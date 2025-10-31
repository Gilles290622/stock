' Exécute un script PowerShell en mode caché sans fenêtre console
' Usage: wscript.exe run-ps-hidden.vbs "C:\chemin\script.ps1" "arg1" "arg2" ...
Dim shell, args, i, cmd
Set shell = CreateObject("WScript.Shell")
Set args = WScript.Arguments
If args.Count = 0 Then WScript.Quit 1
cmd = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & args(0) & """"
For i = 1 To args.Count - 1
  cmd = cmd & " """ & args(i) & """"
Next
shell.Run cmd, 0, False  ' 0 = caché, False = ne pas attendre
