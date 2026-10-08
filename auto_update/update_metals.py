"""TFX確定日足から銀/Pt固定V3を更新する。取引APIは使用しない。"""
import csv
import hashlib
import io
import json
import math
import re
import sys
from datetime import date, datetime
from pathlib import Path

from update_dow_nikkei import ROOT, JST, PageParser, atomic, get_bytes, json_text

SOURCE_PAGE = "https://www.tfx.co.jp/historical/cfd/"
CODES = {"Silver": "V26/JPY", "Platinum": "P26/JPY"}
LABELS = {"Silver": "銀ETFリセット付証拠金取引（Silver ETF）2026",
          "Platinum": "プラチナETFリセット付証拠金取引（Platinum ETF）2026"}
PREFIXES = {"Silver": "銀ETFリセット付証拠金取引",
            "Platinum": "プラチナETFリセット付証拠金取引"}
COLUMNS = ["Date", "Silver", "Platinum"]

def derive(rows):
    """dist/engine.js と同じ固定V3条件。サヤ=銀×3−プラチナ。"""
    out = []
    for item in rows:
        row = {"date": item["Date"], "silver": item["Silver"],
               "platinum": item["Platinum"],
               "spread": 3 * item["Silver"] - item["Platinum"], "v3": 0}
        row["change"] = row["spread"] - out[-1]["spread"] if out else None
        if len(out) >= 6:
            moves = [r["change"] for r in out[-5:]]
            net = sum(moves)
            if sum(x < 0 for x in moves) >= 3 and net <= -300 and row["change"] > 0 and row["spread"] <= 2200:
                row["v3"] = 1
            elif sum(x > 0 for x in moves) >= 3 and net >= 300 and row["change"] < 0 and row["spread"] >= 2500:
                row["v3"] = -1
        out.append(row)
    return out

def read_history(path):
    with path.open(encoding="utf-8-sig", newline="") as f:
        source = list(csv.DictReader(f))
    if len(source) < 7:
        raise ValueError("銀−Ptの既存履歴が7営業日未満です")
    out = []
    for item in source:
        day = date.fromisoformat(item["Date"]).isoformat()
        if out and day <= out[-1]["Date"]:
            raise ValueError("銀−Ptの日付重複/逆順")
        row = {"Date": day}
        for leg in CODES:
            value = float(item[leg])
            if not math.isfinite(value) or value <= 0:
                raise ValueError("銀−Ptの欠損/異常価格")
            row[leg] = value
        out.append(row)
    return out

def available_dates(page):
    parser = PageParser()
    parser.feed(page)
    for leg, label in LABELS.items():
        found = [i for i, value in parser.labels.items() if "".join(value.split()) == "".join(label.split())]
        if len(found) != 1 or parser.inputs.get(found[0], {}).get("value") != CODES[leg]:
            raise ValueError("TFX公式商品名/コードが固定2026年限と不一致: " + leg)
    dates = sorted(set(re.findall(r"PRT-010-CSV-015-(20\d{6})\.CSV", page)))
    if not dates:
        raise ValueError("TFX公式日足一覧が取得できません")
    return dates

def read_daily(raw, day):
    records = list(csv.reader(io.StringIO(raw.decode("cp932"))))
    stamp = day.replace("-", "")
    if not records or records[0][:2] != ["H00", "PRT-010-CSV-015"] or records[0][3] != stamp:
        raise ValueError("TFX帳票ヘッダー/日付不一致: " + day)
    values = [r for r in records if r and r[0] == "D01"]
    foot = [r for r in records if r and r[0] == "F90"]
    if len(foot) != 1 or int(foot[0][4]) != len(values):
        raise ValueError("TFX帳票欠損: " + day)
    result = {"Date": day}
    for leg, code in CODES.items():
        match = [r for r in values if len(r) == 20 and r[3] == code]
        if len(match) != 1:
            raise ValueError("TFX商品行重複/欠損: " + leg)
        r = match[0]
        if r[1] != stamp or not r[4].startswith(PREFIXES[leg]) or "(2026年リセット)" not in r[4]:
            raise ValueError("TFX商品名・年限不一致: " + leg)
        opening, high, low, close = [float(r[i]) for i in (6, 8, 10, 12)]
        if not all(math.isfinite(v) and v > 0 for v in (opening, high, low, close)) or not low <= min(opening, close) <= max(opening, close) <= high:
            raise ValueError("TFX OHLC異常: " + leg)
        result[leg] = close  # 12=終値。14=清算値は不使用
    return result

