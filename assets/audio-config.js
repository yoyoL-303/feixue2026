/*
 * 游戏音频统一配置
 * ------------------------------------------------------------
 * 所有音乐/音效路径、默认音量、分类开关、单个资源音量倍率都集中在这里。
 * 最终音量 = 用户分类音量（0~1） × 资源 volume 倍率。
 *
 * 替换音频：
 *   1. 直接覆盖 assets/audio/ 下的同名 .wav 文件；或
 *   2. 修改下面对应资源条目的 src（支持 mp3/ogg/wav 等浏览器可播放格式）。
 * 不需要改任何游戏逻辑。
 */
window.AUDIO_CONFIG = {
  version: 1,
  basePath: "assets/audio/",
  storageKey: "dilina-audio-settings-v1",
  maxVolume: 100,

  defaults: {
    musicEnabled: true,
    sfxEnabled: true,
    musicVolume: 40,
    sfxVolume: 70
  },

  music: {
    game: {
      src: "music/bgm_game.wav",
      volume: 0.65,
      loop: true,
      enabled: true
    },
    victory: {
      src: "music/bgm_victory.wav",
      volume: 0.85,
      loop: false,
      enabled: true
    },
    gameover: {
      src: "music/bgm_gameover.wav",
      volume: 0.8,
      loop: false,
      enabled: true
    }
  },

  sfx: {
    uiClick: {
      src: "ui/ui_click.wav",
      volume: 0.75,
      loop: false,
      enabled: true,
      minGapMs: 55,
      poolSize: 2
    },
    uiVictory: {
      src: "ui/ui_victory.wav",
      volume: 0.9,
      loop: false,
      enabled: true,
      minGapMs: 300,
      poolSize: 1
    },
    uiDefeat: {
      src: "ui/ui_defeat.wav",
      volume: 0.9,
      loop: false,
      enabled: true,
      minGapMs: 300,
      poolSize: 1
    },
    enemyKnockback: {
      src: "combat/enemy_knockback.wav",
      volume: 0.8,
      loop: false,
      enabled: true,
      minGapMs: 38,
      poolSize: 3
    },
    barrierCrack: {
      src: "combat/barrier_crack.wav",
      volume: 0.85,
      loop: false,
      enabled: true,
      minGapMs: 45,
      poolSize: 2
    },
    barrierBreak: {
      src: "combat/barrier_break.wav",
      volume: 0.95,
      loop: false,
      enabled: true,
      minGapMs: 500,
      poolSize: 1
    },
    linaHurt: {
      src: "combat/lina_hurt.wav",
      volume: 0.9,
      loop: false,
      enabled: true,
      minGapMs: 120,
      poolSize: 2
    }
  }
};
