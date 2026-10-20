# First-logon provisioning of the Windows CI VM (run by autounattend from the config ISO, as the
# local administrator "ci"). Installs what the Monsters CI needs, locks SSH to key-only, then
# writes C:\ci-setup.done and powers the VM off: scripts/ci-windows.sh setup takes it from there.
param([string]$Source = 'E:')

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
Start-Transcript -Path C:\ci-setup.log -Append | Out-Null
$src = $Source.TrimEnd('\')
$versions = Get-Content "$src\ci-versions.json" -Raw | ConvertFrom-Json
function Step([string]$message) { Write-Host "=== $(Get-Date -Format s) $message" }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
    [Environment]::GetEnvironmentVariable('Path', 'User')
}

Step 'power, Defender, Windows Update, long paths'
powercfg /setactive SCHEME_MIN
powercfg /hibernate off
# The VM is reverted to the clean snapshot before every run: real-time scanning only slows
# pnpm install and the tests down, and updates would be thrown away anyway.
try { Set-MpPreference -DisableRealtimeMonitoring $true -ErrorAction Stop } catch { Write-Host $_ }
try { Add-MpPreference -ExclusionPath 'C:\ci', 'C:\Users\ci' -ErrorAction Stop } catch { Write-Host $_ }
$au = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU'
New-Item -Path $au -Force | Out-Null
Set-ItemProperty -Path $au -Name NoAutoUpdate -Value 1 -Type DWord
Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled -Value 1 -Type DWord
Get-ScheduledTask -TaskName ServerManager -ErrorAction SilentlyContinue | Disable-ScheduledTask | Out-Null

Step 'OpenSSH Server (key only)'
if (-not (Get-Service sshd -ErrorAction SilentlyContinue)) {
  Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
}
$sshDir = 'C:\ProgramData\ssh'
$cfg = "$sshDir\sshd_config"
if (-not (Test-Path $cfg)) { Start-Service sshd; Stop-Service sshd }
# sshd keeps the first value of each keyword: these lines win over the defaults below them.
$lines = @('PasswordAuthentication no', 'KbdInteractiveAuthentication no', 'PubkeyAuthentication yes', '') +
  (Get-Content $cfg | Where-Object { $_ -notmatch '^\s*(PasswordAuthentication|KbdInteractiveAuthentication|PubkeyAuthentication)\s' })
Set-Content -Path $cfg -Value $lines -Encoding ascii
Copy-Item "$src\authorized_keys" "$sshDir\administrators_authorized_keys" -Force
icacls "$sshDir\administrators_authorized_keys" /inheritance:r /grant '*S-1-5-32-544:F' /grant '*S-1-5-18:F'
Set-Service sshd -StartupType Automatic
Start-Service sshd
# The rule shipped with Server 2025 allows the Private profile only, and the QEMU user-mode network
# is an unidentified (Public) one: a rule of our own for every profile. Only 127.0.0.1 of the host
# reaches port 22 anyway (QEMU forward).
Remove-NetFirewallRule -Name 'Monsters-CI-SSH' -ErrorAction SilentlyContinue
New-NetFirewallRule -Name 'Monsters-CI-SSH' -DisplayName 'OpenSSH Server (Monsters CI)' -Enabled True `
  -Profile Any -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null

Step 'Visual C++ runtime'
$vcRedist = "$src\vc_redist.x64.exe"
$signature = Get-AuthenticodeSignature $vcRedist
if ($signature.Status -eq 'Valid' -and $signature.SignerCertificate.Subject -match 'O=Microsoft Corporation') {
  Start-Process -Wait -FilePath $vcRedist -ArgumentList '/install', '/quiet', '/norestart'
} else {
  Write-Host "vc_redist.x64.exe not signed by Microsoft ($($signature.Status)): not installed"
}

Step 'Git for Windows'
$gitSetup = Get-ChildItem "$src\Git-*-64-bit.exe" | Select-Object -First 1
Start-Process -Wait -FilePath $gitSetup.FullName -ArgumentList '/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-', '/SUPPRESSMSGBOXES'

Step 'Node.js'
$nodeMsi = Get-ChildItem "$src\node-*-x64.msi" | Select-Object -First 1
Start-Process -Wait -FilePath msiexec.exe -ArgumentList '/i', "`"$($nodeMsi.FullName)`"", '/qn', '/norestart'
Refresh-Path
git config --system core.longpaths true
node --version
git --version

Step "pnpm $($versions.pnpm) via corepack"
[Environment]::SetEnvironmentVariable('COREPACK_ENABLE_DOWNLOAD_PROMPT', '0', 'Machine')
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
corepack enable pnpm
corepack install -g "pnpm@$($versions.pnpm)"
pnpm --version

Step 'activation of the evaluation'
for ($i = 0; $i -lt 10; $i++) {
  $out = cscript //nologo C:\Windows\System32\slmgr.vbs /ato | Out-String
  Write-Host $out
  if ($out -match 'successfully') { break }
  Start-Sleep -Seconds 30
}
cscript //nologo C:\Windows\System32\slmgr.vbs /dli
cscript //nologo C:\Windows\System32\slmgr.vbs /xpr

Step 'done'
Set-Content -Path C:\ci-setup.done -Value (Get-Date -Format o)
Stop-Transcript | Out-Null
shutdown /s /t 5 /c 'Monsters CI provisioning done'
