"""Isolated clean setup + real HTTP demo + restart/persistence smoke."""

import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DESTINATION=ROOT / "work/temiz kurulum"
OUTPUT=ROOT / "artifacts/validation"


def request(path,body=None):
    payload=json.dumps(body).encode() if body is not None else None
    req=urllib.request.Request("http://127.0.0.1:8877"+path,data=payload,headers={"Content-Type":"application/json"} if payload else {})
    with urllib.request.urlopen(req,timeout=10) as response:
        data=response.read()
        return json.loads(data) if response.headers.get("Content-Type","").startswith("application/json") else data


def start(env,log):
    process=subprocess.Popen([str(DESTINATION/".venv/bin/python"),"-m","safer5","serve","--port","8877"],cwd=DESTINATION,env=env,stdout=log,stderr=log)
    for _ in range(150):
        try:
            assert request("/api/v1/health")["status"]=="ok"
            return process
        except (OSError,AssertionError):
            if process.poll() is not None:
                raise RuntimeError("Clean server failed to start")
            time.sleep(.1)
    process.terminate()
    raise RuntimeError("Clean server startup timeout")


def main():
    OUTPUT.mkdir(parents=True,exist_ok=True)
    if DESTINATION.exists():
        raise RuntimeError("Clean verification destination already exists; use a new checkout")
    shutil.copytree(ROOT,DESTINATION,ignore=shutil.ignore_patterns(".git",".venv","data","artifacts","work","node_modules","dist",".npm-cache",".qa","__pycache__",".pytest_cache",".ruff_cache","*.tsbuildinfo"))
    with (ROOT / "work/clean-install.log").open("w") as log:
        setup=subprocess.run(["sh","scripts/setup.sh"],cwd=DESTINATION,stdout=log,stderr=log,timeout=300)
        if setup.returncode:
            raise RuntimeError("Clean setup failed; see work/clean-install.log")
        env={**os.environ,"PYTHONPATH":str(DESTINATION / "backend/src"),"SAFER5_FRONTEND_DIR":str(DESTINATION / "frontend/dist")}
        process=start(env,log)
        try:
            assert b"safeR5" in request("/")
            assert request("/api/v1/overview")["stats"]["experiments"]==0
            job=request("/api/v1/experiments",{})
            for _ in range(600):
                value=request("/api/v1/jobs/"+job["id"])
                if value["status"] not in ("queued","running"):
                    break
                time.sleep(.1)
            assert value["status"]=="succeeded",value
            result=request("/api/v1/experiments/"+value["result_id"])
            assert result["baseline"]["event_count"]==2400
        finally:
            process.terminate();process.wait(timeout=30)
        process=start(env,log)
        try:
            assert request("/api/v1/overview")["stats"]["experiments"]==1
            assert request("/api/v1/experiments/"+result["id"])["provenance"]==result["provenance"]
        finally:
            process.terminate();process.wait(timeout=30)
    evidence={"status":"passed","platform":sys.platform,"clean_directory":str(DESTINATION),"setup_command":"sh scripts/setup.sh",
        "serve_command":"PYTHONPATH=backend/src .venv/bin/python -m safer5 serve --port 8877",
        "empty_environment_before_setup":True,"demo_event_count":result["baseline"]["event_count"],"experiment_id":result["id"],
        "restart_preserved_history":True,"provenance":result["provenance"],"scope":"Actual native macOS clean venv/npm install, production index, HTTP demo and restart; not Windows/Docker."}
    (OUTPUT / "clean-install.json").write_text(json.dumps(evidence,ensure_ascii=False,indent=2))
    print(json.dumps({"status":"passed","evidence":str(OUTPUT / "clean-install.json")}))


if __name__=="__main__":
    main()
