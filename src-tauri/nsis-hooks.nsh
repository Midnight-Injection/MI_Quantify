; NSIS installer hooks for MI Quantify
; 安装前关闭残留进程，卸载时询问用户是否保留 data/ 和 log/ 目录

!macro customInstall
  ; 安装前强制关闭所有残留的 MI Quantify 和 sidecar 进程
  nsExec::ExecToLog 'taskkill /F /IM "mi_quantify.exe" /T'
  nsExec::ExecToLog 'taskkill /F /IM "mi-quantify-sidecar.exe" /T'
  Sleep 500
!macroend

!macro customUnInstall
  ; 卸载前先关闭 sidecar 和主程序
  nsExec::ExecToLog 'taskkill /F /IM "mi-quantify-sidecar.exe" /T'
  nsExec::ExecToLog 'taskkill /F /IM "mi_quantify.exe" /T'
  Sleep 500

  ; 删除 sidecar 二进制文件（NSIS 卸载器可能无法跟踪 externalBin 文件）
  Delete /REBOOTOK "$INSTDIR\mi-quantify-sidecar.exe"

  ; 询问用户是否保留数据
  MessageBox MB_YESNO "是否保留 MI Quantify 的数据文件和日志？$\n$\n选择「是」保留 data/ 和 log/ 目录，以便将来重新安装时恢复数据。$\n选择「否」将删除所有数据。" /SD IDYES IDYES keepData IDNO removeData

  keepData:
    ; 保留 data/ 和 log/：先移到临时位置，卸载完再移回来
    Rename "$INSTDIR\data" "$TEMP\mi_quantify_data_backup"
    Rename "$INSTDIR\log" "$TEMP\mi_quantify_log_backup"
    goto uninstContinue

  removeData:
    RmDir /r "$INSTDIR\data"
    RmDir /r "$INSTDIR\log"
    goto uninstContinue

  uninstContinue:
!macroend

!macro customUnInstallAfter
  ; 卸载完成后，如果用户选择保留数据，恢复目录
  IfFileExists "$TEMP\mi_quantify_data_backup" 0 norestore
    CreateDirectory "$INSTDIR"
    Rename "$TEMP\mi_quantify_data_backup" "$INSTDIR\data"
    Rename "$TEMP\mi_quantify_log_backup" "$INSTDIR\log"
  norestore:
!macroend
