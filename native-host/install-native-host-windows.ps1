$ErrorActionPreference = 'Stop'
$HostName = 'com.pocketfiles.clipboard'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $Here

Write-Host 'PocketFiles Desktop Bridge installer' -ForegroundColor White
$ExtensionId = Read-Host 'Paste the PocketFiles extension ID from chrome://extensions (or edge://extensions)'
if ($ExtensionId -notmatch '^[a-p]{32}$') {
  throw 'That does not look like a Chromium extension ID (32 letters a-p).'
}
$Browser = (Read-Host 'Browser: Chrome or Edge [Chrome]').Trim().ToLower()
if ([string]::IsNullOrWhiteSpace($Browser)) { $Browser = 'chrome' }
if ($Browser -notin @('chrome', 'edge')) { throw 'Choose Chrome or Edge.' }

$Python = Get-Command python -ErrorAction SilentlyContinue
if (-not $Python) { throw 'Python 3 is required. Install Python from python.org and enable Add Python to PATH.' }

Write-Host 'Building the small native host executable...' -ForegroundColor White
& python -m pip install --user --upgrade pyinstaller
if ($LASTEXITCODE -ne 0) { throw 'Could not install PyInstaller.' }
& python -m PyInstaller --noconfirm --onefile --name pocketfiles-native-host --distpath (Join-Path $Here 'dist') --workpath (Join-Path $env:TEMP 'pocketfiles-pyinstaller') (Join-Path $Here 'native_host.py')
if ($LASTEXITCODE -ne 0) { throw 'Could not build the native host executable.' }

$ExePath = (Resolve-Path (Join-Path $Here 'dist\pocketfiles-native-host.exe')).Path
$InstallDir = Join-Path $env:LOCALAPPDATA 'PocketFiles\NativeHost'
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$InstalledExe = Join-Path $InstallDir 'pocketfiles-native-host.exe'
Copy-Item -Force $ExePath $InstalledExe

$ManifestPath = Join-Path $InstallDir 'com.pocketfiles.clipboard.json'
$Manifest = @{
  name = $HostName
  description = 'PocketFiles local file clipboard bridge'
  path = $InstalledExe
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($ManifestPath, $Manifest, [System.Text.UTF8Encoding]::new($false))

if ($Browser -eq 'edge') {
  $RegistryPath = 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.pocketfiles.clipboard'
} else {
  $RegistryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.pocketfiles.clipboard'
}
New-Item -Path $RegistryPath -Force | Out-Null
Set-Item -Path $RegistryPath -Value $ManifestPath

Write-Host ''
Write-Host 'Desktop Bridge installed.' -ForegroundColor Green
Write-Host 'Reload PocketFiles at chrome://extensions or edge://extensions, then select files and press Copy.'
Write-Host 'Paste with Ctrl+V in File Explorer or another app that accepts copied files.'
