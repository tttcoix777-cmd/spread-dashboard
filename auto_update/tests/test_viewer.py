import json
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import update_viewer as viewer


class ViewerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='viewer-test-')
        self.site = Path(self.tmp.name)
        self.raw = (ROOT / 'logs/raw/20261020.CSV').read_bytes()
        self.now = datetime(2026, 10, 21, 10, 30, tzinfo=viewer.JST)

    def tearDown(self):
        self.tmp.cleanup()

    def fetch(self, url):
        return (b'PRT-010-CSV-015-20261020.CSV' if url == viewer.PAGE else self.raw)

    def execute(self, fetch=None):
        return viewer.run(self.site, self.site / 'cache', fetch=fetch or self.fetch, now=self.now)

    def test_actual_close_and_contract(self):
        row = next(r for r in viewer.parse_daily(self.raw, '2026-10-20') if r['contract'] == '2026')
        self.assertEqual(row['Gold'], 59740)
        self.assertNotEqual(row['Gold'], 59747)  # settlement
        self.assertEqual(row['Silver'], 8275.9)

    def test_update_idempotent_and_preserves_strategy_files(self):
        protected = self.site / 'silver-platinum.csv'
        protected.write_text('strategy data')
        self.assertEqual(self.execute(), 0)
        saved = (self.site / 'metals-viewer.json').read_bytes()
        self.assertEqual(self.execute(), 0)
        self.assertEqual(saved, (self.site / 'metals-viewer.json').read_bytes())
        self.assertEqual(protected.read_text(), 'strategy data')

    def test_failure_retains_prices_and_last_success(self):
        self.execute()
        saved = (self.site / 'metals-viewer.json').read_bytes()
        old = json.loads((self.site / 'metals-viewer-status.json').read_text())
        def fail(url):
            raise OSError('offline')
        self.assertEqual(self.execute(fail), 1)
        status = json.loads((self.site / 'metals-viewer-status.json').read_text())
        self.assertEqual(status['last_success_at'], old['last_success_at'])
        self.assertEqual(status['error'], 'offline')
        self.assertEqual(saved, (self.site / 'metals-viewer.json').read_bytes())

    def test_bad_date_truncated_duplicate_units(self):
        with self.assertRaises(ValueError):
            viewer.parse_daily(self.raw, '2026-10-19')
        with self.assertRaises(ValueError):
            viewer.parse_daily(self.raw.split(b'F90')[0], '2026-10-20')
        with self.assertRaises(ValueError):
            viewer.parse_daily(self.raw.replace(b'59740,', b'59740.5,'), '2026-10-20')

    def test_fullwidth_holiday_not_settlement(self):
        records = self.raw.decode('cp932').splitlines()
        for i, line in enumerate(records):
            fields = line.split(',')
            if len(fields) == 20 and fields[3] == 'G26/JPY':
                for k in (6, 8, 10, 12):
                    fields[k] = '－－－'
                records[i] = ','.join(fields)
        row = next(r for r in viewer.parse_daily('\n'.join(records).encode('cp932'), '2026-10-20') if r['contract'] == '2026')
        self.assertIsNone(row['Gold'])
        self.assertIsNotNone(row['Silver'])

    def test_changed_source_rejected(self):
        self.execute()
        self.raw = self.raw.replace(b'59740,', b'59741,')
        self.assertEqual(self.execute(), 1)
        status = json.loads((self.site / 'metals-viewer-status.json').read_text())
        self.assertIn('changed', status['error'])


if __name__ == '__main__':
    unittest.main()

