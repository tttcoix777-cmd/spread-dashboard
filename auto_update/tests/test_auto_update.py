import contextlib
import csv
import io
import json
import math
import os
import shutil
import sys
import tempfile
import unittest
import uuid
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from signal_engine import calculate, simulate, signal_state
from update_dow_nikkei import daily_csv, products_from_page, merge, run, validate_history, JST


class AutoTests(unittest.TestCase):
    def setUp(self):
        base = Path(os.environ.get("TFX_TEST_TMPDIR", tempfile.gettempdir())).resolve()
        directory = base / ("tfx-test-" + uuid.uuid4().hex)
        directory.mkdir()
        def cleanup():
            if directory.resolve().parent != base:
                raise RuntimeError("Unsafe cleanup path")
            shutil.rmtree(directory)
        self.addCleanup(cleanup)
        self.root = directory / "auto_update"
        self.root.mkdir()
        for name in ["config.json", "frozen_settings.json"]:
            shutil.copy2(ROOT / name, self.root / name)
        (self.root / "data").mkdir()
        shutil.copy2(ROOT / "tests/fixtures/prices.csv", self.root / "data/prices.csv")
        self.site = directory / "dist"
        self.fixture = ROOT / "tests/fixtures"
        self.now = datetime(2026, 10, 4, 10, 30, tzinfo=JST)

    def fetch(self, url):
        if "20261001.CSV" in url:
            return (self.fixture / "20261001.csv").read_bytes()
        return (self.fixture / ("page.html" if url.endswith("/cfd/") else "lifecycle.html" if "/article/" in url else "latest.csv")).read_bytes()

    def execute(self, fetch=None, now=None):
        with contextlib.redirect_stdout(io.StringIO()):
            code = run(self.root, self.site, now or self.now, fetch or self.fetch)
        return code, json.loads((self.site / "dow-nikkei-status.json").read_text(encoding="utf-8"))

    def test_real_product_and_close_not_settlement(self):
        selected, available = products_from_page(self.fetch("https://www.tfx.co.jp/historical/cfd/").decode(), 2026)
        self.assertEqual(selected["ny_dow"]["code"], "D26/JPY")
        self.assertTrue(any("2027" in s for s in available))
        row = daily_csv(self.fetch("latest.csv"), "2026-10-02", selected)
        self.assertEqual(row["ny_dow_close"], 51161)  # 清算値51170と混同しない。
        self.assertEqual(row["nikkei225_close"], 69763)

    def test_weekend_no_new_prices_idempotent(self):
        code, status = self.execute()
        self.assertEqual(code, 0)
        self.assertEqual(status["update_status"], "NO_NEW_DATA")
        self.assertEqual(status["latest"]["spread"], -18602)
        n = len(status["history"])
        self.assertEqual(len(self.execute()[1]["history"]), n)

    def test_new_day_append_and_catchup_dedup(self):
        original = (self.root / "data/prices.csv").read_text(encoding="utf-8")
        rows = original.splitlines()
        (self.root / "data/prices.csv").write_text("\n".join(rows[:-1])+"\n", encoding="utf-8")
        code, status = self.execute()
        self.assertEqual(code, 0)
        self.assertEqual(status["added_dates"], ["2026-10-02"])
        self.assertEqual(status["update_status"], "UPDATED")
        self.assertEqual(self.execute()[1]["added_dates"], [])

    def test_fetch_failure_preserves_prices_and_marks_error(self):
        _, success = self.execute()
        before = (self.root / "data/prices.csv").read_bytes()
        def failed(url):
            raise OSError("test network unavailable")
        code, status = self.execute(failed)
        self.assertEqual(code, 1)
        self.assertEqual(status["update_status"], "DATA UPDATE ERROR")
        self.assertEqual(status["last_success_at"], success["last_success_at"])
        self.assertEqual((self.root / "data/prices.csv").read_bytes(), before)
        self.assertIn("network unavailable", status["error"])
        self.assertTrue((self.root / "logs/2026-10.csv").exists())

    def test_missing_close_preserves_history(self):
        before = (self.root / "data/prices.csv").read_bytes()
        def missing(url):
            raw = self.fetch(url)
            if url.endswith(".CSV"):
                raw = raw.replace(b",51161,045940,", b",-,045940,")
            return raw
        self.assertEqual(self.execute(missing)[0], 1)
        self.assertEqual((self.root / "data/prices.csv").read_bytes(), before)

    def test_modified_parameter_rejected(self):
        path = self.root / "frozen_settings.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        data["parameters"]["SHORT_MA"] = 19
        path.write_text(json.dumps(data), encoding="utf-8")
        self.assertEqual(self.execute()[0], 1)

    def test_expired_contract_stops_without_rollover(self):
        code, status = self.execute(now=datetime(2026, 12, 11, 10, 30, tzinfo=JST))
        self.assertEqual(code, 1)
        self.assertIn("取引期間外", status["error"])

    def test_source_stale_is_error(self):
        code, status = self.execute(now=datetime(2026, 10, 7, 10, 30, tzinfo=JST))
        self.assertEqual(code, 1)
        self.assertIn("古く", status["error"])

    def test_anomaly_does_not_auto_fill(self):
        seed = {"date":"2026-10-01", "ny_dow_open":100, "ny_dow_close":100, "nikkei225_open":100, "nikkei225_close":100}
        bad = {**seed, "date":"2026-10-02", "ny_dow_close":130}
        with self.assertRaisesRegex(ValueError, "PRICE WARNING"):
            merge([seed], [bad], .2)

    def test_conflicting_same_date_rejected(self):
        row = {"date":"2026-10-01", "ny_dow_open":100, "ny_dow_close":100, "nikkei225_open":100, "nikkei225_close":100}
        with self.assertRaisesRegex(ValueError, "不一致"):
            merge([row], [{**row, "ny_dow_close":101}], .2)

    def test_b_and_c2_filter(self):
        spreads=[5000-i*50 for i in range(50)]+[2550+(i-49)*60 for i in range(50,60)]+[3000]
        def rows(values):
            return [{"date":f"2026-{i//28+1:02d}-{i%28+1:02d}", "ny_dow_close":10000+v, "nikkei225_close":10000} for i,v in enumerate(values)]
        r = calculate(rows(spreads))[-1]
        self.assertTrue(r["signal_b"])
        self.assertFalse(r["signal_c2"])
        self.assertEqual(r["signal_state"], "B SIGNAL")
        spreads = [5000-i*50 for i in range(50)]+[4000,1000]+[1000+(i-51)*100 for i in range(52,60)]+[1700]
        r = calculate(rows(spreads))[-1]
        self.assertTrue(r["signal_c2"])
        self.assertTrue(r["signal_b"])
        self.assertEqual(r["signal_state"], "B + C2 SIGNAL")
        with self.assertRaises(ValueError):
            signal_state(False, True)

    def test_ma_warmup_and_oos_next_open(self):
        data = [{"date":"2026-10-03", "spread":5000, "signal_b":True, "ny_dow_open":15000,"nikkei225_open":10000},
                {"date":"2026-10-05", "spread":3900, "signal_b":False, "ny_dow_open":14900,"nikkei225_open":10000}]
        pos = simulate(data, "signal_b")
        self.assertEqual(pos["position"]["entry_spread"], 4900)
        self.assertEqual(pos["pending_exit"], "take_profit")
        self.assertEqual(pos["closed_trades"], [])  # 終端でも強制決済しない。
        data.append({"date":"2026-10-06","spread":3600,"signal_b":False,"ny_dow_open":13800,"nikkei225_open":10000})
        pos = simulate(data,"signal_b")
        self.assertEqual(pos["closed_trades"][0]["exit_spread"],3800)
        self.assertIsNone(pos["position"])


if __name__ == "__main__":
    unittest.main()
