/**
 * bubbleSystem.js
 * 泡泡系統（精緻肥皂泡：半透球體 + 彩虹薄膜 + 亮邊 + 高光星芒 + 內部小泡點）
 *
 * 觸發來源：
 *  1. faceParams.MAR > THRESHOLDS.MOUTH_OPEN → spawnBubble()
 *  2. UI 輸入框 submit → spawnWordBubble(word)
 *
 * 對外 API（window.bubbleSystem）：update / draw / spawnBubble / spawnWordBubble / handleClick
 */

(function () {

  const bubbles = [];

  const CFG = {
    MAX_BUBBLES:    120,   // 上限提高（大口吐氣量大）
    FACE_COOLDOWN:  180,   // ms，嘴張觸發間隔（縮短 → 持續吐）
    BURST:          5,     // 一次張嘴吐出的泡泡數（量五倍）
    RISE_SPEED_MIN: 3.8,   // 上升速度（兩倍快）
    RISE_SPEED_MAX: 8.0,
    DRIFT_RANGE:    0.9,    // 左右散開（吐氣擴散感）
    LIFESPAN_MIN:   44,    // frames（約 0.73 秒 @60fps）
    LIFESPAN_MAX:   52,    // 約 0.87 秒 → 上升約 0.8 秒就淡化消失
    SIZE_MIN:       4,     // 再縮小（吐氣的小泡泡）
    SIZE_MAX:       22,
    WORD_SIZE_MIN:  120,   // 花朵泡泡更大
    WORD_SIZE_MAX:  160,
  };

  let lastFaceTrigger = 0;

  class Bubble {
    constructor({ x, y, r, word, hasDaisy }) {
      this.x     = x;
      this.y     = y;
      this.r     = r;
      this.word  = word  || null;
      this.daisy = hasDaisy || false;

      this.vx    = (Math.random() - 0.5) * CFG.DRIFT_RANGE;
      this.vy    = -(Math.random() * (CFG.RISE_SPEED_MAX - CFG.RISE_SPEED_MIN) + CFG.RISE_SPEED_MIN);
      this.life  = 0;
      this.maxLife = Math.floor(Math.random() * (CFG.LIFESPAN_MAX - CFG.LIFESPAN_MIN) + CFG.LIFESPAN_MIN);
      this.wobble = Math.random() * Math.PI * 2;
      this.rot    = Math.random() * Math.PI * 2;  // 薄膜色澤的旋轉相位
      this.dead  = false;

      // 內部漂浮小泡點（固定相對位置）
      this.dots = [];
      const n = Math.floor(Math.random() * 4) + 2;
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2;
        const rad = Math.random() * 0.68;
        this.dots.push({ dx: Math.cos(ang) * rad, dy: Math.sin(ang) * rad, s: Math.random() * 0.045 + 0.015 });
      }
    }

    update() {
      this.life++;
      this.wobble += 0.04;
      this.x += this.vx + Math.sin(this.wobble) * 0.3;
      this.y += this.vy;
      if (this.life >= this.maxLife || this.y + this.r < 0) this.dead = true;
    }

    draw(p) {
      const alpha = this.life < 5
        ? p.map(this.life, 0, 5, 0, 1)                              // 快速淡入（配合 0.4 秒短壽命）
        : p.map(this.life, this.maxLife * 0.5, this.maxLife, 1, 0); // 後半淡出
      const A = Math.max(0, alpha) * (this.word ? 1.0 : 0.5);   // 吐氣泡減半；花泡(word)維持清楚
      const ctx = p.drawingContext;
      const { x, y, r } = this;

      ctx.save();

      // 1. 泡膜主體：中心幾乎透明 → 邊緣聚色（淡藍紫青）
      const body = ctx.createRadialGradient(x, y, r * 0.15, x, y, r);
      body.addColorStop(0.00, `rgba(225,235,255,${0.04 * A})`);
      body.addColorStop(0.55, `rgba(212,224,255,${0.07 * A})`);
      body.addColorStop(0.82, `rgba(226,212,246,${0.16 * A})`);  // 淡紫
      body.addColorStop(0.94, `rgba(190,228,250,${0.30 * A})`);  // 青藍
      body.addColorStop(1.00, `rgba(255,255,255,0)`);
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();

      // 2. 彩虹薄膜光澤（iridescence）：靠邊緣的彩虹環
      const irid = ctx.createRadialGradient(x, y, r * 0.7, x, y, r);
      irid.addColorStop(0.00, 'rgba(255,255,255,0)');
      irid.addColorStop(0.70, `rgba(255,198,224,${0.11 * A})`);  // 粉
      irid.addColorStop(0.85, `rgba(202,200,255,${0.13 * A})`);  // 紫藍
      irid.addColorStop(0.95, `rgba(188,246,232,${0.15 * A})`);  // 青綠
      irid.addColorStop(1.00, 'rgba(255,255,255,0)');
      ctx.fillStyle = irid;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();

      // 3. 亮邊 rim（薄膜邊緣反光）+ 局部更亮的弧
      ctx.lineWidth = Math.max(1, r * 0.022);
      ctx.strokeStyle = `rgba(235,245,255,${0.26 * A})`;
      ctx.beginPath(); ctx.arc(x, y, r * 0.985, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = Math.max(1.5, r * 0.05);
      ctx.strokeStyle = `rgba(235,245,255,${0.4 * A})`;
      ctx.beginPath(); ctx.arc(x, y, r * 0.95, Math.PI * 1.02, Math.PI * 1.5); ctx.stroke();   // 左上亮弧
      ctx.beginPath(); ctx.arc(x, y, r * 0.95, Math.PI * 0.08, Math.PI * 0.42); ctx.stroke();  // 右下亮弧

      // 4. 主高光（左上柔光斑，降白）
      const hx = x - r * 0.34, hy = y - r * 0.4;
      const hl = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 0.5);
      hl.addColorStop(0, `rgba(245,250,255,${0.28 * A})`);
      hl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hl;
      ctx.beginPath(); ctx.arc(hx, hy, r * 0.5, 0, Math.PI * 2); ctx.fill();

      // 5. 內部漂浮小泡點
      for (const d of this.dots) {
        ctx.fillStyle = `rgba(235,245,255,${0.2 * A})`;
        ctx.beginPath(); ctx.arc(x + d.dx * r, y + d.dy * r, d.s * r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = `rgba(235,245,255,${0.3 * A})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.arc(x + d.dx * r, y + d.dy * r, d.s * r, 0, Math.PI * 2); ctx.stroke();
      }

      // 6. sparkle 星芒（尖銳亮點，左上邊，降白）
      drawSparkle(ctx, x - r * 0.46, y - r * 0.46, r * 0.16, A);

      ctx.restore();

      // ── 雛菊改用圖片貼（等花圖素材）；程序雛菊先停用
      if (this.daisy && window._daisyImg) {
        const dr = this.r * 1.25;
        p.push();
        p.imageMode(p.CENTER);
        p.tint(255, Math.floor(A * 255));
        p.image(window._daisyImg, this.x, this.y, dr, dr);
        p.pop();
      }
      if (this.word) {
        p.noStroke();
        p.fill(255, 235, 240, Math.floor(A * 255));
        p.textAlign(p.CENTER, p.CENTER);
        p.textSize(this.r * 0.16);
        p.textFont('Georgia');
        p.textStyle(p.ITALIC);
        p.text(this.word, this.x, this.y + this.r * 0.78);   // 文字在花下方泡泡內底部
      }
    }

    _drawDaisy(p, alpha) {
      const a = alpha;
      const R = this.r * 0.62;            // 花半徑（佔泡泡內大部分）
      const PETALS = 16;                  // 細長花瓣放射
      p.push();
      p.translate(this.x, this.y);
      p.noStroke();
      // 花瓣：根淺粉 → 尖深粉紫紅（多層橢圓疊近似漸層）
      for (let i = 0; i < PETALS; i++) {
        p.push();
        p.rotate((i / PETALS) * p.TWO_PI + this.wobble * 0.04);
        p.fill(255, 200, 218, a * 0.85 * 255);
        p.ellipse(0, -R * 0.55, R * 0.2, R * 0.74);     // 瓣根（淺粉）
        p.fill(238, 150, 188, a * 0.7 * 255);
        p.ellipse(0, -R * 0.74, R * 0.14, R * 0.44);    // 瓣中（粉）
        p.fill(198, 92, 144, a * 0.62 * 255);
        p.ellipse(0, -R * 0.9, R * 0.085, R * 0.22);    // 瓣尖（深粉紫紅）
        p.pop();
      }
      // 花心：蓬鬆黃色（同心環顆粒）
      p.fill(218, 176, 52, a * 255);
      p.ellipse(0, 0, R * 0.56, R * 0.56);
      p.fill(244, 208, 92, a * 230);
      p.ellipse(0, 0, R * 0.42, R * 0.42);
      for (let ring = 1; ring <= 3; ring++) {
        const rr = R * 0.07 * ring, n = ring * 7;
        for (let k = 0; k < n; k++) {
          const ang = (k / n) * p.TWO_PI + ring * 1.3;
          p.fill(255, 224, 124, a * 0.8 * 255);
          p.ellipse(Math.cos(ang) * rr, Math.sin(ang) * rr, R * 0.045, R * 0.045);
        }
      }
      p.pop();
    }

    contains(x, y) { return Math.hypot(x - this.x, y - this.y) < this.r; }

    pop() {
      this.dead = true;
      if (window.audioSystem) window.audioSystem.playPop();
    }
  }

  // 尖銳星芒高光（十字光芒 + 中心亮點）
  function drawSparkle(ctx, x, y, s, A) {
    ctx.strokeStyle = `rgba(235,245,255,${0.5 * A})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - s, y); ctx.lineTo(x + s, y);
    ctx.moveTo(x, y - s); ctx.lineTo(x, y + s);
    ctx.stroke();
    const g = ctx.createRadialGradient(x, y, 0, x, y, s * 0.55);
    g.addColorStop(0, `rgba(245,250,255,${0.6 * A})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, s * 0.55, 0, Math.PI * 2); ctx.fill();
  }

  // ─────────────────────────────────────────────
  window.bubbleSystem = {

    update(p) {
      const fp = window.faceParams;
      const now = Date.now();
      if (fp && fp.detected && fp.MAR > window.THRESHOLDS.MOUTH_OPEN && now - lastFaceTrigger > CFG.FACE_COOLDOWN) {
        for (let i = 0; i < CFG.BURST; i++) this.spawnBubble();   // 一口氣吐一團（量五倍）
        lastFaceTrigger = now;
      }
      for (const b of bubbles) b.update();
      for (let i = bubbles.length - 1; i >= 0; i--) {
        if (bubbles[i].dead) bubbles.splice(i, 1);
      }
    },

    draw(p) { for (const b of bubbles) b.draw(p); },

    // 吐氣泡泡（嘴張觸發）— 從嘴巴噴出、散開上升，像水裡大口吐氣
    spawnBubble() {
      if (bubbles.length >= CFG.MAX_BUBBLES) return;
      const p = window._p5;
      if (!p) return;

      // 嘴巴中心螢幕位置（上下唇 13/14，對齊玻璃臉投影）
      const fp = window.faceParams;
      let cx = p.width * 0.5, cy = p.height * 0.58, faceScale = 1;
      if (fp && fp.detected && fp.rawLandmarks) {
        const lm = fp.rawLandmarks, top = lm[13], bot = lm[14];
        if (top && bot) {
          const cfg = window.glassFace && window.glassFace.CFG;
          const S = (cfg && cfg.FACE_SCALE) || 1.75;
          const mirror = cfg ? cfg.MIRROR : true;
          const mxn = (top.x + bot.x) / 2, myn = (top.y + bot.y) / 2;
          const mx = mirror ? (1 - mxn) : mxn;
          cx = ((mx - 0.5) * S * 0.5 + 0.5) * p.width;
          cy = (0.5 - (0.5 - myn) * S * 0.5) * p.height;
        }
        // 臉遠近 → 泡泡大小：臉寬（左右臉頰 234-454）越大＝臉越靠近＝泡泡越大
        const L = lm[234], R = lm[454];
        if (L && R) {
          const w = Math.hypot(R.x - L.x, R.y - L.y);   // normalized 臉寬
          faceScale = Math.max(0.45, Math.min(2.4, w / 0.32));   // 基準臉寬 0.32 → scale 1
        }
      }

      bubbles.push(new Bubble({
        x: cx + (Math.random() - 0.5) * 26,   // 從嘴噴出、散開
        y: cy + (Math.random() - 0.5) * 14,
        r: (Math.random() * (CFG.SIZE_MAX - CFG.SIZE_MIN) + CFG.SIZE_MIN) * faceScale,   // 大小隨臉遠近
      }));
    },

    // 帶文字＋雛菊的泡泡（輸入框觸發）
    spawnWordBubble(word) {
      if (bubbles.length >= CFG.MAX_BUBBLES) return;
      const p = window._p5;
      if (!p) return;
      const b = new Bubble({
        x: p.width * (0.35 + Math.random() * 0.3),    // 大致置中
        y: p.height * (0.45 + Math.random() * 0.15),
        r: Math.random() * (CFG.WORD_SIZE_MAX - CFG.WORD_SIZE_MIN) + CFG.WORD_SIZE_MIN,
        word: word,
        hasDaisy: true,
      });
      b.maxLife = 320;        // 花泡顯示久一點（約 5 秒，看得到花與字）
      b.vy = -0.35;           // 慢慢上浮
      b.vx = (Math.random() - 0.5) * 0.15;
      bubbles.push(b);
    },

    handleClick(x, y) {
      for (let i = bubbles.length - 1; i >= 0; i--) {
        if (bubbles[i].contains(x, y)) { bubbles[i].pop(); return; }
      }
    },
  };

  window._bubbles = bubbles;   // debug

})();
