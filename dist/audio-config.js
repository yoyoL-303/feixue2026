/*
 * 游戏音频统一配置
 * ------------------------------------------------------------
 * 全部声音由 Web Audio API 实时合成，不依赖任何外部音频文件。
 * 音量 = 用户分类音量 × 单条音效 volume 倍率。
 * 支持关闭总声音、独立关闭音乐/音效，并自动保存设置。
 */
window.AUDIO_CONFIG = {
  version: 2,
  storageKey: "dilina-audio-settings-v2",
  maxVolume: 100,

  defaults: {
    masterEnabled: true,
    musicEnabled: true,
    sfxEnabled: true,
    musicVolume: 40,
    sfxVolume: 70
  },

  music: {
    game: {
      type: "game",
      tempo: 84,
      volume: 0.55,
      loop: true,
      enabled: true
    },
    victory: {
      type: "victory",
      tempo: 112,
      volume: 0.7,
      loop: false,
      enabled: true
    },
    gameover: {
      type: "gameover",
      tempo: 72,
      volume: 0.65,
      loop: false,
      enabled: true
    }
  },

  sfx: {
    drawLine: {
      type: "drawLine",
      volume: 0.55,
      minGapMs: 90,
      enabled: true
    },
    collision: {
      type: "collision",
      volume: 0.85,
      minGapMs: 42,
      enabled: true
    },
    uiClick: {
      type: "uiClick",
      volume: 0.7,
      minGapMs: 55,
      enabled: true
    },
    uiVictory: {
      type: "uiVictory",
      volume: 0.9,
      minGapMs: 300,
      enabled: true
    },
    uiDefeat: {
      type: "uiDefeat",
      volume: 0.9,
      minGapMs: 300,
      enabled: true
    },
    enemyKnockback: {
      type: "enemyKnockback",
      volume: 0.8,
      minGapMs: 38,
      enabled: true
    },
    barrierCrack: {
      type: "barrierCrack",
      volume: 0.8,
      minGapMs: 45,
      enabled: true
    },
    barrierBreak: {
      type: "barrierBreak",
      volume: 0.95,
      minGapMs: 500,
      enabled: true
    },
    linaHurt: {
      type: "linaHurt",
      volume: 0.9,
      minGapMs: 120,
      enabled: true
    }
  }
};
