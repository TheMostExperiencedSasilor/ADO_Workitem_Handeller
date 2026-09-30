# Source for the ADO Work Item AI Assistant Windows launcher.
# Build with ./build_launcher.ps1; users should double-click the generated EXE.

$ErrorActionPreference = 'Stop'

function Get-ProjectRoot {
    # PS2EXE does not consistently populate $PSScriptRoot. Accept either a
    # normal .ps1 path or the directory containing the compiled executable.
    $paths = @(
        $PSCommandPath
        [Environment]::GetCommandLineArgs()[0]
        [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    )
    $locations = @($PSScriptRoot, [AppContext]::BaseDirectory)
    foreach ($path in $paths) {
        if (-not [string]::IsNullOrWhiteSpace($path)) {
            $locations += Split-Path -Parent $path
        }
    }
    foreach ($location in $locations) {
        if ([string]::IsNullOrWhiteSpace($location)) { continue }
        $root = Split-Path -Parent $location
        if (Test-Path -LiteralPath (Join-Path $root 'start_app.py') -PathType Leaf) {
            return $root
        }
    }
    throw 'Cannot find start_app.py next to the launcher directory. Keep the EXE inside launcher/.'
}

function Show-LaunchError([string]$message) {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show(
        $message,
        'ADO Work Item AI Assistant',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning
    )
}

try {
    $projectRoot = Get-ProjectRoot
    $startScript = Join-Path $projectRoot 'start_app.py'
    $venvPython = Join-Path $projectRoot 'backend\.venv\Scripts\pythonw.exe'
    $pythonArguments = '"{0}"' -f $startScript

    if (Test-Path -LiteralPath $venvPython -PathType Leaf) {
        $python = $venvPython
    } else {
        # Only windowless interpreters are used: neither first run nor later
        # launches should leave a Command Prompt / Windows Terminal open.
        $command = Get-Command pyw.exe -ErrorAction SilentlyContinue
        if ($command) {
            $python = $command.Source
            $pythonArguments = '-3 "{0}"' -f $startScript
        } else {
            $command = Get-Command pythonw.exe -ErrorAction SilentlyContinue
            if (-not $command) {
                throw 'Python 3.10+ with pyw.exe or pythonw.exe is required.'
            }
            $python = $command.Source
        }
    }

    $process = Start-Process -FilePath $python -ArgumentList $pythonArguments `
        -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
    # Start-Process -Wait can wait for the entire descendant tree on Windows,
    # including the intentionally detached Flask server. Wait only for Python.
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        throw "Startup returned exit code $($process.ExitCode)."
    }
    # start_app.py has already detached the backend, confirmed /api/health,
    # and opened the browser; the launcher process can now exit naturally.
} catch {
    Show-LaunchError ("ADO Work Item AI Assistant could not start.`r`n`r`n" +
        "$($_.Exception.Message)`r`n`r`nSee logs\launcher.log and logs\backend.log for details.")
    exit 1
}
