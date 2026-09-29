Lumen 1.2.0 fixes overnight schedule reconciliation and makes the popup focus on live brightness control.

- On wake or restart, the latest missed schedule replaces an older saved ramp. Expired occurrences apply their final target immediately; failed writes retry. The 23:00 Night / 07:00 Work overnight case now restores Work.
- Native System.Management replaces PowerShell for laptop brightness. Reusable per-display helper sessions cache DDC handles and min/max, isolate timeouts and recover automatically.
- Working laptop panels remain available after external-display discovery failure. Unresponsive displays retain a disabled row and a visible warning.
- Unique EDID manufacturer/product/serial identities survive port changes. Device paths remain the fallback for missing or duplicate serials. Exact path aliases migrate automatically; unambiguous legacy displays have a one-click migration.
- Live sliders and Night/Work chips come first in a compact popup. Fade to… is collapsed, schedules read as sentences and reference presets, settings autosave, and calibration is under each display's Details.
- Display limits clamp brightness immediately. Idle dimming's input-only behavior is documented in the app and README.

Download the portable EXE or extract the ZIP and run Lumen.exe. Enable DDC/CI in external monitor settings.

**Signing:** these builds remain unsigned. [Code signing policy and SignPath enrollment requirements](https://github.com/doff256/Lumen/blob/main/docs/code-signing.md). SignPath approval and owner setup are still required; no signing application has been submitted on the owner's behalf.
