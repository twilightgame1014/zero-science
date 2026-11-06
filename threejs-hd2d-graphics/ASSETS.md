# アセット一覧と利用条件

## 本モジュールに含まれるアセット

すべて本プロジェクトのために新規制作したオリジナル素材です。既存作品の素材・デザインは使用していません。そのまま本ゲームで商用利用できます（出典表記不要）。

| パス | 内容 | 形式 | 備考 |
|---|---|---|---|
| assets/characters/player-spritesheet-boy.png | 主人公（男の子：ゴーグル＋白衣）4方向×4フレーム | PNG 1024×1024 透過 | 行: 下・左・右・上 |
| assets/characters/player-spritesheet-girl.png | 主人公（女の子：銀髪ロング＋ゴーグル＋白衣）4方向×4フレーム | PNG 1024×1024 透過 | 行: 下・左・右・上 |
| assets/characters/player-spritesheet-girl-no-shadow.png | 同上・接地影なし版（ブーツ下の元絵の楕円影を除去） | PNG 1024×1024 透過 | 行: 下・左・右・上。エンジン側が `shadow-blob.png` で影を描くため二重影にならない |
| assets/characters/reference/*.jpg | 上記2点の元画像（白背景） | JPG | ユーザー提供。透過化・サイズ正規化の原典として保管 |

主人公2名のデザインはユーザー提供のイラストが原典です。白背景の除去（透過化）、足位置・サイズの正規化を行い、モジュールのシート規格（4列×4行、足元位置統一）に合わせてあります。
| assets/textures/grass-detail.png | 草地ディテール（タイリング用） | PNG 256×256 | 地形マップに乗算 |
| assets/textures/rock-detail.png | 岩ディテール（タイリング用） | PNG 256×256 | 将来の岩マテリアル用に同梱 |
| assets/textures/particle-dot.png | パーティクル用ソフトドット | PNG 64×64 透過 | |
| assets/textures/shadow-blob.png | 足元影用グラデーション | PNG 128×128 透過 | |

## コード生成アセット（ファイルを持たないもの）

以下は実行時にコードで生成しており、外部ファイル・外部ライセンスは関係しません。

- 地形（高さ・河川・バイオーム色分け）：`TerrainRenderer` / `utils.ts`
- 樹木・草・シダ・花・岩・小石・倒木などの自然物：`EnvironmentRenderer`（InstancedMesh、シード固定の手続き配置）
- 水面：カスタムシェーダー（`TerrainRenderer`）
- 建築物の仮モデル（作業台・焚き火・窯・製錬炉・小屋・研究所・工場・発電所・研究施設）：`StructureRenderer` の手続きモデル。将来 GLB に差し替え可能
- プレースホルダーキャラ：スプライト未指定時に `AssetManager` が Canvas で生成

## 外部ライブラリ

| 名前 | ライセンス | 用途 |
|---|---|---|
| Three.js | MIT | 描画エンジン（npm 依存） |

## フォルダ構成（将来のアセット追加先）

- assets/terrain/ … 地形テクスチャ等
- assets/vegetation/ … 植生モデル・テクスチャ
- assets/rocks/ … 岩モデル・テクスチャ
- assets/water/ … 水関連テクスチャ
- assets/structures/ … 建築物 GLB 等
- assets/characters/ … キャラクタースプライト
- assets/textures/ … 汎用テクスチャ
