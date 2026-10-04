"""TFX公式確定日足→固定B/C2→CSV/JSON。標準ライブラリのみ、実注文なし。"""
import argparse
import csv
import hashlib
import io
import json
import math
import os
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen
from signal_engine import PARAMETERS, calculate, simulate

ROOT = Path(__file__).resolve().parent
JST = timezone(timedelta(hours=9))
FIELDS = ["date", "ny_dow_open", "ny_dow_close", "nikkei225_open", "nikkei225_close"]
LOG_FIELDS = ["attempt_at", "date", "dow", "nikkei", "spread", "ma20", "ma50",
              "spread_10d_change", "signal_b", "signal_c2", "update_status", "error"]


def get_bytes(url):
    if urlparse(url).scheme != "https" or urlparse(url).hostname not in {"www.tfx.co.jp", "www.clickkabu365.jp"}:
        raise ValueError("取得先はTFX公式HTTPSに限ります")
    last = None
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={"User-Agent": "TFX-Spread-Monitor/1.0"}), timeout=30) as response:
                if urlparse(response.url).hostname not in {"www.tfx.co.jp", "www.clickkabu365.jp"}:
                    raise ValueError("公式ドメイン外へのリダイレクト")
                body = response.read(2_000_001)
                if len(body) > 2_000_000:
                    raise ValueError("公式データのサイズ上限超過")
                return body
        except (OSError, TimeoutError) as error:
            last = error
            if attempt < 2:
                time.sleep(2 ** attempt)
    raise RuntimeError("TFX取得失敗: " + str(last))


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.inputs, self.labels, self.tables = {}, {}, []
        self.label_id = self.label_text = self.cell = None
        self.row = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "input" and a.get("type") == "checkbox":
            self.inputs[a.get("id")] = a
        if tag == "label":
            self.label_id, self.label_text = a.get("for"), ""
        if tag == "tr":
            self.row = []
        if tag in {"td", "th"}:
            self.cell = ""

    def handle_data(self, text):
        if self.label_text is not None:
            self.label_text += text
        if self.cell is not None:
            self.cell += text

    def handle_endtag(self, tag):
        if tag == "label" and self.label_text is not None:
            self.labels[self.label_id] = " ".join(self.label_text.split())
            self.label_id = self.label_text = None
        if tag in {"td", "th"} and self.cell is not None:
            self.row.append("".join(self.cell.split()))
            self.cell = None
        if tag == "tr" and self.row:
            self.tables.append(self.row)
            self.row = []


def products_from_page(page, year):
    parser = PageParser()
    parser.feed(page)
    patterns = {"nikkei225": rf"日経\s*225 リセット付証拠金取引（Nikkei 225）{year}",
                "ny_dow": rf"NYダウ リセット付証拠金取引（DJIA）{year}"}
    selected = {}
    available = []
    for element_id, label in parser.labels.items():
        if re.search(r"(?:Nikkei 225|DJIA).*20\d\d", label) and "Micro" not in label:
            available.append(label)
        for leg, pattern in patterns.items():
            if re.fullmatch(pattern, label):
                item = parser.inputs.get(element_id, {})
                if leg in selected or not item.get("value") or not item.get("name"):
                    raise ValueError("公式商品選択欄が重複・不正です")
                selected[leg] = {"name": label, "code": item["value"], "form_name": item["name"], "year": year}
    if set(selected) != {"ny_dow", "nikkei225"}:
        raise ValueError("固定年限の対象商品を公式ページから確認できません")
    return selected, available


def verify_lifecycle(page, selected, expected, now):
    parser = PageParser()
    parser.feed(page)
    observed = {}
    for leg, prefix in [("nikkei225", "日経225リセット付"), ("ny_dow", "NYダウリセット付")]:
        matches = [r for r in parser.tables if len(r) >= 4 and r[0].startswith(prefix)
                   and f"{selected[leg]['year']}年リセット" in r[0]]
        if len(matches) != 1:
            raise ValueError("公式の取引開始・最終日を確認できません: " + leg)
        dates = []
        for cell in matches[0][1:4]:
            m = re.search(r"(\d{4})年(\d{1,2})月(\d{1,2})日", cell)
            if not m:
                raise ValueError("公式の取引日程形式が変わっています")
            dates.append(date(*map(int, m.groups())).isoformat())
        value = dict(zip(["start", "last_trade", "reset"], dates))
        if value != expected[leg]:
            raise ValueError("公式の商品日程が固定設定と異なります。確認が必要です: " + leg)
        if not value["start"] <= now.date().isoformat() <= value["last_trade"]:
            raise ValueError("固定2026年限は現在取引期間外です。年限を自動切替しません: " + leg)
        observed[leg] = value
    return observed


