$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
function Get-Displays {
  $displays = @()
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
      if ($request.monitorId -like 'wmi:*') {
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
