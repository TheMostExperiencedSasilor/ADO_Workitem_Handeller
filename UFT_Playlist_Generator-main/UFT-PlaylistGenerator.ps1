Set-StrictMode -Version Latest

function Get-ApplicationBaseDirectory {
    if ($PSCommandPath) {
        return (Split-Path -Parent $PSCommandPath)
    }

    if ($MyInvocation.MyCommand.Path) {
        return (Split-Path -Parent $MyInvocation.MyCommand.Path)
    }

    return [System.AppContext]::BaseDirectory
}

function New-AppConfig {
    [pscustomobject][ordered]@{
        LastListPath          = $null
        Project               = 'AspenHYSYS'
        Namespace             = 'TestCases'
        ProductTestClass      = 'ProductTestCase'
        SampleTestClass       = 'ClassSampleTest'
        SolutionValue         = $null
        EnforcePattern        = $true
        OutputMode            = 'SameAsList'
        CustomOutputDirectory = $null
        OutputFileName        = 'Playlist.playlist'
    }
}

function Repair-AppConfig {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Config
    )

    $defaults = New-AppConfig
    foreach ($property in $defaults.PSObject.Properties.Name) {
        $existing = $Config.PSObject.Properties[$property]
        if ($null -ne $existing) {
            $defaults.$property = $existing.Value
        }
    }

    if ([string]::IsNullOrWhiteSpace($defaults.OutputFileName)) {
        $defaults.OutputFileName = 'Playlist.playlist'
    }

    if ($defaults.OutputMode -ne 'SameAsList' -and $defaults.OutputMode -ne 'CustomDirectory') {
        $defaults.OutputMode = 'SameAsList'
    }

    return $defaults
}

function Load-AppConfig {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    try {
        if (Test-Path -LiteralPath $Path) {
            $json = [System.IO.File]::ReadAllText($Path)
            $config = $json | ConvertFrom-Json
            if ($null -ne $config) {
                return (Repair-AppConfig -Config $config)
            }
        }
    }
    catch {
        # Ignore parse errors and return defaults.
    }

    return (New-AppConfig)
}

function Save-AppConfig {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Config,

        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    try {
        $json = (Repair-AppConfig -Config $Config) | ConvertTo-Json -Depth 5
        [System.IO.File]::WriteAllText($Path, $json)
    }
    catch {
        # Not critical during runtime.
    }
}

function New-PlaylistStats {
    [pscustomobject][ordered]@{
        RawLines   = 0
        Valid      = 0
        Duplicates = 0
        Invalid    = 0
        Ids        = (New-Object 'System.Collections.Generic.List[string]')
    }
}

function Load-Ids {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [bool]$EnforcePattern,

        [string]$Pattern = '^VSTS[A-Za-z0-9]+$'
    )

    $stats = New-PlaylistStats
    if (-not (Test-Path -LiteralPath $Path)) {
        return $stats
    }

    $regex = $null
    if ($EnforcePattern) {
        $regex = [System.Text.RegularExpressions.Regex]::new($Pattern)
    }

    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $lines = [System.IO.File]::ReadAllLines($Path)
    $stats.RawLines = $lines.Length

    foreach ($raw in $lines) {
        $line = $raw.Trim()
        if ($line.Length -eq 0) {
            continue
        }

        if ($line.StartsWith('#') -or $line.StartsWith('//')) {
            continue
        }

        if ($null -ne $regex -and -not $regex.IsMatch($line)) {
            $stats.Invalid++
            continue
        }

        if (-not $seen.Add($line)) {
            $stats.Duplicates++
            continue
        }

        [void]$stats.Ids.Add($line)
    }

    $stats.Valid = $stats.Ids.Count
    return $stats
}

function Escape-XmlValue {
    param(
        [AllowNull()]
        [string]$Value
    )

    $escaped = [System.Security.SecurityElement]::Escape($Value)
    if ($null -eq $escaped) {
        return [string]::Empty
    }

    return $escaped
}

