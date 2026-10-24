$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$archive = Join-Path $root 'tmp/vips-windows/vips-dev-x64-all-8.18.7.zip'
$url = 'https://github.com/libvips/build-win64-mxe/releases/download/v8.18.7/vips-dev-x64-all-8.18.7.zip'
$sha = '78e56ba30c267ba32ff965200534bd5721364cadbead8c4d595e44b58dfeff15'
New-Item -ItemType Directory -Force (Split-Path $archive), (Join-Path $root 'src-tauri/tools/vips') | Out-Null
if (!(Test-Path $archive)) { Invoke-WebRequest $url -OutFile $archive }
if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLower() -ne $sha) { throw 'libvips 官方压缩包 SHA-256 不匹配' }
$stage = Join-Path $root 'tmp/vips-windows/extracted'
Expand-Archive $archive $stage -Force
Copy-Item (Join-Path $stage 'vips-dev-8.18/*') (Join-Path $root 'src-tauri/tools/vips') -Recurse -Force
& (Join-Path $root 'src-tauri/tools/vips/bin/vips.exe') --version
if ($LASTEXITCODE -ne 0) { throw '内置 libvips 启动失败' }
