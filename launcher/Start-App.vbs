Option Explicit

Dim shell, fso, scriptDir, command, exitCode
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
command = Chr(34) & scriptDir & "\Start-App.bat" & Chr(34)

' Run completely hidden and wait only until the bootstrapper has started the
' detached backend and opened localhost in the default browser.
exitCode = shell.Run(command, 0, True)

If exitCode <> 0 Then
  MsgBox "ADO Work Item AI Assistant could not start." & vbCrLf & vbCrLf & _
         "See logs\launcher.log and logs\backend.log for details.", _
         vbExclamation, "ADO Work Item AI Assistant"
End If
