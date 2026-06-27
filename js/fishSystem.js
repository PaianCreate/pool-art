/**
 * fishSystem.js
 * 金魚系統 — 抽象錦鯉 [koi]：噴砂顆粒質感 + 修長俯視造型 + 擺動細長尾
 *
 * 觸發：faceParams.EAR < THRESHOLDS.BLINK（眨眼瞬間）→ spawnFish()
 * 對外 API（window.fishSystem）：update(p) / draw(p)
 *
 * 形狀（參考俯視錦鯉照）：頭圓鈍 → 身體修長漸細 → 細長飄帶尾，前段兩側展開胸鰭。
 * 質感：噴砂顆粒（stipple 漸層底 + 細密噴點），橘紅/藍/粉隨機配色。
 * 身體與尾巴分兩張離屏紋理，尾巴以尾基為樞紐擺動。
 */

(function () {

  const fishes = [];

  const CFG = {
    MAX_FISH:       12,
    BLINK_COOLDOWN: 800,
    SPEED_MIN:      4.0,    // 游速
    SPEED_MAX:      6.5,
    SIZE_MIN:       11,     // 縮小到約 1/3
    SIZE_MAX:       21,
    LIFESPAN_MIN:   55,     // 約 1 秒 @60fps
    LIFESPAN_MAX:   66,
    TAIL_SWAY:      0.4,    // 尾巴擺動幅度（弧度）
    TAIL_SPEED:     0.55,   // 尾巴擺動速度（加快）
  };

  const PALETTES = [
    { body: [232, 110, 55],  belly: [255, 248, 240], glow: [255, 186, 120] }, // 橘紅
    { body: [108, 150, 226], belly: [244, 248, 255], glow: [184, 208, 252] }, // 藍
    { body: [246, 150, 172], belly: [255, 248, 250], glow: [255, 206, 196] }, // 粉金
  ];

  let lastBlinkTime = 0;
  let wasBlinking   = false;

  const clamp = (v) => Math.max(0, Math.min(255, v | 0));

  // 漸層底 + 細密噴點 → 細緻噴砂色塊
  function stipple(ctx, x, y, rx, ry, col, n, peak) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0.0, `rgba(${col[0]},${col[1]},${col[2]},${0.92 * peak})`);
    g.addColorStop(0.55, `rgba(${col[0]},${col[1]},${col[2]},${0.5 * peak})`);
    g.addColorStop(1.0, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    for (let i = 0; i < n; i++) {
      const a  = Math.random() * Math.PI * 2;
      const rr = Math.pow(Math.random(), 0.6);
      const px = x + Math.cos(a) * rr * rx;
      const py = y + Math.sin(a) * rr * ry;
      const al = (1 - rr * 0.7) * 0.34 * (0.4 + Math.random()) * peak;
      const j  = 24;
      ctx.fillStyle = `rgba(${clamp(col[0] + (Math.random() - 0.5) * j)},${clamp(col[1] + (Math.random() - 0.5) * j)},${clamp(col[2] + (Math.random() - 0.5) * j)},${al.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(px, py, Math.random() * 0.8 + 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function bez(P, t) {
    const u = 1 - t;
    return [
      u * u * u * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t * t * t * P[3][0],
      u * u * u * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t * t * t * P[3][1],
    ];
  }

  // 生成修長俯視錦鯉紋理（身體一張、尾巴一張）
  function makeKoiTexture(s, pal) {
    // ── 身體（修長流線，頭圓→尾漸細 + 兩側胸鰭）
    const bpad = Math.ceil(s * 2.8);
    const bc = document.createElement('canvas'); bc.width = bpad * 2; bc.height = bpad * 2;
    const bctx = bc.getContext('2d');
    const box = bpad, boy = bpad;
    const SP = [[s * 1.35, 0], [s * 0.5, -s * 0.05], [-s * 0.5, -s * 0.08], [-s * 1.45, -s * 0.12]];
    for (let i = 0; i <= 22; i++) {
      const t = i / 22;
      const pt = bez(SP, t);
      const rad = s * 0.6 * Math.pow(1 - t, 1.15) + s * 0.07;   // 頭圓大 → 尾漸細
      const col = t < 0.2 ? pal.belly : (t < 0.7 ? pal.body : pal.glow);
      stipple(bctx, box + pt[0], boy + pt[1], rad, rad * 0.85, col, Math.floor(160 * (1 - t * 0.5)), 1 - t * 0.2);
    }
    // 頭部圓鈍（白亮 + 主色）
    const hd = bez(SP, 0.05);
    stipple(bctx, box + hd[0], boy + hd[1], s * 0.6, s * 0.54, [255, 250, 245], 280, 1);
    stipple(bctx, box + hd[0] - s * 0.12, boy + hd[1], s * 0.52, s * 0.48, pal.body, 200, 0.72);
    // 胸鰭（前段兩側展開，俯視左右）
    stipple(bctx, box + s * 0.5, boy - s * 0.58, s * 0.38, s * 0.2, pal.glow, 110, 0.58);
    stipple(bctx, box + s * 0.5, boy + s * 0.58, s * 0.38, s * 0.2, pal.glow, 110, 0.58);
    const body = { canvas: bc, cx: box, cy: boy };

    // ── 尾巴（細長飄帶，往身體後方延伸）
    const tpad = Math.ceil(s * 3.2);
    const tc = document.createElement('canvas'); tc.width = tpad * 2; tc.height = tpad * 2;
    const tctx = tc.getContext('2d');
    const tox = tpad, toy = tpad;
    const TP = [[0, 0], [-s * 0.23, s * 0.03], [-s * 0.5, s * 0.05], [-s * 0.77, -s * 0.03]];  // 尾巴縮短 1/3
    stipple(tctx, tox, toy, s * 0.18, s * 0.16, pal.glow, 80, 0.8);   // 尾基銜接
    for (let i = 1; i <= 16; i++) {
      const t = i / 16;
      const pt = bez(TP, t);
      const rad = s * 0.2 * (1 - t * 0.55);                            // 細長
      stipple(tctx, tox + pt[0], toy + pt[1], rad, rad * 1.4, pal.glow, Math.floor(50 * (1 - t * 0.3)), 0.72 * (1 - t * 0.35));
    }
    const tail = { canvas: tc, cx: tox, cy: toy };

    return { body, tail, tailPivot: [-s * 1.45, -s * 0.12] };
  }

  class Fish {
    constructor({ x, y, size, dir }) {
      this.x    = x;
      this.y    = y;
      this.size = size;
      this.dir  = dir;
      this.speed = Math.random() * (CFG.SPEED_MAX - CFG.SPEED_MIN) + CFG.SPEED_MIN;
      this.wobble = Math.random() * Math.PI * 2;
      this.tailPhase = Math.random() * Math.PI * 2;
      this.life   = 0;
      this.maxLife = Math.floor(Math.random() * (CFG.LIFESPAN_MAX - CFG.LIFESPAN_MIN) + CFG.LIFESPAN_MIN);
      this.dead   = false;
      this.pal = PALETTES[Math.floor(Math.random() * PALETTES.length)];
      this.tex = makeKoiTexture(size, this.pal);
    }

    update() {
      this.life++;
      this.wobble    += 0.05;
      this.tailPhase += CFG.TAIL_SPEED;
      this.x += this.speed * this.dir;
      this.y += Math.sin(this.wobble) * 0.5;
      if (this.life >= this.maxLife || this.x > window.innerWidth + 130 || this.x < -130) this.dead = true;
    }

    draw(p) {
      const alpha = this.life < 8
        ? p.map(this.life, 0, 8, 0, 1)
        : p.map(this.life, this.maxLife * 0.5, this.maxLife, 1, 0);
      const A = Math.max(0, Math.min(1, alpha));   // clamp 0~1（globalAlpha 設 >1 會被瀏覽器忽略 → 魚變透明）

      const ctx = p.drawingContext;
      const tex = this.tex;
      ctx.save();
      ctx.globalAlpha = A;
      ctx.translate(this.x, this.y);

      // 池底陰影：魚形深色剪影，明顯分離在下方（像參考圖人浮水面、影投在較遠池底）
      const sz = this.size;
      ctx.save();
      ctx.globalAlpha = A * 0.4;
      ctx.translate(sz * 0.35, sz * 2.2);            // 明顯分離（往下偏一段距離）
      ctx.scale(this.dir, 1);
      const shade = (cx2, rx, ry, a0) => {           // 漸層柔邊剪影（不用 filter）
        ctx.save();
        ctx.translate(cx2, 0);
        ctx.scale(1, ry / rx);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
        g.addColorStop(0.0, `rgba(10,28,52,${a0})`);
        g.addColorStop(0.6, `rgba(10,28,52,${a0 * 0.5})`);
        g.addColorStop(1.0, 'rgba(10,28,52,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      };
      shade(0, sz * 1.35, sz * 0.55, 0.8);            // 身剪影
      shade(-sz * 0.6, sz * 0.5, sz * 0.3, 0.6);      // 尾剪影（配合短尾）
      ctx.restore();

      ctx.scale(this.dir, 1);
      ctx.rotate(Math.sin(this.wobble) * 0.08);

      // 尾巴（以尾基樞紐擺動）→ 先畫
      ctx.save();
      ctx.translate(tex.tailPivot[0], tex.tailPivot[1]);
      ctx.rotate(Math.sin(this.tailPhase) * CFG.TAIL_SWAY);
      ctx.drawImage(tex.tail.canvas, -tex.tail.cx, -tex.tail.cy);
      ctx.restore();

      // 身體
      ctx.drawImage(tex.body.canvas, -tex.body.cx, -tex.body.cy);

      ctx.restore();
    }
  }

  // ─────────────────────────────────────────────
  window.fishSystem = {
    update(p) {
      const fp = window.faceParams;
      const now = Date.now();
      if (fp && fp.detected) {
        const isBlinking = fp.EAR < window.THRESHOLDS.BLINK;
        if (isBlinking && !wasBlinking && now - lastBlinkTime > CFG.BLINK_COOLDOWN) {
          this.spawnFish();
          lastBlinkTime = now;
        }
        wasBlinking = isBlinking;
      }
      for (const f of fishes) f.update();
      for (let i = fishes.length - 1; i >= 0; i--) {
        if (fishes[i].dead) fishes.splice(i, 1);
      }
    },

    draw(p) { for (const f of fishes) f.draw(p); },

    spawnFish() {
      if (fishes.length >= CFG.MAX_FISH) return;
      const p = window._p5;
      if (!p) return;
      const fp = window.faceParams;
      let cx = p.width * 0.5, cy = p.height * 0.42, dir = Math.random() > 0.5 ? 1 : -1;
      if (fp && fp.detected && fp.rawLandmarks) {
        const lm = fp.rawLandmarks;
        const cfg = window.glassFace && window.glassFace.CFG;
        const S = (cfg && cfg.FACE_SCALE) || 1.75;
        const mirror = cfg ? cfg.MIRROR : true;
        const proj = (pt) => {
          const mx = mirror ? (1 - pt.x) : pt.x;
          return { x: ((mx - 0.5) * S * 0.5 + 0.5) * p.width, y: (0.5 - (0.5 - pt.y) * S * 0.5) * p.height };
        };
        const eye = Math.random() < 0.5 ? lm[33] : lm[263];   // 左 / 右眼外角
        if (eye && lm[1]) {
          const e = proj(eye), nose = proj(lm[1]);
          cx = e.x; cy = e.y;
          dir = Math.sign(e.x - nose.x) || dir;               // 往眼角外側游出
        }
      }
      fishes.push(new Fish({
        x: cx + (Math.random() - 0.5) * 14,
        y: cy + (Math.random() - 0.5) * 10,
        size: Math.random() * (CFG.SIZE_MAX - CFG.SIZE_MIN) + CFG.SIZE_MIN,
        dir,
      }));
    },
  };

})();