def daily_csv(raw, day, selected):
    rows = list(csv.reader(io.StringIO(raw.decode("cp932"))))
    target = day.replace("-", "")
    if not rows or rows[0][:2] != ["H00", "PRT-010-CSV-015"] or len(rows[0]) < 4 or rows[0][3] != target:
        raise ValueError("TFX日次CSVヘッダー/取引日が一致しません")
    records = [r for r in rows if r and r[0] == "D01"]
    footers = [r for r in rows if r and r[0] == "F90"]
    if len(footers) != 1 or len(footers[0]) < 5 or int(footers[0][4]) != len(records):
        raise ValueError("TFX日次CSVが途中で切れています")
    result = {"date": day}
    for leg, product in selected.items():
        hits = [r for r in records if len(r) >= 5 and r[3] == product["code"]]
        if len(hits) != 1:
            raise ValueError("TFX商品行が欠損・重複: " + product["name"])
        r = hits[0]
        expected_prefix = "日経225リセット付証拠金取引" if leg == "nikkei225" else "NYダウリセット付証拠金取引"
        if len(r) != 20 or r[1] != target or not r[4].startswith(expected_prefix) or f"({product['year']}年リセット)" not in r[4]:
            raise ValueError("TFX商品名・年限・日付・列形式が不一致")
        # TFX PRT-010-CSV-015: 6=始値、8=高値、10=安値、12=終値。14=清算値は使用しない。
        for field, index in [("open", 6), ("close", 12)]:
            value = r[index].strip().replace(",", "")
            if not value or value in {"-", "―"}:
                raise ValueError(f"{day} {product['name']} {field}欠損。自動補完しません")
            number = float(value)
            if not math.isfinite(number) or number <= 0:
                raise ValueError("価格が正の有限値ではありません")
            result[f"{leg}_{field}"] = number
        high, low = float(r[8]), float(r[10])
        if not all(math.isfinite(v) and v > 0 for v in [high, low]) or not low <= result[f"{leg}_close"] <= high or not low <= result[f"{leg}_open"] <= high:
            raise ValueError("TFX OHLC価格の整合性エラー")
    return result


def validate_history(rows):
    unique = {}
    for row in rows:
        r = {"date": date.fromisoformat(row["date"]).isoformat()}
        for field in FIELDS[1:]:
            number = float(row[field])
            if not math.isfinite(number) or number <= 0:
                raise ValueError("履歴の欠損・異常価格: " + field)
            r[field] = number
        if r["date"] in unique and unique[r["date"]] != r:
            raise ValueError("同日異価格の履歴があります: " + r["date"])
        unique[r["date"]] = r
    result = [unique[d] for d in sorted(unique)]
    if len(result) < 50:
        raise ValueError("指標計算用に最低50共通営業日の履歴が必要です")
    return result


def merge(history, incoming, max_ratio):
    merged = {r["date"]: r for r in history}
    previous = history[-1]
    added = []
    for r in sorted(incoming, key=lambda x: x["date"]):
        if r["date"] in merged:
            if merged[r["date"]] != r:
                raise ValueError("TFX価格が保存履歴と不一致。自動上書きしません: " + r["date"])
            continue
        if r["date"] < previous["date"]:
            raise ValueError("履歴中間への挿入は確認が必要です")
        for leg in ["ny_dow", "nikkei225"]:
            for field in ["open", "close"]:
                ratio = abs(r[f"{leg}_{field}"] / previous[f"{leg}_close"] - 1)
                if ratio > max_ratio:
                    raise ValueError(f"DATA PRICE WARNING: {r['date']} {leg}/{field} {ratio:.1%}変動。自動補完しません")
        merged[r["date"]] = r
        previous = r
        added.append(r["date"])
    return [merged[d] for d in sorted(merged)], added


