$ErrorActionPreference = 'Stop'
$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $ProjectDir
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22.12+ kurun.' }
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12))process.exit(1)'
if ($LASTEXITCODE -ne 0) { throw 'Node.js 22.12+ gerekli.' }
if (Get-Command uv -ErrorAction SilentlyContinue) {
  $env:UV_CACHE_DIR = Join-Path $ProjectDir 'work/uv-cache'
  $env:UV_PROJECT_ENVIRONMENT = Join-Path $ProjectDir '.venv'
  uv sync --project backend --frozen --extra dev
} else {
  py -3.12 -m venv .venv
  if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 kurun veya uv kullanın.' }
  & .venv/Scripts/python.exe -m pip install -r requirements-dev.lock.txt
}
if ($LASTEXITCODE -ne 0) { throw 'Python bağımlılık kurulumu başarısız.' }
npm --prefix frontend ci --cache (Join-Path $ProjectDir 'work/npm-cache') --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Arayüz bağımlılık kurulumu başarısız.' }
npm --prefix frontend run build
if ($LASTEXITCODE -ne 0) { throw 'Arayüz derlemesi başarısız.' }
Write-Output 'Kurulum tamamlandı. Başlatın: ./scripts/start.ps1'
