/**
 * waterFace.js  —  AR 水質臉濾鏡（Spark AR / IG filter 風格）
 *
 * 做法：
 *  1. WebGL 全螢幕顯示攝影機畫面（鏡像，像自拍）
 *  2. 用 MediaPipe landmark 把「臉的範圍」做成遮罩，貼在你臉的真實位置/大小
 *  3. 臉範圍內：折射你的臉影像 + 程序式水波 + 鏡面高光 + 臉緣亮邊 + 淡藍透明
 *     → 你的五官透過水看得見，看得出是你，只是水做的
 *
 * 沒攝影機時：整層透明，露出底下的泳池圖當 fallback。
 * 質感參數集中在 FRAG shader 最上面的 const。
 */

(function () {

  const CFG = {
    HSCALE: 0.5,    // 遮罩解析度倍率
    MIRROR: 1,      // 自拍鏡像（1=鏡像，0=不鏡像）
  };

  // ── Shaders ────────────────────────────────────
  const VERT = `
    precision highp float;
    attribute vec3 aPosition;
    attribute vec2 aTexCoord;
    uniform mat4 uModelViewMatrix;
    uniform mat4 uProjectionMatrix;
    varying vec2 vTexCoord;
    void main() {
      vTexCoord = aTexCoord;
      gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
    }
  `;

  const FRAG = `
    precision highp float;
    varying vec2 vTexCoord;
    uniform sampler2D uVideo;   // 攝影機畫面
    uniform sampler2D uMask;    // 臉部遮罩（螢幕空間）
    uniform vec2  uScale;       // object-fit cover 縮放
    uniform vec2  uMaskRes;     // 遮罩像素尺寸
    uniform float uMirror;      // 鏡像
    uniform float uTime;

    // ── 質感參數（要調整改這裡，存檔重新整理即可）──
    const float uRefract   = 0.075;  // 折射扭曲幅度（加大→五官隨水晃，更液態）
    const float uRippleAmp = 0.20;   // 水波起伏
    const float uTint      = 0.42;   // 藍色調混入（加深→像水不是白霧）
    const vec3  uTintCol   = vec3(0.45, 0.74, 0.95);
    const float uFresnel   = 0.55;   // 臉緣亮邊（壓低→避免白霧光暈）
    const float uSpec      = 1.10;   // 鏡面濕亮點（提高→濕潤立體感）

    // 螢幕 uv → 攝影機 uv（cover + 鏡像）
    vec2 toVideoUV(vec2 uv) {
      vec2 v = (uv - 0.5) * uScale + 0.5;
      v.x = mix(v.x, 1.0 - v.x, uMirror);
      return v;
    }

    void main() {
      vec2 uv   = vTexCoord;
      vec2 vUv  = toVideoUV(uv);
      vec3 base = texture2D(uVideo, clamp(vUv, 0.0, 1.0)).rgb;

      float m = texture2D(uMask, uv).r;
      if (m < 0.003) { gl_FragColor = vec4(0.0); return; }   // 臉外 → 透明，露出底下泳池背景

      // 程序式水波法線
      vec2 rip;
      rip.x = sin(uv.y * 34.0 + uTime * 1.60) + 0.6 * sin(uv.x * 23.0 - uTime * 1.15);
      rip.y = cos(uv.x * 30.0 - uTime * 1.35) + 0.6 * cos(uv.y * 26.0 + uTime * 0.95);
      vec3 n = normalize(vec3(rip * uRippleAmp, 1.0));

      // 折射你的臉
      vec2 refrUV = clamp(vUv + n.xy * uRefract * m, 0.0, 1.0);
      vec3 distort = texture2D(uVideo, refrUV).rgb;

      vec3 water = mix(distort, uTintCol, uTint);

      // 鏡面濕亮點
      vec3 L = normalize(vec3(-0.40, -0.60, 0.70));
      float spec = pow(max(dot(n, L), 0.0), 32.0);
      water += spec * uSpec;

      // 臉緣亮邊（用遮罩梯度）
      vec2 t = 1.0 / uMaskRes;
      float mL = texture2D(uMask, uv - vec2(t.x, 0.0)).r;
      float mR = texture2D(uMask, uv + vec2(t.x, 0.0)).r;
      float mD = texture2D(uMask, uv - vec2(0.0, t.y)).r;
      float mU = texture2D(uMask, uv + vec2(0.0, t.y)).r;
      float rim = clamp(length(vec2(mR - mL, mU - mD)) * 7.0, 0.0, 1.0);
      water += vec3(0.60, 0.85, 1.0) * rim * uFresnel;   // 偏藍白的玻璃透光邊

      // 臉內輸出液態水質臉：遮罩當 alpha → 臉緣羽化融進泳池、半透明處透出底下泳池
      // （premultiplied alpha：rgb 先乘 m，半透明邊緣顏色才正確）
      gl_FragColor = vec4(water * m, m);
    }
  `;

  // 臉部輪廓 landmark（下顎 + 額頭一圈）
  const JAW = [
    10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,
    400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109,
  ];

  new p5(function (p) {
    let shaderObj, maskG, vidG, webcamEl;
    let scaleX = 1, scaleY = 1;

    p.setup = function () {
      const cnv = p.createCanvas(p.windowWidth, p.windowHeight, p.WEBGL);
      p.pixelDensity(1);
      cnv.id('waterface-canvas');
      cnv.style('position', 'fixed');
      cnv.style('top', '0');
      cnv.style('left', '0');
      cnv.style('width', '100vw');
      cnv.style('height', '100vh');
      cnv.style('z-index', '1');          // 在泳池圖(fallback)之上、泡泡/金魚之下
      cnv.style('pointer-events', 'none');

      shaderObj = p.createShader(VERT, FRAG);
      webcamEl = document.getElementById('webcam');
      makeMaskBuffer();
      p.noStroke();
      p.frameRate(60);
    };

    function makeMaskBuffer() {
      maskG = p.createGraphics(
        Math.round(p.width * CFG.HSCALE),
        Math.round(p.height * CFG.HSCALE)
      );
      maskG.pixelDensity(1);
    }

    p.windowResized = function () {
      p.resizeCanvas(p.windowWidth, p.windowHeight);
      makeMaskBuffer();
    };

    p.draw = function () {
      p.clear();
      if (!updateVideo()) return;     // 攝影機還沒好 → 透明（露出底下泳池）

      computeCoverScale();
      buildMask();                    // 沒臉也會清空遮罩 → 只顯示原始自拍

      p.shader(shaderObj);
      shaderObj.setUniform('uVideo', vidG);
      shaderObj.setUniform('uMask', maskG);
      shaderObj.setUniform('uScale', [scaleX, scaleY]);
      shaderObj.setUniform('uMaskRes', [maskG.width, maskG.height]);
      shaderObj.setUniform('uMirror', CFG.MIRROR);
      shaderObj.setUniform('uTime', p.millis() / 1000);
      p.plane(p.width, p.height);
    };

    // 把攝影機畫面畫進 vidG（當貼圖）
    function updateVideo() {
      const el = webcamEl;
      if (!el || el.readyState < 2 || !el.videoWidth) return false;
      if (!vidG || vidG.width !== el.videoWidth || vidG.height !== el.videoHeight) {
        vidG = p.createGraphics(el.videoWidth, el.videoHeight);
        vidG.pixelDensity(1);
      }
      vidG.drawingContext.drawImage(el, 0, 0, vidG.width, vidG.height);
      return true;
    }

    // object-fit: cover 的縮放（攝影機畫面填滿螢幕、裁切溢出）
    function computeCoverScale() {
      const canvasAspect = p.width / p.height;
      const videoAspect = vidG.width / vidG.height;
      if (canvasAspect > videoAspect) {
        scaleX = 1;
        scaleY = videoAspect / canvasAspect;
      } else {
        scaleX = canvasAspect / videoAspect;
        scaleY = 1;
      }
    }

    // landmark(攝影機 uv) → 遮罩像素座標（含 cover 反算 + 鏡像）
    function lmToMaskPx(l) {
      const su = CFG.MIRROR
        ? (0.5 - l.x) / scaleX + 0.5
        : (l.x - 0.5) / scaleX + 0.5;
      const sv = (l.y - 0.5) / scaleY + 0.5;
      return { x: su * maskG.width, y: sv * maskG.height };
    }

    // 畫臉部遮罩（白色填滿臉輪廓 + 模糊軟邊）
    function buildMask() {
      const g = maskG;
      const ctx = g.drawingContext;
      ctx.clearRect(0, 0, g.width, g.height);

      const fp = window.faceParams;
      if (!fp || !fp.detected || !fp.rawLandmarks) return false;

      const lm = fp.rawLandmarks;
      const pts = JAW.map((i) => lmToMaskPx(lm[i]));

      ctx.fillStyle = 'white';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fill();

      g.filter(p.BLUR, Math.max(1, g.width * 0.012));   // 軟邊 → 自然 rim
      return true;
    }

    window.waterFace = { CFG };
  });

})();
