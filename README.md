# Lumen

A Windows 10/11 tray app for display brightness, gradual transitions, and schedules.

[Download the latest release](https://github.com/doff256/Lumen/releases/latest) · [MIT license](LICENSE)

![Lumen popup with presets and transition controls](assets/screenshot.png)

## Use

Run the portable EXE, then click Lumen in the system tray. Enable **DDC/CI** in an external monitor's own menu. Supported laptop panels use Windows WMI brightness control.

- **Make a change:** select a display, target and duration. Start stays visible in the 432 × 648 popup. Choose Smooth (perceptual), Early or Late. Now applies instantly.
- **Sliders:** brightness changes while dragging, with updates limited to approximately 125 ms and pending values coalesced. Individual sliders show hardware brightness; All displays applies each panel's calibration.
- **Presets:** Night and Work apply to all displays in one click. Their default targets are 20% and 80%; edit them in Settings.
- **Hotkeys:** Ctrl + Alt + Up/Down adjusts every display by 5 percentage points. Disable shortcuts in Settings if they conflict with another app. Registration conflicts are reported.
- **Schedules:** choose a one-time date, weekday/time repeat, or sunrise/sunset with an offset. Solar schedules require latitude and longitude and are calculated locally. They follow the computer's local calendar and skip dates without the selected solar event.
- **Calibration:** Settings provides minimum, maximum and target offset for each display. Limits clamp every write. Offsets apply to targets and group changes; individual sliders and hotkeys adjust the resulting hardware level directly.
- **Idle dimming:** optionally dim after a chosen number of minutes. Zero disables it. Activity restores the current brightness or ramp position. Ramps continue on their original timeline while dimmed.

A manual change cancels the selected display's ramp. Start replaces its current ramp. Stop cancels active ramps. Right-click the tray icon to refresh, enable login startup, or quit. Closing the popup leaves the tray app running.

## Sleep, reconnects and saved settings

Display changes and resume trigger a refresh. After sleep, the latest missed occurrence for each display resumes if its ramp is still active, jumping to the appropriate curve position. Expired missed occurrences are skipped. Ramps that were already running apply their final target even if they finished during sleep. Schedule start times while Lumen is fully closed are skipped.

Settings, calibration, schedules and ramps are stored in `settings.json` in Electron's user-data directory, normally `%APPDATA%\lumen-brightness`. External monitors use Windows device-interface paths, with geometry as a fallback when Windows supplies no path. Some dock/port changes can create a different device path. Old geometry-ID schedules and ramps need recreating; Lumen warns about unresolved legacy IDs rather than assigning them to an uncertain panel.

## Hardware and architecture

External monitors use a small compiled helper calling `dxva2.dll`. The helper is built once during packaging, runs only for a request, and is terminated after a five-second timeout. Requests for different displays run independently. PowerShell is used only on demand for WMI laptop panels, with UTF-8 input/output, no execution-policy bypass, and no runtime C# compilation. There is no resident bridge process.

Lumen retains Electron for its UI. A native .NET tray UI could reduce its distribution size and memory use, but is not required for the native display helper. Smooth interpolates in approximate gamma 2.2 perceptual space; actual panel response varies. Some docks, cables and displays do not support DDC/CI. Unsupported displays are omitted; there is no software dimming fallback.

Builds are unsigned and Windows may show SmartScreen. Native helper isolation does not replace code signing. There are no accounts, telemetry, location requests, or runtime network calls.

## Development and releases

Use Node.js 22+ and npm on Windows. The native helper uses the .NET Framework C# compiler included with supported Windows versions.

```sh
npm ci
npm test
npm start
npm run test:ui
npm run dist -- --publish never
```

`npm start -- --demo` uses simulated displays. Non-Windows development also uses simulated displays. `test:ui` opens a hidden Electron window, exercises the actual renderer with simulated displays, and refreshes the README screenshot.

Tests cover schedule catch-up, disconnected displays, adapter failures, concurrent/manual writes, calibration, presets, idle restoration, solar events, perceptual curves, helper timeouts, broken pipes and UTF-8. Real DDC compatibility still depends on the connected hardware.

Push a version tag matching `package.json` (for example `v1.1.0`) to test, build the portable EXE and ZIP, and publish them to GitHub Releases. Manual workflow runs produce downloadable build artifacts without publishing a release.
