#!/bin/sh
set -eu
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$PROJECT_DIR"
if [ ! -x .venv/bin/python ] || [ ! -f frontend/dist/index.html ]; then
    echo 'Önce sh scripts/setup.sh komutunu çalıştırın.' >&2
    exit 1
fi
export PYTHONPATH="$PROJECT_DIR/backend/src"
export SAFER5_DATA_DIR=${SAFER5_DATA_DIR:-"$PROJECT_DIR/data"}
export SAFER5_FRONTEND_DIR="$PROJECT_DIR/frontend/dist"
port_status=$(.venv/bin/python - <<'PY'
import errno
import socket

with socket.socket() as sock:
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind(("127.0.0.1", 8765))
    except OSError as error:
        if error.errno != errno.EADDRINUSE:
            raise
        print("in-use")
PY
) || { echo 'Port kontrolü tamamlanamadı. Yukarıdaki Python/ortam hatasını kontrol edin.' >&2; exit 1; }
if [ "$port_status" = 'in-use' ]; then
    echo '8765 portu kullanımda. Çalışan safeR5 penceresini kontrol edin.' >&2
    exit 1
fi
echo 'safeR5 açılıyor: http://127.0.0.1:8765'
exec .venv/bin/python -m safer5 --root "$SAFER5_DATA_DIR" serve
