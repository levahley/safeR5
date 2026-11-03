#!/bin/sh
set -eu
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$PROJECT_DIR"
command -v node >/dev/null 2>&1 || { echo 'Node.js 22.12 veya üzerini kurun.' >&2; exit 1; }
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12)){console.error("Node.js 22.12+ gerekli.");process.exit(1)}'
if command -v uv >/dev/null 2>&1; then
    UV_CACHE_DIR="$PROJECT_DIR/work/uv-cache" UV_PROJECT_ENVIRONMENT="$PROJECT_DIR/.venv" uv sync --project backend --frozen --extra dev
else
    PYTHON_EXECUTABLE=${SAFER5_PYTHON:-python3}
    "$PYTHON_EXECUTABLE" -c 'import sys; assert (3,12)<=sys.version_info[:2]<(3,14), "Python 3.12 veya 3.13 gerekli; SAFER5_PYTHON ile yolunu seçin."'
    "$PYTHON_EXECUTABLE" -m venv .venv
    .venv/bin/python -m pip install -r requirements-dev.lock.txt
fi
# Some macOS workspace tools mark .pth files hidden; CPython intentionally skips those.
.venv/bin/python -c 'import os,pathlib,stat; [os.chflags(p,p.stat().st_flags & ~stat.UF_HIDDEN) for p in pathlib.Path(".venv").glob("lib/python*/site-packages/*.pth")] if hasattr(os,"chflags") else None'
npm --prefix frontend ci --cache "$PROJECT_DIR/work/npm-cache" --no-fund
npm --prefix frontend run build
echo 'Kurulum tamamlandı. Başlatın: sh scripts/start.sh'
