# Removes everything install-on-this-pc.ps1 added. Keeps the logs folder unless -DeleteLogs is passed.
param([switch]$DeleteLogs)
$ErrorActionPreference = 'Continue'
Unregister-ScheduledTask -TaskName 'csbot-gsi-probe' -Confirm:$false -ErrorAction SilentlyContinue
Get-NetTCPConnection -LocalPort 47399 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -Confirm:$false }
$steam = (Get-ItemProperty 'HKCU:\Software\Valve\Steam').SteamPath -replace '/', '\'
$cfg = Join-Path $steam 'steamapps\common\Counter-Strike Global Offensive\game\csgo\cfg\gamestate_integration_csbot_probe_match.cfg'
if (Test-Path $cfg) { Remove-Item $cfg -Force -Confirm:$false }
$dest = Join-Path $env:LOCALAPPDATA 'csbot-probe'
if ($DeleteLogs) { Remove-Item $dest -Recurse -Force -Confirm:$false -ErrorAction SilentlyContinue }
else { Get-ChildItem $dest -File -ErrorAction SilentlyContinue | Remove-Item -Force -Confirm:$false }
'removed task, listener and cfg' + ($(if ($DeleteLogs) { ' and logs' } else { ' (logs kept in ' + $dest + '\logs)' }))