def csv_text(rows):
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=COLUMNS)
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue()

def run(root=ROOT, site_dir=None, now=None, fetch=get_bytes):
    now = now or datetime.now(JST)
    site_dir = site_dir or root.parent / "dist"
    stamp = now.isoformat(timespec="seconds")
    path = root / "data/metals-status.json"
    old = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    status = {**old, "last_attempt_at": stamp, "error": "", "update_status": "DATA UPDATE ERROR", "added_dates": []}
    failed = False
    try:
        rows = read_history(site_dir / "silver-platinum.csv")
        if rows[-1]["Date"] > now.date().isoformat():
            raise ValueError("未来日付の履歴があります")
        raw_page = fetch(SOURCE_PAGE).decode("utf-8")
        dates = available_dates(raw_page)
        latest_published = datetime.strptime(dates[-1], "%Y%m%d").date()
        if latest_published > now.date() or (now.date() - latest_published).days > 4:
            raise ValueError("TFX公式価格の最終公開日が未来/4暦日超過")
        if rows[-1]["Date"].replace("-", "") < dates[0]:
            raise ValueError("公開日足と既存履歴に欠落があります。自動補完しません")
        added, sources = [], []
        for stamp_day in dates:
            day = datetime.strptime(stamp_day, "%Y%m%d").date().isoformat()
            if day < rows[-1]["Date"]:
                continue
            url = "https://www.tfx.co.jp/kawase/document/PRT-010-CSV-015-" + stamp_day + ".CSV"
            raw = fetch(url)
            row = read_daily(raw, day)
            sources.append({"date": day, "url": url, "sha256": hashlib.sha256(raw).hexdigest()})
            if day == rows[-1]["Date"]:
                if any(abs(row[leg] - rows[-1][leg]) > 0.000001 for leg in CODES):
                    raise ValueError("既存価格とTFX公式終値が不一致: " + day)
                continue
            for leg in CODES:
                if abs(row[leg] / rows[-1][leg] - 1) > 0.20:
                    raise ValueError("DATA PRICE WARNING: " + day + " " + leg)
            rows.append(row)
            added.append(day)
        latest = derive(rows)[-1]
        status.update(update_status="UPDATED" if added else "NO_NEW_DATA", data_date=latest["date"],
                      latest=latest, last_success_at=stamp, added_dates=added, sources=sources,
                      v3_frozen=True, product_codes=CODES)
        atomic(site_dir / "silver-platinum.csv", csv_text(rows))
    except Exception as exc:
        failed = True
        status.update(error=str(exc), update_status="DATA UPDATE ERROR")
    atomic(path, json_text(status))
    atomic(site_dir / "silver-platinum-status.json", json_text(status))
    logs = root / "logs/metals"
    logs.mkdir(parents=True, exist_ok=True)
    with (logs / f"{now.year}-{now.month:02d}.csv").open("a", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=["attempt", "data_date", "spread", "v3", "status", "error"])
        if file.tell() == 0:
            writer.writeheader()
        prior = status.get("latest") or {}
        writer.writerow({"attempt": stamp, "data_date": status.get("data_date"), "spread": prior.get("spread"),
                         "v3": prior.get("v3"), "status": status["update_status"], "error": status["error"]})
    print(json.dumps({"status": status["update_status"], "date": status.get("data_date"),
                      "latest": status.get("latest"), "error": status["error"]}, ensure_ascii=False))
    return 1 if failed else 0

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--site-dir", type=Path, default=ROOT.parent / "dist")
    args = parser.parse_args()
    sys.exit(run(site_dir=args.site_dir.resolve()))
