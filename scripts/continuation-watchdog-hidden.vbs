Option Explicit
Dim shell, nodePath, rootPath, command, result
If WScript.Arguments.Count <> 2 Then WScript.Quit 64
nodePath = WScript.Arguments(0)
rootPath = WScript.Arguments(1)
If InStr(nodePath, Chr(34)) > 0 Or InStr(rootPath, Chr(34)) > 0 Then WScript.Quit 64
Set shell = CreateObject("WScript.Shell")
command = Chr(34) & nodePath & Chr(34) & " " & Chr(34) & rootPath & "\.harness-dist\continuationWatchdog.js" & Chr(34) & " check"
result = shell.Run(command, 0, True)
WScript.Quit result