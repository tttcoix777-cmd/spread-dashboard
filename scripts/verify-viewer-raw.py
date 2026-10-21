"""Read-only check of every cached TFX original against the source manifest and saved prices."""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'auto_update'))
from update_viewer import parse_daily, PAGE, get_bytes


def verify(cache, live=False):
    data = json.loads((ROOT / 'dist/metals-viewer.json').read_text(encoding='utf-8'))
    expected = {(r['date'], r['contract']): r for r in data['rows']}
    actual = {}
    errors = []
    for source in data['sources']:
        file = cache / (source['date'].replace('-', '') + '.CSV')
        if not file.exists():
            errors.append('Missing original: ' + source['date'])
            continue
        raw = file.read_bytes()
        if hashlib.sha256(raw).hexdigest() != source['sha256']:
            errors.append('SHA256 mismatch: ' + source['date'])
        for row in parse_daily(raw, source['date']):
            actual[(row['date'], row['contract'])] = row
    if actual != expected:
        errors.append('Original parsed prices and saved source prices differ')
    missing_reports = []
    if live:
        page = get_bytes(PAGE).decode('utf-8')
        days = {d for d in re.findall(r'PRT-010-CSV-015-(20\d{6})\.CSV', page)
                if data['sources'][0]['date'].replace('-', '') <= d <= data['sources'][-1]['date'].replace('-', '')}
        saved = {s['date'].replace('-', '') for s in data['sources']}
        missing_reports = sorted(days - saved)
        if missing_reports or saved - days:
            errors.append('Official report calendar and saved manifest differ')
    return {'source_days': len(data['sources']), 'original_rows': len(actual), 'prices_unchanged': actual == expected,
            'official_listing_checked': live, 'missing_official_reports': missing_reports, 'errors': errors}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', type=Path, default=ROOT / '.viewer-cache')
    parser.add_argument('--check-live', action='store_true')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    report = verify(args.cache, args.check_live)
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(text + '\n', encoding='utf-8')
    print(text)
    raise SystemExit(bool(report['errors']))
