param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location $root
$install=Join-Path $root 'tmp/windows-e2e/install'
& (Join-Path $PSScriptRoot 'check-windows-manifest.ps1') -ExecutablePath $Installer
New-Item -ItemType Directory -Force $install | Out-Null
New-NetFirewallRule -Name 'Exhibition-CI-Old-Deny' -DisplayName 'Exhibition CI old deny' -Program (Join-Path $install 'tauronic.exe') -Direction Inbound -Action Block -Profile Any | Out-Null
$setup=Start-Process (Resolve-Path $Installer) -ArgumentList '/S',"/D=$install" -PassThru
$null=$setup.Handle
if(!$setup.WaitForExit(300000) -or $setup.ExitCode -ne 0){throw 'Windows 安装失败'}
if(!(Test-Path (Join-Path $install '地图资源'))){throw '安装目录缺少地图资源文件夹'}
if(Get-NetFirewallRule -Name 'Exhibition-CI-Old-Deny' -ErrorAction SilentlyContinue){throw '安装程序未清除本应用的旧拒绝规则'}
$allow=Get-NetFirewallRule -DisplayName 'ExhibitionApp-Local-TCP' -ErrorAction Stop
if($allow.Enabled -ne 'True' -or $allow.Action -ne 'Allow'){throw '本应用局域网 TCP 规则未启用'}
$env:VIPS_BIN=Join-Path $install 'tools/vips/bin/vips.exe'
node scripts/create-e2e-originals.mjs (Join-Path $install '地图资源')
if($LASTEXITCODE -ne 0){throw '测试原图生成失败'}
$env:E2E_WINDOWS_APP=Join-Path $install 'tauronic.exe'
pnpm exec playwright test --project=chromium-tablet
if($LASTEXITCODE -ne 0){throw 'Windows 原生服务与 iPad 控制端端到端验证失败'}
$originals=Get-Content (Join-Path $install '地图资源/test-originals.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach($original in $originals){if((Get-FileHash -LiteralPath $original.file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $original.sha256){throw "原图被修改：$($original.file)"}}
