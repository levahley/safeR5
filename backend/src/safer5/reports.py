"""Self-contained printable exports with escaped untrusted content."""

import csv
import html
import io
import json


def safe_cell(value):
    text = str(value)
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")) else text


def report_bytes(result, format):
    if format == "json":
        return json.dumps(result, ensure_ascii=False, indent=2).encode()
    if format == "csv":
        out = io.StringIO(newline="")
        writer = csv.writer(out)
        writer.writerow(["safeR5", "Deney", safe_cell(result["name"])])
        writer.writerow(["ölçüm", "tam_kayıt", "kayıplı_kayıt"])
        for metric in sorted(result["baseline"]["metrics"]):
            writer.writerow([safe_cell(metric), safe_cell(result["baseline"]["metrics"][metric]), safe_cell(result["perturbed"]["metrics"][metric])])
        writer.writerow(["deney_id", result["id"]])
        writer.writerow(["yapılandırma", safe_cell(json.dumps(result["config"], ensure_ascii=False))])
        return ("\ufeff" + out.getvalue()).encode("utf-8")
    title = "safeR5 — " + result["name"]
    details = {k: result.get(k) for k in ("id", "config", "optimization", "provenance", "performance", "loss_manifest")}
    limitations = "Yerel araştırma deneyi; üretim ağı başarısı veya saldırgan atfı değildir. Veri kökeni provenance.synthetic alanındadır. Model skoru olasılık değildir. Yanlış alarm paydası gözlenen, etiketli normal kaynak/host/kullanıcı/5dk pencereleridir. evidence_flag_rate ayrı bir olay-delil oranıdır. Görünmez saldırı adımları yakalama paydasında kalır."
    if format == "markdown":
        text = f"# {html.escape(title.replace(chr(10), ' '))}\n\n{limitations}\n\n"
        for name, key in (("Tam kayıt", "baseline"), ("Kayıplı kayıt", "perturbed")):
            text += f"## {name}\n\n```json\n{json.dumps(result[key]['metrics'],ensure_ascii=False,indent=2)}\n```\n\n"
        text += "## Tekrar üretim ve yöntem\n\n~~~json\n" + json.dumps(details, ensure_ascii=False, indent=2).replace("~", "\\u007e").replace("<", "\\u003c") + "\n~~~\n"
        return text.encode()
    if format != "html":
        raise ValueError("Desteklenmeyen rapor biçimi.")
    sections = "".join(f"<h2>{name}</h2><pre>{html.escape(json.dumps(result[key]['metrics'],ensure_ascii=False,indent=2))}</pre>" for name,key in (("Tam kayıt","baseline"),("Kayıplı kayıt","perturbed")))
    links = "".join(f'<li><a href="/api/v1/experiments/{result["id"]}/evidence?event_id={html.escape(eid,quote=True)}">{html.escape(eid)}</a></li>' for a in result.get("perturbed", {}).get("alerts", [])[:5] for eid in a["evidence_ids"][:2])
    text = f'''<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)}</title><style>body{{font:16px system-ui;max-width:980px;margin:40px auto;padding:0 20px;color:#162633}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;background:#f0f4f6;padding:16px}}h1{{border-bottom:3px solid #168f80;padding-bottom:20px}}@media print{{body{{margin:0;font-size:10pt}}pre{{background:white;border:1px solid #ddd}}h2{{break-after:avoid}}a{{overflow-wrap:anywhere}}}}</style><h1>{html.escape(title)}</h1><p>{html.escape(limitations)}</p>{sections}<h2>Gözlenen delil bağlantıları</h2><ul>{links}</ul><h2>Yöntem, kaynak ve tekrar üretim</h2><pre>{html.escape(json.dumps(details,ensure_ascii=False,indent=2))}</pre></html>'''
    return text.encode()
