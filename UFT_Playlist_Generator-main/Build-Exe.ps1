$scriptPath = Join-Path $PSScriptRoot 'UFT-PlaylistGenerator.ps1'
$outputPath = Join-Path $PSScriptRoot 'UFT-PlaylistGenerator.exe'

if (-not (Get-Module -ListAvailable -Name ps2exe)) {
    Install-Module -Name ps2exe -Scope CurrentUser -Force
}

Import-Module ps2exe -ErrorAction Stop

$invokeParams = @{
    inputFile    = $scriptPath
    outputFile   = $outputPath
    noConsole    = $true
    title        = 'UFT Playlist Generator'
    product      = 'UFT Playlist Generator'
    company      = 'JohnieTheLou'
    requireAdmin = $false
}

Invoke-PS2EXE @invokeParams

Write-Host "Build completed successfully: $outputPath"
