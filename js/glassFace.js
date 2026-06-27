/**
 * glassFace.js — 清透玻璃 3D 臉（Three.js）
 *
 * 做法（跟 Spark AR / IG filter 同原理，但純 web）：
 *  1. MediaPipe FaceMesh 偵測臉 → 拿到 478 點「3D 臉網格」（有深度，不是平面照片）
 *  2. 用標準三角索引（window.FACE_TRIANGULATION）把點接成立體臉面
 *  3. 套 MeshPhysicalMaterial 清透玻璃材質 + 環境反射 → 立體玻璃臉
 *     → 五官立體、邊緣透光、表面高光；臉形穩定不扭曲（只有頭一動，反光跟著流）
 *
 * 沒臉時整層透明，露出底下的泳池背景（#pool-bg, z0）。
 * 質感參數集中在最上方 CFG，改完存檔重新整理即可。
 */

import * as THREE from 'three';

(function () {

  // ── 質感 / 對位參數（要調就改這裡）──────────────
  const CFG = {
    MIRROR: true,          // 自拍鏡像（你往右，玻璃臉往右）
    FACE_SCALE: 1.8,       // 臉整體大小
    DEPTH: 2.2,            // 深度倍率（加大 → 五官更凸更立體、更突顯）
    SMOOTH: 0.4,           // 時序平滑 0~1（越小越穩越不抖、越大越即時）
    SMOOTH_SPACE: 0.3,     // 空間平滑（去三角塊面，讓玻璃表面滑順）
    RIM_TUCK: 0.03,        // 臉緣往後收（捲成殼，輕一點）
    RIPPLE_AMP: 0.013,     // 臉表面水流起伏振幅（像流動的水做的臉）
    RIPPLE_SPEED: 1.5,     // 水流速度
    GLASS_COLOR: 0xeaf4ff, // 玻璃本體色（略帶水藍 → 壓白）
    TRANSMISSION: 0.99,    // 透光度（再透 → 透出折射的泳池，晶瑩剔透）
    THICKNESS: 1.4,        // 玻璃厚度（加厚 → 折射更強，五官把泳池格紋扭曲更明顯）
    IOR: 1.4,              // 折射率（水~1.33 / 玻璃~1.5 之間）
    ATTEN_COLOR: 0x4a96d2, // 玻璃吸收色：再飽和一點的深天藍
    ATTEN_DIST: 1.1,       // 吸收距離縮短 → 暗部更深藍、對比更強
    FACE_OPACITY: 0.92,    // 臉整體透明度上限（反射的藍+金棕填滿臉）
    ROUGHNESS: 0.005,      // 更低 → 高光更尖銳、對比更強
    ENV_INTENSITY: 2.85,   // 環境反射再加強 → 藍 + 金棕更明顯
    CLEARCOAT: 0.55,       // 清漆收斂（減少白色高光膜）
    KEY_LIGHT: 1.2,        // 白高光降低（減少白色的量）
    WARM_LIGHT: 1.15,      // 暖金反光再加強（金棕條紋更明顯，冷暖對比）
  };

  const NUM = 468;         // 三角索引用前 468 點（FaceMesh refine 給 478，多的是虹膜）
  let renderer, scene, camera, mesh, geom, posAttr;
  let smoothed = null;     // EMA 平滑後的頂點座標
  let adjacency = null, tmpPos = null;   // 空間平滑用：鄰接表 + 暫存
  let imgAspect = 4 / 3;   // 攝影機長寬比（還原臉真實比例，避免被壓扁）
  let bgPlane, bgMat;      // 泳池背景平面（臉折射它 + 表面流動水光）
  let fade = 0, lastT = 0; // 臉淡入淡出（慢慢浮現，不突然閃現）
  const webcamEl = document.getElementById('webcam');

  // FaceMesh 臉部輪廓一圈（FACEMESH_FACE_OVAL）— 臉緣收邊用
  const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397,
                365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58,
                132, 93, 234, 127, 162, 21, 54, 103, 67, 109];

  init();

  function init() {
    const cnv = document.createElement('canvas');
    cnv.id = 'glassface-canvas';
    Object.assign(cnv.style, {
      position: 'fixed', top: '0', left: '0',
      width: '100vw', height: '100vh',
      zIndex: '1',                 // 泳池(z0) 之上、泡泡金魚(z2) 之下
      pointerEvents: 'none',
    });
    document.body.appendChild(cnv);

    renderer = new THREE.WebGLRenderer({ canvas: cnv, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);   // 透明背景 → 露出泳池
    renderer.toneMapping = THREE.ACESFilmicToneMapping;   // 高光更漂亮不爆掉
    renderer.toneMappingExposure = 0.92;   // 降曝光 → 暗部更深、對比更強、白色收斂
    resize();

    scene = new THREE.Scene();

    // 環境反射：程序天空（藍天 + 太陽高光 + 暖色地面）→ 玻璃映藍天、強亮高光
    scene.environment = makeSkyEnv();

    // 會流動的泳池背景平面（放在臉後方）：
    //  - 臉外直接看到它 → 背景泳池水波動態
    //  - 玻璃臉 transmission 折射它 → 折射五官 + 折射的是「流動的泳池」→ 臉融進水裡
    bgMat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: null }, uTime: { value: 0 },
        uPlaneAspect: { value: 1 },        // plane 在螢幕的寬高比（= 視窗比例）
        uTexAspect: { value: 1920 / 1086 } // 泳池圖原始寬高比（載入後以實際值覆蓋）
      },
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: `
        uniform sampler2D uTex; uniform float uTime;
        uniform float uPlaneAspect; uniform float uTexAspect;
        varying vec2 vUv;
        // cover：保持圖片比例填滿、取中央（避免被螢幕比例拉伸壓縮）
        vec2 coverUV(vec2 uv) {
          float r = uPlaneAspect / uTexAspect;
          vec2 o = uv;
          if (r > 1.0) o.y = (uv.y - 0.5) / r + 0.5;   // 視窗較寬 → 垂直取中段
          else         o.x = (uv.x - 0.5) * r + 0.5;   // 視窗較高/窄 → 水平取中段
          return o;
        }
        void main() {
          vec2 uv = coverUV(vUv);
          vec3 col = texture2D(uTex, uv).rgb;          // 泳池格紋（cover 不變形）
          // 流動焦散光紋（caustics）：多層交錯 sin → 網狀水光在池底游移流動
          vec2 p = uv * 4.0;
          float t = uTime * 0.7;                        // 速度加快 → 水光更明顯流動
          float c = sin(p.x + t) * sin(p.y - t * 0.8)
                  + sin(p.x * 1.6 - t * 0.7) * sin(p.y * 1.4 + t * 0.5);
          c = max(c, 0.0);
          c = pow(c * 0.5, 1.6);
          col += vec3(0.5, 0.66, 0.78) * c * 0.7;       // 偏藍白流動水光（加強）
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    bgPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bgMat);
    bgPlane.position.z = -1.5;          // 臉後方 → 被臉折射
    scene.add(bgPlane);
    updateBgScale();

    // 先放淺藍純色底，避免底圖載入前/失敗時整片黑
    bgMat.uniforms.uTex.value = makeFlatTex(143, 198, 224);

    // 手機(直式)載手機專屬底圖、桌機載原圖；手機圖載入失敗自動退回原圖（不黑）
    const portrait = window.innerWidth < window.innerHeight;
    const DESKTOP_BG = 'assets/img/pool-bg.jpg?v=3';
    const MOBILE_BG  = 'assets/img/pool-bg-mobile.jpg?v=3';
    loadBg(portrait ? MOBILE_BG : DESKTOP_BG, portrait ? DESKTOP_BG : null);

    // 補兩盞光打出尖銳高光（玻璃表面濕亮的白色亮塊，勾勒五官）
    const key = new THREE.DirectionalLight(0xffffff, CFG.KEY_LIGHT);
    key.position.set(-0.6, 0.9, 1.0);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfe6ff, 0.9);
    rim.position.set(0.7, -0.4, 0.6);
    scene.add(rim);
    const warm = new THREE.DirectionalLight(0xffe6c2, CFG.WARM_LIGHT);  // 暖色補光 → 暖反光斑
    warm.position.set(0.3, 0.5, 0.8);
    scene.add(warm);

    setupCamera();

    // 臉網格：位置每幀更新、索引固定
    geom = new THREE.BufferGeometry();
    posAttr = new THREE.BufferAttribute(new Float32Array(NUM * 3), 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('position', posAttr);
    geom.setIndex(window.FACE_TRIANGULATION);
    buildEdgeWeights();          // 臉緣淡化權重（邊緣 alpha 漸淡 → 霧化融入水）

    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(CFG.GLASS_COLOR),
      roughness: CFG.ROUGHNESS,
      metalness: 0.0,
      transmission: CFG.TRANSMISSION,   // 真玻璃透光
      thickness: CFG.THICKNESS,
      ior: CFG.IOR,
      attenuationColor: new THREE.Color(CFG.ATTEN_COLOR),  // 厚度吸收 → 藍綠體積
      attenuationDistance: CFG.ATTEN_DIST,
      transparent: true,
      clearcoat: CFG.CLEARCOAT,
      clearcoatRoughness: 0.06,
      envMapIntensity: CFG.ENV_INTENSITY,
      side: THREE.DoubleSide,      // 單層臉片 → 雙面才有體積感
      depthWrite: false,
    });

    // 臉緣淡化：邊緣頂點 alpha 漸淡 → 不再硬邊銳利，霧化融入水
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aEdge;\nvarying float vEdge;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vEdge = aEdge;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vEdge;')
        .replace('#include <dithering_fragment>', '  gl_FragColor.a *= vEdge;\n#include <dithering_fragment>');
    };

    mesh = new THREE.Mesh(geom, mat);
    mesh.visible = false;
    scene.add(mesh);

    window.addEventListener('resize', () => { resize(); setupCamera(); updateBgScale(); });
    renderer.setAnimationLoop(loop);
    window.glassFace = { CFG, mesh, get material() { return mesh.material; } };
  }

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  // 程序天空環境貼圖：天頂藍 → 地平線亮帶 → 地面暖色，加一顆太陽高光（玻璃的強亮反射點）
  function makeSkyEnv() {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 512;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0.00, '#1267b0');   // 天頂深飽和藍
    g.addColorStop(0.40, '#3f97d8');   // 飽和天空藍
    g.addColorStop(0.52, '#bcdcf0');   // 地平線亮帶（偏藍，不要太白）
    g.addColorStop(0.60, '#e6a456');   // 暖金帶（更飽和 → 金棕反光更明顯）
    g.addColorStop(1.00, '#c07e38');   // 地面飽和暖金
    ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
    // 太陽：小而尖銳的白亮斑（少量純白高光點，不要大片白）
    const sx = c.width * 0.68, sy = c.height * 0.22, sr = c.height * 0.2;
    const sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
    sun.addColorStop(0.0, 'rgba(255,255,255,1)');
    sun.addColorStop(0.4, 'rgba(255,250,240,0.4)');
    sun.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = sun; ctx.fillRect(0, 0, c.width, c.height);
    // 暖金色光斑（額外暖反光源 → 五官邊緣的金棕條紋）
    const wx = c.width * 0.3, wy = c.height * 0.68, wr = c.height * 0.42;
    const warm = ctx.createRadialGradient(wx, wy, 0, wx, wy, wr);
    warm.addColorStop(0.0, 'rgba(232,170,92,0.75)');
    warm.addColorStop(1.0, 'rgba(232,170,92,0)');
    ctx.fillStyle = warm; ctx.fillRect(0, 0, c.width, c.height);

    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(tex).texture;
    tex.dispose();
    return env;
  }

  // 正交相機：對位準、臉不因透視變形
  function setupCamera() {
    const a = window.innerWidth / window.innerHeight;
    camera = new THREE.OrthographicCamera(-a, a, 1, -1, -10, 10);
    camera.position.set(0, 0, 3);
    camera.lookAt(0, 0, 0);
  }

  // 1×1 純色 texture（底圖載入前的底色，避免黑屏）
  function makeFlatTex(r, g, b) {
    const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }

  // 載背景底圖到 bgPlane；失敗則載 fallback（手機圖沒放成功時退回原圖，不會變黑）
  function loadBg(url, fallback) {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;      // cover 取中央，不需重複
        bgMat.uniforms.uTex.value = tex;
        if (tex.image) bgMat.uniforms.uTexAspect.value = tex.image.width / tex.image.height;
      },
      undefined,
      () => { if (fallback) loadBg(fallback, null); }
    );
  }

  // 背景平面填滿正交視野；比例由 shader 的 coverUV 處理（不靠拉伸 plane）
  function updateBgScale() {
    if (!bgPlane) return;
    const a = window.innerWidth / window.innerHeight;
    bgPlane.scale.set(2 * a, 2, 1);                 // 剛好填滿視野
    if (bgMat) bgMat.uniforms.uPlaneAspect.value = a;  // 告訴 shader 目前視窗比例做 cover
  }

  function loop() {
    const fp = window.faceParams;
    if (webcamEl && webcamEl.videoWidth) imgAspect = webcamEl.videoWidth / webcamEl.videoHeight;
    const now = performance.now() / 1000;
    const dt = lastT ? Math.min(0.1, now - lastT) : 0.016; lastT = now;
    if (bgMat) bgMat.uniforms.uTime.value = now;   // 背景水光持續流動

    const detected = fp && fp.detected && fp.rawLandmarks && fp.rawLandmarks.length >= NUM;
    if (detected) {
      updateMesh(fp.rawLandmarks);
      fade = Math.min(1, fade + dt / 1.0);     // 1 秒慢慢淡入浮現
    } else {
      fade = Math.max(0, fade - dt / 0.6);     // 約 0.6 秒淡出
    }
    mesh.material.opacity = fade * CFG.FACE_OPACITY;   // 淡入(1秒) × 透明度上限 → 柔和浮現且更透
    mesh.visible = fade > 0.005;

    renderer.render(scene, camera);
  }

  // landmark(normalized image 座標) → 世界座標，含鏡像 / 比例還原 / 深度 / 平滑
  function updateMesh(lm) {
    const arr = posAttr.array;
    const sm = (smoothed = smoothed || new Float32Array(NUM * 3));
    const S = CFG.FACE_SCALE;
    const a = imgAspect;
    const k = CFG.SMOOTH;

    for (let i = 0; i < NUM; i++) {
      const p = lm[i];
      const mx = CFG.MIRROR ? (1.0 - p.x) : p.x;
      const X = (mx - 0.5) * a * S;          // 乘 a 還原真實長寬，臉不被壓扁
      const Y = (0.5 - p.y) * S;             // 影像 y 向下 → 翻成世界 y 向上
      const Z = (-p.z) * a * S * CFG.DEPTH;  // 深度：凸向相機為 +Z

      const j = i * 3;
      sm[j]     += (X - sm[j])     * k;       // EMA 平滑，減少臉抖
      sm[j + 1] += (Y - sm[j + 1]) * k;
      sm[j + 2] += (Z - sm[j + 2]) * k;
      arr[j] = sm[j]; arr[j + 1] = sm[j + 1]; arr[j + 2] = sm[j + 2];
    }

    smoothSurface(arr);                      // 空間平滑去塊面 + 臉緣收邊
    surfaceRipple(arr, performance.now() / 1000);  // 臉表面像水流動

    posAttr.needsUpdate = true;
    geom.computeVertexNormals();             // 重算法線 → 玻璃光照正確（高光跟著水流動）
  }

  // 臉表面像水流動：每點深度加多頻流動擾動，重算法線後高光跟著流（一張流動的水做的臉）
  function surfaceRipple(arr, t) {
    const amp = CFG.RIPPLE_AMP * CFG.FACE_SCALE;
    const s = CFG.RIPPLE_SPEED;
    for (let i = 0; i < NUM; i++) {
      const j = i * 3;
      const x = arr[j], y = arr[j + 1];
      const w = Math.sin(x * 9.0 + t * 1.6 * s) * 0.6
              + Math.sin(y * 7.0 - t * 1.3 * s) * 0.5
              + Math.sin((x + y) * 6.0 + t * 2.1 * s) * 0.4;
      arr[j + 2] += w * amp;
    }
  }

  // 空間平滑（Laplacian）讓玻璃表面滑順，並把臉緣往後收成殼
  function smoothSurface(arr) {
    if (!adjacency) adjacency = buildAdjacency();
    const tmp = (tmpPos = tmpPos || new Float32Array(NUM * 3));
    const lam = CFG.SMOOTH_SPACE;

    // 每點往鄰居平均靠攏 → 磨掉三角塊面
    for (let i = 0; i < NUM; i++) {
      const nb = adjacency[i]; const j = i * 3;
      if (!nb.length) { tmp[j] = arr[j]; tmp[j + 1] = arr[j + 1]; tmp[j + 2] = arr[j + 2]; continue; }
      let sx = 0, sy = 0, sz = 0;
      for (let n = 0; n < nb.length; n++) { const m = nb[n] * 3; sx += arr[m]; sy += arr[m + 1]; sz += arr[m + 2]; }
      const inv = 1 / nb.length;
      tmp[j]     = arr[j]     + (sx * inv - arr[j])     * lam;
      tmp[j + 1] = arr[j + 1] + (sy * inv - arr[j + 1]) * lam;
      tmp[j + 2] = arr[j + 2] + (sz * inv - arr[j + 2]) * lam;
    }
    arr.set(tmp);

    // 臉緣只往後收成殼邊（不往中心收，否則額頭頂點被擠在一起 → 缺一塊）
    const tuck = CFG.RIM_TUCK * CFG.FACE_SCALE;
    for (let k = 0; k < OVAL.length; k++) {
      arr[OVAL[k] * 3 + 2] -= tuck;
    }
  }

  // 從三角索引建頂點鄰接表（一次）
  function buildAdjacency() {
    const adj = Array.from({ length: NUM }, () => new Set());
    const T = window.FACE_TRIANGULATION;
    for (let i = 0; i < T.length; i += 3) {
      const a = T[i], b = T[i + 1], c = T[i + 2];
      if (a < NUM && b < NUM && c < NUM) {
        adj[a].add(b); adj[a].add(c);
        adj[b].add(a); adj[b].add(c);
        adj[c].add(a); adj[c].add(b);
      }
    }
    return adj.map((s) => Array.from(s));
  }

  // 臉緣淡化權重：BFS 算每點離臉輪廓(OVAL)幾圈，邊緣 0 → 內側 1（smoothstep 漸變）
  function buildEdgeWeights() {
    if (!adjacency) adjacency = buildAdjacency();
    const dist = new Float32Array(NUM); dist.fill(999);
    const queue = [];
    for (let k = 0; k < OVAL.length; k++) { dist[OVAL[k]] = 0; queue.push(OVAL[k]); }
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      const nbs = adjacency[cur];
      for (let n = 0; n < nbs.length; n++) {
        const nb = nbs[n];
        if (dist[nb] > dist[cur] + 1) { dist[nb] = dist[cur] + 1; queue.push(nb); }
      }
    }
    const RINGS = 3;
    const arr = new Float32Array(NUM);
    for (let i = 0; i < NUM; i++) {
      const t = Math.min(1, dist[i] / RINGS);
      arr[i] = t * t * (3 - 2 * t);    // smoothstep：邊緣淡、內側實
    }
    geom.setAttribute('aEdge', new THREE.BufferAttribute(arr, 1));
  }

})();
