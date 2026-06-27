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
        // 啟動臉部追蹤（鏡頭）；失敗會自動切到滑鼠模擬模式
        if (window.startFaceTracking) window.startFaceTracking();
        // 解鎖音訊（部分瀏覽器需手勢後 resume）
        if (window.Howler && Howler.ctx && Howler.ctx.state === 'suspended') {
          Howler.ctx.resume();
        }
        // 淡出入口層，動畫結束後移除以免擋互動
        enterScreen.classList.add('hidden');
        setTimeout(() => enterScreen.remove(), 1200);
      };
      enterBtn.addEventListener('click', enter);
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