function Build-PlaylistXml {
    param(
        [Parameter(Mandatory = $true)]
        [System.Collections.Generic.IReadOnlyList[string]]$Ids,

        [Parameter(Mandatory = $true)]
        [string]$Project,

        [Parameter(Mandatory = $true)]
        [string]$Namespace,

        [Parameter(Mandatory = $true)]
        [string]$Class,

        [AllowNull()]
        [string]$SolutionValue
    )

    $builder = [System.Text.StringBuilder]::new()
    [void]$builder.AppendLine('<Playlist Version="2.0">')
    [void]$builder.AppendLine('  <Rule Name="Includes" Match="Any">')
    [void]$builder.AppendLine('    <Rule Match="All">')

    if ([string]::IsNullOrWhiteSpace($SolutionValue)) {
        [void]$builder.AppendLine('      <Property Name="Solution" />')
    }
    else {
        [void]$builder.AppendLine(('      <Property Name="Solution" Value="{0}" />' -f (Escape-XmlValue $SolutionValue)))
    }

    [void]$builder.AppendLine('      <Rule Match="Any">')
    [void]$builder.AppendLine('        <Rule Match="All">')
    [void]$builder.AppendLine(('          <Property Name="Project" Value="{0}" />' -f (Escape-XmlValue $Project)))
    [void]$builder.AppendLine('          <Rule Match="Any">')
    [void]$builder.AppendLine('            <Rule Match="All">')
    [void]$builder.AppendLine(('              <Property Name="Namespace" Value="{0}" />' -f (Escape-XmlValue $Namespace)))
    [void]$builder.AppendLine('              <Rule Match="Any">')
    [void]$builder.AppendLine('                <Rule Match="All">')
    [void]$builder.AppendLine(('                  <Property Name="Class" Value="{0}" />' -f (Escape-XmlValue $Class)))
    [void]$builder.AppendLine('                  <Rule Match="Any">')

    foreach ($id in $Ids) {
        $fqn = "$Namespace.$Class.$id"
        [void]$builder.AppendLine('                    <Rule Match="All">')
        [void]$builder.AppendLine(('                      <Property Name="TestWithNormalizedFullyQualifiedName" Value="{0}" />' -f (Escape-XmlValue $fqn)))
        [void]$builder.AppendLine('                      <Rule Match="Any">')
        [void]$builder.AppendLine(('                        <Property Name="DisplayName" Value="{0}" />' -f (Escape-XmlValue $id)))
        [void]$builder.AppendLine('                      </Rule>')
        [void]$builder.AppendLine('                    </Rule>')
    }

    [void]$builder.AppendLine('                  </Rule>')
    [void]$builder.AppendLine('                </Rule>')
    [void]$builder.AppendLine('              </Rule>')
    [void]$builder.AppendLine('            </Rule>')
    [void]$builder.AppendLine('          </Rule>')
    [void]$builder.AppendLine('        </Rule>')
    [void]$builder.AppendLine('      </Rule>')
    [void]$builder.AppendLine('    </Rule>')
    [void]$builder.AppendLine('  </Rule>')
    [void]$builder.AppendLine('</Playlist>')

    return $builder.ToString()
}

function Build-LadderXml {
    param(
        [Parameter(Mandatory = $true)]
        [System.Collections.Generic.IReadOnlyList[string]]$Ids,

        [Parameter(Mandatory = $true)]
        [string]$Project,

        [Parameter(Mandatory = $true)]
        [string]$Namespace,

        [Parameter(Mandatory = $true)]
        [string]$Class,

        [AllowNull()]
        [string]$SolutionValue
    )

    return (Build-PlaylistXml -Ids $Ids -Project $Project -Namespace $Namespace -Class $Class -SolutionValue $SolutionValue)
}

function Build-SampleCasesXml {
    param(
        [Parameter(Mandatory = $true)]
        [System.Collections.Generic.IReadOnlyList[string]]$Ids,

        [Parameter(Mandatory = $true)]
        [string]$Project,

        [Parameter(Mandatory = $true)]
        [string]$Namespace,

        [Parameter(Mandatory = $true)]
        [string]$Class,

        [AllowNull()]
        [string]$SolutionValue
    )

    return (Build-PlaylistXml -Ids $Ids -Project $Project -Namespace $Namespace -Class $Class -SolutionValue $SolutionValue)
}

