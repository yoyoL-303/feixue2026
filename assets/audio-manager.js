/*
 * GameAudioManager
 * ------------------------------------------------------------
 * 独立的背景音乐 / 音效管理器，不依赖游戏状态或 Canvas。
 * - 音乐：三条独立 Audio，同一时间只播放一条。
 * - 音效：每个资源一个预创建实例池，避免高频创建对象。
 * - 音量：用户分类音量 × 单个资源相对音量。
 * - 容错：缺文件、解码失败、自动播放拒绝都不会抛出到游戏。
 */
(function (global) {
  "use strict";

  class GameAudioManager {
    constructor(config) {
      this.config = config || {};
      this.basePath = String(this.config.basePath || "assets/audio/");
      if (!this.basePath.endsWith("/")) this.basePath += "/";
      this.storageKey = this.config.storageKey || "dilina-audio-settings-v1";
      this.maxVolume = Number.isFinite(this.config.maxVolume) ? this.config.maxVolume : 100;
      this.defaults = Object.assign({
        musicEnabled: true,
        sfxEnabled: true,
        musicVolume: 40,
        sfxVolume: 70
      }, this.config.defaults || {});

      this.settings = this._loadSettings();
      this.musicEnabled = this.settings.musicEnabled;
      this.sfxEnabled = this.settings.sfxEnabled;
      this.musicVolume = this.settings.musicVolume;
      this.sfxVolume = this.settings.sfxVolume;

      this._initialized = false;
      this._available = true;
      this._autoplayBlocked = false;
      this._currentMusic = null;
      this._musicPausedByGame = false;
      this._music = new Map();
      this._sfx = new Map();
      this._lastSfxAt = Object.create(null);
    }

    _now() {
      return global.performance && typeof global.performance.now === "function"
        ? global.performance.now()
        : Date.now();
    }

    _resolve(src) {
      if (!src) return "";
      if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(src)) return src;
      if (/^(?:data:|blob:|file:|\/)/i.test(src)) return src;
      if (/^[A-Za-z]:[\\/]/.test(src)) return src;
      return this.basePath + src.replace(/^\.\//, "");
    }

    _clampVolume(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.min(this.maxVolume, n));
    }

    _loadSettings() {
      const fallback = {
        musicEnabled: !!this.defaults.musicEnabled,
        sfxEnabled: !!this.defaults.sfxEnabled,
        musicVolume: this._clampVolume(this.defaults.musicVolume),
        sfxVolume: this._clampVolume(this.defaults.sfxVolume)
      };
      try {
        const raw = global.localStorage && global.localStorage.getItem(this.storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          return {
            musicEnabled: parsed.musicEnabled !== false,
            sfxEnabled: parsed.sfxEnabled !== false,
            musicVolume: this._clampVolume(parsed.musicVolume != null ? parsed.musicVolume : fallback.musicVolume),
            sfxVolume: this._clampVolume(parsed.sfxVolume != null ? parsed.sfxVolume : fallback.sfxVolume)
          };
        }
        // 旧版只有一个总静音开关，首次升级时迁移为分类关闭，避免突然出声。
        if (global.localStorage && global.localStorage.getItem("dilina-muted") === "1") {
          return { musicEnabled: false, sfxEnabled: false, musicVolume: fallback.musicVolume, sfxVolume: fallback.sfxVolume };
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

    _applyMusicVolume(record) {
      if (!record || !record.element) return;
      const relative = record.asset.volume != null ? record.asset.volume : 1;
      record.element.volume = Math.max(0, Math.min(1, (this.musicVolume / 100) * relative));
    }

    _applySfxVolume(record) {
      if (!record) return;
      const relative = record.asset.volume != null ? record.asset.volume : 1;
      const volume = Math.max(0, Math.min(1, (this.sfxVolume / 100) * relative));
      record.pool.forEach((el) => { el.volume = volume; });
    }

    _makeElement(src, loop) {
      const el = new global.Audio();
      el.preload = "auto";
      el.loop = !!loop;
      el.volume = 0;
      el.src = this._resolve(src);
      return el;
    }

    initAudio() {
      if (this._initialized) return this._available;
      this._initialized = true;
      if (!global.Audio) {
        this._available = false;
        return false;
      }

      const music = this.config.music || {};
      Object.keys(music).forEach((name) => {
        const asset = music[name];
        if (!asset || !asset.src) return;
        const record = {
          asset,
          element: null,
          failed: false
        };
        try {
          record.element = this._makeElement(asset.src, asset.loop);
          record.element.addEventListener("error", () => { record.failed = true; });
          record.element.addEventListener("playing", () => { this._autoplayBlocked = false; });
          this._applyMusicVolume(record);
        } catch (err) {
          record.failed = true;
        }
        this._music.set(name, record);
      });

      const sfx = this.config.sfx || {};
      Object.keys(sfx).forEach((name) => {
        const asset = sfx[name];
        if (!asset || !asset.src) return;
        const size = Math.max(1, Math.min(6, Number(asset.poolSize) || 2));
        const record = {
          asset,
          pool: [],
          failed: false
        };
        for (let i = 0; i < size; i++) {
          try {
            const el = this._makeElement(asset.src, false);
            el.addEventListener("error", () => { record.failed = true; });
            record.pool.push(el);
          } catch (err) {
            record.failed = true;
          }
        }
        this._applySfxVolume(record);
        this._sfx.set(name, record);
      });

      return true;
    }

    _pauseAllMusic() {
      this._music.forEach((record) => {
        if (record.element && !record.element.paused) {
          try { record.element.pause(); } catch (err) { /* ignore */ }
        }
      });
    }

    _playCurrentMusic() {
      if (!this.musicEnabled || this._musicPausedByGame) return false;
      const name = this._currentMusic;
      const record = name ? this._music.get(name) : null;
      if (!record || !record.element || record.failed) return false;
      this._applyMusicVolume(record);
      if (record.element.ended) {
        try { record.element.currentTime = 0; } catch (err) { /* ignore */ }
      }
      try {
        const promise = record.element.play();
        if (promise && typeof promise.catch === "function") {
          promise.catch(() => { this._autoplayBlocked = true; });
        }
        return true;
      } catch (err) {
        this._autoplayBlocked = true;
        return false;
      }
    }

    playMusic(name) {
      this.initAudio();
      const record = this._music.get(name);
      if (!record || !record.element || record.failed || record.asset.enabled === false) return false;

      const changed = this._currentMusic !== name;
      this._currentMusic = name;
      if (changed) {
        this._music.forEach((other, otherName) => {
          if (!other.element) return;
          if (otherName !== name) {
            try {
              if (!other.element.paused) other.element.pause();
              other.element.currentTime = 0;
            } catch (err) { /* ignore */ }
          }
        });
        try { record.element.currentTime = 0; } catch (err) { /* ignore */ }
      }

      if (!this.musicEnabled || this._musicPausedByGame) {
        this._pauseAllMusic();
        return false;
      }
      // 同一首游戏音乐在 PLAYING/结算/强化/下一关之间不重置 currentTime。
      return this._playCurrentMusic();
    }

    stopMusic() {
      this._pauseAllMusic();
      this._music.forEach((record) => {
        try { if (record.element) record.element.currentTime = 0; } catch (err) { /* ignore */ }
      });
      this._currentMusic = null;
      this._musicPausedByGame = false;
    }

    pauseMusic() {
      this._musicPausedByGame = true;
      this._pauseAllMusic();
    }

    resumeMusic() {
      this._musicPausedByGame = false;
      this._playCurrentMusic();
    }

    setMusicEnabled(enabled) {
      this.musicEnabled = !!enabled;
      this.settings.musicEnabled = this.musicEnabled;
      this._saveSettings();
      if (!this.musicEnabled) {
        this._pauseAllMusic();
      } else if (!this._musicPausedByGame) {
        this._playCurrentMusic();
      }
      return this.musicEnabled;
    }

    setSfxEnabled(enabled) {
      this.sfxEnabled = !!enabled;
      this.settings.sfxEnabled = this.sfxEnabled;
      this._saveSettings();
      if (!this.sfxEnabled) this._stopAllSfx();
      return this.sfxEnabled;
    }

    setMusicVolume(value) {
      this.musicVolume = this._clampVolume(value);
      this.settings.musicVolume = this.musicVolume;
      this._saveSettings();
      this._music.forEach((record) => this._applyMusicVolume(record));
      return this.musicVolume;
    }

    setSfxVolume(value) {
      this.sfxVolume = this._clampVolume(value);
      this.settings.sfxVolume = this.sfxVolume;
      this._saveSettings();
      this._sfx.forEach((record) => this._applySfxVolume(record));
      return this.sfxVolume;
    }

    _stopAllSfx() {
      this._sfx.forEach((record) => {
        record.pool.forEach((el) => {
          try {
            if (!el.paused) el.pause();
            el.currentTime = 0;
          } catch (err) { /* ignore */ }
        });
      });
    }

    playSfx(name) {
      this.initAudio();
      if (!this.sfxEnabled) return false;
      const record = this._sfx.get(name);
      if (!record || record.failed || record.asset.enabled === false) return false;

      const now = this._now();
      const gap = Number(record.asset.minGapMs) || 0;
      if (now - (this._lastSfxAt[name] || 0) < gap) return false;

      const element = record.pool.find((el) => el.paused || el.ended);
      if (!element) return false;

      this._lastSfxAt[name] = now;
      this._applySfxVolume(record);
      try {
        element.currentTime = 0;
        const promise = element.play();
        if (promise && typeof promise.catch === "function") {
          promise.catch(() => { this._autoplayBlocked = true; });
        }
        return true;
      } catch (err) {
        this._autoplayBlocked = true;
        return false;
      }
    }

    stopAllAudio() {
      this.stopMusic();
      this._stopAllSfx();
      this._lastSfxAt = Object.create(null);
    }

    handleUserGesture() {
      this.initAudio();
      if (this._autoplayBlocked && this.musicEnabled && !this._musicPausedByGame) {
        this._playCurrentMusic();
      }
    }

    getSettings() {
      return {
        musicEnabled: this.musicEnabled,
        sfxEnabled: this.sfxEnabled,
        musicVolume: this.musicVolume,
        sfxVolume: this.sfxVolume
      };
    }

    getState() {
      const current = this._currentMusic ? this._music.get(this._currentMusic) : null;
      return {
        initialized: this._initialized,
        available: this._available,
        autoplayBlocked: this._autoplayBlocked,
        currentMusic: this._currentMusic,
        musicPausedByGame: this._musicPausedByGame,
        music: current && current.element ? {
          paused: current.element.paused,
          ended: current.element.ended,
          currentTime: current.element.currentTime,
          duration: Number.isFinite(current.element.duration) ? current.element.duration : null,
          volume: current.element.volume,
          loop: current.element.loop,
          readyState: current.element.readyState,
          failed: current.failed
        } : null,
        settings: this.getSettings()
      };
    }
  }

  global.GameAudioManager = GameAudioManager;
})(window);
