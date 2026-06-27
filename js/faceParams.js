/**
 * faceParams.js
 * MediaPipe FaceMesh 接入 + 臉部參數計算
 * 對外暴露 window.faceParams（所有模組都可以讀）
 *
 * 使用方式：
 *   faceParams.MAR   → 嘴巴張幅 0~1
 *   faceParams.EAR   → 眼睛開闔 0~1（接近0=閉眼）
 *   faceParams.YAW   → 頭部左右偏轉 -1~1（左負右正）
 *   faceParams.PITCH → 頭部仰俯 -1~1（下負上正）
 *   faceParams.detected → bool，是否偵測到臉
 */

window.faceParams = {
  MAR: 0,
  EAR: 0.3,
  YAW: 0,
  PITCH: 0,
  rawLandmarks: null,        // 臉部 478 點（玻璃臉用）
  detected: false,
};

// ── EMA 平滑係數（數字越小越平滑，越大越即時）
const SMOOTH = {
  MAR: 0.12,
  EAR: 0.45,   // 調靈敏 → 跟得上快速眨眼（原本 0.10 太重，眨眼來不及降到觸發線）
  YAW: 0.08,
  PITCH: 0.08,
};

// ── 各參數觸發閾值（可調整）
window.THRESHOLDS = {
  BLINK: 0.24,     // EAR 低於此值 → 眨眼（放寬 → 手機自拍角度也容易觸發）
  MOUTH_OPEN: 0.45, // MAR 高於此值 → 嘴張開（放寬 → 不必張很大也能吐泡泡）
};

// ─────────────────────────────────────────────
// MediaPipe Landmark 點位索引
// 參考：https://github.com/google/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model_uv_visualization.png
// ─────────────────────────────────────────────
const LM = {
  // 嘴巴（用於 MAR）
  MOUTH_TOP:    13,
  MOUTH_BOTTOM: 14,
  MOUTH_LEFT:   78,
  MOUTH_RIGHT: 308,

  // 左眼（用於 EAR）
  L_EYE_TOP:    159,
  L_EYE_BOTTOM: 145,
  L_EYE_LEFT:    33,
  L_EYE_RIGHT:  133,

  // 右眼（用於 EAR）
  R_EYE_TOP:    386,
  R_EYE_BOTTOM: 374,
  R_EYE_LEFT:   362,
  R_EYE_RIGHT:  263,

  // 頭部角度（用於 YAW / PITCH）
  NOSE_TIP:      1,
  CHIN:        152,
  LEFT_CHEEK:  234,
  RIGHT_CHEEK: 454,
  FOREHEAD:     10,
};

