param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location $root
$install=Join-Path $root 'tmp/windows-e2e/install'
New-Item -ItemType Directory -Force $install | Out-Null
$setup=Start-Process (Resolve-Path $Installer) -ArgumentList '/S',"/D=$install" -PassThru
$null=$setup.Handle
if(!$setup.WaitForExit(300000) -or $setup.ExitCode -ne 0){throw 'Windows 安装失败'}
if(!(Test-Path (Join-Path $install '地图资源'))){throw '安装目录缺少地图资源文件夹'}
$env:VIPS_BIN=Join-Path $install 'tools/vips/bin/vips.exe'
node scripts/create-e2e-originals.mjs (Join-Path $install '地图资源')
if($LASTEXITCODE -ne 0){throw '测试原图生成失败'}
$env:E2E_WINDOWS_APP=Join-Path $install 'tauronic.exe'
pnpm exec playwright test --project=chromium-tablet
if($LASTEXITCODE -ne 0){throw 'Windows 原生服务与 iPad 控制端端到端验证失败'}
$originals=Get-Content (Join-Path $install '地图资源/test-originals.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach($original in $originals){if((Get-FileHash -LiteralPath $original.file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $original.sha256){throw "原图被修改：$($original.file)"}}
