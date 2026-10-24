; 只为本应用创建局域网访问规则，不关闭或重设系统防火墙。
!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$INSTDIR\地图资源"
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="ExhibitionApp-Local-TCP" program="$INSTDIR\tauronic.exe"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="ExhibitionApp-Local-TCP" dir=in action=allow program="$INSTDIR\tauronic.exe" protocol=TCP localport=1421,8787 remoteip=localsubnet profile=private,public'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="ExhibitionApp-Local-Discovery" program="$INSTDIR\tauronic.exe"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="ExhibitionApp-Local-Discovery" dir=in action=allow program="$INSTDIR\tauronic.exe" protocol=UDP localport=8789 remoteip=localsubnet profile=private,public'
  Pop $0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="ExhibitionApp-Local-TCP" program="$INSTDIR\tauronic.exe"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="ExhibitionApp-Local-Discovery" program="$INSTDIR\tauronic.exe"'
  Pop $0
  ; 用户原图和缓存保留，不随卸载删除。
!macroend
