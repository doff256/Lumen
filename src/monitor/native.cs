using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class BrightnessNative {
  public static int Main(string[] args) {
    Console.OutputEncoding = new System.Text.UTF8Encoding(false);
    try {
      object result;
      if (args[0] == "list") result = List(false, null);
      else if (args[0] == "get") result = List(true, args[1]);
      else if (args[0] == "set") { if (!Set(args[1], Int32.Parse(args[2]))) throw new Exception("Display disconnected."); result = true; }
      else throw new Exception("Unknown command.");
      Console.WriteLine(new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(result)); return 0;
    } catch (Exception ex) { Console.Error.WriteLine(ex.Message); return 1; }
  }
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct PhysicalMonitor {
    public IntPtr Handle;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description;
  }
  private delegate bool MonitorProc(IntPtr monitor, IntPtr dc, ref Rect rect, IntPtr data);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Device; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DisplayDevice { public int Size; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Name; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description; public uint Flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Id; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Key; }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool EnumDisplayDevices(string device, uint index, ref DisplayDevice info, uint flags);
  [DllImport("user32.dll")] private static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, MonitorProc callback, IntPtr data);
  [DllImport("dxva2.dll", SetLastError = true)] private static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr monitor, out uint count);
  [DllImport("dxva2.dll", SetLastError = true)] private static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr monitor, uint count, [Out] PhysicalMonitor[] items);
  [DllImport("dxva2.dll", SetLastError = true)] private static extern bool DestroyPhysicalMonitors(uint count, PhysicalMonitor[] items);
  [DllImport("dxva2.dll", SetLastError = true)] private static extern bool GetMonitorBrightness(IntPtr monitor, out uint min, out uint current, out uint max);
  [DllImport("dxva2.dll", SetLastError = true)] private static extern bool SetMonitorBrightness(IntPtr monitor, uint value);

  public class Display { public string id { get; set; } public string name { get; set; } public int brightness { get; set; } public string type { get; set; } }

  public static Display[] List(bool read, string wanted) {
    var result = new List<Display>();
    Visit((item, id) => {
      if (wanted != null && id != wanted) return;
      uint min = 0, current = 0, max = 100;
      if (!read || GetMonitorBrightness(item.Handle, out min, out current, out max) && max > min) {
        result.Add(new Display { id = id, name = String.IsNullOrWhiteSpace(item.Description) ? "External display" : item.Description.Trim(), brightness = (int)Math.Round(100.0 * (current - min) / (max - min)), type = "DDC/CI" });
      }
    });
    return result.ToArray();
  }

  public static bool Set(string id, int percent) {
    bool changed = false;
    Visit((item, itemId) => {
      if (itemId != id) return;
      uint min, current, max;
      if (!GetMonitorBrightness(item.Handle, out min, out current, out max)) throw new Exception("Display did not respond to DDC/CI. Check its on-screen settings.");
      uint raw = (uint)Math.Round(min + (max - min) * Math.Max(0, Math.Min(100, percent)) / 100.0);
      if (!SetMonitorBrightness(item.Handle, raw)) throw new Exception("Display rejected the brightness change.");
      changed = true;
    });
    return changed;
  }

  private static void Visit(Action<PhysicalMonitor, string> visitor) {
    int logical = 0;
    Exception failure = null;
    MonitorProc callback = (IntPtr monitor, IntPtr dc, ref Rect rect, IntPtr data) => {
      try {
        logical++;
        uint count;
        if (!GetNumberOfPhysicalMonitorsFromHMONITOR(monitor, out count) || count == 0 || count > 32) return true;
        var items = new PhysicalMonitor[count];
        if (!GetPhysicalMonitorsFromHMONITOR(monitor, count, items)) return true;
        try {
          for (int i = 0; i < items.Length; i++) {
            string id = "ddc:" + rect.Left + ":" + rect.Top + ":" + (rect.Right - rect.Left) + ":" + (rect.Bottom - rect.Top) + ":" + i;
            var info = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
            var device = new DisplayDevice { Size = Marshal.SizeOf(typeof(DisplayDevice)) };
            if (GetMonitorInfo(monitor, ref info) && EnumDisplayDevices(info.Device, (uint)i, ref device, 1) && !String.IsNullOrWhiteSpace(device.Id))
              id = "ddc:path:" + device.Id;
            visitor(items[i], id);
          }
        } finally { DestroyPhysicalMonitors(count, items); }
      } catch (Exception ex) { failure = ex; return false; }
      return true;
    };
    bool enumerated = EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, callback, IntPtr.Zero);
    GC.KeepAlive(callback);
    if (failure != null) throw failure;
    if (!enumerated) throw new Exception("Windows could not enumerate displays.");
  }
}