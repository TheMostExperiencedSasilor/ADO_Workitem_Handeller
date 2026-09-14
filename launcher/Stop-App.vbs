Option Explicit

Dim shell, fso, scriptDir, command, exitCode
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
command = Chr(34) & scriptDir & "\Stop-App.bat" & Chr(34)
exitCode = shell.Run(command, 0, True)

If exitCode <> 0 Then
  MsgBox "ADO Work Item AI Assistant could not stop cleanly." & vbCrLf & vbCrLf & _
         "See logs\launcher.log for details.", _
         vbExclamation, "ADO Work Item AI Assistant"
End If
