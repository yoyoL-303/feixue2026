/*
 * GameAudioManager
 * ------------------------------------------------------------
 * 独立的 Web Audio 合成音频管理器，不依赖游戏状态或 Canvas。
 * - 不加载任何音频文件，音效与背景音乐全部由振荡器/噪声实时合成。
 * - AudioContext 只在用户首次点击、触摸或按键后创建，兼容移动端自动播放限制。
 * - 不支持 Web Audio API 时静默降级，游戏继续运行。
 * - 支持总静音、音乐/音效分类开关、分类音量与 localStorage 恢复。
 */
(function (global) {
  "use strict";

  var MUSIC_PATTERNS = {
    game: {
      wave: "triangle",
      notes: [
        261.63, 0, 329.63, 392.00, 0, 329.63, 261.63, 0,
        220.00, 0, 261.63, 329.63, 0, 392.00, 329.63, 0
      ],
      bass: [130.81, 110.00, 98.00, 87.31]
    },
    victory: {
      wave: "triangle",
      notes: [523.25, 659.25, 783.99, 1046.50, 0, 783.99, 1046.50, 0],
      bass: []
    },
    gameover: {
      wave: "sine",
      notes: [392.00, 349.23, 329.63, 293.66, 261.63, 0, 196.00, 0],
      bass: []
    }
  };

  class GameAudioManager {
    constructor(config) {
      this.config = config || {};
      this.storageKey = this.config.storageKey || "dilina-audio-settings-v2";
      this.maxVolume = Number.isFinite(this.config.maxVolume) ? this.config.maxVolume : 100;
      this.defaults = Object.assign({
        masterEnabled: true,
        musicEnabled: true,
        sfxEnabled: true,
        musicVolume: 40,
        sfxVolume: 70
      }, this.config.defaults || {});

      this.settings = this._loadSettings();
      this.masterEnabled = this.settings.masterEnabled;
      this.musicEnabled = this.settings.musicEnabled;
      this.sfxEnabled = this.settings.sfxEnabled;
      this.musicVolume = this.settings.musicVolume;
      this.sfxVolume = this.settings.sfxVolume;

      this._initialized = false;
      this._available = true;
      this._autoplayBlocked = false;
      this._ctx = null;
      this._masterGain = null;
      this._musicGain = null;
      this._sfxGain = null;
      this._noiseBuffer = null;
      this._currentMusic = null;
      this._musicPausedByGame = false;
      this._musicTimer = null;
      this._musicStep = 0;
      this._nextNoteTime = 0;
      this._musicSources = new Set();
      this._sfxSources = new Set();
      this._lastSfxAt = Object.create(null);
      this._unlockInstalled = false;

      this._installUnlockListeners();
    }

    _now() {
      return global.performance && typeof global.performance.now === "function"
        ? global.performance.now()
        : Date.now();
    }

    _clampVolume(value) {
      var n = Number(value);
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.min(this.maxVolume, n));
    }

    _loadSettings() {
      var fallback = {
        masterEnabled: this.defaults.masterEnabled !== false,
        musicEnabled: !!this.defaults.musicEnabled,
        sfxEnabled: !!this.defaults.sfxEnabled,
        musicVolume: this._clampVolume(this.defaults.musicVolume),
        sfxVolume: this._clampVolume(this.defaults.sfxVolume)
      };
      try {
        var raw = global.localStorage && global.localStorage.getItem(this.storageKey);
        if (raw) {
          var parsed = JSON.parse(raw);
          return {
            masterEnabled: parsed.masterEnabled !== false,
            musicEnabled: parsed.musicEnabled !== false,
            sfxEnabled: parsed.sfxEnabled !== false,
            musicVolume: this._clampVolume(parsed.musicVolume != null ? parsed.musicVolume : fallback.musicVolume),
            sfxVolume: this._clampVolume(parsed.sfxVolume != null ? parsed.sfxVolume : fallback.sfxVolume)
          };
        }
        if (global.localStorage && global.localStorage.getItem("dilina-muted") === "1") {
          fallback.masterEnabled = false;
        }
      } catch (err) {
        // localStorage 不可用时使用默认设置。
      }
      return fallback;
    }

    _saveSettings() {
      try {
        if (global.localStorage) {
          global.localStorage.setItem(this.storageKey, JSON.stringify({
            masterEnabled: this.masterEnabled,
            musicEnabled: this.musicEnabled,
            sfxEnabled: this.sfxEnabled,
            musicVolume: this.musicVolume,
            sfxVolume: this.sfxVolume
          }));
        }
      } catch (err) {
        // 忽略隐私模式或存储配额限制。
      }
    }

    _installUnlockListeners() {
      if (this._unlockInstalled) return;
      this._unlockInstalled = true;
      var manager = this;
      var unlocked = false;
      function unlock() {
        if (unlocked) return;
        unlocked = true;
        manager.handleUserGesture();
      }
      try {
        global.addEventListener("pointerdown", unlock, { once: true, passive: true, capture: true });
        global.addEventListener("touchstart", unlock, { once: true, passive: true, capture: true });
        global.addEventListener("click", unlock, { once: true, capture: true });
        global.addEventListener("keydown", unlock, { once: true, capture: true });
      } catch (err) {
        // 极端环境不支持事件监听时，游戏仍可正常运行。
      }
    }

    _setGain(param, value, now) {
      if (!param) return;
      try {
        param.cancelScheduledValues(now);
        param.setValueAtTime(param.value, now);
        param.linearRampToValueAtTime(value, now + 0.03);
      } catch (err) {
        try { param.value = value; } catch (ignore) { /* ignore */ }
      }
    }

    _applyGains() {
      if (!this._ctx) return;
      var now = this._ctx.currentTime;
      this._setGain(this._masterGain, this.masterEnabled ? 1 : 0, now);
      this._setGain(
        this._musicGain,
        this.masterEnabled && this.musicEnabled ? this.musicVolume / 100 : 0,
        now
      );
      this._setGain(
        this._sfxGain,
        this.masterEnabled && this.sfxEnabled ? this.sfxVolume / 100 : 0,
        now
      );
    }

    _resumeContext() {
      if (!this._ctx) return;
      var ctx = this._ctx;
      if (ctx.state === "suspended" && typeof ctx.resume === "function") {
        try {
          var promise = ctx.resume();
          if (promise && typeof promise.catch === "function") {
            promise.catch(function () { /* 保留静默降级 */ });
          }
        } catch (err) {
          // 某些 WebView 在非手势路径会拒绝 resume。
        }
      }
      this._autoplayBlocked = ctx.state !== "running";
    }

    initAudio() {
      if (this._initialized) {
        this._resumeContext();
        return this._available;
      }
      this._initialized = true;

      var AudioContextClass = global.AudioContext || global.webkitAudioContext;
      if (!AudioContextClass) {
        this._available = false;
        return false;
      }

      try {
        var ctx = new AudioContextClass();
        var master = ctx.createGain();
        var music = ctx.createGain();
        var sfx = ctx.createGain();
        master.gain.value = 0;
        music.gain.value = 0;
        sfx.gain.value = 0;
        music.connect(master);
        sfx.connect(master);
        master.connect(ctx.destination);

        this._ctx = ctx;
        this._masterGain = master;
        this._musicGain = music;
        this._sfxGain = sfx;
        this._available = true;
        this._autoplayBlocked = ctx.state !== "running";
        this._applyGains();

        var manager = this;
        ctx.onstatechange = function () {
          manager._autoplayBlocked = ctx.state !== "running";
          if (ctx.state === "running") manager._resumeMusicAfterUnlock();
        };

        this._resumeContext();
        return true;
      } catch (err) {
        this._available = false;
        this._ctx = null;
        this._masterGain = null;
        this._musicGain = null;
        this._sfxGain = null;
        return false;
      }
    }

    _resumeMusicAfterUnlock() {
      if (this._currentMusic && this._canPlayMusic()) this._ensureMusicScheduler();
    }

    _canPlayMusic() {
      if (!this._available || !this._ctx || !this.masterEnabled || !this.musicEnabled || this._musicPausedByGame) {
        return false;
      }
      var record = this._currentMusic && this.config.music ? this.config.music[this._currentMusic] : null;
      return !!record && record.enabled !== false;
    }

    _musicPattern(record) {
      var type = record && record.type ? record.type : "game";
      return MUSIC_PATTERNS[type] || MUSIC_PATTERNS.game;
    }

    _musicStepDuration(record) {
      var tempo = Number(record && record.tempo) || 84;
      return 60 / Math.max(40, tempo) / 2;
    }

    _ensureMusicScheduler() {
      if (!this._canPlayMusic() || this._musicTimer) return;
      var ctx = this._ctx;
      var manager = this;
      this._musicStep = 0;
      this._nextNoteTime = ctx.currentTime + 0.06;
      this._musicTimer = global.setInterval(function () { manager._musicTick(); }, 60);
      this._musicTick();
    }

    _musicTick() {
      if (!this._canPlayMusic()) {
        this._stopMusicScheduler(true);
        return;
      }
      var ctx = this._ctx;
      var record = this.config.music[this._currentMusic];
      var pattern = this._musicPattern(record);
      var stepDuration = this._musicStepDuration(record);
      var horizon = ctx.currentTime + 0.18;
      var guard = 0;

      while (this._nextNoteTime < horizon && guard < 8) {
        this._scheduleMusicStep(record, pattern, this._musicStep, this._nextNoteTime, stepDuration);
        this._nextNoteTime += stepDuration;
        this._musicStep++;
        guard++;
        if (this._musicStep >= pattern.notes.length) {
          this._musicStep = 0;
          if (record.loop === false) {
            this._stopMusicScheduler(false);
            return;
          }
        }
      }
    }

    _scheduleMusicStep(record, pattern, step, when, stepDuration) {
      var note = pattern.notes[step % pattern.notes.length];
      var relative = record.volume != null ? record.volume : 0.55;
      if (note) {
        this._tone(
          note,
          stepDuration * 0.88,
          pattern.wave || "triangle",
          0.18 * relative,
          when,
          0,
          this._musicGain,
          this._musicSources
        );
      }
      if (pattern.bass && pattern.bass.length && step % 4 === 0) {
        var bass = pattern.bass[Math.floor(step / 4) % pattern.bass.length];
        this._tone(
          bass,
          stepDuration * 2.8,
          "sine",
          0.12 * relative,
          when,
          0,
          this._musicGain,
          this._musicSources
        );
      }
    }

    _stopMusicScheduler(stopSources) {
      if (this._musicTimer) {
        global.clearInterval(this._musicTimer);
        this._musicTimer = null;
      }
      if (stopSources) {
        this._musicSources.forEach(function (node) {
          try { node.stop(); } catch (err) { /* already stopped */ }
        });
        this._musicSources.clear();
      }
    }

    _getNoiseBuffer() {
      if (this._noiseBuffer || !this._ctx) return this._noiseBuffer;
      var ctx = this._ctx;
      var length = Math.max(1, Math.floor(ctx.sampleRate * 0.5));
      var buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this._noiseBuffer = buffer;
      return buffer;
    }

    _trackSource(node, set) {
      var manager = this;
      set.add(node);
      node.onended = function () { set.delete(node); };
      return node;
    }

    _tone(frequency, duration, type, volume, when, slideTo, destination, set) {
      destination = destination || this._sfxGain;
      set = set || this._sfxSources;
      if (!this._ctx || !destination) return;
      var ctx = this._ctx;
      var start = Math.max(ctx.currentTime + 0.002, Number(when) || ctx.currentTime);
      var end = start + Math.max(0.02, duration);
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(Math.max(20, frequency), start);
      if (slideTo) {
        try {
          osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), end);
        } catch (err) {
          // 某些实现不接受指数滑音，保留固定频率。
        }
      }
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + Math.min(0.025, duration * 0.25));
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain);
      gain.connect(destination);
      this._trackSource(osc, set || this._sfxSources);
      try {
        osc.start(start);
        osc.stop(end + 0.03);
      } catch (err) {
        set.delete(osc);
      }
    }

    _noise(duration, volume, filterType, frequency, q, when) {
      if (!this._ctx || !this._sfxGain) return;
      var ctx = this._ctx;
      var start = Math.max(ctx.currentTime + 0.002, Number(when) || ctx.currentTime);
      var end = start + Math.max(0.02, duration);
      var source = ctx.createBufferSource();
      source.buffer = this._getNoiseBuffer();
      source.loop = true;
      var filter = ctx.createBiquadFilter();
      filter.type = filterType || "bandpass";
      filter.frequency.setValueAtTime(Math.max(40, frequency || 1200), start);
      filter.Q.value = Number(q) || 0.8;
      var gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this._sfxGain);
      this._trackSource(source, this._sfxSources);
      try {
        source.start(start);
        source.stop(end + 0.02);
      } catch (err) {
        this._sfxSources.delete(source);
      }
    }

    _playSynth(record, when) {
      var v = record.volume != null ? record.volume : 0.8;
      var t = when;
      switch (record.type) {
        case "drawLine":
          this._noise(0.075, 0.045 * v, "bandpass", 1900, 1.1, t);
          this._tone(880, 0.045, "sine", 0.02 * v, t, 620, this._sfxGain, this._sfxSources);
          break;
        case "collision":
          this._tone(175, 0.12, "triangle", 0.2 * v, t, 68, this._sfxGain, this._sfxSources);
          this._noise(0.055, 0.07 * v, "lowpass", 320, 0.7, t);
          break;
        case "barrierCrack":
          this._noise(0.11, 0.1 * v, "bandpass", 2600, 1.8, t);
          this._tone(1500, 0.035, "triangle", 0.045 * v, t, 2100, this._sfxGain, this._sfxSources);
          break;
        case "barrierBreak":
          this._noise(0.34, 0.18 * v, "highpass", 900, 0.8, t);
          this._tone(1800, 0.18, "triangle", 0.07 * v, t + 0.01, 2600, this._sfxGain, this._sfxSources);
          this._tone(2400, 0.16, "triangle", 0.06 * v, t + 0.045, 3300, this._sfxGain, this._sfxSources);
          this._tone(3000, 0.14, "sine", 0.045 * v, t + 0.08, 3900, this._sfxGain, this._sfxSources);
          this._tone(110, 0.2, "triangle", 0.13 * v, t, 55, this._sfxGain, this._sfxSources);
          break;
        case "uiVictory":
          this._tone(523.25, 0.13, "triangle", 0.14 * v, t);
          this._tone(659.25, 0.13, "triangle", 0.14 * v, t + 0.1);
          this._tone(783.99, 0.15, "triangle", 0.15 * v, t + 0.2);
          this._tone(1046.5, 0.28, "sine", 0.1 * v, t + 0.3);
          break;
        case "uiDefeat":
          this._tone(392, 0.2, "sine", 0.14 * v, t);
          this._tone(329.63, 0.22, "sine", 0.13 * v, t + 0.14);
          this._tone(261.63, 0.34, "triangle", 0.13 * v, t + 0.3, 196);
          break;
        case "uiClick":
          this._tone(1050, 0.035, "square", 0.035 * v, t);
          this._noise(0.018, 0.02 * v, "highpass", 2200, 0.8, t);
          break;
        case "enemyKnockback":
          this._noise(0.13, 0.07 * v, "bandpass", 900, 1.1, t);
          this._tone(300, 0.13, "triangle", 0.12 * v, t, 90);
          break;
        case "linaHurt":
          this._tone(420, 0.28, "sawtooth", 0.11 * v, t, 150);
          this._noise(0.16, 0.06 * v, "lowpass", 520, 0.7, t);
          break;
        default:
          this._tone(440, 0.08, "sine", 0.05 * v, t);
      }
    }

    playMusic(name) {
      this.initAudio();
      var record = this.config.music && this.config.music[name];
      if (!record || record.enabled === false) return false;

      var changed = this._currentMusic !== name;
      this._currentMusic = name;
      if (changed) {
        this._stopMusicScheduler(true);
        this._musicStep = 0;
      }
      if (!this._canPlayMusic()) {
        this._stopMusicScheduler(true);
        return false;
      }
      this._ensureMusicScheduler();
      return true;
    }

    stopMusic() {
      this._stopMusicScheduler(true);
      this._currentMusic = null;
      this._musicPausedByGame = false;
    }

    pauseMusic() {
      this._musicPausedByGame = true;
      this._stopMusicScheduler(true);
    }

    resumeMusic() {
      this._musicPausedByGame = false;
      if (this._currentMusic && this._canPlayMusic()) this._ensureMusicScheduler();
    }

    setMasterEnabled(enabled) {
      this.masterEnabled = !!enabled;
      this.settings.masterEnabled = this.masterEnabled;
      this._saveSettings();
      this._applyGains();
      if (!this.masterEnabled) {
        this._stopMusicScheduler(true);
        this._stopAllSfx();
      } else if (this._currentMusic && this._canPlayMusic()) {
        this._ensureMusicScheduler();
      }
      return this.masterEnabled;
    }

    setMusicEnabled(enabled) {
      this.musicEnabled = !!enabled;
      this.settings.musicEnabled = this.musicEnabled;
      this._saveSettings();
      this._applyGains();
      if (!this.musicEnabled) {
        this._stopMusicScheduler(true);
      } else if (!this._musicPausedByGame && this._currentMusic) {
        this._ensureMusicScheduler();
      }
      return this.musicEnabled;
    }

    setSfxEnabled(enabled) {
      this.sfxEnabled = !!enabled;
      this.settings.sfxEnabled = this.sfxEnabled;
      this._saveSettings();
      this._applyGains();
      if (!this.sfxEnabled) this._stopAllSfx();
      return this.sfxEnabled;
    }

    setMusicVolume(value) {
      this.musicVolume = this._clampVolume(value);
      this.settings.musicVolume = this.musicVolume;
      this._saveSettings();
      this._applyGains();
      return this.musicVolume;
    }

    setSfxVolume(value) {
      this.sfxVolume = this._clampVolume(value);
      this.settings.sfxVolume = this.sfxVolume;
      this._saveSettings();
      this._applyGains();
      return this.sfxVolume;
    }

    _stopAllSfx() {
      this._sfxSources.forEach(function (node) {
        try { node.stop(); } catch (err) { /* already stopped */ }
      });
      this._sfxSources.clear();
    }

    playSfx(name) {
      this.initAudio();
      if (!this._available || !this._ctx || !this.masterEnabled || !this.sfxEnabled) return false;
      var record = this.config.sfx && this.config.sfx[name];
      if (!record || record.enabled === false) return false;
      var now = this._now();
      var gap = Number(record.minGapMs) || 0;
      if (now - (this._lastSfxAt[name] || 0) < gap) return false;
      this._lastSfxAt[name] = now;
      this._resumeContext();
      this._playSynth(record, this._ctx.currentTime + 0.006);
      return true;
    }

    stopAllAudio() {
      this.stopMusic();
      this._stopAllSfx();
      this._lastSfxAt = Object.create(null);
    }

    handleUserGesture() {
      this.initAudio();
      this._resumeContext();
      if (this._currentMusic && this._canPlayMusic()) this._ensureMusicScheduler();
    }

    getSettings() {
      return {
        masterEnabled: this.masterEnabled,
        musicEnabled: this.musicEnabled,
        sfxEnabled: this.sfxEnabled,
        musicVolume: this.musicVolume,
        sfxVolume: this.sfxVolume
      };
    }

    getState() {
      var current = this._currentMusic && this.config.music
        ? this.config.music[this._currentMusic]
        : null;
      return {
        initialized: this._initialized,
        available: this._available,
        autoplayBlocked: this._autoplayBlocked,
        contextState: this._ctx ? this._ctx.state : null,
        sampleRate: this._ctx ? this._ctx.sampleRate : null,
        currentMusic: this._currentMusic,
        musicPausedByGame: this._musicPausedByGame,
        music: current ? {
          type: current.type,
          running: !!this._musicTimer,
          loop: current.loop !== false,
          tempo: current.tempo || 84
        } : null,
        activeMusicVoices: this._musicSources.size,
        activeSfxVoices: this._sfxSources.size,
        settings: this.getSettings()
      };
    }
  }

  global.GameAudioManager = GameAudioManager;
})(window);
