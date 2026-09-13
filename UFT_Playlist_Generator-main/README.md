# UFT Playlist Generator

A PowerShell + WinForms GUI that generates ladder-style Visual Studio `.playlist` files from a user-supplied text file containing test IDs. No Visual Studio or compilation required.

## Prerequisites

- Windows
- Windows PowerShell 5.1 (included with Windows 10/11) or PowerShell 7+ on Windows

## Run the script directly

You can run the PowerShell GUI in any of these ways:

- Double-click `Run.bat`
- Right-click `UFT-PlaylistGenerator.ps1` and choose **Run with PowerShell**
- Run it manually:

```powershell
powershell -STA -File .\UFT-PlaylistGenerator.ps1
```

The script uses `playlistconfig.json` beside the script/exe to store settings.

## Build an EXE

Run the helper script:

```powershell
powershell -ExecutionPolicy Bypass -File .\Build-Exe.ps1
```

`Build-Exe.ps1` checks whether the `ps2exe` module is available, installs it for the current user if needed, imports it, and then creates `UFT-PlaylistGenerator.exe` in the repo root.

## Important notes about `ps2exe`

- `ps2exe` is a wrapper, not true compilation: the PowerShell script is bundled inside the generated `.exe`
- PowerShell must still be present on the target machine (which it is on Windows 10/11)
- Some antivirus tools may produce false positives for `ps2exe`-generated executables

## Summary

This PowerShell implementation preserves the app's logic, GUI flow, config format, and playlist-generation behavior while avoiding any Visual Studio or compilation requirement for normal use.