def atomic(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(text, encoding="utf-8", newline="")
    os.replace(temp, path)


def csv_text(rows, fields):
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue()


def json_text(data):
    return json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n"


def write_log(root, payload):
    root.mkdir(parents=True, exist_ok=True)
    latest = payload.get("latest") or {}
    log = {"attempt_at": payload["last_attempt_at"], "date": latest.get("date"),
           "dow": latest.get("ny_dow_close"), "nikkei": latest.get("nikkei225_close"),
           **{k: latest.get(k) for k in ["spread", "ma20", "ma50", "spread_10d_change", "signal_b", "signal_c2"]},
           "update_status": payload["update_status"], "error": payload.get("error", "")}
    filename = root / (payload["last_attempt_at"][:7] + ".csv")
    with filename.open("a", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=LOG_FIELDS)
        if file.tell() == 0:
            writer.writeheader()
        writer.writerow(log)
    audit = root / (re.sub(r"[^0-9]", "", payload["last_attempt_at"]) + ".json")
    atomic(audit, json_text({k: v for k, v in payload.items() if k != "history"}))


def run(root=ROOT, site_dir=None, now=None, fetch=get_bytes):
    now = now or datetime.now(JST)
    stamp = now.isoformat(timespec="seconds")
    config = json.loads((root / "config.json").read_text(encoding="utf-8"))
    frozen = json.loads((root / "frozen_settings.json").read_text(encoding="utf-8"))
    status_file = root / "data/status.json"
    old = json.loads(status_file.read_text(encoding="utf-8")) if status_file.exists() else {}
    payload = {**old, "last_attempt_at": stamp, "schedule_time_jst": "10:30", "error": "",
               "update_status": "DATA UPDATE ERROR", "stale_attempt_hours": config["stale_attempt_hours"]}
    error = None
    history = []
    try:
        if any(frozen["parameters"].get(k) != v for k, v in PARAMETERS.items()) or config["product_year"] != 2026:
            raise ValueError("B/C2固定パラメータまたは2026年限が変更されています")
        with (root / "data/prices.csv").open(encoding="utf-8-sig", newline="") as file:
            history = validate_history(list(csv.DictReader(file)))
        if any(not r["date"].startswith("2026-") or r["date"] > now.date().isoformat() for r in history):
            raise ValueError("保存履歴に年外・未来日付があります")
        page = fetch(config["source_page"]).decode("utf-8")
        selected, available = products_from_page(page, config["product_year"])
        lifecycle = verify_lifecycle(fetch(config["product_schedule_source"]).decode("utf-8"), selected, config["verified_lifecycle"], now)
        published = sorted(set(re.findall(r"PRT-010-CSV-015-(20\d{6})\.CSV", page)))
        if not published:
            raise ValueError("公式ページに確定日足CSVがありません")
        latest_source_day = datetime.strptime(published[-1], "%Y%m%d").date()
        if latest_source_day > now.date() or latest_source_day.isoformat() < history[-1]["date"]:
            raise ValueError("公式最新日と保存履歴が矛盾しています")
        if (now.date() - latest_source_day).days > config["max_source_age_calendar_days"]:
            raise ValueError("公式データが4暦日より古くなっています。休場・公表遅延を確認してください")
        needed = [d for d in published if d >= history[-1]["date"].replace("-", "")]
        incoming, sources = [], []
        for compact in needed:
            day = datetime.strptime(compact, "%Y%m%d").date().isoformat()
            url = urljoin(config["source_page"], f"/kawase/document/PRT-010-CSV-015-{compact}.CSV")
            raw = fetch(url)
            # 原本はエラー解析用に保存。解析前でも日付・ハッシュを記録できる。
            raw_dir = root / "logs/raw"
            raw_dir.mkdir(parents=True, exist_ok=True)
            (raw_dir / f"{compact}.CSV").write_bytes(raw)
            incoming.append(daily_csv(raw, day, selected))
            sources.append({"date": day, "url": url, "sha256": hashlib.sha256(raw).hexdigest()})
        history, added = merge(history, incoming, config["anomaly_max_leg_change_ratio"])
        indicators = calculate(history)
        payload.update(update_status="UPDATED" if added else "NO_NEW_DATA", error="", history=history,
                       latest=indicators[-1], products=selected, available_products=available,
                       verified_lifecycle=lifecycle, sources=sources, data_date=history[-1]["date"],
                       last_success_at=stamp, added_dates=added, frozen_parameters=PARAMETERS,
                       positions={"B": simulate(indicators, "signal_b"), "C2": simulate(indicators, "signal_c2")})
        atomic(root / "data/prices.csv", csv_text(history, FIELDS))
        atomic(root / "data/latest.json", json_text(payload["latest"]))
        atomic(root / "data/signals.csv", csv_text(indicators, FIELDS + ["spread", "ma20", "ma50", "spread_10d_change", "signal_b", "signal_c2", "signal_state"]))
    except Exception as exc:
        error = str(exc)
        payload.update(update_status="DATA UPDATE ERROR", error=error, added_dates=[])
        if not payload.get("history") and history:
            payload.update(history=history, latest=calculate(history)[-1], data_date=history[-1]["date"])
        # latest/pricesは成功時だけ更新。statusは必ず更新し、前回正常値を「最新」に見せない。
    atomic(status_file, json_text(payload))
    write_log(root / "logs", payload)
    if site_dir:
        if payload.get("history"):
            atomic(site_dir / "dow-nikkei.csv", csv_text(payload["history"], FIELDS))
        atomic(site_dir / "dow-nikkei-status.json", json_text(payload))
    print(json.dumps({"status": payload["update_status"], "data_date": payload.get("data_date"),
                      "last_success_at": payload.get("last_success_at"), "added_dates": payload.get("added_dates"),
                      "error": payload["error"]}, ensure_ascii=False))
    return 1 if error else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-dir", type=Path, default=ROOT.parent / "dist")
    args = parser.parse_args()
    ROOT.joinpath("data").mkdir(parents=True, exist_ok=True)
    lock = ROOT / "data/.update.lock"
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        print("別の更新処理が実行中です。停止済みならREADMEの復旧手順を参照してください。", file=sys.stderr)
        return 2
    os.close(fd)
    try:
        return run(site_dir=args.site_dir.resolve())
    finally:
        lock.unlink(missing_ok=True)


if __name__ == "__main__":
    sys.exit(main())
