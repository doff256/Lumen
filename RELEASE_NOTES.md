Lumen 1.1.0 improves display reliability and adds everyday brightness controls.

- Stable Windows device-path IDs, automatic refresh after resume/display changes, and catch-up for schedules whose ramps are still active.
- Manual changes reliably override ramps; slow or failed monitors do not block writes to other displays.
- Compiled DDC/CI helper replaces the PowerShell external-display bridge. No startup C# compilation or execution-policy bypass. WMI PowerShell runs only on demand for laptop panels.
- Live throttled sliders, tray-click debounce, single-instance startup protection, and a visible Start action.
- Ctrl+Alt+Up/Down hotkeys, editable Night/Work presets, sunrise/sunset schedules, perceptual ramps, per-display limits/offsets, and optional idle dimming.
- MIT license, screenshot, and automated Windows release builds.

Download the portable EXE for a single-file launcher, or extract the ZIP and run Lumen.exe. Builds are unsigned. Enable DDC/CI in your monitor menu.

Upgrade note: schedules or saved ramps using old geometry-based display IDs need recreating. Lumen warns about unresolved legacy IDs. Device paths may still change with some dock/port changes.
