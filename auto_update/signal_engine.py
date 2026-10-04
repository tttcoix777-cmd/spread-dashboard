"""既存Phase 3 BとCandidate C2の固定条件。注文APIは使用しない。"""
import math

PARAMETERS = {"N": 5, "MINIMUM_MOVE": 500, "SHORT_MA": 20, "LONG_MA": 50,
              "PULLBACK_MINIMUM_MOVE": 500, "TAKE_PROFIT_SPREAD": 1000,
              "STOP_LOSS_SPREAD": 2000, "MAX_HOLDING_DAYS": 30}
OOS_START = "2026-10-03"


def calculate(rows):
    out = []
    for i, source in enumerate(rows):
        r = dict(source)
        r["spread"] = r["ny_dow_close"] - r["nikkei225_close"]
        r["change"] = r["spread"] - out[-1]["spread"] if out else None
        out.append(r)
        for name, window in [("ma20", 20), ("ma50", 50)]:
            r[name] = sum(x["spread"] for x in out[-window:]) / window if len(out) >= window else None
        r["spread_10d_change"] = r["spread"] - out[i-10]["spread"] if i >= 10 else None
        pullback, j = 0.0, i-1
        while j >= 1 and out[j]["change"] > 0:
            pullback += out[j]["change"]
            j -= 1
        r["pullback_move"] = pullback
        r["signal_b"] = bool(r["ma50"] is not None and r["ma20"] < r["ma50"]
                             and r["change"] < 0 and pullback >= 500)
        r["signal_c2"] = bool(r["signal_b"] and r["spread_10d_change"] is not None
                              and r["spread_10d_change"] < 0)
        r["signal_state"] = signal_state(r["signal_b"], r["signal_c2"])
    return out


def signal_state(b, c2):
    if c2 and not b:
        raise ValueError("C2 SIGNALだけの状態は固定ロジック上あり得ません")
    return "B + C2 SIGNAL" if c2 else "B SIGNAL" if b else "NO SIGNAL"


def simulate(rows, key):
    """OOS開始時flat。終値予約→翌共通始値。終端強制決済なし。"""
    pos = pending_entry = pending_exit = None
    trades = []
    for i, r in enumerate(rows):
        if pos and pending_exit:
            exit_spread = r["ny_dow_open"] - r["nikkei225_open"]
            trades.append({**pos, "exit_date": r["date"], "exit_spread": exit_spread,
                           "pnl": pos["entry_spread"]-exit_spread, "exit_reason": pending_exit})
            pos = pending_exit = None
        if pending_entry:
            pos = {"entry_date": r["date"], "entry_spread": r["ny_dow_open"]-r["nikkei225_open"],
                   "signal_date": pending_entry, "entry_index": i}
            pending_entry = None
        if pos:
            pos["holding_days"] = i-pos["entry_index"]+1
            pos["unrealized_points"] = pos["entry_spread"]-r["spread"]
            pnl = pos["unrealized_points"]
            pending_exit = "stop_loss" if pnl <= -2000 else "take_profit" if pnl >= 1000 else "max_holding" if pos["holding_days"] >= 30 else None
        if r["date"] >= OOS_START and r[key] and pos is None:
            pending_entry = r["date"]
    if pos:
        pos = {k: v for k, v in pos.items() if k != "entry_index"}
        pos.update(take_profit_spread=pos["entry_spread"]-1000, stop_loss_spread=pos["entry_spread"]+2000)
    latest = rows[-1] if rows else None
    return {"kind": "OOS_SIMULATED_NOT_ACTUAL", "position": pos,
            "pending_entry_signal_date": pending_entry, "pending_exit": pending_exit,
            "entry_candidate": bool(latest and latest[key] and not pos), "closed_trades": trades}
