/**
 * waterRipple.js — 水面波紋層（p5.js，height-field 水波模擬）
 *
 * 臉浸在水裡，臉龐左右兩側持續泛起微弱晃動的水波（不是圓圈、不靠頭動）：
 * 用網格存水面高度，波在格點間傳播、干涉、衰減（Hugo Elias 演算法）；
 * 在左右兩頰位置持續注入微弱擾動，用 sin 讓左右交錯起伏 → 自然晃動。
 * 邊界吸收，波不反彈。再用波的斜率畫水面反光（additive 淡藍白）。
 *
 * 疊在玻璃臉上方（z-index 3）= 臉在水面下。參數集中在最上方 CFG。
 */

(function () {

  const CFG = {
    COLS: 170,            // 水面網格寬
    DAMP: 0.945,          // 波衰減（調大 → 波持續更久、晃動更明顯）
    EDGE_AMP: 30,         // 沿臉輪廓每點注入強度（加大 → 波紋更明顯）
    MOVE_THRESHOLD: 2,    // 臉移動超過這距離(px)才出波（放低 → 輕微晃就出波）
    LIGHT: 10,            // 水光強度（加強）— 一階斜率畫的薄膜反光
    BORDER: 12,           // 邊界吸收圈數（波不反彈）
    TINT: [175, 222, 255],
    BASE_FACE_SCALE: 1.75,

    // 光影折射焦散（caustics）— 用水波曲率(二階 Laplacian)聚光成尖銳亮紋
    // 波凹下處把光聚焦變亮；波平息→無曲率→亮紋消失，故只在晃動時出現
    CAUSTIC: 0.05,            // 曲率放大量（調大→更多亮紋）
    CAUSTIC_SHARP: 2.4,       // 亮紋銳利度（>1 越尖銳越稀疏，像真實焦散）
    CAUSTIC_BRIGHT: 160,      // 亮紋最大亮度（加強）
    CAUSTIC_TINT: [232, 248, 255], // 焦散偏白（折射聚光是白光，與藍白薄膜對比）
  };

  // 臉部輪廓 landmark（FACE_OVAL）— 水波沿臉的形狀產生，不是兩個圓圈
  const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
                     397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
                     172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];

  new p5(function (p) {
    let cols, rows, cur, prev, img;
    let lastCx = null, lastCy = null;   // 上一幀臉中心（判斷有沒有晃動）

    p.setup = function () {
      const cnv = p.createCanvas(p.windowWidth, p.windowHeight);
      cnv.id('waterripple-canvas');
      cnv.style('position', 'fixed');
      cnv.style('top', '0');
      cnv.style('left', '0');
      cnv.style('width', '100vw');
      cnv.style('height', '100vh');
      cnv.style('z-index', '3');          // 臉(1)、泡泡(2) 之上 → 臉在水面下
      cnv.style('pointer-events', 'none');
      initGrid();
      p.clear();
    };

    function initGrid() {
      cols = CFG.COLS;
      rows = Math.max(2, Math.round(cols * p.windowHeight / p.windowWidth));
      cur = new Float32Array(cols * rows);
      prev = new Float32Array(cols * rows);
      img = p.createImage(cols, rows);
    }

    p.windowResized = function () {
      p.resizeCanvas(p.windowWidth, p.windowHeight);
      initGrid();
    };

    p.draw = function () {
      p.clear();
      injectAlongFace(); // 晃動時沿臉部輪廓形狀注入
      step();            // 波傳播一格
      absorbBorders();   // 邊界吸收 → 波不反彈
      render();          // 畫水光
    };

    // 水波沿臉部輪廓形狀產生：晃動時沿臉緣一整圈注入擾動（不是兩頰兩個圓圈）
    function injectAlongFace() {
      const nose = facePoint(1);
      if (!nose) { lastCx = null; return; }
      let move = 0;
      if (lastCx !== null) move = Math.hypot(nose.x - lastCx, nose.y - lastCy);
      lastCx = nose.x; lastCy = nose.y;
      if (move <= CFG.MOVE_THRESHOLD) return;     // 靜止不出波
      const amt = CFG.EDGE_AMP * Math.min(1, move / 25);
      for (let k = 0; k < FACE_OVAL.length; k++) {
        const pt = facePoint(FACE_OVAL[k]);
        if (pt) disturbAt(pt, amt);
      }
    }

    function disturbAt(pos, amt) {
      const gx = Math.floor(pos.x / p.width * cols);
      const gy = Math.floor(pos.y / p.height * rows);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const x = gx + dx, y = gy + dy;
          if (x < 1 || y < 1 || x >= cols - 1 || y >= rows - 1) continue;
          const fall = 1 - (dx * dx + dy * dy) / 9;
          if (fall > 0) prev[y * cols + x] += amt * fall;
        }
      }
    }

    // 波傳播：新高度 = 鄰居平均 - 舊高度，再衰減
    function step() {
      for (let y = 1; y < rows - 1; y++) {
        const yo = y * cols;
        for (let x = 1; x < cols - 1; x++) {
          const i = yo + x;
          const v = (prev[i - 1] + prev[i + 1] + prev[i - cols] + prev[i + cols]) * 0.5 - cur[i];
          cur[i] = v * CFG.DAMP;
        }
      }
      const tmp = prev; prev = cur; cur = tmp;   // swap buffer
    }

    // 邊界吸收：靠近邊緣的波快速衰減，到邊緣消失，不反彈
    function absorbBorders() {
      const M = CFG.BORDER;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const dEdge = Math.min(x, y, cols - 1 - x, rows - 1 - y);
          if (dEdge < M) {
            const f = (dEdge / M) * (dEdge / M);
            prev[y * cols + x] *= f;
            cur[y * cols + x] *= f;
          }
        }
      }
    }

    // 用波的斜率畫薄膜反光，再用曲率畫光影折射焦散亮紋
    function render() {
      img.loadPixels();
      const px = img.pixels;
      for (let y = 0; y < rows; y++) {
        const yo = y * cols;
        for (let x = 0; x < cols; x++) {
          const i = yo + x;
          const c0 = prev[i];
          const xl = x > 0 ? prev[i - 1] : c0;
          const xr = x < cols - 1 ? prev[i + 1] : c0;
          const yt = y > 0 ? prev[i - cols] : c0;
          const yb = y < rows - 1 ? prev[i + cols] : c0;

          // 一階斜率（法線）→ 水面薄膜反光（淡藍白）
          const dx = xl - xr, dy = yt - yb;
          let a = Math.sqrt(dx * dx + dy * dy) * CFG.LIGHT;
          if (a > 200) a = 200;

          // 二階曲率 Laplacian → 折射焦散：波凹處(正曲率)把光聚焦成尖銳亮紋
          let c = ((xl + xr + yt + yb) - 4 * c0) * CFG.CAUSTIC;
          if (c < 0) c = 0; else if (c > 1) c = 1;
          c = Math.pow(c, CFG.CAUSTIC_SHARP) * CFG.CAUSTIC_BRIGHT;

          // 合成：焦散多處偏白變亮，平緩處維持藍白薄膜
          const total = a + c;
          const wC = total > 0 ? c / total : 0;
          const wT = 1 - wC;
          const idx = i * 4;
          px[idx]     = CFG.TINT[0] * wT + CFG.CAUSTIC_TINT[0] * wC;
          px[idx + 1] = CFG.TINT[1] * wT + CFG.CAUSTIC_TINT[1] * wC;
          px[idx + 2] = CFG.TINT[2] * wT + CFG.CAUSTIC_TINT[2] * wC;
          px[idx + 3] = total > 255 ? 255 : total;
        }
      }
      img.updatePixels();
      p.drawingContext.imageSmoothingEnabled = true;
      p.blendMode(p.ADD);
      p.image(img, 0, 0, p.width, p.height);
      p.blendMode(p.BLEND);
    }

    // 臉的某個 landmark → 螢幕像素（對齊玻璃臉的鏡像 + 正交投影）
    function facePoint(idx) {
      const fp = window.faceParams;
      if (!fp || !fp.detected || !fp.rawLandmarks) return null;
      const lm = fp.rawLandmarks[idx];
      if (!lm) return null;
      const cfg = window.glassFace && window.glassFace.CFG;
      const S = (cfg && cfg.FACE_SCALE) || CFG.BASE_FACE_SCALE;
      const mirror = cfg ? cfg.MIRROR : true;
      const mx = mirror ? (1.0 - lm.x) : lm.x;
      const sx = ((mx - 0.5) * S * 0.5 + 0.5) * p.width;
      const sy = (0.5 - (0.5 - lm.y) * S * 0.5) * p.height;
      return { x: sx, y: sy };
    }

    window.waterRipple = { CFG };
  });

})();
