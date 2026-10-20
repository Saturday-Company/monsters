# Runs inside the Windows VM (update-e2e.ts --win): installs 0.0.1, trusts the test CA (so the
# updater's publisher check can pass), starts it with MONSTERS_UPDATE_AUTO_INSTALL=1 and waits for
# 0.0.2 with a healthy core. The feed is the host's HTTP server, seen from QEMU as 10.0.2.2.
param([string]$Installer, [string]$TestCa)
$ErrorActionPreference = 'Stop'
Import-Certificate -FilePath $TestCa -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
$p = Start-Process -FilePath $Installer -ArgumentList '/S' -PassThru -Wait
Write-Output "installed 0.0.1 (exit $($p.ExitCode))"
$exe = Join-Path $env:LOCALAPPDATA 'Programs\Monsters\Monsters.exe'
$home2 = Join-Path $env:TEMP ('monsters-update-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $home2 | Out-Null
$env:MONSTERS_HOME = $home2
$env:MONSTERS_SECRETS = 'file'
$env:MONSTERS_UPDATE_AUTO_INSTALL = '1'
# The first-start question already answered ("Su questo computer"), in the app's own user data
# folder (the updated version, started by the installer, reads the same one).
$appData = Join-Path $env:APPDATA 'Monsters'
New-Item -ItemType Directory -Force -Path $appData | Out-Null
Set-Content -Path (Join-Path $appData 'connections.json') -Value '{"version":1,"profiles":[],"last":"local"}' -Encoding ascii
$start = Get-Date
Start-Process -FilePath $exe | Out-Null
$log = Join-Path $home2 'logs\desktop.log'
$ok = $false
for ($i = 0; $i -lt 480; $i++) {
  Start-Sleep -Seconds 1
  if ((Test-Path $log) -and (Select-String -Path $log -Pattern 'Monsters desktop 0.0.2' -Quiet)) {
    $sj = Join-Path $home2 'server.json'
    if (Test-Path $sj) {
      try {
        $url = (Get-Content $sj -Raw | ConvertFrom-Json).url
        $r = Invoke-WebRequest -UseBasicParsing -Uri "$url/api/health" -TimeoutSec 3
        if ($r.StatusCode -eq 200) { $ok = $true; break }
      } catch {}
    }
  }
}
if ((Test-Path $log) -and -not $ok) { Get-Content $log -Tail 30 | ForEach-Object { '    ' + $_ } }
elseif (Test-Path $log) {
  Get-Content $log | Select-String 'Monsters desktop|updates:|updater: (Checking|Found|Download|New version|Install|Full|.*signature|.*publisher)' |
    ForEach-Object { '    ' + $_.Line }
}
$version = (Get-Item $exe).VersionInfo.ProductVersion
Write-Output "installed version now: $version"
Get-Process -Name Monsters -ErrorAction SilentlyContinue | Stop-Process -Force
if (-not $ok) { throw '0.0.2 not running with a healthy core' }
Write-Output ("update-e2e-windows: OK, 0.0.1 -> 0.0.2 in {0:N0}s" -f ((Get-Date) - $start).TotalSeconds)
