$ErrorActionPreference = 'Stop'

$source = Join-Path $PSScriptRoot 'Start-Windows.ps1'
$output = Join-Path $PSScriptRoot 'ADOWorkItemLauncher.exe'
if (-not (Get-Module -ListAvailable -Name ps2exe)) {
    throw 'ps2exe is required. Install it with: Install-Module ps2exe -Scope CurrentUser'
}

Import-Module ps2exe -ErrorAction Stop
Invoke-ps2exe -inputFile $source -outputFile $output -noConsole `
    -title 'ADO Work Item AI Assistant' -description 'Windowless ADO Work Item AI Assistant launcher'
Write-Host "Built $output"