function Resolve-OutputPath {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Config,

        [AllowNull()]
        [string]$ListPath
    )

    if ($Config.OutputMode -eq 'CustomDirectory' -and -not [string]::IsNullOrWhiteSpace($Config.CustomOutputDirectory)) {
        $baseDirectory = $Config.CustomOutputDirectory
    }
    else {
        $baseDirectory = if ($ListPath) {
            [System.IO.Path]::GetDirectoryName($ListPath)
        }
        else {
            Get-ApplicationBaseDirectory
        }
    }

    $fileName = $Config.OutputFileName
    if ([string]::IsNullOrWhiteSpace($fileName)) {
        $fileName = 'Playlist.playlist'
    }

    foreach ($invalidCharacter in [System.IO.Path]::GetInvalidFileNameChars()) {
        $fileName = $fileName.Replace($invalidCharacter, '_')
    }

    if (-not $fileName.EndsWith('.playlist', [System.StringComparison]::OrdinalIgnoreCase)) {
        $fileName += '.playlist'
    }

    return [System.IO.Path]::Combine($baseDirectory, $fileName)
}

function Show-OptionsDialog {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Config,

        [Parameter(Mandatory = $true)]
        [System.Windows.Forms.IWin32Window]$Owner
    )

    $dialog = New-Object System.Windows.Forms.Form
    $dialog.Text = 'Options'
    $dialog.Width = 455
    $dialog.Height = 300
    $dialog.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
    $dialog.MaximizeBox = $false
    $dialog.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterParent

    $txtProject = New-Object System.Windows.Forms.TextBox
    $txtProject.Left = 160
    $txtProject.Top = 20
    $txtProject.Width = 240
    $txtProject.Text = $Config.Project

    $txtNamespace = New-Object System.Windows.Forms.TextBox
    $txtNamespace.Left = 160
    $txtNamespace.Top = 55
    $txtNamespace.Width = 240
    $txtNamespace.Text = $Config.Namespace

    $txtClass = New-Object System.Windows.Forms.TextBox
    $txtClass.Left = 160
    $txtClass.Top = 90
    $txtClass.Width = 240
    $txtClass.Text = $Config.ProductTestClass

    $txtSolution = New-Object System.Windows.Forms.TextBox
    $txtSolution.Left = 160
    $txtSolution.Top = 125
    $txtSolution.Width = 240
    $txtSolution.Text = if ($null -ne $Config.SolutionValue) { $Config.SolutionValue } else { '' }

    $chkPattern = New-Object System.Windows.Forms.CheckBox
    $chkPattern.Left = 160
    $chkPattern.Top = 160
    $chkPattern.Width = 300
    $chkPattern.Text = 'Enforce ^VSTS[A-Za-z0-9]+$ pattern'
    $chkPattern.Checked = [bool]$Config.EnforcePattern

    $btnOk = New-Object System.Windows.Forms.Button
    $btnOk.Left = 160
    $btnOk.Top = 200
    $btnOk.Width = 100
    $btnOk.Text = 'OK'

    $btnCancel = New-Object System.Windows.Forms.Button
    $btnCancel.Left = 280
    $btnCancel.Top = 200
    $btnCancel.Width = 100
    $btnCancel.Text = 'Cancel'

    $controls = @(
        (New-Object System.Windows.Forms.Label -Property @{ Left = 20; Top = 23; Width = 130; Text = 'Project:' }),
        $txtProject,
        (New-Object System.Windows.Forms.Label -Property @{ Left = 20; Top = 58; Width = 130; Text = 'Namespace:' }),
        $txtNamespace,
        (New-Object System.Windows.Forms.Label -Property @{ Left = 20; Top = 93; Width = 130; Text = 'Class:' }),
        $txtClass,
        (New-Object System.Windows.Forms.Label -Property @{ Left = 20; Top = 128; Width = 130; Text = 'Solution Value:' }),
        $txtSolution,
        $chkPattern,
        $btnOk,
        $btnCancel
    )
    [void]$dialog.Controls.AddRange([System.Windows.Forms.Control[]]$controls)

    $btnOk.Add_Click({
        if ([string]::IsNullOrWhiteSpace($txtProject.Text) -or
            [string]::IsNullOrWhiteSpace($txtNamespace.Text) -or
            [string]::IsNullOrWhiteSpace($txtClass.Text)) {
            [System.Windows.Forms.MessageBox]::Show(
                $dialog,
                'Project, Namespace, and Class cannot be blank.',
                'Validation',
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Warning
            ) | Out-Null
            return
        }

        $Config.Project = $txtProject.Text.Trim()
        $Config.Namespace = $txtNamespace.Text.Trim()
        $Config.ProductTestClass = $txtClass.Text.Trim()
        $Config.SolutionValue = if ([string]::IsNullOrWhiteSpace($txtSolution.Text)) { $null } else { $txtSolution.Text.Trim() }
        $Config.EnforcePattern = $chkPattern.Checked
        $dialog.DialogResult = [System.Windows.Forms.DialogResult]::OK
        $dialog.Close()
    }.GetNewClosure())

    $btnCancel.Add_Click({
        $dialog.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
        $dialog.Close()
    }.GetNewClosure())

    return $dialog.ShowDialog($Owner)
}

