# Pool Art — 開發說明

## 專案結構
```
pool-art/
├── index.html
├── assets/
│   ├── img/
│   │   └── pool-bg.jpg      ← 泳池背景圖（已放入）
│   └── audio/
│       └── bubble-pop.mp3   ← 放你的音樂在這（自行加入）
└── js/
    ├── faceParams.js    臉部追蹤 + MAR/EAR/YAW/PITCH 參數
    ├── bubbleSystem.js  泡泡系統（嘴張觸發 + 文字輸入觸發）
    ├── fishSystem.js    金魚系統（眨眼觸發）
    ├── audio.js         Howler.js 音訊（點破泡泡播放）
    ├── sketch.js        p5.js 主畫布（透明 canvas 疊在背景圖上）
    └── ui.js            輸入框 / debug 面板 / 狀態燈
```

## 啟動方式（需要本地伺服器，不能直接雙擊 html）

### 最快：Python
```bash
cd pool-art
python3 -m http.server 8080
```
然後開瀏覽器 → http://localhost:8080

### 或用 Node.js
```bash
npx serve pool-art
```

## 加入音樂
把你的音樂放在：assets/audio/bubble-pop.mp3
支援 mp3 / ogg / wav

audio.js 頂端可以調整播放區間：
  CLIP_START = 0      從第幾秒開始
  CLIP_END   = 15000  播幾毫秒（15秒）

## Debug 模式
按鍵盤 D 鍵 → 右下角顯示 MAR / EAR / YAW / PITCH 即時數值

## 沒有攝影機時
自動切換 simulation 模式：
  移動滑鼠  →  YAW / PITCH
  按住滑鼠  →  MAR（觸發泡泡）
  滾輪     →  YAW 偏移

## 搭配 Claude Code 開發
```bash
cd pool-art
claude    # 在此資料夾啟動 Claude Code
```
terminal 1: python3 -m http.server 8080
terminal 2: claude
browser:    http://localhost:8080
