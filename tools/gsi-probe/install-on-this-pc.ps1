# Installs the match-safe GSI probe on this PC (agent-run; see AGENTS.md).
# - copies probe.mjs to %LOCALAPPDATA%\csbot-probe and the match-safe cfg into CS2's cfg folder
# - registers a hidden per-user logon task, and starts it now
# Undo with uninstall-from-this-pc.ps1.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $env:LOCALAPPDATA 'csbot-probe'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item (Join-Path $here 'probe.mjs') $dest -Force

$steam = (Get-ItemProperty 'HKCU:\Software\Valve\Steam').SteamPath -replace '/', '\'
$cfgDir = Join-Path $steam 'steamapps\common\Counter-Strike Global Offensive\game\csgo\cfg'
if (-not (Test-Path $cfgDir)) { throw "CS2 cfg folder not found: $cfgDir" }
Copy-Item (Join-Path $here 'gamestate_integration_csbot_probe_match.cfg') $cfgDir -Force

$node = (Get-Command node).Source
$vbs = Join-Path $dest 'run-hidden.vbs'
@"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$dest"
sh.Environment("PROCESS")("LOG_DIR") = "$dest\logs"
sh.Run """$node"" ""$dest\probe.mjs""", 0, False
"@ | Set-Content -Path $vbs -Encoding ASCII

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'csbot-gsi-probe' -Action $action -Trigger $trigger -Settings $settings -Description 'csbot GSI probe (localhost only). Remove with tools/gsi-probe/uninstall-from-this-pc.ps1' -Force | Out-Null
Start-ScheduledTask -TaskName 'csbot-gsi-probe'
"installed: $dest · cfg: $cfgDir\gamestate_integration_csbot_probe_match.cfg · task: csbot-gsi-probe"
