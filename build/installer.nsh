; Instalador do 4notes (incluído pelo electron-builder: nsis.include em electron-builder.yml)
;
; Pergunta se você quer um atalho do 4notes na área de trabalho. O atalho do
; Menu Iniciar é sempre criado. Desinstalar remove o atalho da área de trabalho.
;
;   - Primeira instalação: a opção vem marcada.
;   - Reinstalação/atualização: vem marcada se o atalho já existe (se você o apagou, vem desmarcada).
;   - Instalação silenciosa (/S): segue a regra acima; "--no-desktop-shortcut" não cria o atalho.

!ifndef BUILD_UNINSTALLER
  !include nsDialogs.nsh

  Var desktopShortcut
  Var desktopShortcutCheckbox

  !macro customInit
    StrCpy $desktopShortcut "1"
    ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ReadRegStr $1 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${if} $0 != ""
    ${orIf} $1 != ""
      ${ifNot} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
        StrCpy $desktopShortcut "0"
      ${endIf}
    ${endIf}
    ${if} ${isNoDesktopShortcut}
      StrCpy $desktopShortcut "0"
    ${endIf}
  !macroend

  ; Página "Atalhos", depois da escolha da pasta de instalação. As funções ficam
  ; dentro da macro porque usam plugins que o electron-builder só registra depois.
  !macro customPageAfterChangeDir
    Page custom desktopShortcutPageShow desktopShortcutPageLeave

    Function desktopShortcutPageShow
      ${if} ${isUpdated}
        Abort
      ${endIf}
      !insertmacro MUI_HEADER_TEXT "Atalhos" "Escolha onde o 4notes vai aparecer."
      nsDialogs::Create 1018
      Pop $0
      ${if} $0 == error
        Abort
      ${endIf}
      ${NSD_CreateLabel} 0 0 100% 24u "O 4notes sempre aparece no Menu Iniciar. Se quiser, ele também pode ter um atalho na área de trabalho."
      Pop $0
      ${NSD_CreateCheckbox} 0 32u 100% 12u "Criar um atalho na área de trabalho"
      Pop $desktopShortcutCheckbox
      ${if} $desktopShortcut == "1"
        ${NSD_Check} $desktopShortcutCheckbox
      ${endIf}
      nsDialogs::Show
    FunctionEnd

    Function desktopShortcutPageLeave
      ${NSD_GetState} $desktopShortcutCheckbox $0
      ${if} $0 == ${BST_CHECKED}
        StrCpy $desktopShortcut "1"
      ${else}
        StrCpy $desktopShortcut "0"
      ${endIf}
    FunctionEnd
  !macroend

  !macro customInstall
    ${if} $desktopShortcut == "1"
      CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
    ${elseIf} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
      WinShell::UninstShortcut "$DESKTOP\${SHORTCUT_NAME}.lnk"
      Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    ${endIf}
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  !macroend
!endif

; Desinstalar remove o atalho (numa atualização, quem decide é o instalador novo)
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ${if} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
      WinShell::UninstShortcut "$DESKTOP\${SHORTCUT_NAME}.lnk"
      Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    ${endIf}
  ${endIf}
!macroend
