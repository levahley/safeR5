"""Exercise the shell launcher without depending on the installed app environment."""

import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest


START_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "start.sh"


class StartupTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.project = Path(self.temp_dir.name)
        (self.project / "scripts").mkdir()
        shutil.copyfile(START_SCRIPT, self.project / "scripts" / "start.sh")
        (self.project / ".venv" / "bin").mkdir(parents=True)
        (self.project / ".venv" / "bin" / "python").symlink_to(sys.executable)
        (self.project / "frontend" / "dist").mkdir(parents=True)
        (self.project / "frontend" / "dist" / "index.html").touch()
        source = self.project / "backend" / "src"
        source.mkdir(parents=True)
        (source / "safer5.py").write_text("print('APP_STARTED')\n", encoding="utf-8")
        self.env = os.environ.copy()
        for key in ("PYTHONHOME", "PYTHONPATH", "PYTHONSTARTUP"):
            self.env.pop(key, None)

    def run_launcher(self):
        return subprocess.run(
            ["sh", "scripts/start.sh"],
            cwd=self.project,
            env=self.env,
            capture_output=True,
            text=True,
            timeout=15,
        )

    def test_python_initialization_failure_does_not_claim_port_is_busy(self):
        # A broken interpreter must not be mistaken for an occupied socket.
        self.env["PYTHONHOME"] = str(self.project / "missing-python-home")

        result = self.run_launcher()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Fatal Python error", result.stderr)
        self.assertNotIn("portu kullanımda", result.stderr)
        self.assertNotIn("APP_STARTED", result.stdout)

    def test_occupied_port_still_reports_port_is_busy(self):
        listener = socket.socket()
        self.addCleanup(listener.close)
        try:
            listener.bind(("127.0.0.1", 8765))
        except OSError as error:
            self.skipTest("Port 8765 is unavailable for the regression: %s" % error)
        listener.listen()

        result = self.run_launcher()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("8765 portu kullanımda", result.stderr)
        self.assertNotIn("APP_STARTED", result.stdout)

    def test_free_port_starts_application(self):
        with socket.socket() as probe:
            try:
                probe.bind(("127.0.0.1", 8765))
            except OSError as error:
                self.skipTest("Port 8765 is unavailable for the regression: %s" % error)

        result = self.run_launcher()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("APP_STARTED", result.stdout)
        self.assertNotIn("portu kullanımda", result.stderr)


if __name__ == "__main__":
    unittest.main()
