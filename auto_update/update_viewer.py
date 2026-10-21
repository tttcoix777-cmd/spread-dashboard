"""Independent, display-only TFX metal history. Never writes strategy inputs."""
import argparse
import csv
import hashlib
import io
import json
import math
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from pathlib import Path
from update_dow_nikkei import ROOT, JST, atomic, get_bytes, json_text

PAGE = 'https://www.tfx.co.jp/historical/cfd/'
BASE = 'https://www.tfx.co.jp/kawase/document/PRT-010-CSV-015-'
LEGS = {'G': ('Gold', '金'), 'V': ('Silver', '銀'), 'P': ('Platinum', 'プラチナ')}


def parse_daily(raw, day):
    records = list(csv.reader(io.StringIO(raw.decode('cp932'))))
    stamp = day.replace('-', '')
    if not records or records[0][:2] != ['H00', 'PRT-010-CSV-015'] or records[0][3] != stamp:
        raise ValueError('TFX header/date mismatch: ' + day)
    values = [r for r in records if r and r[0] == 'D01']
    foot = [r for r in records if r and r[0] == 'F90']
    if len(foot) != 1 or int(foot[0][4]) != len(values):
        raise ValueError('TFX truncated report: ' + day)
    groups = {}
    for r in values:
        match = re.fullmatch(r'([GVP])(\d{2})/JPY', r[3])
        if not match:
            continue
        prefix, year = match.groups()
        leg, label = LEGS[prefix]
        contract = '20' + year
        if len(r) != 20 or r[1] != stamp or not r[4].startswith(label) or f'({contract}年リセット)' not in r[4]:
            raise ValueError('TFX product/schema mismatch: ' + day)
        group = groups.setdefault(contract, {'date': day, 'contract': contract})
        if leg in group:
            raise ValueError('Duplicate product: ' + day)
        # Closed/non-traded products have no OHLC: keep null, never settlement or forward fill.
        try:
            opening, high, low, close = [float(r[i]) for i in (6, 8, 10, 12)]
        except ValueError:
            if any(r[i].strip().strip('-－') for i in (6, 8, 10, 12)):
                raise ValueError('Malformed OHLC: ' + day)
            group[leg] = None
            continue
        if not all(math.isfinite(v) and v > 0 for v in (opening, high, low, close)) or not low <= min(opening, close) <= max(opening, close) <= high:
            raise ValueError('Invalid OHLC/unit: ' + day)
        tick = 0.1 if leg == 'Silver' else 1
        if abs(close / tick - round(close / tick)) > 1e-6:
            raise ValueError('Unexpected price unit: ' + day)
        group[leg] = close
    if not groups:
        raise ValueError('No metal products in TFX report: ' + day)
    return [{**{leg: None for leg, _ in LEGS.values()}, **g} for g in groups.values()]


def run(site_dir, cache, start='2022-01-01', fetch=get_bytes, now=None):
    now = now or datetime.now(JST)
    target = site_dir / 'metals-viewer.json'
    status_file = site_dir / 'metals-viewer-status.json'
    old_status = json.loads(status_file.read_text(encoding='utf-8')) if status_file.exists() else {}
    status = {**old_status, 'last_attempt_at': now.isoformat(timespec='seconds'), 'error': '', 'update_status': 'DATA UPDATE ERROR'}
    try:
        old = json.loads(target.read_text(encoding='utf-8')) if target.exists() else {'rows': [], 'sources': []}
        page = fetch(PAGE).decode('utf-8')
        dates = sorted(set(re.findall(r'PRT-010-CSV-015-(20\d{6})\.CSV', page)))
        dates = [d for d in dates if start.replace('-', '') <= d <= now.strftime('%Y%m%d')]
        if not dates or (now.date() - datetime.strptime(dates[-1], '%Y%m%d').date()).days > 4:
            raise ValueError('TFX latest publication missing or more than 4 calendar days old')
        previous = {s['date']: s for s in old['sources']}
        selected = [d for d in dates if datetime.strptime(d, '%Y%m%d').date().isoformat() not in previous or d == dates[-1]]
        cache.mkdir(parents=True, exist_ok=True)

        def load(stamp):
            day = datetime.strptime(stamp, '%Y%m%d').date().isoformat()
            path = cache / (stamp + '.CSV')
            raw = path.read_bytes() if path.exists() and stamp != dates[-1] else fetch(BASE + stamp + '.CSV')
            rows = parse_daily(raw, day)
            path.write_bytes(raw)
            return rows, {'date': day, 'url': BASE + stamp + '.CSV', 'sha256': hashlib.sha256(raw).hexdigest()}

        merged = {(r['date'], r['contract']): r for r in old['rows']}
        with ThreadPoolExecutor(max_workers=4) as pool:
            for rows, source in pool.map(load, selected):
                day = source['date']
                if day in previous and previous[day]['sha256'] != source['sha256']:
                    raise ValueError('Published TFX source changed; manual reconciliation required: ' + day)
                for r in rows:
                    merged[(r['date'], r['contract'])] = r
                previous[day] = source
        rows = sorted(merged.values(), key=lambda r: (r['date'], r['contract']))
        prior_prices = {}
        for row in rows:
            for leg, _ in LEGS.values():
                price = row[leg]
                if price is None:
                    continue
                key = (row['contract'], leg)
                if key in prior_prices and abs(price / prior_prices[key] - 1) > 0.5:
                    raise ValueError('Price jump >50%; check price units/source: ' + row['date'] + ' ' + leg)
                prior_prices[key] = price
        payload = {'source': PAGE, 'price_type': 'TFX closing price (column 12), not settlement',
                   'unit': 'JPY price points', 'multiplier': {'Gold': 100, 'Silver': 100, 'Platinum': 100},
                   'rows': rows, 'sources': sorted(previous.values(), key=lambda s: s['date'])}
        atomic(target, json_text(payload))
        status.update(update_status='UPDATED', last_success_at=status['last_attempt_at'], data_date=rows[-1]['date'],
                      start_date=rows[0]['date'], source_days=len(previous), rows=len(rows))
    except Exception as exc:
        status['error'] = str(exc)
    atomic(status_file, json_text(status))
    print(json.dumps(status, ensure_ascii=False))
    return int(bool(status['error']))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--site-dir', type=Path, default=ROOT.parent / 'dist')
    parser.add_argument('--cache', type=Path, default=ROOT.parent / '.viewer-cache')
    parser.add_argument('--start', default='2022-01-01')
    args = parser.parse_args()
    raise SystemExit(run(args.site_dir, args.cache, args.start))
