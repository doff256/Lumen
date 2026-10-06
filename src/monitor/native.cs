using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Management;
using Microsoft.Win32;
using System.Text;
using System.Web.Script.Serialization;

public static class BrightnessNative {
  static IntPtr cachedHandle = IntPtr.Zero;
  static string cachedId;
  static uint cachedMin, cachedMax;
  static ManagementObject wmiMethod;
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
  public static int Main(string[] args) {
    Console.OutputEncoding = new UTF8Encoding(false); Console.InputEncoding = new UTF8Encoding(false);
    try {
      if (args.Length > 0 && args[0] != "serve") {
        Console.WriteLine(Json.Serialize(Execute(args[0], args.Length > 1 ? args[1] : null, args.Length > 2 ? Int32.Parse(args[2]) : 0))); return 0;
      }
      string line;
      while ((line = Console.ReadLine()) != null) {
        object requestId = null;
        try {
          var request = Json.Deserialize<Dictionary<string, object>>(line);
          requestId = request["id"];
          object result = Execute((string)request["op"], request.ContainsKey("monitorId") ? (string)request["monitorId"] : null, request.ContainsKey("value") ? Convert.ToInt32(request["value"]) : 0);
          Console.WriteLine(Json.Serialize(new { id = requestId, result = result }));
        } catch (Exception ex) { Release(); Console.WriteLine(Json.Serialize(new { id = requestId, error = ex.Message })); }
      }
      return 0;
    } catch (Exception ex) { Console.Error.WriteLine(ex.Message); return 1; }
    finally { Release(); }
  }
  static object Execute(string op, string id, int value) {
    if (op == "list") return List();
    if (op == "wmi-list") return WmiList();
    if (op == "get") return Get(id);
    if (op == "set") { Set(id, value); return true; }
    if (op == "display-off") { TurnOffDisplays(); return true; }
    throw new Exception("Unknown monitor command.");
  }
  static void Release() {
    if (cachedHandle != IntPtr.Zero) DestroyPhysicalMonitor(cachedHandle);
    cachedHandle = IntPtr.Zero; cachedId = null;
    if (wmiMethod != null) wmiMethod.Dispose(); wmiMethod = null;
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
  [DllImport("user32.dll", EntryPoint = "PostMessageW", SetLastError = true)] private static extern bool PostMessage(IntPtr window, uint message, IntPtr command, IntPtr state);
  [DllImport("dxva2.dll", SetLastError = true)] private static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr monitor, out uint count);
  [DllImport("dxva2.dll", SetLastError = true)] private static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr monitor, uint count, [Out] PhysicalMonitor[] items);
  [DllImport("dxva2.dll", SetLastError = true)] private static extern bool DestroyPhysicalMonitors(uint count, PhysicalMonitor[] items);
  [DllImport("dxva2.dll", SetLastError = true)] private static extern bool GetMonitorBrightness(IntPtr monitor, out uint min, out uint current, out uint max);
  [DllImport("dxva2.dll", SetLastError = true)] private static extern bool SetMonitorBrightness(IntPtr monitor, uint value);

  [DllImport("dxva2.dll", SetLastError = true)] private static extern bool DestroyPhysicalMonitor(IntPtr monitor);
  static void TurnOffDisplays() {
    // WM_SYSCOMMAND / SC_MONITORPOWER / 2 requests Windows display power-off.
    if (!PostMessage(new IntPtr(0xffff), 0x0112, new IntPtr(0xF170), new IntPtr(2)))
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  }
  public class Display {
    public string id { get; set; } public string edidId { get; set; }
    public string name { get; set; } public int brightness { get; set; }
    public string type { get; set; }
  }
  static Display Describe(string pathId, string description) {
    var result = new Display { id = pathId, name = description, type = "DDC/CI" };
    try {
      string[] parts = pathId.Split('#');
      if (parts.Length < 3) return result;
      using (var key = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Enum\DISPLAY\" + parts[1] + @"\" + parts[2] + @"\Device Parameters")) {
        var bytes = key == null ? null : key.GetValue("EDID") as byte[];
        if (bytes == null || bytes.Length < 128 || bytes[0] != 0 || bytes[1] != 255) return result;
        int vendor = bytes[8] * 256 + bytes[9];
        string manufacturer = new string(new char[] { (char)(64 + ((vendor >> 10) & 31)), (char)(64 + ((vendor >> 5) & 31)), (char)(64 + (vendor & 31)) });
        int product = bytes[10] + 256 * bytes[11];
        uint serial = BitConverter.ToUInt32(bytes, 12);
        string textSerial = null;
        for (int offset = 54; offset <= 108; offset += 18) {
          if (bytes[offset] != 0 || bytes[offset + 1] != 0 || bytes[offset + 2] != 0) continue;
          string text = Encoding.ASCII.GetString(bytes, offset + 5, 13).Trim('\0', '\n', '\r', ' ');
          if (bytes[offset + 3] == 255) textSerial = text;
          if (bytes[offset + 3] == 252 && text.Length > 0) result.name = text;
        }
        string identity = serial != 0 && serial != UInt32.MaxValue ? serial.ToString("X8") : textSerial;
        if (!String.IsNullOrWhiteSpace(identity) && identity.Trim('0', ' ').Length > 0)
          result.edidId = "edid:" + manufacturer + ":" + product.ToString("X4") + ":" + Uri.EscapeDataString(identity);
      }
    } catch { /* EDID can be absent or inaccessible; retain the device path. */ }
    return result;
  }
  public static Display[] List() {
    var result = new List<Display>();
    Visit((item, display) => { result.Add(display); return false; });
    return result.ToArray();
  }
  static Display Get(string id) {
    if (id.StartsWith("wmi:")) {
      foreach (var panel in WmiList()) if (panel.id == id) return panel;
      throw new Exception("Built-in display is disconnected.");
    }
    Release(); Display found = null;
    Visit((item, display) => {
      if (display.id != id) return false;
      cachedHandle = item.Handle; cachedId = id; found = display; return true;
    });
    uint current;
    if (found == null) throw new Exception("Display is disconnected.");
    if (!GetMonitorBrightness(cachedHandle, out cachedMin, out current, out cachedMax) || cachedMax <= cachedMin) throw new Exception("Display did not respond to DDC/CI.");
    found.brightness = (int)Math.Round(100.0 * (current - cachedMin) / (cachedMax - cachedMin));
    return found;
  }
  static void Set(string id, int percent) {
    percent = Math.Max(0, Math.Min(100, percent));
    if (id.StartsWith("wmi:")) {
      if (cachedId != id || wmiMethod == null) {
        Release();
        using (var search = new ManagementObjectSearcher(@"root\wmi", "SELECT * FROM WmiMonitorBrightnessMethods"))
        using (var rows = search.Get()) {
          foreach (ManagementObject row in rows) {
            if ((string)row["InstanceName"] == id.Substring(4)) wmiMethod = new ManagementObject(row.Path);
            row.Dispose();
          }
        }
        if (wmiMethod == null) throw new Exception("Built-in display is disconnected.");
        cachedId = id;
      }
      using (var input = wmiMethod.GetMethodParameters("WmiSetBrightness")) {
        input["Timeout"] = (UInt64)0; input["Brightness"] = (byte)percent;
        using (var output = wmiMethod.InvokeMethod("WmiSetBrightness", input, null))
          if (Convert.ToUInt32(output["ReturnValue"]) != 0) throw new Exception("Windows rejected the brightness change.");
      }
      return;
    }
    if (cachedHandle == IntPtr.Zero || cachedId != id) Get(id);
    uint raw = (uint)Math.Round(cachedMin + (cachedMax - cachedMin) * percent / 100.0);
    if (!SetMonitorBrightness(cachedHandle, raw)) throw new Exception("Display rejected the brightness change.");
  }
  static string WmiText(object value) {
    var codes = value as UInt16[];
    if (codes == null) return "";
    var text = new StringBuilder(); foreach (var code in codes) if (code != 0) text.Append((char)code);
    return text.ToString().Trim();
  }
  static Display[] WmiList() {
    var result = new List<Display>();
    var identities = new Dictionary<string, Display>(StringComparer.OrdinalIgnoreCase);
    try {
      using (var search = new ManagementObjectSearcher(@"root\wmi", "SELECT * FROM WmiMonitorID WHERE Active=True"))
      using (var rows = search.Get()) foreach (ManagementObject row in rows) {
        string serial = WmiText(row["SerialNumberID"]);
        string edid = serial.Length > 0 && serial.Trim('0', ' ').Length > 0 ? "edid:" + WmiText(row["ManufacturerName"]) + ":" + WmiText(row["ProductCodeID"]) + ":" + Uri.EscapeDataString(serial) : null;
        identities[(string)row["InstanceName"]] = new Display { edidId = edid, name = WmiText(row["UserFriendlyName"]) }; row.Dispose();
      }
    } catch { }
    using (var search = new ManagementObjectSearcher(@"root\wmi", "SELECT * FROM WmiMonitorBrightness WHERE Active=True"))
    using (var rows = search.Get()) foreach (ManagementObject row in rows) {
      string instance = (string)row["InstanceName"]; Display identity; identities.TryGetValue(instance, out identity);
      result.Add(new Display { id = "wmi:" + instance, edidId = identity == null ? null : identity.edidId, name = identity == null || String.IsNullOrWhiteSpace(identity.name) ? "Built-in display" : identity.name, brightness = Convert.ToInt32(row["CurrentBrightness"]), type = "WMI" }); row.Dispose();
    }
    return result.ToArray();
  }
  static void Visit(Func<PhysicalMonitor, Display, bool> visitor) {
    Exception failure = null;
    MonitorProc callback = (IntPtr monitor, IntPtr dc, ref Rect rect, IntPtr data) => {
      try {
        uint count;
        if (!GetNumberOfPhysicalMonitorsFromHMONITOR(monitor, out count) || count == 0 || count > 32) return true;
        var items = new PhysicalMonitor[count];
        if (!GetPhysicalMonitorsFromHMONITOR(monitor, count, items)) return true;
        var keep = new bool[count];
        try {
          for (int i = 0; i < items.Length; i++) {
            string id = "ddc:" + rect.Left + ":" + rect.Top + ":" + (rect.Right - rect.Left) + ":" + (rect.Bottom - rect.Top) + ":" + i;
            var info = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
            var device = new DisplayDevice { Size = Marshal.SizeOf(typeof(DisplayDevice)) };
            if (GetMonitorInfo(monitor, ref info) && EnumDisplayDevices(info.Device, (uint)i, ref device, 1) && !String.IsNullOrWhiteSpace(device.Id)) id = "ddc:path:" + device.Id;
            keep[i] = visitor(items[i], Describe(id, String.IsNullOrWhiteSpace(items[i].Description) ? "External display" : items[i].Description.Trim()));
          }
        } finally { for (int i = 0; i < items.Length; i++) if (!keep[i]) DestroyPhysicalMonitor(items[i].Handle); }
      } catch (Exception ex) { failure = ex; return false; }
      return true;
    };
    bool enumerated = EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, callback, IntPtr.Zero);
    GC.KeepAlive(callback);
    if (failure != null) throw failure;
    if (!enumerated) throw new Exception("Windows could not enumerate displays.");
  }
}
