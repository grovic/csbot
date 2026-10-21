; csbot uninstaller extras: remove the update cache (a copy of the installer kept for
; differential updates). User settings, keys and recordings in %APPDATA%\csbot are kept.
!macro customUnInstall
  RMDir /r "$LOCALAPPDATA\csbot-updater"
!macroend
