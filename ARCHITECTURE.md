# BELT FIRE アーキテクチャ

Coreと描画を分離し、Phaser版を標準Renderer、従来のCanvas版を比較用Rendererとして並行運用しています。

## モジュール構成

```text
main.js
├─ game.js
│  └─ src/content/mission-01.js
├─ mission-02-game.js
│  └─ src/content/mission-02.js
├─ mission-03-game.js
│  └─ src/content/mission-03.js
├─ src/core/grid.js
├─ src/core/construction.js
├─ src/core/failure.js
├─ src/core/simulation.js
├─ src/core/water-simulation.js
├─ src/core/steam-simulation.js
└─ src/render/
   ├─ renderer-factory.js
   ├─ phaser-renderer.js
   └─ canvas-renderer.js
```

### `main.js` / アプリケーション層

URLからミッションを選びます。`game.js`がMission 01、`mission-02-game.js`がMission 02、`mission-03-game.js`がMission 03のDOM、ボタン、ポインター入力、ガイド表示を接続します。ゲームルールやCanvasの描画命令は持ちません。Mission 03では施設ボタンの短押しと長押しを分離し、長押し時だけ施設選択パレットを開きます。

### `src/content/mission-01.js`

グリッドサイズ、設備、ミッション目標、時間定数を定義します。別ミッションや設備パレットを増やす際のコンテンツ層です。

### `src/content/mission-02.js`

電気発生装置、貯水タンク、配置可能なポンプ、目標数と時間定数を定義します。

### `src/content/mission-03.js`

炎・水発生装置、ランプ、配置可能なL字ボイラーと縦型タービン、各設備の入出力ポートと所持数を定義します。L字設備は矩形ではなく、実際に占有する3セルを`cells`として保持します。

### `src/core/grid.js`

座標、隣接、方向、ポート、ベルト終端など、表示方法に依存しないグリッド判定を扱います。

### `src/core/construction.js`

ベルト経路の生成、設置可能判定、💀ベルトと💀設備をまたぐ故障ネットワークの探索を扱います。将来、通常ベルト、分配器、交差ベルトをポートグラフとして拡張します。

### `src/core/failure.js`

資源共通の滞留時間、警告・故障開始・伝播・💀化、一括撤去回数を定義します。設備内部の正規ストックは故障対象外ですが、設備へ誤投入された素材は設備故障を開始します。`failureType`をRendererへ渡し、原因別の演出と共通の最終状態を両立します。

### `src/core/simulation.js`

炎の生成・射出・搬送・滞留・納品を扱い、滞留後の処理を共通故障Coreへ委譲します。CanvasやDOMには触れず、納品や故障開始をコールバックイベントとして外部へ通知します。

### `src/core/water-simulation.js`

電気の生成・搬送、ポンプの入力容量と保持、水への変換・排出、貯水タンクへの納品を扱います。ポンプは空き容量があれば全素材を受け入れ、電気は正常処理、その他は設備故障へ分岐します。満杯時の詰まりと、その手前に滞留した資源による故障もCore状態から自然に発生します。

### `src/core/steam-simulation.js`

火と水の生成、入力ポートごとのストックと組み合わせ判定、蒸気への変換、タービンによる発電、ランプへの納品を扱います。設備が受け付ける素材と成立するレシピを分離しているため、火＋火／水＋水は安全に受け入れられますが変換されず、それぞれが入った入力ブロック内で詰まります。

### `src/render/renderer-factory.js`

通常はPhaser版を選択し、URLに`?renderer=canvas`がある場合は旧Canvas版を選択します。

### `src/render/phaser-renderer.js`

PhaserのScene、Graphics、Text、ParticleEmitter、Camera、Tween、Sound ManagerのAudioContextを使って工場を表現します。Coreのstateを毎フレーム同期し、Coreイベントから一回限りの演出を発生させます。

### `src/render/canvas-renderer.js`

比較・回帰確認用の旧Canvas描画です。シミュレーション状態を受け取り、設備、ベルト、資源、火災、建設プレビューを描画します。

## Phaser統合の原則

Phaserは表示・音・入力を担当し、`src/core`をゲームルールの正として残します。

```text
Core simulation
  ↓ state / events
Phaser scene
  ├─ sprites
  ├─ particles
  ├─ lighting
  ├─ camera
  └─ sound
```

- PhaserのTween完了を搬送判定に使わない
- 資源の位置と進捗はCoreが保持する
- PhaserはCoreの進捗を視覚化する
- 一時停止はCoreの時計だけを止め、建設UIと描画は動かし続ける
- 資源生成、納品、故障開始などはイベントから演出を発生させる
- セーブデータにPhaserオブジェクトを含めない

## 実装済みの統合範囲

- Phaser版とCanvas版の切替
- 設備、ベルト、火・電気・水、危険リング、建設プレビューのPhaser描画
- 盤面へ配置する1×2ポンプと、充電・排水状態の表示
- 盤面へ配置するL字ボイラーと1×2タービン、内部ストックと変換状態の表示
- 火・水の2発生装置、蒸気の搬送、点灯前後のランプ表示
- 射出、納品、原因別の故障開始、共通の💀化、クリアのイベント演出
- パーティクル、カメラFX、合成効果音
- Coreだけを止める一時停止
- WebGLからCanvasへの描画フォールバック

今後、通常ベルト、分配器、交差ベルトのポートモデルは引き続きCoreへ追加し、Rendererはその状態を表現するだけにします。
