# Lumen

Lumen is a Windows tray app for controlling monitor brightness. Set a level immediately, make a gradual change, or schedule one for later.

## Features

- Control external monitors through DDC/CI and supported laptop displays through Windows brightness controls.
- Adjust one display or all displays together.
- Fade to a target brightness over a chosen duration, with even, early, or late pacing.
- Schedule one-time changes or repeat them on selected weekdays.
- Stop an active transition or override it by moving a slider.
- Start with Windows if you enable it from the tray menu.

## Requirements

- Windows 10 or 11
- DDC/CI enabled in the monitor menu for external displays

Display support depends on the monitor and connection. Displays without a supported hardware brightness control are not shown.

## Run

Download the portable EXE from **Releases** and run it. Click the Lumen tray icon to adjust brightness or open **Schedules**. Right-click the icon to refresh displays, change the startup setting, or quit.

Settings and schedules are stored locally in the app's user data folder.

## Build from source

Install Node.js and npm, then run on Windows:

```powershell
npm ci
npm start
```

Run `npm test` for the controller tests or `npm run dist` to build the portable Windows EXE and ZIP.
