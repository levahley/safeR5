"""Documented local CLI; commands never execute event content."""

import argparse
import json
import os
import shutil
import sys
import uuid
from pathlib import Path

from .experiments import publish_experiment, run_experiment
from .lab import generate_lab, validate_lab
from .reports import report_bytes
from .schemas import LabConfig, RunConfig
from .storage import Store


def parser():
    result = argparse.ArgumentParser(prog="python -m safer5", description="safeR5 yerel araştırma laboratuvarı")
    result.add_argument("--root", type=Path, default=Path(os.environ.get("SAFER5_DATA_DIR", "data")))
    commands = result.add_subparsers(dest="command", required=True)
    serve = commands.add_parser("serve")
    serve.add_argument("--port", type=int, default=8765)
    lab = commands.add_parser("lab").add_subparsers(dest="lab_command", required=True)
    generate = lab.add_parser("generate")
    generate.add_argument("--profile", choices=["demo"], default="demo")
    generate.add_argument("--seed", type=int, default=42)
    generate.add_argument("--n-events", type=int, default=2400)
    generate.add_argument("--users", type=int, default=8)
    generate.add_argument("--hosts", type=int, default=4)
    generate.add_argument("--start", default="2026-01-01T00:00:00Z")
    generate.add_argument("--duration-hours", type=float, default=12)
    validate = lab.add_parser("validate")
    validate.add_argument("--manifest", type=Path, required=True)
    run = commands.add_parser("experiment").add_subparsers(dest="experiment_command", required=True).add_parser("run")
    run.add_argument("--config", type=Path)
    evaluate = commands.add_parser("evaluate")
    evaluate.add_argument("--experiment", required=True)
    report = commands.add_parser("report")
    report.add_argument("--experiment", required=True)
    report.add_argument("--format", choices=["json", "csv", "markdown", "html"], default="html")
    report.add_argument("--output", type=Path, required=True)
    ait = commands.add_parser("ait").add_subparsers(dest="ait_command", required=True).add_parser("import")
    ait.add_argument("--archive", type=Path, required=True)
    ait.add_argument("--destination", type=Path, required=True)
    ait.add_argument("--max-uncompressed-bytes", type=int, default=1073741824)
    return result


def main():
    args = parser().parse_args()
    try:
        if args.command == "serve":
            import uvicorn
            from .api import create_app
            uvicorn.run(create_app(args.root), host="127.0.0.1", port=args.port, workers=1)
            return 0
        if args.command == "ait":
            from .ait import import_ait_archive
            value = import_ait_archive(args.archive, args.destination, max_uncompressed_bytes=args.max_uncompressed_bytes)
        elif args.command == "lab" and args.lab_command == "validate":
            value = validate_lab(args.manifest)
            if not value["valid"]:
                print(json.dumps(value, ensure_ascii=False))
                return 1
        else:
            store = Store(args.root)
            if args.command == "lab":
                temp = store.root / "staging" / uuid.uuid4().hex
                try:
                    generate_lab(temp, LabConfig(profile=args.profile, seed=args.seed, n_events=args.n_events,
                        users=args.users,hosts=args.hosts,start=args.start,duration_hours=args.duration_hours))
                    value = store.register_lab(temp)
                finally:
                    shutil.rmtree(temp, ignore_errors=True)
            elif args.command == "experiment":
                config = RunConfig.model_validate_json(args.config.read_text()) if args.config else RunConfig()
                value = publish_experiment(store, run_experiment(store, config))
                value = {"id": value["id"], "status": value["status"], "metrics": value["perturbed"]["metrics"]}
            elif args.command == "evaluate":
                result = store.get("experiments", args.experiment)
                value = {"baseline": result["baseline"]["metrics"], "perturbed": result["perturbed"]["metrics"]}
            else:
                result = store.get("experiments", args.experiment)
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_bytes(report_bytes(result, args.format))
                value = {"output": str(args.output.resolve()), "format": args.format}
        print(json.dumps(value, ensure_ascii=False, default=str))
        return 0
    except (ValueError, FileNotFoundError, OSError) as exc:
        print(f"safeR5: İşlem tamamlanamadı ({type(exc).__name__}). Girdiyi, dosyayı ve erişim izinlerini kontrol edin.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
