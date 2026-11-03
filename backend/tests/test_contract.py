import os
import subprocess
import sys
from pathlib import Path


def test_generated_types_match_backend_contract():
    root = Path(__file__).resolve().parents[2]
    run = subprocess.run([sys.executable, str(root / "scripts/generate_contract.py"), "--check"], capture_output=True, text=True, env={**os.environ,"PYTHONPATH":str(root / "backend/src")})
    assert run.returncode == 0, run.stdout + run.stderr