function New-MainForm {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Config,

        [Parameter(Mandatory = $true)]
        [string]$ConfigPath
    )

    $state = [pscustomobject]@{
        CurrentStats = $null
        ListPath     = $null
    }

    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'UFT Playlist Generator'
    $form.Width = 680
    $form.Height = 360
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
    $form.MaximizeBox = $false
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen

    $txtList = New-Object System.Windows.Forms.TextBox
    $txtList.Left = 20
    $txtList.Top = 50
    $txtList.Width = 480
    $txtList.ReadOnly = $true

    $btnSelect = New-Object System.Windows.Forms.Button
    $btnSelect.Left = 510
    $btnSelect.Top = 48
    $btnSelect.Width = 110
    $btnSelect.Text = 'Select List...'

    $btnRefresh = New-Object System.Windows.Forms.Button
    $btnRefresh.Left = 20
    $btnRefresh.Top = 85
    $btnRefresh.Width = 100
    $btnRefresh.Text = 'Refresh'
    $btnRefresh.Enabled = $false

    $btnGenerate = New-Object System.Windows.Forms.Button
    $btnGenerate.Left = 130
    $btnGenerate.Top = 85
    $btnGenerate.Width = 120
    $btnGenerate.Text = 'Generate'
    $btnGenerate.Enabled = $false

    $chkOpen = New-Object System.Windows.Forms.CheckBox
    $chkOpen.Left = 20
    $chkOpen.Top = 118
    $chkOpen.Width = 140
    $chkOpen.Text = 'Open folder after'

    $rbProductTestCase = New-Object System.Windows.Forms.RadioButton
    $rbProductTestCase.Left = 180
    $rbProductTestCase.Top = 118
    $rbProductTestCase.Width = 150
    $rbProductTestCase.Text = 'Product Test Case'
    $rbProductTestCase.Checked = $true
    $rbProductTestCase.TabStop = $true

    $rbSampleCases = New-Object System.Windows.Forms.RadioButton
    $rbSampleCases.Left = 340
    $rbSampleCases.Top = 118
    $rbSampleCases.Width = 120
    $rbSampleCases.Text = 'Sample Cases'
    $rbSampleCases.TabStop = $true

    $lblSummary = New-Object System.Windows.Forms.Label
    $lblSummary.Left = 20
    $lblSummary.Top = 150
    $lblSummary.Width = 620
    $lblSummary.Height = 60
    $lblSummary.Text = 'No file selected.'

    $lblOutputCaption = New-Object System.Windows.Forms.Label
    $lblOutputCaption.Left = 20
    $lblOutputCaption.Top = 215
    $lblOutputCaption.Width = 120
    $lblOutputCaption.Text = 'Output Target:'

    $txtResolvedOutput = New-Object System.Windows.Forms.TextBox
    $txtResolvedOutput.Left = 20
    $txtResolvedOutput.Top = 245
    $txtResolvedOutput.Width = 600
    $txtResolvedOutput.ReadOnly = $true

    $statusStrip = New-Object System.Windows.Forms.StatusStrip
    $statusLabel = New-Object System.Windows.Forms.ToolStripStatusLabel 'Ready'
    [void]$statusStrip.Items.Add($statusLabel)
    $statusStrip.Dock = [System.Windows.Forms.DockStyle]::Bottom

    $menu = New-Object System.Windows.Forms.MenuStrip
    $fileMenu = New-Object System.Windows.Forms.ToolStripMenuItem '&File'
    $miSelect = New-Object System.Windows.Forms.ToolStripMenuItem 'Select List...'
    $miGenerate = New-Object System.Windows.Forms.ToolStripMenuItem 'Generate Playlist'
    $miGenerate.Enabled = $false
    $miExit = New-Object System.Windows.Forms.ToolStripMenuItem 'Exit'
    $toolsMenu = New-Object System.Windows.Forms.ToolStripMenuItem '&Tools'
    $miOptions = New-Object System.Windows.Forms.ToolStripMenuItem 'Options...'
    $fileMenu.DropDownItems.AddRange([System.Windows.Forms.ToolStripItem[]]@($miSelect, $miGenerate, (New-Object System.Windows.Forms.ToolStripSeparator), $miExit))
    $toolsMenu.DropDownItems.Add($miOptions) | Out-Null
    $menu.Items.AddRange([System.Windows.Forms.ToolStripItem[]]@($fileMenu, $toolsMenu))

    $setStatus = {
        param([string]$Text)
        $statusLabel.Text = $Text
        $statusStrip.Refresh()
    }.GetNewClosure()

    $updateResolvedOutputPreview = {
        if ($null -eq $state.ListPath) {
            $txtResolvedOutput.Text = '(Select a list file first)'
        }
        else {
            $txtResolvedOutput.Text = Resolve-OutputPath -Config $Config -ListPath $state.ListPath
        }
    }.GetNewClosure()

    $refreshStats = {
        if ($null -eq $state.ListPath) {
            return
        }

        $state.CurrentStats = Load-Ids -Path $state.ListPath -EnforcePattern ([bool]$Config.EnforcePattern)
        $btnRefresh.Enabled = $true

        if ($state.CurrentStats.Valid -eq 0) {
            $btnGenerate.Enabled = $false
            $lblSummary.Text = "File: $($state.ListPath)`r`nValid: 0  (Duplicates=$($state.CurrentStats.Duplicates), Invalid=$($state.CurrentStats.Invalid))"
            & $setStatus 'No valid IDs.'
        }
        else {
            $btnGenerate.Enabled = $true
            $lblSummary.Text = "File: $($state.ListPath)`r`nRaw: $($state.CurrentStats.RawLines)  Valid: $($state.CurrentStats.Valid)  Duplicates: $($state.CurrentStats.Duplicates)  Invalid: $($state.CurrentStats.Invalid)"
            & $setStatus 'IDs loaded.'
        }

        & $updateResolvedOutputPreview
    }.GetNewClosure()

    $selectList = {
        $dialog = New-Object System.Windows.Forms.OpenFileDialog
        $dialog.Title = 'Select List of Test IDs'
        $dialog.Filter = 'Text Files (*.txt)|*.txt|All Files (*.*)|*.*'
        try {
            if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {
                $state.ListPath = $dialog.FileName
                $txtList.Text = $state.ListPath
                $Config.LastListPath = $state.ListPath
                Save-AppConfig -Config $Config -Path $ConfigPath
                & $refreshStats
                & $updateResolvedOutputPreview
            }
        }
        finally {
            $dialog.Dispose()
        }
    }.GetNewClosure()

    $generatePlaylist = {
        if ($null -eq $state.ListPath -or $null -eq $state.CurrentStats -or $state.CurrentStats.Valid -eq 0) {
            return
        }

        $dialog = New-Object System.Windows.Forms.SaveFileDialog
        $dialog.Title = 'Save Playlist As'
        $dialog.Filter = 'Playlist Files (*.playlist)|*.playlist|All Files (*.*)|*.*'
        $dialog.FileName = $Config.OutputFileName
        $dialog.InitialDirectory = if (-not [string]::IsNullOrWhiteSpace($Config.CustomOutputDirectory)) {
            $Config.CustomOutputDirectory
        }
        elseif ($null -ne $state.ListPath) {
            [System.IO.Path]::GetDirectoryName($state.ListPath)
        }
        else {
            Get-ApplicationBaseDirectory
        }

        try {
            if ($dialog.ShowDialog($form) -ne [System.Windows.Forms.DialogResult]::OK) {
                return
            }

            $outputPath = $dialog.FileName

            try {
                [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($outputPath)) | Out-Null

                $selectedClass = if ($rbSampleCases.Checked) {
                    $Config.SampleTestClass
                }
                else {
                    $Config.ProductTestClass
                }

                $xml = if ($rbSampleCases.Checked) {
                    Build-SampleCasesXml -Ids $state.CurrentStats.Ids -Project $Config.Project -Namespace $Config.Namespace -Class $selectedClass -SolutionValue $Config.SolutionValue
                }
                else {
                    Build-LadderXml -Ids $state.CurrentStats.Ids -Project $Config.Project -Namespace $Config.Namespace -Class $selectedClass -SolutionValue $Config.SolutionValue
                }

                [System.IO.File]::WriteAllText($outputPath, $xml, (New-Object System.Text.UTF8Encoding $true))

                [System.Windows.Forms.MessageBox]::Show(
                    $form,
                    "Playlist generated.`nTests: $($state.CurrentStats.Valid)`nFile: $outputPath",
                    'Success',
                    [System.Windows.Forms.MessageBoxButtons]::OK,
                    [System.Windows.Forms.MessageBoxIcon]::Information
                ) | Out-Null

                & $setStatus 'Playlist generated.'

                if ($chkOpen.Checked) {
                    try {
                        Start-Process explorer.exe "/select,`"$outputPath`""
                    }
                    catch {
                        # Ignore shell open failures.
                    }
                }
            }
            catch {
                [System.Windows.Forms.MessageBox]::Show(
                    $form,
                    $_.Exception.Message,
                    'Generation Error',
                    [System.Windows.Forms.MessageBoxButtons]::OK,
                    [System.Windows.Forms.MessageBoxIcon]::Error
                ) | Out-Null
                & $setStatus 'Error during generation.'
            }
        }
        finally {
            $dialog.Dispose()
        }
    }.GetNewClosure()

    $showOptions = {
        if ((Show-OptionsDialog -Config $Config -Owner $form) -eq [System.Windows.Forms.DialogResult]::OK) {
            Save-AppConfig -Config $Config -Path $ConfigPath
            & $setStatus 'Options saved.'
            & $updateResolvedOutputPreview
        }
    }.GetNewClosure()

    $loadLastList = {
        if (-not [string]::IsNullOrWhiteSpace($Config.LastListPath) -and (Test-Path -LiteralPath $Config.LastListPath)) {
            $state.ListPath = $Config.LastListPath
            $txtList.Text = $state.ListPath
            & $refreshStats
        }
    }.GetNewClosure()

    $btnGenerate.Add_EnabledChanged({ $miGenerate.Enabled = $btnGenerate.Enabled }.GetNewClosure())
    $btnSelect.Add_Click($selectList)
    $btnRefresh.Add_Click($refreshStats)
    $btnGenerate.Add_Click($generatePlaylist)
    $miSelect.Add_Click($selectList)
    $miGenerate.Add_Click($generatePlaylist)
    $miExit.Add_Click({ $form.Close() }.GetNewClosure())
    $miOptions.Add_Click($showOptions)

    [void]$form.Controls.Add($menu)
    [void]$form.Controls.AddRange([System.Windows.Forms.Control[]]@(
        $txtList,
        $btnSelect,
        $btnRefresh,
        $btnGenerate,
        $chkOpen,
        $rbProductTestCase,
        $rbSampleCases,
        $lblSummary,
        $lblOutputCaption,
        $txtResolvedOutput,
        $statusStrip
    ))
    $form.MainMenuStrip = $menu

    & $loadLastList
    & $updateResolvedOutputPreview

    return $form
}

function Start-UftPlaylistGenerator {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [System.Windows.Forms.Application]::EnableVisualStyles()

    $configPath = Join-Path (Get-ApplicationBaseDirectory) 'playlistconfig.json'
    $config = Load-AppConfig -Path $configPath
    $form = New-MainForm -Config $config -ConfigPath $configPath
    [System.Windows.Forms.Application]::Run($form)
}

function Restart-InStaIfNeeded {
    if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -eq [System.Threading.ApartmentState]::STA) {
        return $false
    }

    $scriptPath = if ($PSCommandPath) { $PSCommandPath } else { $MyInvocation.MyCommand.Path }
    if (-not $scriptPath) {
        throw 'Unable to determine script path for STA relaunch.'
    }

    $powershell = Get-Command powershell.exe -ErrorAction SilentlyContinue
    if ($null -eq $powershell) {
        $powershell = Get-Command pwsh.exe -ErrorAction SilentlyContinue
    }

    if ($null -eq $powershell) {
        throw 'Unable to locate a PowerShell executable for STA relaunch.'
    }

    Start-Process -FilePath $powershell.Source -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', $scriptPath) | Out-Null
    return $true
}

if ($MyInvocation.InvocationName -eq '.' -or $env:UFT_PLAYLIST_GENERATOR_SKIP_UI -eq '1') {
    return
}

if (Restart-InStaIfNeeded) {
    exit
}

Start-UftPlaylistGenerator
