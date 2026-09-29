$ErrorActionPreference = 'Stop'

$native = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class BrightnessNative {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct PhysicalMonitor {
    public IntPtr Handle;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description;
  }
  private delegate bool MonitorProc(IntPtr monitor, IntPtr dc, ref Rect rect, IntPtr data);
  [DllImport("user32.dll")] private static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, MonitorProc callback, IntPtr data);
  [DllImport("dxva2.dll", SetLastError = true)] private static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr monitor, out uint count);
  [DllImport("dxva2.dll", SetLastError = true)] private static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr monitor, uint count, [Out] PhysicalMonitor[] items);
  [DllImport("dxva2.dll", SetLastError = true)] private static extern bool DestroyPhysicalMonitors(uint count, PhysicalMonitor[] items);
  [DllImport("dxva2.dll", SetLastError = true)] private static extern bool GetMonitorBrightness(IntPtr monitor, out uint min, out uint current, out uint max);
  [DllImport("dxva2.dll", SetLastError = true)] private static extern bool SetMonitorBrightness(IntPtr monitor, uint value);

  public class Display { public string id { get; set; } public string name { get; set; } public int brightness { get; set; } public string type { get; set; } }

  public static Display[] List() {
    var result = new List<Display>();
    Visit((item, id) => {
      uint min, current, max;
      if (GetMonitorBrightness(item.Handle, out min, out current, out max) && max > min) {
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
            // Geometry and the physical index distinguish identical displays on separate outputs.
            string id = "ddc:" + rect.Left + ":" + rect.Top + ":" + (rect.Right - rect.Left) + ":" + (rect.Bottom - rect.Top) + ":" + i;
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
'@

Add-Type -TypeDefinition $native -Language CSharp

function Get-Displays {
  $displays = @([BrightnessNative]::List())
  try {
    $panels = @(Get-WmiObject -Namespace 'root\wmi' -Class WmiMonitorBrightness -ErrorAction Stop | Where-Object { $_.Active })
    foreach ($panel in $panels) {
      $displays += [pscustomobject]@{ id = ('wmi:' + $panel.InstanceName); name = 'Built-in display'; brightness = [int]$panel.CurrentBrightness; type = 'WMI' }
    }
  } catch { } # Desktop PCs normally have no WMI brightness provider.
  return $displays
}

while ($null -ne ($line = [Console]::ReadLine())) {
  try {
    $request = $line | ConvertFrom-Json
    if ($request.op -eq 'list') {
      $result = @(Get-Displays)
    } elseif ($request.op -eq 'set') {
      $brightness = [Math]::Max(0, [Math]::Min(100, [int]$request.value))
      if ($request.monitorId -like 'ddc:*') {
        if (-not [BrightnessNative]::Set([string]$request.monitorId, $brightness)) { throw 'Display was disconnected. Refresh displays.' }
      } elseif ($request.monitorId -like 'wmi:*') {
        $instance = ([string]$request.monitorId).Substring(4)
        $method = Get-WmiObject -Namespace 'root\wmi' -Class WmiMonitorBrightnessMethods -ErrorAction Stop | Where-Object { $_.InstanceName -eq $instance } | Select-Object -First 1
        if ($null -eq $method) { throw 'Built-in display was disconnected.' }
        $response = $method.WmiSetBrightness(0, $brightness)
        if ($response.ReturnValue -ne 0) { throw ('Windows rejected brightness: ' + $response.ReturnValue) }
      } else { throw 'Unknown display.' }
      $result = @{ ok = $true }
    } else { throw 'Unknown command.' }
    [Console]::WriteLine((@{ id = $request.id; result = $result } | ConvertTo-Json -Compress -Depth 6))
  } catch {
    [Console]::WriteLine((@{ id = $request.id; error = $_.Exception.Message } | ConvertTo-Json -Compress -Depth 4))
  }
}
