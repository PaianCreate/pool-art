/**
 * ui.js
 * UI 膠水層
 *
 * 負責：
 *  - 輸入框 submit → bubbleSystem.spawnWordBubble(word)
 *  - Debug 面板（按 D 切換）
 *  - 臉部偵測狀態燈
 */

(function () {

  document.addEventListener('DOMContentLoaded', () => {

    // ─────────────────────────────────────────────
    // 入口 Enter 按鈕：點擊（使用者手勢）→ 啟動鏡頭 + 解鎖音訊 + 淡出入口層
    // ─────────────────────────────────────────────
    const enterScreen = document.getElementById('enter-screen');
    const enterBtn    = document.getElementById('enter-btn');
    if (enterBtn && enterScreen) {
      let entered = false;
      const enter = () => {
        if (entered) return;
        entered = true;

        // ⚠️ Safari/WebKit 嚴格要求：getUserMedia 必須在點擊手勢的「同步第一時間」呼叫，
        //    若放在 await / 其他操作之後，Safari 會判定脫離手勢 → 直接拒絕、不跳詢問、綠燈不亮。
        //    所以這行放在最前面，且不用 async/await。
        const camPromise = navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });

        // 解鎖音訊（部分瀏覽器需手勢後 resume）
        if (window.Howler && Howler.ctx && Howler.ctx.state === 'suspended') {
          Howler.ctx.resume();
        }
        // 淡出入口層，動畫結束後移除以免擋互動
        enterScreen.classList.add('hidden');
        setTimeout(() => enterScreen.remove(), 1200);

        camPromise
          .then((stream) => {
            stream.getTracks().forEach((t) => t.stop());   // 釋放，交給 MediaPipe 重新開
            if (window.startFaceTracking) window.startFaceTracking();
          })
          .catch((err) => {
            showCameraHelp(err);                           // 顯示中文權限提示卡
            if (window.startSimulationMode) window.startSimulationMode();  // 降級：無相機也能看故事
          });
      };
      enterBtn.addEventListener('click', enter);
    }

    // ─────────────────────────────────────────────
    // 相機權限失敗 → 中文友善提示卡（教怎麼開權限）
    // ─────────────────────────────────────────────
    function showCameraHelp(err) {
      if (document.getElementById('cam-help')) return;     // 只顯示一次
      const isInApp = /Instagram|FBAN|FBAV|Line|Threads|Twitter|MicroMessenger/i.test(navigator.userAgent);
      const card = document.createElement('div');
      card.id = 'cam-help';
      card.innerHTML = `
        <div class="cam-help-box">
          <div class="cam-help-title">開啟相機才能變成水裡的臉</div>
          <p class="cam-help-desc">
            這個作品會即時把你的臉變成池底的玻璃，需要相機權限。
            ${isInApp
              ? '你目前是用 App 內建瀏覽器開啟，它不支援相機 —— 請點右上角「‧‧‧」選「在 Safari 開啟」。'
              : '請允許相機權限後重新整理頁面：'}
          </p>
          <ul class="cam-help-list">
            <li><b>iPhone</b>：用 <b>Safari</b> 開啟（App 內建瀏覽器無法用相機）</li>
            <li><b>Mac</b>：系統設定 → 隱私權與安全性 → 相機，開啟你的瀏覽器後完全重開</li>
            <li>網址列的相機/鎖頭圖示 → 相機 → 允許</li>
          </ul>
          <p class="cam-help-note">目前先以無相機模式顯示故事。</p>
          <button class="cam-help-btn" id="cam-help-close">我知道了</button>
        </div>`;
      document.body.appendChild(card);
      document.getElementById('cam-help-close')
        .addEventListener('click', () => card.remove());
    }

    // ─────────────────────────────────────────────
    // 輸入框
    // ─────────────────────────────────────────────
    const input  = document.getElementById('word-input');
    const button = document.getElementById('submit-btn');

    // 輸入框已移除，存在時才綁定（保留 spawnWordBubble 供日後使用）
    if (input && button) {
      function submitWord() {
        const word = input.value.trim();
        if (!word) return;
        if (window.bubbleSystem) {
          window.bubbleSystem.spawnWordBubble(word);
        }
        input.value = '';
        input.blur();
      }

      button.addEventListener('click', submitWord);

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitWord();
      });

      // 讓輸入框獲得焦點時，點擊不傳到 canvas
      input.addEventListener('mousedown', (e) => e.stopPropagation());
    }

    // ─────────────────────────────────────────────
    // 故事捲到結尾 → 去掉底部漸層（The End. 完整顯示）
    // ─────────────────────────────────────────────
    const storyScroll = document.getElementById('story-scroll');
    if (storyScroll) {
      const checkEnd = () => {
        const atEnd = storyScroll.scrollTop + storyScroll.clientHeight
                      >= storyScroll.scrollHeight - 4;   // 容差 4px
        storyScroll.classList.toggle('at-end', atEnd);
      };
      storyScroll.addEventListener('scroll', checkEnd);
      checkEnd(); // 內容若不需捲動也即時判斷
    }

    // ─────────────────────────────────────────────
    // Debug 面板（按 D 切換）
    // ─────────────────────────────────────────────
    const debugPanel = document.getElementById('debug-panel');
    let debugVisible = false;

    document.addEventListener('keydown', (e) => {
      if (e.key === 'd' || e.key === 'D') {
        debugVisible = !debugVisible;
        debugPanel.classList.toggle('visible', debugVisible);
      }
    });

    // 每幀更新 debug 數值
    function updateDebug() {
      const fp = window.faceParams;
      if (!fp || !debugVisible) {
        requestAnimationFrame(updateDebug);
        return;
      }

      const set = (key, val, max) => {
        const v = Math.min(1, Math.max(0, val / (max || 1)));
        const el = document.getElementById('d-' + key.toLowerCase());
        const bar = document.getElementById('db-' + key.toLowerCase());
        if (el)  el.textContent  = val.toFixed(2);
        if (bar) bar.style.width = (v * 100) + '%';
      };

      set('mar',   fp.MAR,               1);
      set('ear',   fp.EAR,               0.5);
      set('yaw',   Math.abs(fp.YAW),     1);
      set('pitch', Math.abs(fp.PITCH),   1);

      requestAnimationFrame(updateDebug);
    }
    updateDebug();

  });

})();
