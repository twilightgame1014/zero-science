# このフォルダは廃止（正は assets/ui-icons）

2026-11-06 の整理で、UIアイコンは `assets/ui-icons/` に一本化した。
ゲームが使っているのはそちら（192px マスター＋48/32px 版）。
ここにあった 96×96 WebP 書き出し（lab/craft/book/tech/log/map/home/settings）は
重複のため削除した。96px 版が要る場合は ui-icons のマスターから書き出すこと。
`menu` は ui-icons 側にのみある（Muse 描画の仮アイコン、README 参照）。
