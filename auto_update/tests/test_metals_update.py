"""銀−Pt固定V3: 既存表示の代表サンプルと公式原本CSVを検証。外部通信は行わない。"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import update_metals as metals


class MetalsUpdateTests(unittest.TestCase):
    def test_previous_oct1_signal_is_unchanged(self):
        rows = metals.read_history(ROOT.parent / "dist/silver-platinum.csv")
        rows = [r for r in rows if r["Date"] <= "2026-10-01"]
        latest = metals.derive(rows)[-1]
        self.assertEqual(latest["date"], "2026-10-01")
        self.assertAlmostEqual(latest["spread"], 1784.9, places=5)
        self.assertEqual(latest["v3"], 1)

    def test_official_original_oct2_closes(self):
        raw = (ROOT / "logs/raw/20261002.CSV").read_bytes()
        row = metals.read_daily(raw, "2026-10-02")
        self.assertEqual(row["Date"], "2026-10-02")
        self.assertAlmostEqual(row["Silver"], 8678.8)
        self.assertAlmostEqual(row["Platinum"], 24129.0)

    def test_bad_csv_date_is_rejected(self):
        raw = (ROOT / "logs/raw/20261002.CSV").read_bytes()
        with self.assertRaises(ValueError):
            metals.read_daily(raw, "2026-10-03")

    def test_v3_requires_past_reversal(self):
        rows = [
            {"Date":f"2026-01-{i:02d}","Silver":100.0,"Platinum":250.0}
            for i in range(1,9)
        ]
        self.assertTrue(all(r["v3"] == 0 for r in metals.derive(rows)))


if __name__ == "__main__":
    unittest.main()
