#ifndef OrbitVersion
  #error "Run npm run dist to supply the Orbit version and staged application."
#endif

#define OrbitExe "Orbit.exe"
#define Capabilities "Software\Clients\StartMenuInternet\Orbit\Capabilities"
#define LegacyId "0d2ecc69-c300-5f71-b2dc-81426526d0db"
#define LegacyInstallKey "Software\" + LegacyId
#define LegacyUninstallKey "Software\Microsoft\Windows\CurrentVersion\Uninstall\" + LegacyId

[Setup]
AppId=com.orbitbrowser.desktop
AppName=Orbit
AppVersion={#OrbitVersion}
AppPublisher=Yuwol
DefaultDirName={code:DefaultOrbitDir}
DefaultGroupName=Orbit
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputBaseFilename=Orbit-Setup-{#OrbitVersion}-x64
SetupIconFile=..\renderer\orbit.ico
UninstallDisplayIcon={app}\{#OrbitExe}
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
ChangesAssociations=yes
SetupMutex=OrbitSetupMutex

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#OrbitPayload}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\Orbit"; Filename: "{app}\{#OrbitExe}"; WorkingDir: "{app}"; AppUserModelID: "com.orbitbrowser.desktop"
Name: "{userdesktop}\Orbit"; Filename: "{app}\{#OrbitExe}"; WorkingDir: "{app}"; AppUserModelID: "com.orbitbrowser.desktop"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Classes\OrbitBrowserURL"; ValueType: string; ValueData: "Orbit URL"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\OrbitBrowserURL"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\OrbitBrowserURL\DefaultIcon"; ValueType: string; ValueData: """{app}\{#OrbitExe}"",0"
Root: HKCU; Subkey: "Software\Classes\OrbitBrowserURL\shell\open\command"; ValueType: string; ValueData: """{app}\{#OrbitExe}"" ""%1"""
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\Orbit"; ValueType: string; ValueData: "Orbit"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\Orbit\DefaultIcon"; ValueType: string; ValueData: """{app}\{#OrbitExe}"",0"
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\Orbit\shell\open\command"; ValueType: string; ValueData: """{app}\{#OrbitExe}"""
Root: HKCU; Subkey: "{#Capabilities}"; ValueType: string; ValueName: "ApplicationName"; ValueData: "Orbit"
Root: HKCU; Subkey: "{#Capabilities}"; ValueType: string; ValueName: "ApplicationDescription"; ValueData: "Orbit browser for web links and local documents."
Root: HKCU; Subkey: "{#Capabilities}"; ValueType: string; ValueName: "ApplicationIcon"; ValueData: """{app}\{#OrbitExe}"",0"
Root: HKCU; Subkey: "{#Capabilities}\Startmenu"; ValueType: string; ValueName: "StartMenuInternet"; ValueData: "Orbit"
Root: HKCU; Subkey: "{#Capabilities}\URLAssociations"; ValueType: string; ValueName: "http"; ValueData: "OrbitBrowserURL"
Root: HKCU; Subkey: "{#Capabilities}\URLAssociations"; ValueType: string; ValueName: "https"; ValueData: "OrbitBrowserURL"
Root: HKCU; Subkey: "Software\RegisteredApplications"; ValueType: string; ValueName: "Orbit"; ValueData: "{#Capabilities}"; Flags: uninsdeletevalue
#include OrbitAssociations

[Run]
Filename: "{app}\{#OrbitExe}"; Description: "{cm:LaunchProgram,Orbit}"; Flags: nowait postinstall skipifsilent

[Code]
function LegacyOrbitDir: String;
var
  Directory, Command: String;
begin
  Result := '';
  if RegQueryStringValue(HKCU, '{#LegacyInstallKey}', 'InstallLocation', Directory) and
     RegQueryStringValue(HKCU, '{#LegacyUninstallKey}', 'UninstallString', Command) and
     (CompareText(Command, '"' + AddBackslash(Directory) + 'Uninstall Orbit.exe" /currentuser') = 0) and
     FileExists(AddBackslash(Directory) + 'Orbit.exe') then
    Result := RemoveBackslashUnlessRoot(Directory);
end;

function DefaultOrbitDir(Param: String): String;
begin
  Result := LegacyOrbitDir;
  if Result = '' then
    Result := ExpandConstant('{localappdata}\Programs\Orbit');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  LegacyDir: String;
begin
  if CurStep = ssPostInstall then
  begin
    LegacyDir := LegacyOrbitDir;
    if (LegacyDir <> '') and
       (CompareText(LegacyDir, RemoveBackslashUnlessRoot(ExpandConstant('{app}'))) = 0) then
    begin
      // Retire only the verified NSIS registration for this same directory.
      // Running the old uninstaller here would remove the newly installed app.
      DeleteFile(AddBackslash(LegacyDir) + 'Uninstall Orbit.exe');
      DeleteFile(AddBackslash(LegacyDir) + 'uninstallerIcon.ico');
      RegDeleteKeyIncludingSubkeys(HKCU, '{#LegacyUninstallKey}');
      RegDeleteKeyIncludingSubkeys(HKCU, '{#LegacyInstallKey}');
    end;
  end;
end;
