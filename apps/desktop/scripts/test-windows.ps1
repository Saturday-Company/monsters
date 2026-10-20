# Runs inside the Windows VM (test-windows.sh, and the package step of ci-windows.sh): signature,
# per-user silent install, first start up to the registration done from the window
# (install-probe.mjs, with the VM's Node), uninstall, and nothing of the app left (folder,
# uninstall entry, shortcuts). Arguments: the installer, the test certificate (or "none"), the
# expected version and the probe; without -Probe only the core's health is checked (M3.4).
param([string]$Installer, [string]$TestCert, [string]$Version = '', [string]$Probe = '')
$ErrorActionPreference = 'Stop'
function Step($t) { Write-Output "`n== $t" }

Step 'signature of the installer'
$sig = Get-AuthenticodeSignature -LiteralPath $Installer
Write-Output ("status: {0} ({1})" -f $sig.Status, $sig.StatusMessage)
if ($sig.SignerCertificate) { Write-Output ("signer: {0}" -f $sig.SignerCertificate.Subject) }

if ($TestCert -and $TestCert -ne 'none') {
  # Trusting the test certificate (this VM only, reverted afterwards) turns "UnknownError" into
  # "Valid": the signature is intact and made with that certificate.
  Import-Certificate -FilePath $TestCert -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
  Import-Certificate -FilePath $TestCert -CertStoreLocation Cert:\LocalMachine\TrustedPublisher | Out-Null
  $sig = Get-AuthenticodeSignature -LiteralPath $Installer
  Write-Output ("with the test certificate trusted: {0} ({1})" -f $sig.Status, $sig.StatusMessage)
  if ($sig.Status -ne 'Valid') { throw "installer signature: $($sig.Status)" }
}

$dir = Join-Path $env:LOCALAPPDATA 'Programs\Monsters'
$exe = Join-Path $dir 'Monsters.exe'
$uninstallRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
$startLnk = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Monsters.lnk'
$desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Monsters.lnk'
function UninstallEntries {
  Get-ChildItem $uninstallRoot -ErrorAction SilentlyContinue |
    Where-Object { (Get-ItemProperty $_.PSPath).DisplayName -like 'Monsters*' }
}
if ((Test-Path $dir) -or (UninstallEntries)) { throw "not a clean system: Monsters already installed" }

Step 'per-user install, no administrator rights asked (/S)'
$t0 = Get-Date
$p = Start-Process -FilePath $Installer -ArgumentList '/S' -PassThru -Wait
Write-Output ("installer exit code: {0}, {1:N1}s" -f $p.ExitCode, ((Get-Date) - $t0).TotalSeconds)
if (-not (Test-Path $exe)) { throw "not installed in $dir" }
Write-Output "installed: $exe"
$uninstall = Get-ChildItem $dir -Filter 'Uninstall*.exe' | Select-Object -First 1
if (-not $uninstall) { throw "no uninstaller in $dir" }
$uninstallSig = (Get-AuthenticodeSignature $uninstall.FullName).Status
$appSig = (Get-AuthenticodeSignature $exe).Status
Write-Output ("uninstaller: {0}, signature {1}" -f $uninstall.Name, $uninstallSig)
Write-Output ("app: signature {0}" -f $appSig)
# With the test certificate trusted, the app and the uninstaller must be signed like the installer.
if ($TestCert -and $TestCert -ne 'none') {
  if ($appSig -ne 'Valid') { throw "app signature: $appSig" }
  if ($uninstallSig -ne 'Valid') { throw "uninstaller signature: $uninstallSig" }
}
$entry = UninstallEntries
if (-not $entry) { throw 'no uninstall entry in HKCU' }
Write-Output ("uninstall entry in HKCU: {0}, version {1}" -f $entry.PSChildName, (Get-ItemProperty $entry.PSPath).DisplayVersion)
Write-Output ("start menu shortcut: {0}" -f (Test-Path $startLnk))

Step 'first start up to the registration'
$tmp = Join-Path $env:TEMP ('monsters-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$home2 = Join-Path $tmp 'home'
$userData = Join-Path $tmp 'userdata'
New-Item -ItemType Directory -Path $home2, $userData | Out-Null
$env:MONSTERS_HOME = $home2
$env:MONSTERS_DESKTOP_USER_DATA = $userData
$env:MONSTERS_SECRETS = 'file'
$env:MONSTERS_UPDATE = 'off'
$env:MONSTERS_EMBEDDINGS = 'off'
$env:MONSTERS_TELEGRAM = 'off'
# Without the probe nobody answers the first-start question: answered beforehand.
if (-not $Probe) {
  Set-Content -Path (Join-Path $userData 'connections.json') -Value '{"version":1,"profiles":[],"last":"local"}' -Encoding ascii
}
# A free port for the DevTools protocol (127.0.0.1 only).
$l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$l.Start(); $cdp = $l.LocalEndpoint.Port; $l.Stop()
$app = Start-Process -FilePath $exe -ArgumentList "--remote-debugging-port=$cdp" -PassThru
$ok = $false
if ($Probe) {
  & node $Probe --home $home2 --cdp $cdp --version $Version --timeout 150
  $ok = ($LASTEXITCODE -eq 0)
} else {
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 1
    $sj = Join-Path $home2 'server.json'
    if (Test-Path $sj) {
      $url = (Get-Content $sj -Raw | ConvertFrom-Json).url
      try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri "$url/api/health" -TimeoutSec 3
        if ($r.StatusCode -eq 200) { $ok = $true; Write-Output "health: $($r.Content) after $($i + 1)s"; break }
      } catch {}
    }
  }
}
$log = Join-Path $home2 'logs\desktop.log'
if (Test-Path $log) {
  if ($ok) { Get-Content $log | Select-String 'Monsters desktop|updates:|started core|automatic login' | ForEach-Object { $_.Line } }
  else { Get-Content $log -Tail 40 }
}
Write-Output ("app process alive: {0}" -f [bool](Get-Process -Id $app.Id -ErrorAction SilentlyContinue))
Get-Process -Name Monsters -ErrorAction SilentlyContinue | Stop-Process -Force
for ($i = 0; $i -lt 20 -and (Get-Process -Name Monsters -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
if (Get-Process -Name Monsters -ErrorAction SilentlyContinue) { throw 'Monsters processes still running' }
Write-Output 'app stopped, no process left'
if (-not $ok) { throw 'the installed app did not get to the registration' }

Step 'uninstall (/S)'
$t0 = Get-Date
$p = Start-Process -FilePath $uninstall.FullName -ArgumentList '/S' -PassThru -Wait
# The NSIS uninstaller copies itself to TEMP and goes on from there: wait for its work.
for ($i = 0; $i -lt 120 -and ((Test-Path $dir) -or (UninstallEntries)); $i++) { Start-Sleep -Milliseconds 500 }
Write-Output ("uninstaller exit code: {0}, {1:N1}s" -f $p.ExitCode, ((Get-Date) - $t0).TotalSeconds)
$left = @()
if (Test-Path $dir) { $left += "folder $dir ($((Get-ChildItem -Recurse $dir | Measure-Object).Count) files)" }
if (UninstallEntries) { $left += 'uninstall entry in HKCU' }
if (Test-Path $startLnk) { $left += 'start menu shortcut' }
if (Test-Path $desktopLnk) { $left += 'desktop shortcut' }
if ($left.Count -gt 0) { throw ("left behind after the uninstall: " + ($left -join ', ')) }
Write-Output 'nothing left: folder, uninstall entry and shortcuts gone'
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
Write-Output "`ntest-windows: OK"
