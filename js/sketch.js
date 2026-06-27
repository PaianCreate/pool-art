/**
 * sketch.js
 * p5.js 主畫布
 *
 * 背景策略：
 *  - <img id="pool-bg"> 用 SVG displacement filter 做水波位移
 *  - p5 canvas 疊在上方，背景透明
 *  - canvas 只負責：caustics 光紋 / 臉部 mesh / 泡泡 / 金魚
 */

new p5(function (p) {
  let t = 0;

  // ── SVG filter 元素（在 index.html 已宣告，這裡抓 reference）
  let turbEl, dispEl;
  let phaseX = 0, phaseY = 0;

  // ── Caustics 顏色
  const CAUSTIC = [220, 245, 255];

  // ── 預載素材：詞泡泡裡的粉雛菊圖
  p.preload = function () {
    window._daisyImg = p.loadImage('assets/img/PinkDaisy.png');
  };

  p.setup = function () {
    const cnv = p.createCanvas(p.windowWidth, p.windowHeight);
    cnv.style('position', 'fixed');
    cnv.style('top', '0');
    cnv.style('left', '0');
    // Canvas 本身透明，讓背景圖透出來
    p.clear();
    p.frameRate(60);

    turbEl = document.getElementById('svg-turb');
    dispEl = document.getElementById('svg-disp');
  };

  p.windowResized = function () {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };

  p.draw = function () {
    t += 0.008;
    p.clear(); // 保持 canvas 透明，讓背景 img 透出來

    updateWaterDisplacement(); // 背景磁磚水波流動（水底光影動態）
    // drawCaustics(); // 已移除飄移的橢圓形光斑
    // 臉部改由 waterFace.js 的 WebGL 折射層繪製，這裡不再畫線框臉
    // drawFaceMesh();

    if (window.bubbleSystem) window.bubbleSystem.update(p);
    if (window.bubbleSystem) window.bubbleSystem.draw(p);
    if (window.fishSystem)   window.fishSystem.update(p);
    if (window.fishSystem)   window.fishSystem.draw(p);
  };

  // ─────────────────────────────────────────────
  // 水波位移 — 更新 SVG filter 參數
  // ─────────────────────────────────────────────
  function updateWaterDisplacement() {
    if (!turbEl || !dispEl) return;

    // 兩軸不同速度持續推進 → 水紋緩緩游移（不只原地漲縮）
    phaseX += 0.0024;
    phaseY += 0.0033;

    // 頻率呼吸：幅度加大，讓整片水面的紋路慢慢漲縮、來回搖晃（有機感）
    const fx = 0.012 + Math.sin(phaseX) * 0.0065;
    const fy = 0.008 + Math.cos(phaseY) * 0.0050;
    turbEl.setAttribute('baseFrequency', `${fx.toFixed(5)} ${fy.toFixed(5)}`);

    // seed 固定不動——大幅度位移時若整數跳 seed 會「啪」一下整片瞬移，很突兀，改用頻率＋強度呼吸來製造流動
    turbEl.setAttribute('seed', '2');

    // 位移強度呼吸：在 16~32 之間起伏（加大 → 水底光影流動更明顯）
    // t 每 frame +0.008，sin(t*0.6) 約 21 秒一個來回 → 像水面緩緩漲落
    const scale = 24 + Math.sin(t * 0.6) * 8;
    dispEl.setAttribute('scale', scale.toFixed(1));
  }

  // ─────────────────────────────────────────────
  // Caustics 光紋（白色半透明光斑游移）
  // ─────────────────────────────────────────────
  function drawCaustics() {
    const N = 12;
    p.noStroke();

    for (let i = 0; i < N; i++) {
      const nx    = p.noise(i * 2.3,      t * 0.32);
      const ny    = p.noise(i * 2.3 + 71, t * 0.32);
      const nr    = p.noise(i * 3.9,      t * 0.18);
      const na    = p.noise(i * 1.7,      t * 0.48);
      const angN  = p.noise(i * 4.2,      t * 0.15);

      const x     = nx * p.width;
      const y     = ny * p.height;
      const rx    = nr * 55 + 18;
      const ry    = rx * (0.35 + p.noise(i * 5.1, t * 0.25) * 0.5);
      const angle = angN * p.TWO_PI;
      const alpha = na * 18 + 4;

      p.push();
      p.translate(x, y);
      p.rotate(angle);
      p.scale(1, ry / rx);
      p.fill(CAUSTIC[0], CAUSTIC[1], CAUSTIC[2], alpha);
      p.ellipse(0, 0, rx * 2, rx * 2);
      p.pop();
    }
  }

  // ─────────────────────────────────────────────
  // 臉部 mesh 渲染
  // Phase 1：半透明水液態輪廓
  // Phase 2（之後）：GLSL shader 折射版
  // ─────────────────────────────────────────────
  function drawFaceMesh() {
    const fp = window.faceParams;
    if (!fp || !fp.detected || !fp.rawLandmarks) return;

    const lm      = fp.rawLandmarks;
    const cx      = p.width  * 0.5;
    const cy      = p.height * 0.50;
    const scale   = p.height * 0.78;
    const offsetX = fp.YAW   * p.width  * 0.06;
    const offsetY = fp.PITCH * p.height * 0.04;

    function lmX(idx) { return cx + (lm[idx].x - 0.5) * scale + offsetX; }
    function lmY(idx) { return cy + (lm[idx].y - 0.5) * scale + offsetY; }

    // 臉部輪廓
    const jawIndices = [
      10,338,297,332,284,251,389,356,
      454,323,361,288,397,365,379,378,
      400,377,152,148,176,149,150,136,
      172,58,132,93,234,127,162,21,
      54,103,67,109,10
    ];

    for (let layer = 0; layer < 2; layer++) {
      p.noFill();
      p.stroke(185, 235, 245, layer === 0 ? 40 : 20);
      p.strokeWeight(layer === 0 ? 1.5 : 3.5);
      p.beginShape();
      for (const idx of jawIndices) {
        if (!lm[idx]) continue;
        p.curveVertex(lmX(idx), lmY(idx));
      }
      p.endShape();
    }

    // 眼睛
    const eyes = [
      [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246,33],
      [362,382,381,380,374,373,390,249,263,466,388,387,386,385,384,398,362]
    ];
    for (const eye of eyes) {
      p.noFill();
      p.stroke(185, 235, 245, 50);
      p.strokeWeight(1.2);
      p.beginShape();
      for (const idx of eye) {
        if (!lm[idx]) continue;
        p.curveVertex(lmX(idx), lmY(idx));
      }
      p.endShape(p.CLOSE);
    }

    // 嘴巴
    const mouth = [61,185,40,39,37,0,267,269,270,409,291,375,321,405,314,17,84,181,91,146,61];
    p.noFill();
    p.stroke(200, 240, 250, 60);
    p.strokeWeight(1.2);
    p.beginShape();
    for (const idx of mouth) {
      if (!lm[idx]) continue;
      p.curveVertex(lmX(idx), lmY(idx));
    }
    p.endShape(p.CLOSE);

    // 稀疏 mesh 連線
    const meshPts = [
      10,338,297,332,284,251,389,356,
      33,133,362,263,1,4,5,195,197,
      61,291,13,14,159,145,386,374
    ];
    const threshold = scale * 0.08;
    p.strokeWeight(0.5);
    for (let i = 0; i < meshPts.length; i++) {
      for (let j = i + 1; j < meshPts.length; j++) {
        const a = lm[meshPts[i]], b = lm[meshPts[j]];
        if (!a || !b) continue;
        const ax = lmX(meshPts[i]), ay = lmY(meshPts[i]);
        const bx = lmX(meshPts[j]), by = lmY(meshPts[j]);
        const d  = Math.hypot(ax - bx, ay - by);
        if (d > threshold) continue;
        const alpha = p.map(d, 0, threshold, 28, 4);
        p.stroke(160, 220, 235, alpha);
        p.line(ax, ay, bx, by);
      }
    }
  }

  window._p5 = p;

  p.mousePressed = function () {
    if (window.bubbleSystem) {
      window.bubbleSystem.handleClick(p.mouseX, p.mouseY);
    }
  };
});
