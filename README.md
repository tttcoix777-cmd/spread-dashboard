# 統合サヤ管理

銀−プラチナ **固定V3** / 日経225−NYダウ **Candidate C2** の統合ダッシュボードです。

公開画面: `dist/` / TFX自動更新: `auto_update/`。
- 取引所CFDの公式確定日足をGitHub Actionsから毎日10:30 JST頃に取得します。
- 日経ダウ: `auto_update/update_dow_nikkei.py` → `dist/dow-nikkei-status.json`
- 銀−プラチナ: `auto_update/update_metals.py` → `dist/silver-platinum-status.json` と `dist/silver-platinum.csv`
- **既存のV3およびB/C2の売買ロジックとパラメータを変更しません。** 銀−Ptの確定終値V3候補、日経ダウC2の候補を同じ画面で確認できます。
- 未更新・整合性エラーのときは保存済み日足を「過去参考値」として示し、新規候補を停止します。
- 自動更新はデータ収集と表示のみ。**注文・口座連携は一切ありません。** 実建値は手入力です。

公開画面: https://tttcoix777-cmd.github.io/spread-dashboard/

設定・運用・障害対応は [README_AUTO_UPDATE.md](README_AUTO_UPDATE.md) を参照してください。
