# ゼロからの科学 〜石と水と木から〜

石・水・木といった自然の資源だけから出発し、実験・精製・製錬・工作を積み重ねて、
原始時代から現代科学までの文明を作り直していく科学シミュレーションゲームです。
小学生や科学の知識がない人でも楽しめるよう、すべての物質・道具・反応に「やさしい説明」と「くわしく」が付いています。

## 遊び方（開発者向け）

```bash
npm install
npm run build      # dist/index.html（1ファイル版）を作る
npm run serve      # http://localhost:8080 で遊ぶ
```

`dist/index.html` はダブルクリックで開いても動きます。3Dフィールドは Three.js を CDN（jsDelivr）から読むため、オンライン環境が必要です。読み込めない場合は自動で2Dの地図表示に切り替わります。

## テスト

```bash
npm test           # エンジンの自動テスト ＋ ボットによる全物質到達テスト
npm run e2e        # ブラウザでの結合テスト（初回は npx playwright install chromium が必要）
npm run typecheck  # 描画モジュール（TypeScript）の型チェック
```

## 構成

| パス | 内容 | 担当 |
|---|---|---|
| `src/game/data.js` | 物質・反応・工作・地域・目標などの科学データ | ゲーム側 |
| `src/game/engine.js` | 実験判定・採取・工作・セーブ・自動テスト（UIから独立） | ゲーム側 |
| `src/game/ui.js` | 画面・入力・3Dフィールド連携 | ゲーム側 |
| `src/template.html` | ページの骨組みとCSS | ゲーム側 |
| `src/graphics/` | HD-2D描画モジュール（Three.js・描画専用） | **Muse（改変しない）** |
| `src/graphics-entry.ts` | 描画モジュールをページから使うための入口 | ゲーム側 |
| `assets/` | ゲームに埋め込む画像（軽量化済み）。`assets/source/` は受け取った原本 | — |
| `docs/handoff/` | 描画モジュールの引き継ぎ資料・API仕様 | Muse |
| `threejs-hd2d-graphics/` | Muse から受け取った描画モジュールの原本（デモ・元画像つき）。`src/graphics/` はここからの写し | Muse |
| `assets/lab-stages*/`・`references/` | 研究室の背景の元データ、HD-2D の参考画像 | Muse |

## 公開

`main` ブランチに push すると、GitHub Actions がテスト → ビルド → GitHub Pages への公開を自動で行います。
（初回のみ、リポジトリの Settings → Pages → Source を「GitHub Actions」にしてください）