// ── 計算兩點距離
function dist3(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

// ── MAR：嘴巴縱向距離 / 橫向距離
function calcMAR(lm) {
  const vertical = dist3(lm[LM.MOUTH_TOP], lm[LM.MOUTH_BOTTOM]);
  const horizontal = dist3(lm[LM.MOUTH_LEFT], lm[LM.MOUTH_RIGHT]);
  return horizontal > 0 ? Math.min(1, vertical / horizontal) : 0;
}

// ── EAR：眼睛縱向 / 橫向（取兩眼平均）
function calcEAR(lm) {
  const lv = dist3(lm[LM.L_EYE_TOP], lm[LM.L_EYE_BOTTOM]);
  const lh = dist3(lm[LM.L_EYE_LEFT], lm[LM.L_EYE_RIGHT]);
  const rv = dist3(lm[LM.R_EYE_TOP], lm[LM.R_EYE_BOTTOM]);
  const rh = dist3(lm[LM.R_EYE_LEFT], lm[LM.R_EYE_RIGHT]);
  const l = lh > 0 ? lv / lh : 0;
  const r = rh > 0 ? rv / rh : 0;
  return (l + r) / 2;
}

// ── YAW：左臉頰到右臉頰的水平不對稱
function calcYAW(lm) {
  const noseX = lm[LM.NOSE_TIP].x;
  const leftX  = lm[LM.LEFT_CHEEK].x;
  const rightX = lm[LM.RIGHT_CHEEK].x;
  const total = rightX - leftX;
  if (total < 0.001) return 0;
  const ratio = (noseX - leftX) / total; // 0.5 = 正面
  return (ratio - 0.5) * 2; // -1~1
}

// ── PITCH：鼻尖相對於下巴和前額的垂直位置
function calcPITCH(lm) {
  const noseY   = lm[LM.NOSE_TIP].y;
  const chinY   = lm[LM.CHIN].y;
  const foreY   = lm[LM.FOREHEAD].y;
  const total   = chinY - foreY;
  if (Math.abs(total) < 0.001) return 0;
  const ratio = (noseY - foreY) / total; // ~0.5 = 正面
  return (ratio - 0.5) * -2; // 上仰為正
}

// ── EMA lerp 平滑
function smooth(key, rawVal) {
  faceParams[key] += (rawVal - faceParams[key]) * SMOOTH[key];
}

// ─────────────────────────────────────────────
// MediaPipe FaceMesh 初始化
// ─────────────────────────────────────────────
function initFaceMesh() {
  const videoEl = document.getElementById('webcam');

  // FaceMesh：只偵測臉，478 點（含眼唇虹膜細修），輕快精準
  const faceMesh = new FaceMesh({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
  });

  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,    // 更精確的眼/唇/虹膜點位
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  faceMesh.onResults((results) => {
    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      const lm = results.multiFaceLandmarks[0];
      faceParams.rawLandmarks = lm;
      faceParams.detected = true;

      smooth('MAR',   calcMAR(lm));
      smooth('EAR',   calcEAR(lm));
      smooth('YAW',   calcYAW(lm));
      smooth('PITCH', calcPITCH(lm));
    } else {
      faceParams.detected = false;
      // 沒臉時緩慢回到中性值
      smooth('MAR',   0);
      smooth('EAR',   0.3);
      smooth('YAW',   0);
      smooth('PITCH', 0);
    }
  });

  // 啟動攝影機
  const camera = new Camera(videoEl, {
    onFrame: async () => {
      await faceMesh.send({ image: videoEl });
    },
    width: 640,
    height: 480,
  });

  camera.start().catch((err) => {
    console.warn('[faceParams] Camera error:', err);
    console.info('[faceParams] Running in simulation mode (mouse).');
    startSimulationMode();
  });
}

// ─────────────────────────────────────────────
// Simulation mode（沒有攝影機時用滑鼠模擬）
// ─────────────────────────────────────────────
function startSimulationMode() {
  faceParams.detected = true; // 模擬視為偵測到
  let simScroll = 0;

  document.addEventListener('mousemove', (e) => {
    const mx = e.clientX / window.innerWidth;
    const my = e.clientY / window.innerHeight;
    smooth('YAW',   (mx - 0.5) * 2);
    smooth('PITCH', (0.5 - my) * 1.5);
    smooth('EAR',   0.15 + my * 0.4);
  });

  document.addEventListener('mousedown', () => {
    smooth('MAR', 0.85);
  });
  document.addEventListener('mouseup', () => {
    smooth('MAR', 0);
  });

  document.addEventListener('wheel', (e) => {
    simScroll = Math.max(-1, Math.min(1, simScroll + e.deltaY * 0.001));
    smooth('YAW', simScroll);
  });
}

// ── 對外暴露啟動函式：由入口 Enter 按鈕（使用者手勢）觸發
//    手機 / 瀏覽器都要求「使用者點擊」後才給鏡頭權限，所以不在載入時自動啟動
let _faceStarted = false;
window.startFaceTracking = function () {
  if (_faceStarted) return;
  _faceStarted = true;
  initFaceMesh();
};

// ── 無相機降級：直接進模擬模式（滑鼠/觸控），讓沒相機權限的人也能看故事
let _simStarted = false;
window.startSimulationMode = function () {
  if (_simStarted || _faceStarted) return;
  _simStarted = true;
  startSimulationMode();
};
