/**
 * audio.js
 * Howler.js 音訊設定
 *
 * 使用方式：把你的音樂放在 assets/audio/bubble-pop.mp3
 * audioSystem.playPop() → 播放前 15 秒
 *
 * 對外 API（window.audioSystem）：
 *  .playPop()     播放泡泡音效（點破觸發）
 *  .setTrack(url) 執行期間換音軌
 */

(function () {

  // ── 設定你的音訊路徑（把 mp3/ogg 放在 assets/audio/）
  const AUDIO_SRC  = 'assets/audio/bubble-pop.mp3';
  const CLIP_START = 0;      // 秒，從哪裡開始播
  const CLIP_END   = 15000;  // ms，播到哪裡停（15秒）

  let sound = null;
  let isPlaying = false;

  function loadSound(src) {
    if (sound) { sound.unload(); }

    sound = new Howl({
      src: [src],
      html5: true,         // 串流播放，大檔案不需要全部載入
      volume: 0.75,
      onloaderror: () => {
        console.warn('[audio] 找不到音訊檔：', src);
        console.info('[audio] 請把音訊放在 assets/audio/bubble-pop.mp3');
      },
      onend: () => {
        isPlaying = false;
      },
    });
  }

  // 初始化載入
  loadSound(AUDIO_SRC);

  window.audioSystem = {

    playPop() {
      if (!sound) return;

      // 如果正在播放，先停止再重播（允許重疊也可以移除這段）
      if (isPlaying) {
        sound.stop();
      }

      isPlaying = true;

      // 從 CLIP_START 秒播到 CLIP_END ms
      const id = sound.play();
      sound.seek(CLIP_START, id);

      // 到達結束點時停止
      setTimeout(() => {
        if (isPlaying) {
          sound.stop(id);
          isPlaying = false;
        }
      }, CLIP_END - CLIP_START * 1000);
    },

    // 執行期間換音軌（可以從 UI 呼叫）
    setTrack(url) {
      loadSound(url);
    },

    get isPlaying() { return isPlaying; },
  };

})();
