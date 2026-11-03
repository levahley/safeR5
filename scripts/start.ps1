$ErrorActionPreference = 'Stop'
$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $ProjectDir
if (-not (Test-Path '.venv/Scripts/python.exe')) { throw 'Önce ./scripts/setup.ps1 çalıştırın.' }
if (-not (Test-Path 'frontend/dist/index.html')) { throw 'Önce ./scripts/setup.ps1 çalıştırın.' }
$env:PYTHONPATH = Join-Path $ProjectDir 'backend/src'
$env:SAFER5_FRONTEND_DIR = Join-Path $ProjectDir 'frontend/dist'
if (-not $env:SAFER5_DATA_DIR) { $env:SAFER5_DATA_DIR = Join-Path $ProjectDir 'data' }
& .venv/Scripts/python.exe -c 'import socket; s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); s.bind(("127.0.0.1",8765)); s.close()'
if ($LASTEXITCODE -ne 0) { throw '8765 portu kullanımda; çalışan safeR5 penceresini kontrol edin.' }
Write-Output 'safeR5 açılıyor: http://127.0.0.1:8765'
& .venv/Scripts/python.exe -m safer5 --root $env:SAFER5_DATA_DIR serve
exit $LASTEXITCODE
