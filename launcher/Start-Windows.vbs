Option Explicit

Dim shell, fso, scriptDir, rootDir, launcher, command, exitCode
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
rootDir = fso.GetParentFolderName(scriptDir)

' Prefer pythonw from the app virtual environment so Windows never creates a
' Command Prompt / Windows Terminal window.
launcher = rootDir & "\backend\.venv\Scripts\pythonw.exe"

If fso.FileExists(launcher) Then
  command = Chr(34) & launcher & Chr(34) & " " & Chr(34) & rootDir & "\start_app.py" & Chr(34)
  exitCode = shell.Run(command, 0, True)
Else
  ' First run: try Python's windowless launcher, then fall back to a hidden
  ' console Python process if pyw/pythonw is not available on PATH.
  exitCode = RunCandidate(shell, "pyw.exe -3", rootDir)
  If exitCode = 9009 Then exitCode = RunCandidate(shell, "pythonw.exe", rootDir)
  If exitCode = 9009 Then exitCode = RunCandidate(shell, "py.exe -3", rootDir)
  If exitCode = 9009 Then exitCode = RunCandidate(shell, "python.exe", rootDir)
End If

If exitCode <> 0 Then
  MsgBox "ADO Work Item AI Assistant could not start." & vbCrLf & vbCrLf & _
         "Python 3.10+ is required. See logs\launcher.log and logs\backend.log for details.", _
         vbExclamation, "ADO Work Item AI Assistant"
End If

Function RunCandidate(shellObject, executable, root)
  Dim cmd, result
  On Error Resume Next
  cmd = executable & " " & Chr(34) & root & "\start_app.py" & Chr(34)
  result = shellObject.Run(cmd, 0, True)
  If Err.Number <> 0 Then
    Err.Clear
    result = 9009
  End If
  On Error GoTo 0
  RunCandidate = result
End Function
