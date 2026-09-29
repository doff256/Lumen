# Lumen

A Windows 10/11 tray app for monitor brightness, gradual transitions, and local-time schedules.

## Use

1. Run `Lumen-1.0.0-portable.exe`. Windows may show a SmartScreen prompt because this personal build is unsigned.
2. Click the square Lumen icon in the system tray. For an external display, enable **DDC/CI** in the monitor's own menu. Laptops with Windows WMI brightness support appear as a built-in display.
3. Drag a display slider to set its brightness instantly. With multiple displays, the bottom slider shows their average and sets all of them together. In **Make a change**, pick a target, a duration, and an even, early, or late curve. **Now** means an instant change.
4. Open **Schedules** to create a one-time action or a repeat on selected weekdays. A schedule begins at the selected local time and ramps from the actual brightness then.

Dragging a brightness slider cancels that display's active transition. A later schedule still runs. A new transition replaces the active one for its selected display. The **Stop** button halts all active transitions at their current level.

Right-click the tray icon to refresh displays, set Windows login startup, or quit. Closing the popup leaves the tray app running. Schedules and active transitions are saved in `%APPDATA%\lumen-brightness\settings.json` (Electron's user data path may include the product name). A transition that finishes while the app is closed applies its final target when the app is reopened. Missed schedule start times while the app is not running are skipped. Sleep catch-up is limited to one minute so old changes do not fire unexpectedly.

## Design and behavior plan

| Surface | Decision |
| --- | --- |
| Tray popup | One dense column, sharp corners, clear type, simple divider lines. Display sliders first; the target and timing action remain visible below. |
| Immediate action | Target 0–100%, display or all, duration 0–1440 minutes, even/early/late progression. Current brightness is captured when Start is pressed. |
| Schedules | Same target, duration and curve; adds a one-time date or local time and repeat days. Show upcoming time, enable/disable and remove. |
| During a transition | Show current and target values, completion time and progress. Manual display adjustment stops only that display's ramp. |
| Storage | Local JSON file, written atomically. No account, telemetry, network calls, or background service beyond the tray process. |

The UI uses a restrained charcoal palette, square geometry, tabular brightness figures and one lime accent for controls and state. It avoids glass effects, gradients on surfaces, decorative cards, and motion that competes with the actual brightness transition.

## Build from source

Requires Node.js 20+ and npm. On Windows run `npm install`, then `npm start`. `npm run dist` builds a portable EXE and a ZIP distribution. On a non-Windows development machine the app uses two simulated displays so the UI can be reviewed; real hardware control only runs on Windows.

`npm test` checks interpolation, multi-display independence, manual overrides and schedule firing. The DDC/CI bridge is Windows-specific and must be checked on actual hardware.

## Hardware notes

External displays use Windows' `GetPhysicalMonitorsFromHMONITOR`, `GetMonitorBrightness` and `SetMonitorBrightness` APIs. The bridge translates a display's reported hardware min/max to the UI's 0–100% range. Built-in panels use `WmiMonitorBrightness`/`WmiSetBrightness`. Displays that expose neither are omitted; there is no software gamma dimming fallback. Some monitors, cables and dock connections block or slow DDC/CI, and this implementation cannot be verified against your exact hardware from the build machine. If a monitor moves to another Windows display position, a saved schedule targeting it may need to be recreated.

The app has no affiliation with Twinkle Tray. It is a separate implementation focused on the workflow above.
