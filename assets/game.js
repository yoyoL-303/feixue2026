(() => {
  'use strict';

  // Chrome 61 基线：Chrome 86 才加入的 replaceChildren 用小型本地兼容实现。
  if (typeof Element !== 'undefined' && !Element.prototype.replaceChildren) {
    Element.prototype.replaceChildren = function () {
      while (this.firstChild) this.removeChild(this.firstChild);
      for (let i = 0; i < arguments.length; i++) this.appendChild(arguments[i]);
    };
  }

  // 实际测量 Flex gap 是否生效，供 CSS 基线间距回退使用。
  try {
    const gapProbe = document.createElement('div');
    gapProbe.style.position = 'absolute';
    gapProbe.style.visibility = 'hidden';
    gapProbe.style.display = 'flex';
    gapProbe.style.flexDirection = 'column';
    gapProbe.style.rowGap = '1px';
    gapProbe.appendChild(document.createElement('div'));
    gapProbe.appendChild(document.createElement('div'));
    document.body.appendChild(gapProbe);
    if (gapProbe.scrollHeight === 1) document.documentElement.classList.add('supports-flex-gap');
    document.body.removeChild(gapProbe);
  } catch (err) {
    // 不支持 Flex gap 时继续使用 CSS 基线 margin。
  }

  /* ============================================================
     1. 统一配置
     - 关卡难度、角色成长、牢笼耐久、强化效果都从这里读取。
     - 增加关卡时：复制 levels 中的一项，并同步调整 maxLevel。
     - 修改强化幅度时：改对应属性上的 UpgradeRate / Amount。
     ============================================================ */
  const GAME_STATE = Object.freeze({
    LOADING: 'loading',
    START: 'start',
    PLAYING: 'playing',
    LEVEL_CLEAR: 'levelClear',
    UPGRADE: 'upgrade',
    NEXT_LEVEL: 'nextLevel',
    GAMEOVER: 'gameover',
    WIN: 'win'
  });

  const GAME_CONFIG = {
    level: {
      initialLevel: 1,
      maxLevel: 5,
      duration: 60,
      initialSpawnDelay: 0.9,
      minSpawnInterval: 0.5,
      // 同一关内的 0-20 / 20-40 / 40-60 秒节奏；只调节刷新间隔。
      spawnRamp: [
        { until: 20, intervalScale: 1.12 },
        { until: 40, intervalScale: 1.0 },
        { until: 60, intervalScale: 0.90 }
      ],
      levels: [
        {
          title: '第1关：吃瓜群众来袭！',
          hint: '热身一下，牢笼会先替你挡下靠近的敌人。',
          speedMultiplier: 1.0,
          spawnInterval: 2.0,
          spawnCount: [1, 1],
          weights: { crowd: 0.9, memory: 0.1, marriage: 0 }
        },
        {
          title: '第2关：回忆开始攻击！',
          hint: '回忆怪更快了，牢笼耐久每关都会恢复满。',
          speedMultiplier: 1.1,
          spawnInterval: 1.8,
          spawnCount: [1, 2],
          weights: { crowd: 0.7, memory: 0.3, marriage: 0 }
        },
        {
          title: '第3关：催婚怪出现了！',
          hint: '催婚怪需要两次登山杖格挡，也会消耗牢笼耐久。',
          speedMultiplier: 1.2,
          spawnInterval: 1.6,
          spawnCount: [1, 2],
          weights: { crowd: 0.55, memory: 0.3, marriage: 0.15 }
        },
        {
          title: '第4关：围攻升级！',
          hint: '敌人更快，单次刷新数量也会增加。',
          speedMultiplier: 1.32,
          spawnInterval: 1.4,
          spawnCount: [2, 3],
          weights: { crowd: 0.45, memory: 0.35, marriage: 0.2 }
        },
        {
          title: '第5关：最后围攻！',
          hint: '守住这一关，此生不破此牢。',
          speedMultiplier: 1.45,
          spawnInterval: 1.2,
          spawnCount: [2, 4],
          weights: { crowd: 0.38, memory: 0.36, marriage: 0.26 }
        }
      ]
    },

    player: {
      baseMoveSpeed: 320,
      moveSpeedUpgradeRate: 0.10,
      maxMoveSpeedMultiplier: 1.5,
      radius: 18,
      // 保留原字段名以兼容既有碰撞逻辑；现在表示登山杖自动格挡半径。
      shieldRange: 46,
      lenaKeep: 9
    },

    lina: {
      initialHealth: 3,
      maxHealth: 6,
      healthUpgradeAmount: 1,
      radius: 25
    },

    barrier: {
      initialDurability: 5,
      maxDurability: 12,
      durabilityUpgradeAmount: 2,
      initialRadius: 150,
      radiusUpgradeRate: 0.15,
      maxRadiusMultiplier: 1.6,
      knockbackDistance: 100,
      knockbackDuration: 0.25,
      enemyHitCooldown: 0.8,
      radiusScreenCap: 1.0
    },

    upgrades: {
      speed: {
        name: '健步如飞',
        icon: '速',
        theme: 'blue'
      },
      health: {
        name: '鸭舌加倍',
        icon: '鸭',
        theme: 'pink'
      },
      durability: {
        name: '加固牢笼',
        icon: '固',
        theme: 'gold'
      },
      radius: {
        name: '扩建牢笼',
        icon: '域',
        theme: 'green'
      }
    },
    upgradeOrder: ['speed', 'health', 'durability', 'radius'],

    milestones: [
      { at: 20, title: '敌人开始增援！', subtitle: '刷新会越来越快，省着点用牢笼耐久。' },
      { at: 40, title: '最后 20 秒了！', subtitle: '画地为牢，一步都不许退。', variant: 'final' }
    ],

    enemyTypes: {
      crowd: {
        name: '吃瓜群众',
        label: '瓜',
        speed: 70,
        radius: 16,
        hp: 1,
        flySpeed: 760,
        drag: 0.82,
        colors: ['#ffb52f', '#ffd76a', '#ff8e2b', '#fff0ad']
      },
      memory: {
        name: '回忆怪',
        label: '忆',
        speed: 108,
        radius: 14,
        hp: 1,
        flySpeed: 1010,
        drag: 0.42,
        colors: ['#45d29a', '#a2f5cf', '#1f9e76', '#eafff4']
      },
      marriage: {
        name: '催婚怪',
        label: '催',
        speed: 44,
        radius: 28,
        hp: 2,
        flySpeed: 720,
        drag: 0.7,
        colors: ['#a77bff', '#d9c1ff', '#7d4bd0', '#ffe6ff']
      }
    },

    performance: {
      maxEnemies: 86,
      maxParticles: 520
    }
  };

  const ENEMY_TYPES = GAME_CONFIG.enemyTypes;

  const QUIPS = [
    '我挡着！',
    '别怕，有我呢！',
    '这就给你画个圈！',
    '我画地为牢啊，厉娜！',
    '谁也别想靠近！',
    '这个圈，画得圆圆的！',
    '有我在，谁都别想进来！'
  ];

  const KNOCK_WORDS = ['弹飞！', '退退退！', '走你！', '别过来啊！', '退！退！退！'];
  const HURT_WORDS = ['缺口！', '哎呀！', '别挤进来！'];

  const TAU = Math.PI * 2;
  const FONT_STACK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", ui-rounded, system-ui, sans-serif';
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const $ = (id) => document.getElementById(id);
  const dom = {
    app: $('app'),
    canvas: $('game'),
    heroCanvas: $('heroCanvas'),
    hud: $('hud'),
    levelValue: $('levelValue'),
    lifeMeter: $('lifeMeter'),
    timerCard: $('timerCard'),
    timerValue: $('timerValue'),
    timerFill: $('timerFill'),
    scoreCard: $('scoreCard'),
    scoreValue: $('scoreValue'),
    barrierCard: $('barrierCard'),
    barrierPips: $('barrierPips'),
    barrierState: $('barrierState'),
    announcement: $('announcement'),
    utility: $('utility'),
    pauseBtn: $('pauseBtn'),
    soundBtn: $('soundBtn'),
    audioScreen: $('audioScreen'),
    audioPanel: $('audioPanel'),
    audioCloseBtn: $('audioCloseBtn'),
    masterToggle: $('masterToggle'),
    masterToggleLabel: $('masterToggleLabel'),
    musicToggle: $('musicToggle'),
    musicToggleLabel: $('musicToggleLabel'),
    musicVolume: $('musicVolume'),
    musicVolumeValue: $('musicVolumeValue'),
    sfxToggle: $('sfxToggle'),
    sfxToggleLabel: $('sfxToggleLabel'),
    sfxVolume: $('sfxVolume'),
    sfxVolumeValue: $('sfxVolumeValue'),
    joystick: $('joystick'),
    joyBase: $('joyBase'),
    joyKnob: $('joyKnob'),
    loadingScreen: $('loadingScreen'),
    loadingText: $('loadingText'),
    maxLevelBadge: $('maxLevelBadge'),
    taglineLevelCount: $('taglineLevelCount'),
    footDuration: $('footDuration'),
    startScreen: $('startScreen'),
    startBtn: $('startBtn'),
    pauseScreen: $('pauseScreen'),
    resumeBtn: $('resumeBtn'),
    levelClearScreen: $('levelClearScreen'),
    clearTitle: $('clearTitle'),
    clearSub: $('clearSub'),
    clearScore: $('clearScore'),
    clearLives: $('clearLives'),
    clearDurability: $('clearDurability'),
    nextDifficulty: $('nextDifficulty'),
    toUpgradeBtn: $('toUpgradeBtn'),
    upgradeScreen: $('upgradeScreen'),
    upgradeGrid: $('upgradeGrid'),
    upgradeSub: $('upgradeSub'),
    nextLevelScreen: $('nextLevelScreen'),
    nextLevelNumber: $('nextLevelNumber'),
    nextLevelTitle: $('nextLevelTitle'),
    nextLevelHint: $('nextLevelHint'),
    upgradeFeedback: $('upgradeFeedback'),
    upgradeFeedbackText: $('upgradeFeedbackText'),
    startNextBtn: $('startNextBtn'),
    nextSpeed: $('nextSpeed'),
    nextLives: $('nextLives'),
    nextBarrier: $('nextBarrier'),
    endScreen: $('endScreen'),
    endPanel: $('endPanel'),
    endEmblem: $('endEmblem'),
    endKicker: $('endKicker'),
    endTitle: $('endTitle'),
    endCopy: $('endCopy'),
    endTime: $('endTime'),
    endTimeLabel: $('endTimeLabel'),
    endScore: $('endScore'),
    endScoreLabel: $('endScoreLabel'),
    endQuote: $('endQuote'),
    restartBtn: $('restartBtn'),
    liveStatus: $('liveStatus')
  };

  const ctx = dom.canvas.getContext('2d');
  const heroCtx = dom.heroCanvas.getContext('2d');
  const HERO_W = 600;
  const HERO_H = 230;
  let heroDpr = 0;

  /* ============================================================
     资源层：assets/asset-manifest.js + resource-manager.js
     - 资源加载失败时游戏照常运行，Canvas 使用矢量兜底。
     - 正式 PNG 只需覆盖 assets/ 下同名文件，或改清单中的 src。
     ============================================================ */
  const FALLBACK_ASSET_MANIFEST = {
    basePath: 'assets/',
    assets: {
      'ui.lifeDuckbill': { src: 'ui/duckbill.png' },
      'prop.trekkingPole': { src: 'props/trekking_pole.png', drawHeight: 94, anchor: [0.5, 0.34] },
      'fx.guardSpark': { src: 'fx/guard_spark.png', drawSize: 42 }
    }
  };
  const ASSET_MANIFEST = window.GAME_ASSET_MANIFEST || FALLBACK_ASSET_MANIFEST;
  const ResourceManagerImpl = window.GameResourceManager;
  const RESOURCES = ResourceManagerImpl
    ? new ResourceManagerImpl(ASSET_MANIFEST, { basePath: 'assets/' })
    : {
        _entries: ASSET_MANIFEST.assets || {},
        _base: (ASSET_MANIFEST.basePath || 'assets/').replace(/\/?$/, '/'),
        getPath(id) {
          const def = this._entries[id];
          if (!def || !def.src) return '';
          return /^(?:data:|blob:|file:|\/)/i.test(def.src) ? def.src : this._base + def.src.replace(/^\.\//, '');
        },
        getConfig(id) { return this._entries[id] || null; },
        getStatus() { return 'unavailable'; },
        isReady() { return false; },
        getImage() { return null; },
        getStats() {
          return { total: Object.keys(this._entries).length, loaded: 0, failed: 0, pending: 0, ready: false, statuses: {} };
        },
        preloadAll() { return Promise.resolve(this.getStats()); }
      };

  // 调试用：记录最近一次 drawSprite 的真实自然尺寸与目标绘制尺寸。
  const spriteDebug = Object.create(null);
  let linaPngLogged = false;
  let linaFallbackLogged = false;

  // 仅在 PNG 加载失败时使用；用内联 SVG 保证 HUD 不会出现空图标。
  const DUCKBILL_FALLBACK_SVG = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 84">' +
      '<circle cx="42" cy="42" r="27" fill="#ffd953" stroke="#4a2d2b" stroke-width="3"/>' +
      '<path d="M60 36 Q78 32 93 43 Q96 48 86 55 Q72 60 58 54 Z" fill="#ff9d30" stroke="#4a2d2b" stroke-width="3"/>' +
      '<path d="M70 55 Q75 57 74 67 Q72 74 66 70 Q62 63 65 56 Z" fill="#ff7099" stroke="#4a2d2b" stroke-width="2.5"/>' +
      '<circle cx="48" cy="33" r="4" fill="#3a2724"/>' +
      '<circle cx="50" cy="31" r="1.5" fill="#fffdf4"/>' +
      '<path d="M24 18 Q13 7 7 20 Q18 27 26 21 Z" fill="#ff7ba1" stroke="#4a2d2b" stroke-width="2"/>' +
    '</svg>'
  );

  /* ============================================================
     2. 状态与工具
     ============================================================ */
  const state = {
    mode: GAME_STATE.LOADING,
    paused: false,
    audioSettingsOpen: false,
    t: 0,
    elapsed: 0,
    level: GAME_CONFIG.level.initialLevel,
    nextLevel: GAME_CONFIG.level.initialLevel + 1,
    maxLives: GAME_CONFIG.lina.initialHealth,
    lives: GAME_CONFIG.lina.initialHealth,
    speedMultiplier: 1,
    score: 0,
    totalScore: 0,
    lastLevelScore: 0,
    lastUpgrade: null,
    upgradeHistory: [],
    upgradeLocked: false,
    finalTime: 0,
    player: null,
    lena: null,
    enemies: [],
    particles: [],
    popups: [],
    shockwaves: [],
    shake: 0,
    flash: 0,
    shieldPulse: 0,
    lastBlockAngle: -Math.PI / 2,
    spawnTimer: GAME_CONFIG.level.initialSpawnDelay,
    nextQuip: 8,
    introQuip: 1.05,
    lastQuip: -1,
    keys: new Set(),
    joy: { active: false, pointerId: null, x: 0, y: 0 },
    barrier: {
      durability: GAME_CONFIG.barrier.initialDurability,
      maxDurability: GAME_CONFIG.barrier.initialDurability,
      radiusMultiplier: 1,
      cracks: [],
      flash: 0,
      breakPulse: 0
    },
    flags: {}
  };

  const view = {
    w: 1,
    h: 1,
    dpr: 1,
    s: 1,
    speedScale: 1,
    radiusScale: 0.8,
    cx: 0,
    cy: 0,
    barrierR: 110,
    topBound: 80,
    doodles: []
  };

  let lastFrame = performance.now();
  let resizeQueued = false;

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const easeOutBack = (x) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  };
  const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);

  function angleLerp(a, b, t) {
    let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
    return a + d * t;
  }

  function roundRect(g, x, y, w, h, r) {
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    g.beginPath();
    g.moveTo(x + rr, y);
    g.lineTo(x + w - rr, y);
    g.quadraticCurveTo(x + w, y, x + w, y + rr);
    g.lineTo(x + w, y + h - rr);
    g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    g.lineTo(x + rr, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - rr);
    g.lineTo(x, y + rr);
    g.quadraticCurveTo(x, y, x + rr, y);
    g.closePath();
  }

  function heartPath(g, x, y, size) {
    g.beginPath();
    g.moveTo(x, y + size * 0.34);
    g.bezierCurveTo(x - size * 0.98, y - size * 0.34, x - size * 0.56, y - size * 0.94, x, y - size * 0.34);
    g.bezierCurveTo(x + size * 0.56, y - size * 0.94, x + size * 0.98, y - size * 0.34, x, y + size * 0.34);
    g.closePath();
  }

  function starPath(g, x, y, radius, points = 5, inner = 0.44) {
    g.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const a = -Math.PI / 2 + i * Math.PI / points;
      const r = i % 2 === 0 ? radius : radius * inner;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
  }

  function ellipse(g, x, y, rx, ry, rotation = 0) {
    g.beginPath();
    g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rotation, 0, TAU);
  }

  function playerRadius() {
    return Math.max(15, GAME_CONFIG.player.radius * view.s);
  }

  function defenseRadius() {
    return playerRadius() + GAME_CONFIG.player.shieldRange * view.s;
  }

  function lenaRadius() {
    return Math.max(20, GAME_CONFIG.lina.radius * view.s);
  }

  function currentPlayerSpeed() {
    return GAME_CONFIG.player.baseMoveSpeed * state.speedMultiplier;
  }

  function getMaxLevel() {
    return Math.min(GAME_CONFIG.level.maxLevel, GAME_CONFIG.level.levels.length);
  }

  function currentLevelConfig() {
    const levels = GAME_CONFIG.level.levels;
    const index = clamp(state.level - 1, 0, levels.length - 1);
    return levels[index] || levels[0];
  }

  function nextLevelConfig() {
    const levels = GAME_CONFIG.level.levels;
    const index = clamp(state.level, 0, levels.length - 1);
    return levels[index] || levels[levels.length - 1];
  }

  function getSpawnRamp(elapsed) {
    const ramps = GAME_CONFIG.level.spawnRamp || [];
    for (let i = 0; i < ramps.length; i++) {
      if (elapsed < ramps[i].until) return ramps[i];
    }
    return ramps[ramps.length - 1] || { intervalScale: 1 };
  }

  function isBarrierActive() {
    return state.barrier.durability > 0;
  }

  function barrierRatio() {
    return state.barrier.maxDurability > 0
      ? clamp(state.barrier.durability / state.barrier.maxDurability, 0, 1)
      : 0;
  }

  function barrierWorldRadius() {
    return GAME_CONFIG.barrier.initialRadius * state.barrier.radiusMultiplier * view.radiusScale;
  }

  function refreshBarrierRadius() {
    view.barrierR = barrierWorldRadius();
  }

  function setText(g, text, x, y, size, fill, stroke, strokeWidth, weight = 900, align = 'center') {
    g.save();
    g.font = `${weight} ${size}px ${FONT_STACK}`;
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    if (stroke && strokeWidth) {
      g.lineWidth = strokeWidth;
      g.strokeStyle = stroke;
      g.strokeText(text, x, y);
    }
    g.fillStyle = fill;
    g.fillText(text, x, y);
    g.restore();
  }

  /* ============================================================
     3. 独立音频系统：配置 + AudioManager
     ============================================================ */
  const AUDIO_FALLBACK_SETTINGS = Object.assign({
    masterEnabled: true,
    musicEnabled: true,
    sfxEnabled: true,
    musicVolume: 40,
    sfxVolume: 70
  }, (window.AUDIO_CONFIG && window.AUDIO_CONFIG.defaults) || {});

  function makeSilentAudioManager() {
    let settings = Object.assign({}, AUDIO_FALLBACK_SETTINGS);
    const noop = () => false;
    return {
      initAudio: noop,
      playMusic: noop,
      stopMusic() {},
      pauseMusic() {},
      resumeMusic() {},
      playSfx: noop,
      setMasterEnabled(value) { settings.masterEnabled = !!value; return settings.masterEnabled; },
      setMusicEnabled(value) { settings.musicEnabled = !!value; return settings.musicEnabled; },
      setSfxEnabled(value) { settings.sfxEnabled = !!value; return settings.sfxEnabled; },
      setMusicVolume(value) { settings.musicVolume = Number(value) || 0; return settings.musicVolume; },
      setSfxVolume(value) { settings.sfxVolume = Number(value) || 0; return settings.sfxVolume; },
      stopAllAudio() {},
      handleUserGesture() {},
      getSettings() { return Object.assign({}, settings); },
      getState() { return { initialized: false, available: false, currentMusic: null, settings: Object.assign({}, settings) }; }
    };
  }

  const AudioManager = window.GameAudioManager
    ? new window.GameAudioManager(window.AUDIO_CONFIG || {})
    : makeSilentAudioManager();

  function syncAudioButton() {
    const settings = AudioManager.getSettings();
    const allOff = !settings.masterEnabled || (!settings.musicEnabled && !settings.sfxEnabled);
    dom.soundBtn.classList.toggle('muted', allOff);
    dom.soundBtn.setAttribute('aria-label', allOff ? '声音已静音，打开声音设置' : '打开声音设置');
    dom.soundBtn.title = allOff ? '声音已静音' : '声音设置';
  }

  function setAudioRangeFill(input, value) {
    if (input) input.style.setProperty('--audio-fill', `${Math.max(0, Math.min(100, value))}%`);
  }

  function updateAudioControls() {
    const settings = AudioManager.getSettings();
    dom.masterToggle.classList.toggle('on', settings.masterEnabled);
    dom.masterToggle.setAttribute('aria-checked', String(settings.masterEnabled));
    dom.masterToggleLabel.textContent = settings.masterEnabled ? '开启' : '静音';
    dom.musicToggle.classList.toggle('on', settings.musicEnabled);
    dom.musicToggle.setAttribute('aria-checked', String(settings.musicEnabled));
    dom.musicToggleLabel.textContent = settings.musicEnabled ? '开启' : '关闭';
    dom.sfxToggle.classList.toggle('on', settings.sfxEnabled);
    dom.sfxToggle.setAttribute('aria-checked', String(settings.sfxEnabled));
    dom.sfxToggleLabel.textContent = settings.sfxEnabled ? '开启' : '关闭';

    const music = Math.round(settings.musicVolume);
    const sfx = Math.round(settings.sfxVolume);
    dom.musicVolume.value = String(music);
    dom.musicVolumeValue.textContent = `${music}%`;
    setAudioRangeFill(dom.musicVolume, music);
    dom.sfxVolume.value = String(sfx);
    dom.sfxVolumeValue.textContent = `${sfx}%`;
    setAudioRangeFill(dom.sfxVolume, sfx);
    syncAudioButton();
  }

  function openAudioSettings() {
    if (state.mode !== GAME_STATE.PLAYING || state.paused || state.audioSettingsOpen) return;
    AudioManager.initAudio();
    state.audioSettingsOpen = true;
    state.keys.clear();
    resetJoystick();
    updateAudioControls();
    showScreen(dom.audioScreen);
    try { dom.audioCloseBtn.focus({ preventScroll: true }); } catch (err) { dom.audioCloseBtn.focus(); }
  }

  function closeAudioSettings() {
    if (!state.audioSettingsOpen) return;
    state.audioSettingsOpen = false;
    setScreen(dom.audioScreen, false);
    lastFrame = performance.now();
    try { dom.soundBtn.focus({ preventScroll: true }); } catch (err) { dom.soundBtn.focus(); }
  }

  function bindAudioSettings() {
    dom.soundBtn.addEventListener('click', openAudioSettings);
    dom.audioCloseBtn.addEventListener('click', closeAudioSettings);
    dom.audioScreen.addEventListener('click', (event) => {
      if (event.target !== dom.audioScreen) return;
      AudioManager.playSfx('uiClick');
      closeAudioSettings();
    });

    dom.masterToggle.addEventListener('click', () => {
      AudioManager.setMasterEnabled(!AudioManager.getSettings().masterEnabled);
      updateAudioControls();
    });
    dom.musicToggle.addEventListener('click', () => {
      AudioManager.setMusicEnabled(!AudioManager.getSettings().musicEnabled);
      updateAudioControls();
    });
    dom.sfxToggle.addEventListener('click', () => {
      AudioManager.setSfxEnabled(!AudioManager.getSettings().sfxEnabled);
      updateAudioControls();
    });
    dom.musicVolume.addEventListener('input', () => {
      const value = Number(dom.musicVolume.value);
      AudioManager.setMusicVolume(value);
      dom.musicVolumeValue.textContent = `${Math.round(value)}%`;
      setAudioRangeFill(dom.musicVolume, value);
      syncAudioButton();
    });
    dom.sfxVolume.addEventListener('input', () => {
      const value = Number(dom.sfxVolume.value);
      AudioManager.setSfxVolume(value);
      dom.sfxVolumeValue.textContent = `${Math.round(value)}%`;
      setAudioRangeFill(dom.sfxVolume, value);
      syncAudioButton();
    });

    // 所有按钮点击统一触发 UI 音效；禁用按钮不会派发 click。
    document.addEventListener('click', (event) => {
      AudioManager.handleUserGesture();
      const button = event.target.closest('button');
      if (!button || button.disabled) return;
      AudioManager.playSfx('uiClick');
    });
  }

  /* ============================================================
     4. 尺寸与响应式布局
     ============================================================ */
  function resizeAll() {
    const rect = dom.canvas.getBoundingClientRect();
    view.w = Math.max(1, rect.width);
    view.h = Math.max(1, rect.height);
    view.dpr = Math.min(2, window.devicePixelRatio || 1);
    dom.canvas.width = Math.round(view.w * view.dpr);
    dom.canvas.height = Math.round(view.h * view.dpr);
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);

    const hudRect = dom.hud.getBoundingClientRect();
    const hudTransformOffset = document.body.classList.contains('is-playing') ? 0 : 12;
    const hudBottom = hudRect.height
      ? hudRect.bottom + hudTransformOffset
      : Math.max(82, view.h * 0.1);
    view.topBound = clamp(hudBottom + 10, 72, Math.min(view.h * 0.36, view.h - 120));
    view.s = clamp(Math.min(view.w, view.h) / 690, 0.72, 1.42);
    view.speedScale = clamp(view.s, 0.86, 1.32);
    view.cx = view.w / 2;

    // 按最大强化后的牢笼尺寸预留空间，保证扩建强化在任意屏幕都不会溢出。
    const arenaMargin = 18;
    const availableHalfW = Math.max(60, view.w / 2 - arenaMargin);
    const availableHalfH = Math.max(60, (view.h - view.topBound - arenaMargin) / 2);
    const maxBarrierWorld = GAME_CONFIG.barrier.initialRadius * GAME_CONFIG.barrier.maxRadiusMultiplier;
    const fitScale = Math.min(availableHalfW, availableHalfH) / maxBarrierWorld;
    view.radiusScale = Math.min(GAME_CONFIG.barrier.radiusScreenCap, Math.max(0.38, fitScale));
    view.barrierR = barrierWorldRadius();

    view.cy = view.topBound + Math.max(
      view.barrierR * 0.72,
      (view.h - view.topBound - arenaMargin) / 2
    );

    document.documentElement.style.setProperty('--hud-safe-bottom', `${view.topBound}px`);
    view.doodles = makeDoodles();

    if (state.lena) {
      state.lena.x = view.cx;
      state.lena.y = view.cy;
      state.lena.r = lenaRadius();
    }
    if (state.player) {
      const pr = playerRadius();
      state.player.x = clamp(state.player.x, pr + 5, view.w - pr - 5);
      state.player.y = clamp(state.player.y, view.topBound + pr, view.h - pr - 6);
      keepPlayerOutOfLena();
    }

    const hdpr = Math.min(2, window.devicePixelRatio || 1);
    const heroW = Math.round(HERO_W * hdpr);
    const heroH = Math.round(HERO_H * hdpr);
    if (hdpr !== heroDpr || dom.heroCanvas.width !== heroW || dom.heroCanvas.height !== heroH) {
      heroDpr = hdpr;
      dom.heroCanvas.width = heroW;
      dom.heroCanvas.height = heroH;
    }
    heroCtx.setTransform(heroDpr, 0, 0, heroDpr, 0, 0);
  }

  function scheduleResize() {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      resizeAll();
    });
  }

  function makeDoodles() {
    const kinds = ['heart', 'star', 'plus', 'swirl', 'flower', 'heart', 'star'];
    const colors = ['#ff9eb9', '#ffc94a', '#75b9ff', '#7ed8b1', '#c3a5ff'];
    const list = [];
    for (let i = 0; i < 18; i++) {
      let x = rand(16, view.w - 16);
      let y = rand(16, view.h - 16);
      // 尽量别挡住画面中心
      for (let tries = 0; tries < 3; tries++) {
        const dx = x - view.cx;
        const dy = y - view.cy;
        if (Math.hypot(dx, dy) > view.barrierR * 1.35) break;
        x = rand(16, view.w - 16);
        y = rand(16, view.h - 16);
      }
      list.push({
        x,
        y,
        size: rand(7, 18),
        kind: pick(kinds),
        color: pick(colors),
        rot: rand(-0.7, 0.7),
        phase: rand(0, TAU),
        alpha: rand(0.07, 0.16)
      });
    }
    return list;
  }

  /* ============================================================
     5. HUD 与界面状态
     ============================================================ */
  const hudCache = {
    timer: null,
    score: null,
    lives: null,
    maxLives: null,
    level: null,
    // 仅用于判断哪些圆点是本次新损失的动画；可用状态始终由实际耐久派生。
    barrierPrevDurability: null
  };

  function buildLifeIcons() {
    dom.lifeMeter.replaceChildren();
    const duckPath = RESOURCES.getPath('ui.lifeDuckbill') || 'assets/ui/duckbill.png';
    for (let i = 0; i < state.maxLives; i++) {
      const wrap = document.createElement('span');
      wrap.className = 'life-icon-wrap';
      const icon = document.createElement('img');
      icon.className = 'life-icon';
      icon.alt = '';
      icon.draggable = false;
      icon.decoding = 'async';
      icon.src = duckPath;
      icon.addEventListener('error', () => {
        if (icon.dataset.fallback === '1') return;
        icon.dataset.fallback = '1';
        icon.src = DUCKBILL_FALLBACK_SVG;
      });
      wrap.appendChild(icon);
      dom.lifeMeter.appendChild(wrap);
    }
    hudCache.maxLives = state.maxLives;
    hudCache.lives = null;
    updateLifeIcons(false);
  }

  function updateLifeIcons(animate) {
    const prev = hudCache.lives;
    const nodes = dom.lifeMeter.children;
    for (let i = 0; i < nodes.length; i++) {
      const full = i < state.lives;
      const node = nodes[i];
      node.classList.toggle('empty', !full);
      node.setAttribute('aria-hidden', full ? 'false' : 'true');
      if (animate && prev !== null && i >= state.lives && i < prev) {
        node.classList.remove('just-lost');
        void node.offsetWidth;
        node.classList.add('just-lost');
      }
    }
    dom.lifeMeter.setAttribute('aria-label', `厉娜体力值 ${state.lives} / ${state.maxLives}（鸭舌护符）`);
    hudCache.lives = state.lives;
    hudCache.maxLives = state.maxLives;
  }

  function buildBarrierPips() {
    dom.barrierPips.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < state.barrier.maxDurability; i++) {
      const pip = document.createElement('span');
      pip.className = 'barrier-pip';
      pip.setAttribute('aria-hidden', 'true');
      fragment.appendChild(pip);
    }
    dom.barrierPips.appendChild(fragment);
    hudCache.barrierPrevDurability = null;
    updateBarrierHud(false);
  }

  function updateBarrierHud(animate) {
    // 数量永远按当前最大耐久校验；发现不一致时直接从数据重建，不沿用旧节点状态。
    if (dom.barrierPips.children.length !== state.barrier.maxDurability) {
      buildBarrierPips();
      return;
    }

    const current = state.barrier.durability;
    const prev = hudCache.barrierPrevDurability;
    const nodes = dom.barrierPips.children;
    for (let i = 0; i < nodes.length; i++) {
      // 唯一数据源：每个圆点是否可用只取决于 i < 当前实际耐久。
      const available = i < current;
      const node = nodes[i];
      node.classList.toggle('empty', !available);
      if (available) {
        // 恢复为可用时必须移除上一关/上一帧留下的损失动画状态。
        node.classList.remove('just-lost');
      } else if (animate && prev !== null && i >= current && i < prev) {
        node.classList.remove('just-lost');
        void node.offsetWidth;
        node.classList.add('just-lost');
      }
    }
    const broken = current <= 0;
    dom.barrierState.textContent = broken
      ? '已失效'
      : `${current} / ${state.barrier.maxDurability}`;
    dom.barrierCard.classList.toggle('broken', broken);
    dom.barrierPips.setAttribute(
      'aria-label',
      broken
        ? '牢笼耐久已失效'
        : `牢笼耐久 ${current} / ${state.barrier.maxDurability}`
    );
    hudCache.barrierPrevDurability = current;
  }

  function updateHUD(force = false) {
    const duration = GAME_CONFIG.level.duration;
    const remaining = clamp(duration - state.elapsed, 0, duration);
    const shown = Math.ceil(remaining - 0.00001);
    if (force || shown !== hudCache.timer) {
      dom.timerValue.textContent = String(shown);
      hudCache.timer = shown;
    }
    dom.timerFill.style.transform = `scaleX(${Math.max(0, remaining / duration)})`;
    const urgent = state.mode === GAME_STATE.PLAYING && remaining <= 10 && remaining > 0;
    dom.timerCard.classList.toggle('urgent', urgent);

    if (force || state.level !== hudCache.level) {
      dom.levelValue.textContent = `第${state.level}关`;
      hudCache.level = state.level;
    }

    if (force || state.score !== hudCache.score) {
      const grew = hudCache.score !== null && state.score > hudCache.score;
      dom.scoreValue.textContent = String(state.score);
      hudCache.score = state.score;
      if (grew && !force) {
        dom.scoreCard.classList.remove('bump');
        void dom.scoreCard.offsetWidth;
        dom.scoreCard.classList.add('bump');
      }
    }

    if (hudCache.maxLives !== state.maxLives) {
      buildLifeIcons();
    } else if (force || hudCache.lives !== state.lives) {
      updateLifeIcons(!force && hudCache.lives !== null);
    }

    if (dom.barrierPips.children.length !== state.barrier.maxDurability) {
      buildBarrierPips();
    } else if (force || hudCache.barrierPrevDurability !== state.barrier.durability) {
      updateBarrierHud(!force && hudCache.barrierPrevDurability !== null);
    }
  }

  function displayAnnouncement(title, subtitle, variant = '') {
    dom.announcement.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = title;
    const span = document.createElement('span');
    span.textContent = subtitle;
    dom.announcement.append(strong, span);
    dom.announcement.dataset.variant = variant;
    dom.announcement.classList.remove('show');
    void dom.announcement.offsetWidth;
    dom.announcement.classList.add('show');
    dom.liveStatus.textContent = `${title}。${subtitle}`;
  }

  function clearAnnouncement() {
    dom.announcement.classList.remove('show');
    dom.announcement.replaceChildren();
  }

  function setScreen(element, visible) {
    element.hidden = !visible;
    if (visible) {
      element.scrollTop = 0;
    }
  }

  function hideAllScreens() {
    [
      dom.loadingScreen,
      dom.startScreen,
      dom.pauseScreen,
      dom.levelClearScreen,
      dom.upgradeScreen,
      dom.nextLevelScreen,
      dom.audioScreen,
      dom.endScreen
    ].forEach((screen) => {
      if (screen) screen.hidden = true;
    });
  }

  function showScreen(element) {
    hideAllScreens();
    if (!element) return;
    if (element !== dom.audioScreen) state.audioSettingsOpen = false;
    element.hidden = false;
    element.scrollTop = 0;
  }

  function syncBodyClasses() {
    const mode = state.mode;
    const isPlaying = mode === GAME_STATE.PLAYING;
    const overlayMode = [
      GAME_STATE.LEVEL_CLEAR,
      GAME_STATE.UPGRADE,
      GAME_STATE.NEXT_LEVEL,
      GAME_STATE.GAMEOVER,
      GAME_STATE.WIN
    ].includes(mode);
    document.body.classList.toggle('is-playing', isPlaying);
    document.body.classList.toggle('is-paused', isPlaying && state.paused);
    document.body.classList.toggle('is-over', overlayMode);
    document.body.classList.toggle('is-loading', mode === GAME_STATE.LOADING);
    document.body.classList.remove('won', 'lost');
    dom.hud.setAttribute('aria-hidden', isPlaying ? 'false' : 'true');
  }

  /* ============================================================
     6. 输入：键盘 + 虚拟摇杆
     ============================================================ */
  const KEY_DIRECTIONS = {
    arrowup: 'up',
    w: 'up',
    arrowdown: 'down',
    s: 'down',
    arrowleft: 'left',
    a: 'left',
    arrowright: 'right',
    d: 'right'
  };
  const CODE_DIRECTIONS = {
    ArrowUp: 'up',
    KeyW: 'up',
    ArrowDown: 'down',
    KeyS: 'down',
    ArrowLeft: 'left',
    KeyA: 'left',
    ArrowRight: 'right',
    KeyD: 'right'
  };

  function keyDirection(e) {
    return KEY_DIRECTIONS[(e.key || '').toLowerCase()] || CODE_DIRECTIONS[e.code] || null;
  }

  function getInputVector() {
    let x = 0;
    let y = 0;
    if (state.keys.has('left')) x -= 1;
    if (state.keys.has('right')) x += 1;
    if (state.keys.has('up')) y -= 1;
    if (state.keys.has('down')) y += 1;
    if (state.joy.active) {
      x += state.joy.x;
      y += state.joy.y;
    }
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y, length: Math.min(1, len) };
  }

  function updateJoystickFromEvent(e) {
    const rect = dom.joyBase.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const max = rect.width * 0.255;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    let dist = Math.hypot(dx, dy);
    const rawMag = Math.min(1, dist / max);
    if (dist > max && dist > 0) {
      dx = dx / dist * max;
      dy = dy / dist * max;
      dist = max;
    }
    const dead = 0.14;
    const amount = rawMag <= dead ? 0 : (rawMag - dead) / (1 - dead);
    const dirLen = dist > 0 ? dist : 1;
    state.joy.x = dx / dirLen * amount;
    state.joy.y = dy / dirLen * amount;
    dom.joyKnob.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px)`;
  }

  function resetJoystick() {
    state.joy.active = false;
    state.joy.pointerId = null;
    state.joy.x = 0;
    state.joy.y = 0;
    dom.joyBase.classList.remove('active');
    dom.joyKnob.style.transform = 'translate(-50%, -50%)';
  }

  function bindJoystick() {
    dom.joyBase.addEventListener('pointerdown', (e) => {
      if (state.mode !== GAME_STATE.PLAYING || state.paused) return;
      e.preventDefault();
      state.joy.active = true;
      state.joy.pointerId = e.pointerId;
      dom.joyBase.classList.add('active');
      try {
        dom.joyBase.setPointerCapture(e.pointerId);
      } catch (err) {
        // 某些浏览器不支持 pointer capture
      }
      updateJoystickFromEvent(e);
    });

    dom.joyBase.addEventListener('pointermove', (e) => {
      if (!state.joy.active || e.pointerId !== state.joy.pointerId) return;
      e.preventDefault();
      updateJoystickFromEvent(e);
    });

    const finish = (e) => {
      if (!state.joy.active || (e.pointerId != null && e.pointerId !== state.joy.pointerId)) return;
      resetJoystick();
    };
    dom.joyBase.addEventListener('pointerup', finish);
    dom.joyBase.addEventListener('pointercancel', finish);
    dom.joyBase.addEventListener('lostpointercapture', finish);
  }

  function bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const dir = keyDirection(e);
      const lower = (e.key || '').toLowerCase();

      if (state.audioSettingsOpen) {
        if (lower === 'p' || lower === 'escape') {
          e.preventDefault();
          closeAudioSettings();
        }
        return;
      }
      if (state.mode === GAME_STATE.PLAYING && (lower === 'p' || lower === 'escape')) {
        e.preventDefault();
        if (state.paused) resumeGame();
        else pauseGame();
        return;
      }
      if (dir) {
        if (state.mode === GAME_STATE.PLAYING) e.preventDefault();
        if (state.mode === GAME_STATE.PLAYING && !state.paused) {
          state.keys.add(dir);
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      const dir = keyDirection(e);
      if (dir) state.keys.delete(dir);
    });

    window.addEventListener('blur', () => {
      state.keys.clear();
      resetJoystick();
    });
  }

  /* ============================================================
     7. 游戏体力周期
     ============================================================ */
  function resetRunStats() {
    state.level = GAME_CONFIG.level.initialLevel;
    state.nextLevel = state.level + 1;
    state.maxLives = GAME_CONFIG.lina.initialHealth;
    state.lives = state.maxLives;
    state.speedMultiplier = 1;
    state.score = 0;
    state.totalScore = 0;
    state.lastLevelScore = 0;
    state.lastUpgrade = null;
    state.upgradeHistory.length = 0;
    state.upgradeLocked = false;
    state.barrier.maxDurability = GAME_CONFIG.barrier.initialDurability;
    state.barrier.durability = state.barrier.maxDurability;
    state.barrier.radiusMultiplier = 1;
    state.barrier.cracks.length = 0;
    state.barrier.flash = 0;
    state.barrier.breakPulse = 0;
    refreshBarrierRadius();
    hudCache.timer = null;
    hudCache.score = null;
    hudCache.lives = null;
    hudCache.maxLives = null;
    hudCache.level = null;
    hudCache.barrierPrevDurability = null;
    buildLifeIcons();
    buildBarrierPips();
    updateHUD(true);
  }

  function resetLevelRuntime() {
    state.elapsed = 0;
    state.paused = false;
    state.score = 0;
    state.finalTime = 0;
    state.shake = 0;
    state.flash = 0;
    state.shieldPulse = 0;
    state.lastBlockAngle = -Math.PI / 2;
    state.spawnTimer = GAME_CONFIG.level.initialSpawnDelay;
    state.nextQuip = 8.5;
    state.introQuip = 1.0;
    state.lastQuip = -1;
    state.flags = {};
    state.enemies.length = 0;
    state.particles.length = 0;
    state.popups.length = 0;
    state.shockwaves.length = 0;
    state.keys.clear();
    resetJoystick();

    state.barrier.durability = state.barrier.maxDurability;
    state.barrier.cracks.length = 0;
    state.barrier.flash = 0;
    state.barrier.breakPulse = 0;

    state.lena = {
      x: view.cx,
      y: view.cy,
      r: lenaRadius(),
      hurt: 0
    };
    const startY = view.cy + view.barrierR * 0.58;
    state.player = {
      x: view.cx,
      y: clamp(startY, view.topBound + playerRadius(), view.h - playerRadius() - 8),
      facing: -Math.PI / 2,
      walk: 0,
      moving: false,
      dustTimer: 0
    };
    keepPlayerOutOfLena();
    hudCache.timer = null;
    hudCache.score = null;
    hudCache.lives = null;
    hudCache.level = null;
    // 清掉上一关的动画判定位；所有圆点的可用状态会在 updateHUD 中按实际耐久重算。
    hudCache.barrierPrevDurability = null;
    updateHUD(true);
    clearAnnouncement();
  }

  function enterStartScreen() {
    state.mode = GAME_STATE.START;
    state.paused = false;
    const max = getMaxLevel();
    dom.maxLevelBadge.textContent = String(max);
    dom.taglineLevelCount.textContent = String(max);
    dom.footDuration.textContent = String(GAME_CONFIG.level.duration);
    hideAllScreens();
    showScreen(dom.startScreen);
    syncBodyClasses();
    updateHUD(true);
    lastFrame = performance.now();
  }

  function startRun() {
    AudioManager.initAudio();
    AudioManager.stopAllAudio();
    state.audioSettingsOpen = false;
    resetRunStats();
    startLevel(GAME_CONFIG.level.initialLevel);
  }

  function startLevel(level) {
    const max = getMaxLevel();
    if (level > max) {
      showFinalWin();
      return;
    }
    state.level = level;
    state.nextLevel = Math.min(level + 1, max);
    state.mode = GAME_STATE.PLAYING;
    state.paused = false;
    resetLevelRuntime();
    hideAllScreens();
    syncBodyClasses();
    dom.pauseBtn.setAttribute('aria-label', '暂停游戏');
    updateHUD(true);

    // 每关开场“画圈成牢”的落笔声；与自动生成牢笼的视觉时机一致。
    AudioManager.playSfx('drawLine');

    const cfg = currentLevelConfig();
    displayAnnouncement(cfg.title, cfg.hint);
    dom.liveStatus.textContent = `${cfg.title} 牢笼耐久 ${state.barrier.durability} / ${state.barrier.maxDurability}，厉娜体力 ${state.lives} / ${state.maxLives}。`;
    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
    lastFrame = performance.now();
    AudioManager.resumeMusic();
    AudioManager.playMusic('game');
  }

  function completeLevel() {
    if (state.mode !== GAME_STATE.PLAYING) return;
    state.mode = GAME_STATE.LEVEL_CLEAR;
    state.paused = false;
    state.elapsed = GAME_CONFIG.level.duration;
    state.finalTime = state.elapsed;
    // BUG 修复：只在关卡成功结算的这一次恢复体力，失败/暂停不会走这里。
    state.lives = state.maxLives;
    state.lastLevelScore = state.score;
    state.totalScore += state.score;
    state.keys.clear();
    resetJoystick();
    hideAllScreens();
    showScreen(dom.levelClearScreen);
    syncBodyClasses();
    clearAnnouncement();
    updateHUD(true);
    populateLevelClearScreen();
    // 第 5 关的最终胜利音效留到最终结算界面，避免普通结算音效重复叠加。
    if (state.level < getMaxLevel()) AudioManager.playSfx('uiVictory');
    dom.liveStatus.textContent = `第 ${state.level} 关守护成功，进入强化选择。`;
  }

  function populateLevelClearScreen() {
    const max = getMaxLevel();
    dom.clearTitle.textContent = `第${state.level}关 · 守住了！`;
    dom.clearSub.textContent = `厉娜还剩 ${state.lives} 个鸭舌护符，牢笼还剩 ${state.barrier.durability} 次耐久。`;
    dom.clearScore.textContent = String(state.score);
    dom.clearLives.textContent = `${state.lives} / ${state.maxLives}`;
    dom.clearDurability.textContent = `${state.barrier.durability} / ${state.barrier.maxDurability}`;
    if (state.level >= max) {
      dom.nextDifficulty.textContent = '最终关已经守住，查看总成绩吧。';
      dom.toUpgradeBtn.textContent = '查看最终成绩';
    } else {
      const next = GAME_CONFIG.level.levels[state.level] || nextLevelConfig();
      dom.nextDifficulty.textContent = `下一关：敌人速度 ×${next.speedMultiplier.toFixed(2)}，刷新间隔 ${next.spawnInterval.toFixed(1)} 秒，单次 ${next.spawnCount[0]}–${next.spawnCount[1]} 只。`;
      dom.toUpgradeBtn.textContent = '选择强化';
    }
  }

  function getUpgradeOptions() {
    const playerCfg = GAME_CONFIG.player;
    const linaCfg = GAME_CONFIG.lina;
    const barrierCfg = GAME_CONFIG.barrier;
    const speedNextMultiplier = Math.min(
      playerCfg.maxMoveSpeedMultiplier,
      state.speedMultiplier + playerCfg.moveSpeedUpgradeRate
    );
    const healthNextMax = Math.min(
      linaCfg.maxHealth,
      state.maxLives + linaCfg.healthUpgradeAmount
    );
    const durabilityNextMax = Math.min(
      barrierCfg.maxDurability,
      state.barrier.maxDurability + barrierCfg.durabilityUpgradeAmount
    );
    const radiusNextMultiplier = Math.min(
      barrierCfg.maxRadiusMultiplier,
      state.barrier.radiusMultiplier + barrierCfg.radiusUpgradeRate
    );

    return [
      {
        id: 'speed',
        def: GAME_CONFIG.upgrades.speed,
        label: '移动速度',
        description: `许飞移动速度提升 ${Math.round(playerCfg.moveSpeedUpgradeRate * 100)}%，更快拦截敌人。`,
        currentText: `${Math.round(playerCfg.baseMoveSpeed * state.speedMultiplier)}`,
        nextText: `${Math.round(playerCfg.baseMoveSpeed * speedNextMultiplier)}`,
        currentValue: state.speedMultiplier,
        nextValue: speedNextMultiplier,
        maxed: speedNextMultiplier <= state.speedMultiplier + 0.0001
      },
      {
        id: 'health',
        def: GAME_CONFIG.upgrades.health,
        label: '厉娜体力',
        description: `厉娜体力上限 +${linaCfg.healthUpgradeAmount}，并立即恢复 ${linaCfg.healthUpgradeAmount} 点体力。`,
        currentText: `${state.lives} / ${state.maxLives}`,
        nextText: `${Math.min(healthNextMax, state.lives + linaCfg.healthUpgradeAmount)} / ${healthNextMax}`,
        currentValue: state.maxLives,
        nextValue: healthNextMax,
        maxed: healthNextMax <= state.maxLives
      },
      {
        id: 'durability',
        def: GAME_CONFIG.upgrades.durability,
        label: '牢笼上限',
        description: `牢笼耐久上限 +${barrierCfg.durabilityUpgradeAmount}，并恢复新增的耐久。`,
        currentText: `${state.barrier.maxDurability} 次`,
        nextText: `${durabilityNextMax} 次`,
        currentValue: state.barrier.maxDurability,
        nextValue: durabilityNextMax,
        maxed: durabilityNextMax <= state.barrier.maxDurability
      },
      {
        id: 'radius',
        def: GAME_CONFIG.upgrades.radius,
        label: '牢笼范围',
        description: `牢笼防御范围扩大 ${Math.round(barrierCfg.radiusUpgradeRate * 100)}%，更早弹开敌人。`,
        currentText: `${Math.round(state.barrier.radiusMultiplier * 100)}%`,
        nextText: `${Math.round(radiusNextMultiplier * 100)}%`,
        currentValue: state.barrier.radiusMultiplier,
        nextValue: radiusNextMultiplier,
        maxed: radiusNextMultiplier <= state.barrier.radiusMultiplier + 0.0001
      }
    ];
  }

  function buildUpgradeCards() {
    dom.upgradeGrid.replaceChildren();
    const options = getUpgradeOptions();
    options.forEach((option) => {
      const def = option.def;
      const card = document.createElement('article');
      card.className = `upgrade-card theme-${def.theme}${option.maxed ? ' maxed' : ''}`;
      card.innerHTML =
        `<div class="upgrade-card-head">` +
          `<div class="upgrade-icon" aria-hidden="true">${def.icon}</div>` +
          `<h3 class="upgrade-name">${def.name}</h3>` +
        `</div>` +
        `<p>${option.description}</p>` +
        `<div class="upgrade-values">` +
          `<span>${option.label} <strong>${option.currentText}</strong></span>` +
          `<span class="arrow">→</span>` +
          `<span>强化后 <strong>${option.nextText}</strong></span>` +
        `</div>` +
        `<button class="upgrade-select" type="button" data-upgrade="${option.id}"` +
          `${option.maxed ? ' disabled' : ''}>${option.maxed ? '已达上限' : '选择此强化'}</button>`;
      dom.upgradeGrid.appendChild(card);
    });
  }

  function openUpgradeScreen() {
    if (state.mode !== GAME_STATE.LEVEL_CLEAR) return;
    if (state.level >= getMaxLevel()) {
      showFinalWin();
      return;
    }
    state.mode = GAME_STATE.UPGRADE;
    state.paused = false;
    state.upgradeLocked = false;
    hideAllScreens();
    showScreen(dom.upgradeScreen);
    syncBodyClasses();
    dom.upgradeSub.textContent = `第${state.level}关通关奖励 · 只能选择一项，强化会保留到后续关卡。`;
    buildUpgradeCards();
    dom.liveStatus.textContent = '请选择一项通关强化。';
  }

  function chooseUpgrade(id) {
    if (state.mode !== GAME_STATE.UPGRADE || state.upgradeLocked) return;
    const option = getUpgradeOptions().find((item) => item.id === id);
    if (!option || option.maxed) return;
    state.upgradeLocked = true;
    dom.upgradeGrid.querySelectorAll('.upgrade-select').forEach((button) => {
      button.disabled = true;
    });

    if (id === 'speed') {
      state.speedMultiplier = option.nextValue;
    } else if (id === 'health') {
      state.maxLives = option.nextValue;
      state.lives = Math.min(
        state.maxLives,
        state.lives + GAME_CONFIG.lina.healthUpgradeAmount
      );
    } else if (id === 'durability') {
      state.barrier.maxDurability = option.nextValue;
      state.barrier.durability = Math.min(
        state.barrier.maxDurability,
        state.barrier.durability + GAME_CONFIG.barrier.durabilityUpgradeAmount
      );
    } else if (id === 'radius') {
      state.barrier.radiusMultiplier = option.nextValue;
      refreshBarrierRadius();
    }

    state.lastUpgrade = {
      id,
      name: option.def.name,
      summary: `${option.def.name}：${option.currentText} → ${option.nextText}`
    };
    state.upgradeHistory.push(id);
    updateHUD(true);
    showNextLevelScreen();
  }

  function showNextLevelScreen() {
    if (state.mode !== GAME_STATE.UPGRADE) return;
    const max = getMaxLevel();
    const nextNumber = Math.min(state.level + 1, max);
    state.nextLevel = nextNumber;
    state.mode = GAME_STATE.NEXT_LEVEL;
    state.paused = false;
    hideAllScreens();
    showScreen(dom.nextLevelScreen);
    syncBodyClasses();

    const next = GAME_CONFIG.level.levels[nextNumber - 1] || currentLevelConfig();
    dom.nextLevelNumber.textContent = `第${nextNumber}关`;
    dom.nextLevelTitle.textContent = next.title.replace(/^第\d+关[:：]\s*/, '');
    dom.nextLevelHint.textContent = next.hint;
    dom.upgradeFeedback.hidden = false;
    dom.upgradeFeedbackText.textContent = state.lastUpgrade ? state.lastUpgrade.summary : '强化已生效';
    dom.nextSpeed.textContent = String(Math.round(GAME_CONFIG.player.baseMoveSpeed * state.speedMultiplier));
    dom.nextLives.textContent = `${state.lives} / ${state.maxLives}`;
    dom.nextBarrier.textContent = `${state.barrier.maxDurability} 次`;
    dom.startNextBtn.textContent = `开始第${nextNumber}关`;
    dom.liveStatus.textContent = `强化成功。准备开始第 ${nextNumber} 关。`;
  }

  function startNextLevel() {
    if (state.mode !== GAME_STATE.NEXT_LEVEL) return;
    startLevel(state.nextLevel);
  }

  function showGameOver() {
    if (state.mode !== GAME_STATE.PLAYING) return;
    state.mode = GAME_STATE.GAMEOVER;
    state.paused = false;
    state.lives = 0;
    state.finalTime = state.elapsed;
    state.finalTotalScore = state.totalScore + state.score;
    state.keys.clear();
    resetJoystick();
    hideAllScreens();
    showScreen(dom.endScreen);
    syncBodyClasses();
    clearAnnouncement();
    updateHUD(true);
    populateEndScreen(false);
    AudioManager.playMusic('gameover');
    AudioManager.playSfx('uiDefeat');
    addShockwave(state.lena.x, state.lena.y, view.barrierR * 1.25, 'rgba(255, 73, 110, .8)', 6);
    addBurst(state.lena.x, state.lena.y, 28, ['#ff718f', '#ffb7c7', '#6f3e4c', '#ffe3b5'], {
      speed: 290,
      size: 6,
      gravity: 260,
      life: 1.25,
      shapes: ['heart', 'circle', 'star']
    });
  }

  function showFinalWin() {
    if (
      state.mode !== GAME_STATE.LEVEL_CLEAR &&
      state.mode !== GAME_STATE.PLAYING &&
      state.mode !== GAME_STATE.NEXT_LEVEL &&
      state.mode !== GAME_STATE.UPGRADE
    ) return;
    state.mode = GAME_STATE.WIN;
    state.paused = false;
    state.finalTotalScore = state.totalScore;
    state.keys.clear();
    resetJoystick();
    hideAllScreens();
    showScreen(dom.endScreen);
    syncBodyClasses();
    clearAnnouncement();
    updateHUD(true);
    populateEndScreen(true);
    AudioManager.playMusic('victory');
    AudioManager.playSfx('uiVictory');
    spawnConfetti();
  }

  function populateEndScreen(won) {
    const max = getMaxLevel();
    const total = won ? state.totalScore : (state.finalTotalScore != null ? state.finalTotalScore : state.totalScore + state.score);
    dom.endPanel.classList.toggle('win', won);
    dom.endPanel.classList.toggle('lose', !won);
    dom.endEmblem.textContent = won ? '牢' : '缺';
    dom.endKicker.textContent = won ? `${max} 关全部守护成功` : '守护失败';
    dom.endTitle.textContent = won ? '牢不可破！' : '哎呀，牢有缺口！';

    const paragraphs = won
      ? [
          `你带着厉娜通过了全部 ${max} 关！`,
          `一共弹飞了 ${total} 个外界干扰。`
        ]
      : [
          '许飞，你还是没守住啊！',
          `第${state.level}关，厉娜的体力值归零了。`
        ];
    dom.endCopy.replaceChildren();
    paragraphs.forEach((text, i) => {
      const p = document.createElement('p');
      p.textContent = text;
      if (!won && i === 1) p.style.fontWeight = '850';
      dom.endCopy.appendChild(p);
    });

    dom.endTime.textContent = won ? String(max) : String(state.level);
    dom.endTimeLabel.innerHTML = won ? '关<br>全部通关' : '关<br>到达关卡';
    dom.endScore.textContent = String(total);
    dom.endScoreLabel.innerHTML = won ? '个<br>总弹飞' : '个<br>本局弹飞';
    dom.endQuote.textContent = won
      ? '此生不破此牢！'
      : '厉娜：你这牢怎么还有个缺口？';
    dom.restartBtn.textContent = won ? '从第1关再来' : '重新守护';
    dom.liveStatus.textContent = won
      ? `全部 ${max} 关守护成功，一共弹飞 ${total} 个干扰。`
      : `守护失败。到达第 ${state.level} 关，本局弹飞 ${total} 个干扰。`;
  }

  function pauseGame() {
    if (state.mode !== GAME_STATE.PLAYING || state.paused) return;
    state.paused = true;
    state.keys.clear();
    resetJoystick();
    AudioManager.pauseMusic();
    syncBodyClasses();
    setScreen(dom.pauseScreen, true);
    dom.pauseBtn.setAttribute('aria-label', '继续游戏');
    dom.liveStatus.textContent = '游戏已暂停。';
    window.setTimeout(() => {
      if (state.paused) {
        try { dom.resumeBtn.focus({ preventScroll: true }); } catch (err) { dom.resumeBtn.focus(); }
      }
    }, 80);
  }

  function resumeGame() {
    if (state.mode !== GAME_STATE.PLAYING || !state.paused) return;
    state.paused = false;
    lastFrame = performance.now();
    AudioManager.resumeMusic();
    syncBodyClasses();
    setScreen(dom.pauseScreen, false);
    dom.pauseBtn.setAttribute('aria-label', '暂停游戏');
    dom.liveStatus.textContent = '继续守护。';
    try { dom.canvas.focus(); } catch (err) { /* canvas 无需焦点 */ }
  }

  function keepPlayerOutOfLena() {
    if (!state.player || !state.lena) return;
    const minDist = state.lena.r + playerRadius() + GAME_CONFIG.player.lenaKeep * view.s;
    let dx = state.player.x - state.lena.x;
    let dy = state.player.y - state.lena.y;
    let dist = Math.hypot(dx, dy);
    if (dist < minDist) {
      if (dist < 0.001) {
        dx = 0;
        dy = 1;
        dist = 1;
      }
      state.player.x = state.lena.x + dx / dist * minDist;
      state.player.y = state.lena.y + dy / dist * minDist;
    }
  }

  /* ============================================================
     8. 游戏更新
     ============================================================ */
  function chooseEnemyType(weights) {
    const roll = Math.random();
    let sum = 0;
    for (const key of ['crowd', 'memory', 'marriage']) {
      sum += weights[key] || 0;
      if (roll <= sum) return key;
    }
    return 'crowd';
  }

  function spawnEnemy(forcedType) {
    if (state.enemies.length >= GAME_CONFIG.performance.maxEnemies) return;
    const levelCfg = currentLevelConfig();
    const typeKey = forcedType || chooseEnemyType(levelCfg.weights);
    const cfg = ENEMY_TYPES[typeKey];
    const scale = clamp(view.s, 0.82, 1.38);
    const r = cfg.radius * scale;
    const edge = randInt(0, 3);
    const pad = 28;
    let x = 0;
    let y = 0;

    if (edge === 0) {
      x = rand(pad, view.w - pad);
      y = -r - 9;
    } else if (edge === 1) {
      x = view.w + r + 9;
      y = rand(48, view.h - 30);
    } else if (edge === 2) {
      x = rand(pad, view.w - pad);
      y = view.h + r + 9;
    } else {
      x = -r - 9;
      y = rand(48, view.h - 30);
    }

    const e = {
      type: typeKey,
      x,
      y,
      r,
      hp: cfg.hp,
      maxHp: cfg.hp,
      speed: cfg.speed * levelCfg.speedMultiplier * view.speedScale * rand(0.92, 1.08),
      vx: 0,
      vy: 0,
      age: 0,
      hitCd: 0,
      flash: 0,
      stun: 0,
      barrierCd: 0,
      barrierMoveTime: 0,
      barrierVx: 0,
      barrierVy: 0,
      flying: false,
      defeated: false,
      dead: false,
      spin: 0,
      spinAngle: 0,
      drag: cfg.drag,
      seed: rand(0, 10),
      wobble: rand(0, TAU),
      wobbleAmp: rand(7, 17) * view.s,
      trailTimer: 0
    };
    state.enemies.push(e);
  }

  function updateSpawner(dt) {
    state.spawnTimer -= dt;
    if (state.spawnTimer > 0) return;
    if (state.enemies.length >= GAME_CONFIG.performance.maxEnemies) {
      state.spawnTimer = 0.45;
      return;
    }

    const levelCfg = currentLevelConfig();
    const ramp = getSpawnRamp(state.elapsed);
    const count = randInt(levelCfg.spawnCount[0], levelCfg.spawnCount[1]);
    for (let i = 0; i < count; i++) spawnEnemy();

    const interval = Math.max(
      GAME_CONFIG.level.minSpawnInterval,
      levelCfg.spawnInterval * ramp.intervalScale * rand(0.9, 1.1)
    );
    state.spawnTimer = interval;
  }

  function movePlayer(dt) {
    const p = state.player;
    if (!p) return;
    const input = getInputVector();
    const speed = currentPlayerSpeed() * view.speedScale;
    const pr = playerRadius();

    if (input.length > 0.01) {
      p.x += input.x * speed * dt;
      p.y += input.y * speed * dt;
      p.moving = true;
      p.walk += dt * (7.6 + input.length * 7.4);
      p.facing = angleLerp(p.facing, Math.atan2(input.y, input.x), 1 - Math.exp(-dt * 14));
      p.dustTimer -= dt;
      if (p.dustTimer <= 0) {
        p.dustTimer = 0.09;
        addDustParticle(p.x, p.y + pr * 1.2);
      }
    } else {
      p.moving = false;
      p.dustTimer = 0;
    }

    p.x = clamp(p.x, pr + 4, view.w - pr - 4);
    p.y = clamp(p.y, view.topBound + pr, view.h - pr - 6);
    keepPlayerOutOfLena();
    p.x = clamp(p.x, pr + 4, view.w - pr - 4);
    p.y = clamp(p.y, view.topBound + pr, view.h - pr - 6);
  }

  function hitEnemy(e) {
    const p = state.player;
    const cfg = ENEMY_TYPES[e.type];
    AudioManager.playSfx('collision');
    AudioManager.playSfx('enemyKnockback');
    let dx = e.x - p.x;
    let dy = e.y - p.y;
    let dist = Math.hypot(dx, dy);
    if (dist < 0.001) {
      dx = Math.cos(e.seed);
      dy = Math.sin(e.seed);
      dist = 1;
    }
    const nx = dx / dist;
    const ny = dy / dist;

    e.hitCd = 0.56;
    e.flash = 0.22;
    state.shieldPulse = 1;
    state.lastBlockAngle = Math.atan2(e.y - p.y, e.x - p.x);
    state.shake = Math.max(state.shake, 3.8);

    addShockwave(p.x, p.y, defenseRadius() * 1.12, 'rgba(85, 162, 255, .7)', 3);
    addBurst(e.x, e.y, 7, cfg.colors, {
      speed: 150,
      size: 4,
      gravity: 210,
      life: 0.48,
      shapes: ['circle', 'star']
    });

    if (e.hp > 1) {
      e.hp--;
      e.stun = 0.28;
      e.vx = nx * 245 * view.speedScale;
      e.vy = ny * 245 * view.speedScale;
      e.dead = false;
      if (e.type === 'marriage' && Math.random() < 0.75) {
        addPopup('格挡！还差一下！', e.x, e.y - e.r * 2.2, {
          color: '#8a55e6',
          size: 14,
          life: 0.8,
          vy: -34
        });
      }
      return;
    }

    e.hp = 0;
    e.flying = true;
    e.defeated = true;
    e.hitCd = 99;
    const tangent = rand(-1, 1);
    const burstSpeed = cfg.flySpeed * view.speedScale;
    e.vx = (nx - ny * tangent * 0.38) * burstSpeed;
    e.vy = (ny + nx * tangent * 0.38) * burstSpeed;
    e.spin = rand(-13, 13);
    e.spinAngle = 0;
    e.stun = 0;
    state.score++;
    state.shake = Math.max(state.shake, 5.5);
    updateHUD();

    addShockwave(e.x, e.y, 54 * view.s, 'rgba(255, 248, 214, .9)', 4);
    addBurst(e.x, e.y, 13, cfg.colors, {
      speed: 260,
      size: 5,
      gravity: 220,
      life: 0.7,
      shapes: ['star', 'circle', 'heart']
    });

    if (e.type === 'marriage') {
      addPopup('催婚怪，退散！', e.x, e.y - e.r * 2.4, {
        color: '#8a55e6',
        size: 17,
        life: 1.05,
        vy: -42
      });
    } else if (Math.random() < 0.58) {
      addPopup(pick(KNOCK_WORDS), e.x, e.y - e.r * 2.2, {
        color: Math.random() < 0.5 ? '#ff5d86' : '#2f87df',
        size: 17,
        life: 0.9,
        vy: -48
      });
    }
  }

  function triggerBarrierDefense(e) {
    if (!isBarrierActive() || e.dead || e.flying || e.barrierCd > 0) return false;

    const l = state.lena;
    const cfg = GAME_CONFIG.barrier;
    let dx = e.x - l.x;
    let dy = e.y - l.y;
    let dist = Math.hypot(dx, dy);
    let nx;
    let ny;
    if (dist < 0.001) {
      // 与中心几乎重合时给一个由敌人 seed 决定的稳定默认方向，避免 NaN。
      const fallback = (e.seed || 0) * 1.7 + 0.4;
      nx = Math.cos(fallback);
      ny = Math.sin(fallback);
      dist = 1;
    } else {
      nx = dx / dist;
      ny = dy / dist;
    }

    const duration = Math.max(0.05, cfg.knockbackDuration);
    const speed = cfg.knockbackDistance / duration;
    e.barrierVx = nx * speed;
    e.barrierVy = ny * speed;
    e.barrierMoveTime = duration;
    e.barrierCd = cfg.enemyHitCooldown;
    e.stun = 0;
    e.flash = 0.14;

    const angle = Math.atan2(ny, nx);
    state.barrier.durability = Math.max(0, state.barrier.durability - 1);
    state.barrier.flash = 1;
    state.barrier.cracks.push(angle);
    if (state.barrier.cracks.length > 40) state.barrier.cracks.shift();
    // 每次真实耐久减少播放一次碰撞/裂纹音效；破碎时再额外播放一次破碎音效。
    AudioManager.playSfx('collision');
    AudioManager.playSfx('barrierCrack');

    const hitX = l.x + nx * view.barrierR;
    const hitY = l.y + ny * view.barrierR;
    state.shake = Math.max(state.shake, 5.5);
    addShockwave(l.x, l.y, view.barrierR * 1.08, 'rgba(255, 213, 85, .82)', 3);
    addShockwave(hitX, hitY, 34 * view.s, 'rgba(255, 255, 222, .95)', 2.5);
    addBurst(hitX, hitY, 11, ['#ffd85e', '#fff4b8', '#9fd6ff', '#ffa3b9'], {
      speed: 190,
      size: 4.5,
      gravity: 180,
      life: 0.65,
      shapes: ['star', 'circle', 'heart']
    });

    if (state.barrier.durability <= 0) {
      state.barrier.breakPulse = 1;
      state.shake = Math.max(state.shake, 14);
      addShockwave(l.x, l.y, view.barrierR * 1.35, 'rgba(255, 104, 132, .92)', 6);
      addBurst(l.x, l.y, 30, ['#ffd66c', '#ff8fa7', '#87515a', '#fff0bb'], {
        speed: 290,
        size: 6,
        gravity: 240,
        life: 1.1,
        shapes: ['star', 'circle', 'heart']
      });
      addPopup('牢笼失效！', l.x, l.y - view.barrierR * 0.4, {
        color: '#ff486b',
        size: 24,
        life: 1.55,
        vy: -28
      });
      AudioManager.playSfx('barrierBreak');
      dom.liveStatus.textContent = '牢笼耐久归零，牢笼失效！许飞仍可自由进出，登山杖格挡仍然有效。';
    } else {
      if (Math.random() < (state.barrier.durability <= 1 ? 0.9 : 0.55)) {
        addPopup(
          state.barrier.durability <= 1 ? '结界裂开了！' : '牢笼挡住了！',
          hitX,
          hitY - 12 * view.s,
          { color: '#b97b1b', size: 16, life: 0.85, vy: -34 }
        );
      }
      dom.liveStatus.textContent = `牢笼挡下了一次攻击，还剩 ${state.barrier.durability} 次耐久。`;
    }

    updateHUD();
    return true;
  }

  function vibrateShortFeedback() {
    // 平台振动能力（客户端 9.50+）；不支持时静默降级，不使用被收紧的 Web Vibration API。
    const miniTool = window.xhs && window.xhs.miniTool;
    if (!miniTool || typeof miniTool.vibrateShort !== 'function') return;
    try {
      const result = miniTool.vibrateShort({ type: 'medium' });
      if (result && typeof result.catch === 'function') result.catch(function () {});
    } catch (err) {
      // 振动失败不影响游戏。
    }
  }

  function damageLena(e) {
    if (e.dead || e.flying) return;
    e.dead = true;
    state.lives = Math.max(0, state.lives - 1);
    state.lena.hurt = 1;
    state.flash = 1;
    state.shake = Math.max(state.shake, 15);

    addShockwave(state.lena.x, state.lena.y, view.barrierR * 0.92, 'rgba(255, 72, 112, .75)', 5);
    addBurst(state.lena.x, state.lena.y, 19, ['#ff657f', '#ffb2c0', '#66333e', '#ffd9a0'], {
      speed: 245,
      size: 6,
      gravity: 280,
      life: 0.95,
      shapes: ['heart', 'star', 'circle']
    });
    if (Math.random() < 0.8) {
      addPopup(pick(HURT_WORDS), state.lena.x, state.lena.y - state.lena.r * 2.8, {
        color: '#ff486b',
        size: 19,
        life: 0.95,
        vy: -38
      });
    }

    AudioManager.playSfx('linaHurt');
    vibrateShortFeedback();
    updateHUD();
    dom.liveStatus.textContent = `厉娜受到攻击，还剩 ${state.lives} 点体力。`;
  }

  function updateEnemies(dt) {
    const p = state.player;
    const l = state.lena;
    if (!p || !l) return;
    const shield = defenseRadius();

    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (e.dead) continue;
      e.age += dt;
      if (e.hitCd > 0) e.hitCd = Math.max(0, e.hitCd - dt);
      if (e.flash > 0) e.flash = Math.max(0, e.flash - dt);
      if (e.barrierCd > 0) e.barrierCd = Math.max(0, e.barrierCd - dt);

      if (e.flying) {
        e.spinAngle += e.spin * dt;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        const drag = Math.exp(-e.drag * dt);
        e.vx *= drag;
        e.vy *= drag;
        e.trailTimer -= dt;
        if (e.trailTimer <= 0 && state.particles.length < GAME_CONFIG.performance.maxParticles) {
          e.trailTimer = 0.045;
          const colors = ENEMY_TYPES[e.type].colors;
          addParticle(e.x + rand(-e.r * 0.4, e.r * 0.4), e.y + rand(-e.r * 0.4, e.r * 0.4), {
            vx: -e.vx * 0.035 + rand(-24, 24),
            vy: -e.vy * 0.035 + rand(-24, 24),
            gravity: 30,
            size: rand(2, 4.5),
            life: 0.32,
            maxLife: 0.32,
            color: pick(colors),
            shape: 'circle',
            drag: 0.8
          });
        }
        if (e.x < -150 || e.x > view.w + 150 || e.y < -150 || e.y > view.h + 150) {
          e.dead = true;
        }
        continue;
      }

      // 牢笼弹飞：只位移，不影响敌人血量、死亡状态和弹飞计数。
      if (e.barrierMoveTime > 0) {
        const step = Math.min(dt, e.barrierMoveTime);
        e.x += e.barrierVx * step;
        e.y += e.barrierVy * step;
        e.barrierMoveTime = Math.max(0, e.barrierMoveTime - step);
        continue;
      }

      if (e.stun > 0) {
        e.stun -= dt;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        const drag = Math.exp(-4.7 * dt);
        e.vx *= drag;
        e.vy *= drag;
      } else {
        let dx = l.x - e.x;
        let dy = l.y - e.y;
        const dist = Math.hypot(dx, dy) || 1;
        dx /= dist;
        dy /= dist;
        e.wobble += dt * 2.3;
        const sway = Math.sin(e.wobble + e.seed) * e.wobbleAmp;
        e.x += (dx * e.speed - dy * sway) * dt;
        e.y += (dy * e.speed + dx * sway) * dt;
      }

      // 许飞登山杖优先拦截；没有拦到且牢笼有耐久时再由牢笼弹开。
      const pdx = e.x - p.x;
      const pdy = e.y - p.y;
      if (e.hitCd <= 0 && Math.hypot(pdx, pdy) < shield + e.r) {
        hitEnemy(e);
      }

      if (!e.flying && !e.dead && isBarrierActive() && e.barrierCd <= 0) {
        const barrierDx = e.x - l.x;
        const barrierDy = e.y - l.y;
        if (Math.hypot(barrierDx, barrierDy) <= view.barrierR + e.r) {
          if (triggerBarrierDefense(e)) continue;
        }
      }

      if (!e.flying && !e.dead) {
        const ldx = e.x - l.x;
        const ldy = e.y - l.y;
        if (Math.hypot(ldx, ldy) < l.r + e.r * 0.72) {
          damageLena(e);
        }
      }
    }

    state.enemies = state.enemies.filter((e) => !e.dead);
  }

  function showPlayerQuip(text) {
    if (!state.player || state.mode !== GAME_STATE.PLAYING) return;
    // 不在这里固定气泡坐标；followPlayer 会让 drawPopups 每帧实时计算位置。
    addPopup(text, state.player.x, state.player.y, {
      style: 'bubble',
      color: '#2f6bbd',
      size: clamp(13 * view.s, 12, 17),
      life: 1.75,
      vy: 0,
      vx: 0,
      maxWidth: 190,
      followPlayer: true
    });
  }

  function updateQuips(dt) {
    if (state.introQuip > 0) {
      state.introQuip -= dt;
      if (state.introQuip <= 0) {
        state.lastQuip = QUIPS.length - 1;
        showPlayerQuip('我画地为牢啊，厉娜！');
      }
    }
    state.nextQuip -= dt;
    if (state.nextQuip <= 0) {
      let index = randInt(0, QUIPS.length - 1);
      if (index === state.lastQuip) index = (index + 1) % QUIPS.length;
      state.lastQuip = index;
      showPlayerQuip(QUIPS[index]);
      state.nextQuip = rand(7.5, 11.5);
    }
  }

  function checkMilestones() {
    GAME_CONFIG.milestones.forEach((milestone, index) => {
      const key = `milestone${index}`;
      if (!state.flags[key] && state.elapsed >= milestone.at) {
        state.flags[key] = true;
        displayAnnouncement(milestone.title, milestone.subtitle, milestone.variant || '');
      }
    });
  }

  function updateGame(dt) {
    state.elapsed += dt;
    updateSpawner(dt);
    movePlayer(dt);
    updateEnemies(dt);
    updateQuips(dt);
    checkMilestones();
    updateHUD();

    if (state.lives <= 0) {
      state.lives = 0;
      showGameOver();
      return;
    }
    if (state.elapsed >= GAME_CONFIG.level.duration) {
      state.elapsed = GAME_CONFIG.level.duration;
      completeLevel();
    }
  }

  /* ============================================================
     9. 粒子、飘字、屏幕效果
     ============================================================ */
  function addParticle(x, y, options = {}) {
    if (state.particles.length >= GAME_CONFIG.performance.maxParticles) return;
    const life = options.life != null ? options.life : 0.7;
    const maxLife = options.maxLife != null ? options.maxLife : life;
    state.particles.push({
      x,
      y,
      vx: options.vx || 0,
      vy: options.vy || 0,
      gravity: options.gravity != null ? options.gravity : 180,
      drag: options.drag != null ? options.drag : 0.4,
      size: options.size != null ? options.size : 4,
      life,
      maxLife,
      color: options.color || '#ff8aa9',
      shape: options.shape || 'circle',
      rot: options.rot || rand(0, TAU),
      spin: options.spin != null ? options.spin : rand(-8, 8)
    });
  }

  function addBurst(x, y, count, colors, options = {}) {
    const speed = options.speed || 190;
    const shapes = options.shapes || ['circle'];
    const spread = options.spread != null ? options.spread : TAU;
    const baseAngle = options.angle != null ? options.angle : 0;
    for (let i = 0; i < count; i++) {
      const angle = options.angle != null
        ? baseAngle + rand(-spread / 2, spread / 2)
        : rand(0, TAU);
      const velocity = speed * rand(0.45, 1.15);
      addParticle(x, y, {
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        gravity: options.gravity != null ? options.gravity : 200,
        drag: options.drag != null ? options.drag : 0.55,
        size: (options.size || 5) * rand(0.65, 1.25),
        life: (options.life || 0.7) * rand(0.7, 1.15),
        color: pick(colors),
        shape: pick(shapes)
      });
    }
  }

  function addDustParticle(x, y) {
    if (state.particles.length >= GAME_CONFIG.performance.maxParticles - 20) return;
    addParticle(x + rand(-5, 5), y, {
      vx: rand(-16, 16),
      vy: rand(-8, 2),
      gravity: -5,
      drag: 1.3,
      size: rand(2.2, 4.6),
      life: 0.35,
      color: 'rgba(174, 129, 104, .35)',
      shape: 'circle'
    });
  }

  function addShockwave(x, y, maxR, color, width) {
    state.shockwaves.push({
      x,
      y,
      maxR,
      color,
      width: width || 3,
      life: 0.48,
      maxLife: 0.48
    });
    if (state.shockwaves.length > 26) state.shockwaves.shift();
  }

  function addPopup(text, x, y, options = {}) {
    const life = options.life || 1.1;
    const item = {
      text,
      x: clamp(x, 46, view.w - 46),
      y: clamp(y, 50, view.h - 25),
      color: options.color || '#ff5d86',
      size: options.size || 18,
      style: options.style || 'pop',
      life,
      maxLife: life,
      vy: options.vy != null ? options.vy : -42,
      vx: options.vx != null ? options.vx : rand(-7, 7),
      seed: rand(0, TAU),
      maxWidth: options.maxWidth || 210,
      tail: options.tail || 'down',
      followPlayer: !!options.followPlayer
    };
    state.popups.push(item);
    if (state.popups.length > 22) state.popups.shift();
  }

  function spawnConfetti() {
    const colors = ['#ff6f9c', '#ffc94a', '#4f9dff', '#3cba86', '#a97bff', '#ff8e53', '#fff1a9'];
    const count = reduceMotion ? 40 : 125;
    for (let i = 0; i < count; i++) {
      addParticle(rand(0, view.w), rand(-view.h * 0.3, -8), {
        vx: rand(-48, 48),
        vy: rand(45, 165),
        gravity: rand(55, 105),
        drag: 0.2,
        size: rand(4.5, 9),
        life: rand(2.3, 4.2),
        color: pick(colors),
        shape: 'confetti',
        rot: rand(0, TAU),
        spin: rand(-9, 9)
      });
    }
  }

  function updateVisuals(dt) {
    state.shake = Math.max(0, state.shake - dt * (reduceMotion ? 21 : 34));
    state.flash = Math.max(0, state.flash - dt * 2.7);
    state.shieldPulse = Math.max(0, state.shieldPulse - dt * 2.2);
    state.barrier.flash = Math.max(0, state.barrier.flash - dt * 2.6);
    const breakWasAnimating = state.barrier.breakPulse > 0;
    state.barrier.breakPulse = Math.max(0, state.barrier.breakPulse - dt * 0.9);
    // BUG 修复：破碎动画结束后再移除失效牢笼上的耐久裂痕。
    if (breakWasAnimating && state.barrier.breakPulse === 0 && state.barrier.durability <= 0) {
      state.barrier.cracks.length = 0;
    }
    if (state.lena) state.lena.hurt = Math.max(0, state.lena.hurt - dt * 2.2);

    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.life -= dt;
      p.vy += p.gravity * dt;
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      if (p.life <= 0 || p.y > view.h + 80 || p.x < -80 || p.x > view.w + 80) {
        state.particles.splice(i, 1);
      }
    }

    for (let i = state.popups.length - 1; i >= 0; i--) {
      const p = state.popups[i];
      p.life -= dt;
      if (!p.followPlayer) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy *= Math.exp(-1.8 * dt);
      }
      if (p.life <= 0) state.popups.splice(i, 1);
    }

    for (let i = state.shockwaves.length - 1; i >= 0; i--) {
      const wave = state.shockwaves[i];
      wave.life -= dt;
      if (wave.life <= 0) state.shockwaves.splice(i, 1);
    }
  }

  /* ============================================================
     10. 绘制工具与角色
     ============================================================ */
  function drawShadow(g, x, y, rx, ry, alpha = 0.15) {
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = '#5b392c';
    ellipse(g, x, y, rx, ry);
    g.fill();
    g.restore();
  }

  function drawDoodle(g, d, t) {
    const bob = Math.sin(t * 0.7 + d.phase) * 1.6;
    g.save();
    g.translate(d.x, d.y + bob);
    g.rotate(d.rot + Math.sin(t * 0.35 + d.phase) * 0.06);
    g.globalAlpha = d.alpha;
    g.strokeStyle = d.color;
    g.fillStyle = d.color;
    g.lineWidth = 2.2;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    if (d.kind === 'heart') {
      heartPath(g, 0, 0, d.size);
      g.fill();
    } else if (d.kind === 'star') {
      starPath(g, 0, 0, d.size, 5, 0.44);
      g.fill();
    } else if (d.kind === 'plus') {
      g.beginPath();
      g.moveTo(-d.size, 0);
      g.lineTo(d.size, 0);
      g.moveTo(0, -d.size);
      g.lineTo(0, d.size);
      g.stroke();
    } else if (d.kind === 'swirl') {
      g.beginPath();
      for (let i = 0; i < 30; i++) {
        const a = i * 0.34;
        const r = d.size * i / 30;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    } else {
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * TAU - Math.PI / 2;
        g.beginPath();
        g.arc(Math.cos(a) * d.size * 0.55, Math.sin(a) * d.size * 0.55, d.size * 0.32, 0, TAU);
        g.fill();
      }
      g.beginPath();
      g.arc(0, 0, d.size * 0.24, 0, TAU);
      g.fillStyle = '#ffd65e';
      g.fill();
    }
    g.restore();
  }

  function drawBackground(t) {
    const g = ctx;
    const w = view.w;
    const h = view.h;
    const base = g.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, '#fff9eb');
    base.addColorStop(0.48, '#fff3dd');
    base.addColorStop(1, '#ffeacf');
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);

    g.save();
    g.globalAlpha = 0.78;
    drawSoftBlob(g, w * 0.11, h * 0.18, Math.max(w, h) * 0.32, 'rgba(255, 184, 205, .22)');
    drawSoftBlob(g, w * 0.92, h * 0.1, Math.max(w, h) * 0.26, 'rgba(147, 203, 255, .16)');
    drawSoftBlob(g, w * 0.82, h * 0.9, Math.max(w, h) * 0.36, 'rgba(255, 211, 122, .16)');
    drawSoftBlob(g, w * 0.08, h * 0.92, Math.max(w, h) * 0.23, 'rgba(170, 231, 207, .14)');
    g.restore();

    const spacing = Math.max(34, Math.min(w, h) / 18);
    g.save();
    g.fillStyle = 'rgba(126, 85, 64, .1)';
    for (let y = spacing * 0.55; y < h; y += spacing) {
      for (let x = spacing * 0.55; x < w; x += spacing) {
        g.beginPath();
        g.arc(x, y, 1.05, 0, TAU);
        g.fill();
      }
    }
    g.restore();

    for (let i = 0; i < view.doodles.length; i++) {
      drawDoodle(g, view.doodles[i], t);
    }
  }

  function drawSoftBlob(g, x, y, r, color) {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }

  function drawBarrierCracks(g, r, s, strong) {
    const cracks = state.barrier.cracks;
    if (!cracks.length) return;
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (let i = 0; i < cracks.length; i++) {
      const a = cracks[i];
      g.save();
      g.rotate(a);
      const start = r * (0.54 + (i % 4) * 0.035);
      const isLatest = i === cracks.length - 1;
      g.strokeStyle = isLatest
        ? 'rgba(113, 50, 57, .92)'
        : `rgba(122, 69, 64, ${strong ? .72 : .48})`;
      g.lineWidth = (isLatest ? 3.1 : strong ? 2.4 : 1.9) * s;
      g.beginPath();
      g.moveTo(start, 0);
      g.lineTo(r * 0.74, -4.8 * s);
      g.lineTo(r * 0.81, 3.4 * s);
      g.lineTo(r * 0.91, -2.6 * s);
      g.lineTo(r * 1.02, 2.1 * s);
      if (strong) {
        g.moveTo(r * 0.78, 0);
        g.lineTo(r * 0.86, 6 * s);
        g.lineTo(r * 0.93, 3.2 * s);
      }
      g.stroke();
      g.restore();
    }
    g.restore();
  }

  function drawBarrier(t) {
    if (!state.lena) return;
    const g = ctx;
    const s = view.s;
    const r = view.barrierR;
    const b = state.barrier;
    const active = isBarrierActive();
    const ratio = barrierRatio();
    const flash = Math.max(b.flash || 0, (state.lena.hurt || 0) * 0.45);
    const unstable = active && ratio <= 0.2;
    const flicker = unstable ? 0.7 + 0.3 * Math.abs(Math.sin(t * 13)) : 1;

    let ringColor;
    let outerColor;
    let runeColor;
    let fillTop;
    let fillMid;
    let fillEdge;
    if (!active) {
      ringColor = 'rgba(118, 96, 91, .38)';
      outerColor = 'rgba(118, 96, 91, .16)';
      runeColor = '#b5a8a2';
      fillTop = 'rgba(147, 128, 119, .035)';
      fillMid = 'rgba(121, 105, 98, .025)';
      fillEdge = 'rgba(100, 88, 83, .015)';
    } else if (ratio > 0.6) {
      ringColor = 'rgba(255, 156, 179, .82)';
      outerColor = 'rgba(255, 183, 201, .32)';
      runeColor = '#fff0ae';
      fillTop = 'rgba(255, 238, 240, .17)';
      fillMid = 'rgba(255, 195, 214, .18)';
      fillEdge = 'rgba(255, 163, 188, .26)';
    } else if (ratio > 0.25) {
      ringColor = 'rgba(255, 150, 91, .86)';
      outerColor = 'rgba(255, 174, 95, .36)';
      runeColor = '#fff2b2';
      fillTop = 'rgba(255, 239, 219, .15)';
      fillMid = 'rgba(255, 196, 143, .17)';
      fillEdge = 'rgba(255, 145, 126, .25)';
    } else {
      ringColor = 'rgba(246, 81, 108, .92)';
      outerColor = 'rgba(255, 104, 118, .42)';
      runeColor = '#ffd9d5';
      fillTop = 'rgba(255, 224, 228, .14)';
      fillMid = 'rgba(255, 158, 163, .16)';
      fillEdge = 'rgba(246, 100, 113, .25)';
    }

    g.save();
    g.translate(view.cx, view.cy);
    const breathe = active
      ? 1 + Math.sin(t * 2.15) * 0.012 + flash * 0.012
      : 1;
    g.scale(breathe, breathe);

    const fill = g.createRadialGradient(0, 0, r * 0.08, 0, 0, r);
    fill.addColorStop(0, fillTop);
    fill.addColorStop(0.58, fillMid);
    fill.addColorStop(0.88, fillEdge);
    fill.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = fill;
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.fill();

    g.globalAlpha = active ? 1 : 0.62;
    g.strokeStyle = outerColor;
    g.lineWidth = (active ? 9 : 5) * s;
    g.beginPath();
    g.arc(0, 0, r - 2 * s, 0, TAU);
    g.stroke();

    // 外层旋转虚线圈
    g.save();
    g.rotate(t * 0.16);
    g.setLineDash(active ? [10 * s, 9 * s] : [4 * s, 15 * s]);
    g.lineDashOffset = -t * 7 * s;
    g.globalAlpha = active ? flicker : 0.48;
    g.strokeStyle = ringColor;
    g.lineWidth = (active ? 3 : 2) * s;
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.stroke();
    g.restore();

    if (active) {
      g.save();
      g.rotate(-t * 0.09);
      g.setLineDash([3 * s, 14 * s]);
      g.globalAlpha = 0.65 * flicker;
      g.strokeStyle = 'rgba(255, 239, 192, .85)';
      g.lineWidth = 2 * s;
      g.beginPath();
      g.arc(0, 0, r - 13 * s, 0, TAU);
      g.stroke();
      g.restore();

      // 八个守护符文：星星与菱形，不再使用爱心。
      for (let i = 0; i < 8; i++) {
        const a = -Math.PI / 2 + i / 8 * TAU + t * 0.08;
        const x = Math.cos(a) * (r - 5 * s);
        const y = Math.sin(a) * (r - 5 * s);
        g.save();
        g.translate(x, y);
        g.rotate(a + Math.PI / 2);
        g.globalAlpha = (0.5 + Math.sin(t * 2 + i) * 0.14) * flicker;
        if (i % 2 === 0) {
          starPath(g, 0, 0, 3.6 * s, 5, 0.4);
        } else {
          g.beginPath();
          g.moveTo(0, -4.2 * s);
          g.lineTo(3.1 * s, 0);
          g.lineTo(0, 4.2 * s);
          g.lineTo(-3.1 * s, 0);
          g.closePath();
        }
        g.fillStyle = runeColor;
        g.fill();
        g.restore();
      }
    } else {
      // 破碎后的地面虚线轮廓
      g.save();
      g.rotate(-t * 0.035);
      g.setLineDash([2 * s, 11 * s]);
      g.globalAlpha = 0.42;
      g.strokeStyle = 'rgba(117, 94, 86, .52)';
      g.lineWidth = 2.2 * s;
      g.beginPath();
      g.arc(0, 0, r - 4 * s, 0, TAU);
      g.stroke();
      g.restore();
    }

    g.globalAlpha = 1;
    drawBarrierCracks(g, r, s, !active || ratio < 0.4);

    // 结界标签
    const isBroken = !active;
    const label = isBroken ? '牢笼失效' : '画地为牢';
    const tagSize = clamp(11 * s + 2, 10, 15);
    g.save();
    g.font = `950 ${tagSize}px ${FONT_STACK}`;
    const tagW = g.measureText(label).width + 18 * s;
    const tagH = tagSize + 8 * s;
    const tagY = -r - tagH * 0.72;
    roundRect(g, -tagW / 2, tagY, tagW, tagH, tagH / 2);
    g.fillStyle = isBroken ? 'rgba(236, 226, 216, .9)' : 'rgba(255, 251, 238, .92)';
    g.fill();
    g.strokeStyle = isBroken ? 'rgba(115, 92, 87, .66)' : 'rgba(91, 54, 65, .8)';
    g.lineWidth = 2;
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = isBroken ? '#8d7a74' : '#d45178';
    g.fillText(label, 0, tagY + tagH / 2 + 0.5);
    g.restore();

    if (active && flash > 0) {
      g.globalAlpha = flash * 0.62;
      g.strokeStyle = '#fff9e7';
      g.lineWidth = 5 * s;
      g.beginPath();
      g.arc(0, 0, r + 4 * s, 0, TAU);
      g.stroke();
      g.globalAlpha = flash * 0.22;
      g.strokeStyle = '#ffd65e';
      g.lineWidth = 12 * s;
      g.beginPath();
      g.arc(0, 0, r + 2 * s, 0, TAU);
      g.stroke();
    }

    if (b.breakPulse > 0) {
      g.save();
      g.globalAlpha = b.breakPulse * 0.8;
      g.strokeStyle = 'rgba(255, 222, 154, .9)';
      g.lineWidth = 3 * s;
      g.lineCap = 'round';
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * TAU + 0.18;
        const inner = r * (0.92 + (i % 3) * 0.03);
        const outer = r * (1.06 + (i % 2) * 0.05);
        g.beginPath();
        g.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
        g.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
        g.stroke();
      }
      g.restore();
    }

    g.restore();
  }

  function drawPlayerAura(t) {
    const p = state.player;
    if (!p) return;
    const g = ctx;
    const s = view.s;
    const r = defenseRadius();
    const pulse = state.shieldPulse;
    const aimAngle = pulse > 0 ? angleLerp(p.facing, state.lastBlockAngle, 0.9) : p.facing + 0.24;

    g.save();
    g.translate(p.x, p.y);
    g.globalAlpha = 0.2 + pulse * 0.35;
    g.strokeStyle = 'rgba(63, 140, 238, .66)';
    g.lineWidth = 1.5 * s;
    g.setLineDash([2 * s, 5 * s]);
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.stroke();
    g.setLineDash([]);

    // 登山杖自动格挡时，朝向最近的撞击方向亮起金色格挡弧。
    g.globalAlpha = 0.25 + pulse * 0.6;
    g.strokeStyle = pulse > 0 ? 'rgba(255, 207, 78, .96)' : 'rgba(255, 255, 255, .85)';
    g.lineWidth = (2.1 + pulse * 1.2) * s;
    g.beginPath();
    g.arc(0, 0, r + 1.8 * s, aimAngle - 0.78, aimAngle + 0.78);
    g.stroke();

    if (pulse > 0) {
      g.globalAlpha = pulse * 0.26;
      g.fillStyle = 'rgba(255, 211, 93, .45)';
      g.beginPath();
      g.arc(0, 0, r * lerp(0.9, 1.12, pulse), 0, TAU);
      g.fill();
    }
    g.restore();
  }

  /**
   * 计算完整 PNG 的目标绘制矩形。
   * - 宽高比只取 image.naturalWidth / image.naturalHeight。
   * - displayWidth / displayHeight 是目标显示尺寸；二者都给时默认按 contain 保持比例。
   * - 只有配置 stretch: true 才会显式拉伸。
   * - 永远不裁切源图：drawSprite 使用 5 参数 drawImage。
   */
  function getSpriteLayout(image, options = {}) {
    const naturalWidth = image && (image.naturalWidth || image.width) || 0;
    const naturalHeight = image && (image.naturalHeight || image.height) || 0;
    if (!naturalWidth || !naturalHeight) return null;

    const anchor = Array.isArray(options.anchor) ? options.anchor : [0.5, 0.5];
    const anchorX = Number.isFinite(anchor[0]) ? anchor[0] : 0.5;
    const anchorY = Number.isFinite(anchor[1]) ? anchor[1] : 0.5;
    let width;
    let height;

    if (options.displayWidth != null && options.displayHeight != null) {
      if (options.stretch) {
        width = options.displayWidth;
        height = options.displayHeight;
      } else {
        const scale = Math.min(
          options.displayWidth / naturalWidth,
          options.displayHeight / naturalHeight
        );
        width = naturalWidth * scale;
        height = naturalHeight * scale;
      }
    } else if (options.displayWidth != null) {
      width = options.displayWidth;
      height = width * naturalHeight / naturalWidth;
    } else if (options.displayHeight != null) {
      height = options.displayHeight;
      width = height * naturalWidth / naturalHeight;
    } else {
      width = naturalWidth;
      height = naturalHeight;
    }

    const x = (options.x || 0) - width * anchorX;
    const y = (options.y || 0) - height * anchorY;
    return {
      x,
      y,
      width,
      height,
      naturalWidth,
      naturalHeight,
      aspect: naturalWidth / naturalHeight,
      anchorX,
      anchorY
    };
  }

  function drawSprite(g, image, x, y, options = {}) {
    if (!image) return null;
    const layout = getSpriteLayout(image, Object.assign({}, options, { x, y }));
    if (!layout) return null;
    g.imageSmoothingEnabled = true;
    // 5 参数 drawImage：完整使用 PNG，不传 sx/sy/sw/sh，也不做任何裁切。
    g.drawImage(image, layout.x, layout.y, layout.width, layout.height);
    if (options.id) {
      spriteDebug[options.id] = {
        id: options.id,
        naturalWidth: layout.naturalWidth,
        naturalHeight: layout.naturalHeight,
        displayWidth: options.displayWidth != null ? options.displayWidth : null,
        displayHeight: options.displayHeight != null ? options.displayHeight : null,
        drawX: layout.x,
        drawY: layout.y,
        drawWidth: layout.width,
        drawHeight: layout.height,
        anchor: [layout.anchorX, layout.anchorY]
      };
    }
    return layout;
  }

  function drawFallbackTrekkingPole(g, w, h, anchor) {
    const ink = '#4a2d2b';
    const top = -h * anchor[1];
    const bottom = h * (1 - anchor[1]);
    const shaftW = Math.max(2.2, w * 0.15);
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';

    // 腕带
    g.strokeStyle = ink;
    g.lineWidth = shaftW * 1.45;
    g.beginPath();
    g.moveTo(0, top + h * 0.08);
    g.bezierCurveTo(-w * 0.35, top + h * 0.12, -w * 0.42, top + h * 0.28, -w * 0.18, top + h * 0.32);
    g.stroke();
    g.strokeStyle = '#ff7b9e';
    g.lineWidth = shaftW * 0.7;
    g.stroke();

    // 杖身
    g.strokeStyle = ink;
    g.lineWidth = shaftW * 1.7;
    g.beginPath();
    g.moveTo(0, top + h * 0.18);
    g.lineTo(0, bottom - h * 0.06);
    g.stroke();
    g.strokeStyle = '#31528f';
    g.lineWidth = shaftW;
    g.stroke();
    g.strokeStyle = 'rgba(132, 177, 246, .85)';
    g.lineWidth = Math.max(1, shaftW * 0.28);
    g.beginPath();
    g.moveTo(-w * 0.13, top + h * 0.23);
    g.lineTo(-w * 0.13, bottom - h * 0.1);
    g.stroke();

    // 握把和金色杖帽
    g.strokeStyle = ink;
    g.lineWidth = shaftW * 2.4;
    g.beginPath();
    g.moveTo(-w * 0.04, top + h * 0.17);
    g.quadraticCurveTo(-w * 0.28, top + h * 0.07, -w * 0.03, top + h * 0.02);
    g.stroke();
    g.strokeStyle = '#2b4779';
    g.lineWidth = shaftW * 1.45;
    g.stroke();
    g.fillStyle = '#ffc94a';
    g.strokeStyle = ink;
    g.lineWidth = Math.max(1, shaftW * 0.45);
    g.beginPath();
    g.arc(0, top + h * 0.015, w * 0.11, 0, TAU);
    g.fill();
    g.stroke();

    // 金属装饰环
    for (const ratio of [0.42, 0.62]) {
      g.fillStyle = '#ffc94a';
      g.strokeStyle = ink;
      g.lineWidth = Math.max(0.8, shaftW * 0.3);
      g.beginPath();
      g.ellipse(0, top + h * ratio, w * 0.14, h * 0.013, 0, 0, TAU);
      g.fill();
      g.stroke();
    }

    // 雪托与杖尖
    g.fillStyle = 'rgba(255, 201, 74, .84)';
    g.strokeStyle = ink;
    g.lineWidth = Math.max(0.8, shaftW * 0.3);
    g.beginPath();
    g.ellipse(0, bottom - h * 0.12, w * 0.34, h * 0.022, 0, 0, TAU);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(0, bottom - h * 0.1);
    g.lineTo(w * 0.12, bottom);
    g.lineTo(0, bottom + h * 0.035);
    g.lineTo(-w * 0.12, bottom);
    g.closePath();
    g.fillStyle = '#eef5fa';
    g.fill();
    g.stroke();
    g.restore();
  }

  function drawTrekkingPole(g, gripX, gripY, s, t, facing, blockAngle, pulse) {
    const blend = clamp(pulse * 1.35, 0, 1);
    const aim = angleLerp(facing, blockAngle != null ? blockAngle : facing, blend * 0.94);
    const idleSway = Math.sin(t * 2.25) * 0.025;
    const strikeSway = Math.sin((1 - pulse) * Math.PI * 2) * 0.13 * pulse;
    // 日常斜握，格挡时自动摆正并指向来袭方向。
    const restTilt = 0.32 * (1 - blend * 0.9);
    const poleAngle = aim - Math.PI / 2 + restTilt + idleSway + strikeSway;
    const cfg = RESOURCES.getConfig('prop.trekkingPole') || {};
    const displayWidth = (cfg.displayWidth != null ? cfg.displayWidth : cfg.drawWidth != null ? cfg.drawWidth : 40) * s;
    const displayHeight = (cfg.displayHeight != null ? cfg.displayHeight : cfg.drawHeight != null ? cfg.drawHeight : 86) * s;
    const anchor = Array.isArray(cfg.anchor) ? cfg.anchor : [0.5, 0.34];
    const image = RESOURCES.getImage('prop.trekkingPole');

    g.save();
    g.translate(gripX, gripY);
    g.rotate(poleAngle);
    let layout;
    if (image) {
      layout = drawSprite(g, image, 0, 0, {
        id: 'prop.trekkingPole',
        displayWidth,
        displayHeight,
        anchor,
        stretch: !!cfg.stretch
      });
    } else {
      const fallbackImage = {
        naturalWidth: cfg.width || 72,
        naturalHeight: cfg.height || 180
      };
      layout = getSpriteLayout(fallbackImage, {
        x: 0,
        y: 0,
        displayWidth,
        displayHeight,
        anchor,
        stretch: !!cfg.stretch
      });
      drawFallbackTrekkingPole(g, layout.width, layout.height, anchor);
    }

    // 杖尖高光：格挡时更亮
    const tipY = layout.height * (1 - anchor[1]) * 0.92;
    g.globalAlpha = 0.52 + pulse * 0.48;
    starPath(g, 0, tipY, (2.2 + pulse * 1.8) * s, 4, 0.3);
    g.fillStyle = '#fff2a6';
    g.fill();
    g.globalAlpha = 1;
    g.restore();
  }

  function drawGuardFX(t) {
    if (!state.player || state.shieldPulse <= 0.02) return;
    const p = state.player;
    const pulse = state.shieldPulse;
    const angle = state.lastBlockAngle;
    const dist = defenseRadius() * 0.88;
    const fxX = p.x + Math.cos(angle) * dist;
    const fxY = p.y + Math.sin(angle) * dist;
    const cfg = RESOURCES.getConfig('fx.guardSpark') || {};
    const pulseScale = 0.72 + (1 - pulse) * 0.5;
    const displayWidth = (cfg.displayWidth != null ? cfg.displayWidth : cfg.displaySize != null ? cfg.displaySize : cfg.drawSize != null ? cfg.drawSize : 42) * view.s * pulseScale;
    const displayHeight = (cfg.displayHeight != null ? cfg.displayHeight : cfg.displaySize != null ? cfg.displaySize : cfg.drawSize != null ? cfg.drawSize : 42) * view.s * pulseScale;
    const g = ctx;
    const image = RESOURCES.getImage('fx.guardSpark');

    g.save();
    g.translate(fxX, fxY);
    g.rotate((1 - pulse) * 0.9);
    g.globalAlpha = Math.min(1, pulse * 1.65);
    if (image) {
      drawSprite(g, image, 0, 0, {
        id: 'fx.guardSpark',
        displayWidth,
        displayHeight,
        anchor: [0.5, 0.5],
        stretch: !!cfg.stretch
      });
    } else {
      const size = Math.max(displayWidth, displayHeight);
      g.fillStyle = 'rgba(255, 214, 92, .32)';
      g.beginPath();
      g.arc(0, 0, size * 0.5, 0, TAU);
      g.fill();
      starPath(g, 0, 0, size * 0.38, 4, 0.26);
      g.fillStyle = '#fff3a8';
      g.fill();
    }
    g.restore();
  }

  function drawLenaAt(g, x, y, s, t, options = {}) {
    const hurt = options.hurt || 0;
    const lives = options.lives != null ? options.lives : 3;
    const seed = options.seed || 0;
    const bob = Math.sin(t * 2.2 + seed) * 1.1 * s;
    const ink = '#50313b';
    const lw = Math.max(1.6, 2.3 * s);
    const blinking = ((t + seed) % 3.4) < 0.09;

    // 厉娜 PNG 成功加载时直接绘制完整图片；只有图片不可用时才回退到下方矢量造型。
    const linaCfg = RESOURCES.getConfig('character.lina');
    if (linaCfg && linaCfg.useInGame) {
      const linaImage = RESOURCES.getImage('character.lina');
      if (linaImage) {
        drawShadow(g, x, y + 33 * s, 25 * s, 7.2 * s, 0.16);
        g.save();
        g.translate(x, y + bob);
        const displayWidth = (linaCfg.displayWidth != null ? linaCfg.displayWidth : 64) * s;
        const displayHeight = (linaCfg.displayHeight != null ? linaCfg.displayHeight : 58) * s;
        const layout = drawSprite(g, linaImage, 0, 0, {
          id: 'character.lina',
          displayWidth,
          displayHeight,
          anchor: Array.isArray(linaCfg.anchor) ? linaCfg.anchor : [0.5, 0.45],
          stretch: !!linaCfg.stretch
        });
        if (!linaPngLogged) {
          linaPngLogged = true;
          const linaPath = RESOURCES.getPath('character.lina');
          const drawWidth = layout ? layout.width : null;
          const drawHeight = layout ? layout.height : null;
          console.info(
            `[Lina PNG] resource=character.lina path=${linaPath} status=${RESOURCES.getStatus('character.lina')} natural=${linaImage.naturalWidth}x${linaImage.naturalHeight} draw=${drawWidth}x${drawHeight}`,
            {
              resource: 'character.lina',
              path: linaPath,
              status: RESOURCES.getStatus('character.lina'),
              naturalWidth: linaImage.naturalWidth,
              naturalHeight: linaImage.naturalHeight,
              imageSrc: linaImage.currentSrc || linaImage.src,
              image: linaImage,
              drawWidth,
              drawHeight
            }
          );
        }
        g.restore();
        return;
      }
      if (!linaFallbackLogged && RESOURCES.getStats && RESOURCES.getStats().ready) {
        linaFallbackLogged = true;
        console.warn('[Lina PNG] image unavailable; using Canvas fallback', {
          resource: 'character.lina',
          path: RESOURCES.getPath('character.lina'),
          status: RESOURCES.getStatus('character.lina')
        });
      }
    }

    drawShadow(g, x, y + 33 * s, 25 * s, 7.2 * s, 0.16);
    g.save();
    g.translate(x, y + bob);

    // 身后柔光
    const halo = g.createRadialGradient(0, 0, 4 * s, 0, 2 * s, 42 * s);
    halo.addColorStop(0, 'rgba(255, 255, 255, .42)');
    halo.addColorStop(0.6, 'rgba(255, 195, 212, .16)');
    halo.addColorStop(1, 'rgba(255, 195, 212, 0)');
    g.fillStyle = halo;
    g.beginPath();
    g.arc(0, 2 * s, 42 * s, 0, TAU);
    g.fill();

    // 双腿
    g.lineCap = 'round';
    g.strokeStyle = '#e2a089';
    g.lineWidth = 4.5 * s;
    g.beginPath();
    g.moveTo(-6.5 * s, 24 * s);
    g.lineTo(-7.2 * s, 31 * s);
    g.moveTo(6.5 * s, 24 * s);
    g.lineTo(7.2 * s, 31 * s);
    g.stroke();
    g.strokeStyle = '#7a4653';
    g.lineWidth = 3.6 * s;
    g.beginPath();
    g.moveTo(-8.8 * s, 32 * s);
    g.lineTo(-5.2 * s, 32 * s);
    g.moveTo(5.2 * s, 32 * s);
    g.lineTo(8.8 * s, 32 * s);
    g.stroke();

    // 双马尾发髻
    const bunY = -26 * s;
    for (const side of [-1, 1]) {
      g.beginPath();
      g.arc(side * 16.5 * s, bunY, 7.8 * s, 0, TAU);
      g.fillStyle = '#74453e';
      g.fill();
      g.strokeStyle = ink;
      g.lineWidth = lw;
      g.stroke();
      g.beginPath();
      g.arc(side * 15.2 * s, bunY - 2 * s, 3.7 * s, 0, TAU);
      g.fillStyle = '#8c574c';
      g.fill();
    }

    // 小裙子
    g.beginPath();
    g.moveTo(-10 * s, -1 * s);
    g.quadraticCurveTo(-20 * s, 2 * s, -23 * s, 17 * s);
    g.quadraticCurveTo(-22 * s, 29 * s, -11 * s, 31 * s);
    g.quadraticCurveTo(0, 35 * s, 11 * s, 31 * s);
    g.quadraticCurveTo(22 * s, 29 * s, 23 * s, 17 * s);
    g.quadraticCurveTo(20 * s, 2 * s, 10 * s, -1 * s);
    g.closePath();
    const dress = g.createLinearGradient(0, 0, 0, 32 * s);
    dress.addColorStop(0, '#ff92b5');
    dress.addColorStop(1, '#f76595');
    g.fillStyle = dress;
    g.fill();
    g.strokeStyle = ink;
    g.lineWidth = lw;
    g.stroke();

    // 裙摆花边
    g.beginPath();
    g.moveTo(-18.5 * s, 26 * s);
    for (let i = 0; i < 5; i++) {
      const x0 = -18.5 * s + i * 9.3 * s;
      g.quadraticCurveTo(x0 + 4.6 * s, 34 * s, x0 + 9.3 * s, 26 * s);
    }
    g.strokeStyle = '#ffe8d2';
    g.lineWidth = 2.2 * s;
    g.stroke();

    // 手臂
    g.strokeStyle = ink;
    g.lineWidth = 5.4 * s;
    g.beginPath();
    g.moveTo(-14 * s, 5 * s);
    g.lineTo(-23 * s, 15 * s);
    g.moveTo(14 * s, 5 * s);
    g.lineTo(23 * s, 15 * s);
    g.stroke();
    g.strokeStyle = '#ffe0c8';
    g.lineWidth = 3.4 * s;
    g.beginPath();
    g.moveTo(-14 * s, 5 * s);
    g.lineTo(-23 * s, 15 * s);
    g.moveTo(14 * s, 5 * s);
    g.lineTo(23 * s, 15 * s);
    g.stroke();

    // 领口和胸前小心心
    g.beginPath();
    g.arc(0, -1.5 * s, 7.4 * s, 0, Math.PI);
    g.fillStyle = '#fff1db';
    g.fill();
    g.strokeStyle = ink;
    g.lineWidth = 1.6 * s;
    g.stroke();
    heartPath(g, 0, 12 * s, 5.6 * s);
    g.fillStyle = '#fff2d8';
    g.fill();
    g.strokeStyle = 'rgba(102, 47, 61, .42)';
    g.lineWidth = 1.2 * s;
    g.stroke();

    // 头发底与脸
    g.beginPath();
    g.arc(0, -15 * s, 17.4 * s, 0, TAU);
    g.fillStyle = '#74453e';
    g.fill();
    g.strokeStyle = ink;
    g.lineWidth = lw;
    g.stroke();

    g.beginPath();
    g.arc(0, -12.2 * s, 15 * s, 0, TAU);
    g.fillStyle = '#ffe3ce';
    g.fill();
    g.strokeStyle = ink;
    g.lineWidth = lw;
    g.stroke();

    // 刘海
    g.beginPath();
    g.moveTo(-15.6 * s, -17 * s);
    g.quadraticCurveTo(-12 * s, -29.5 * s, 0, -28.2 * s);
    g.quadraticCurveTo(12 * s, -29.5 * s, 15.6 * s, -17 * s);
    g.quadraticCurveTo(9.8 * s, -20.6 * s, 4.2 * s, -17.4 * s);
    g.quadraticCurveTo(-0.2 * s, -21.8 * s, -5.2 * s, -17.2 * s);
    g.quadraticCurveTo(-10.5 * s, -21.3 * s, -15.6 * s, -17 * s);
    g.closePath();
    g.fillStyle = '#74453e';
    g.fill();
    g.strokeStyle = ink;
    g.lineWidth = 1.7 * s;
    g.stroke();

    // 蝴蝶结
    g.save();
    g.translate(-17 * s, -28 * s);
    g.rotate(-0.4);
    g.fillStyle = '#ffd85c';
    g.strokeStyle = ink;
    g.lineWidth = 1.8 * s;
    g.beginPath();
    g.ellipse(-4 * s, 0, 4.5 * s, 2.8 * s, -0.35, 0, TAU);
    g.fill();
    g.stroke();
    g.beginPath();
    g.ellipse(4 * s, 0, 4.5 * s, 2.8 * s, 0.35, 0, TAU);
    g.fill();
    g.stroke();
    g.beginPath();
    g.arc(0, 0, 1.8 * s, 0, TAU);
    g.fillStyle = '#ff82a7';
    g.fill();
    g.restore();

    // 表情
    if (hurt > 0) {
      g.strokeStyle = '#54303b';
      g.lineWidth = 2.1 * s;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-10 * s, -15.3 * s);
      g.lineTo(-5.2 * s, -11.7 * s);
      g.moveTo(-5.2 * s, -15.3 * s);
      g.lineTo(-10 * s, -11.7 * s);
      g.moveTo(5.2 * s, -15.3 * s);
      g.lineTo(10 * s, -11.7 * s);
      g.moveTo(10 * s, -15.3 * s);
      g.lineTo(5.2 * s, -11.7 * s);
      g.stroke();
      g.beginPath();
      g.ellipse(0, -4.2 * s, 3 * s, 4.2 * s, 0, 0, TAU);
      g.fillStyle = '#6a3942';
      g.fill();
    } else {
      g.fillStyle = '#4d2d36';
      if (blinking) {
        g.strokeStyle = '#4d2d36';
        g.lineWidth = 1.9 * s;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(-9.6 * s, -14 * s);
        g.quadraticCurveTo(-7.4 * s, -12 * s, -5.2 * s, -14 * s);
        g.moveTo(5.2 * s, -14 * s);
        g.quadraticCurveTo(7.4 * s, -12 * s, 9.6 * s, -14 * s);
        g.stroke();
      } else {
        g.beginPath();
        g.ellipse(-7.4 * s, -14.2 * s, 2.1 * s, 2.8 * s, 0, 0, TAU);
        g.ellipse(7.4 * s, -14.2 * s, 2.1 * s, 2.8 * s, 0, 0, TAU);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,.9)';
        g.beginPath();
        g.arc(-6.7 * s, -15.1 * s, 0.65 * s, 0, TAU);
        g.arc(8.1 * s, -15.1 * s, 0.65 * s, 0, TAU);
        g.fill();
      }
      g.fillStyle = 'rgba(255, 143, 160, .48)';
      g.beginPath();
      g.ellipse(-11.5 * s, -8.2 * s, 3.2 * s, 1.7 * s, -0.2, 0, TAU);
      g.ellipse(11.5 * s, -8.2 * s, 3.2 * s, 1.7 * s, 0.2, 0, TAU);
      g.fill();

      g.strokeStyle = '#8d4d58';
      g.lineWidth = 1.7 * s;
      g.lineCap = 'round';
      g.beginPath();
      if (lives <= 1) {
        g.arc(0, -4.8 * s, 3.2 * s, 0.2, Math.PI - 0.2, true);
      } else {
        g.arc(0, -4.2 * s, 3.7 * s, 0.18, Math.PI - 0.18);
      }
      g.stroke();
    }

    if (hurt > 0) {
      g.globalAlpha = hurt * 0.34;
      g.fillStyle = '#fff9ec';
      g.beginPath();
      g.arc(0, -1 * s, 27 * s, 0, TAU);
      g.fill();
    }

    g.restore();
  }

  function drawPlayerSpriteAt(g, x, y, s, t, options, image, cfg) {
    const facing = options.facing != null ? options.facing : -Math.PI / 2;
    const blockAngle = options.blockAngle != null ? options.blockAngle : facing;
    const blockPulse = options.blockPulse || 0;
    const moving = !!options.moving;
    const walk = options.walk || 0;
    const bob = moving ? Math.sin(walk) * 1.4 * s : Math.sin(t * 2.1) * 0.7 * s;

    drawShadow(g, x, y + 23 * s, 18 * s, 5.8 * s, 0.15);
    g.save();
    g.translate(x, y + bob);

    const displayWidth = (cfg.displayWidth != null ? cfg.displayWidth : 64) * s;
    const displayHeight = (cfg.displayHeight != null ? cfg.displayHeight : 58) * s;
    const layout = drawSprite(g, image, 0, 0, {
      id: 'character.xufei',
      displayWidth,
      displayHeight,
      anchor: Array.isArray(cfg.anchor) ? cfg.anchor : [0.5, 0.65],
      stretch: !!cfg.stretch
    });

    // 角色 PNG 只替换身体表现；登山杖、格挡角度、碰撞半径和玩法坐标保持原样。
    const gripX = Math.cos(facing) * 5 * s + Math.cos(facing + Math.PI / 2) * 10 * s;
    const gripY = Math.sin(facing) * 5 * s + Math.sin(facing + Math.PI / 2) * 10 * s + 1.5 * s;
    drawTrekkingPole(g, gripX, gripY, s, t, facing, blockAngle, blockPulse);

    g.restore();
    return layout;
  }

  function drawPlayerAt(g, x, y, s, t, options = {}) {
    const xufeiCfg = RESOURCES.getConfig('character.xufei');
    if (xufeiCfg && xufeiCfg.useInGame) {
      const xufeiImage = RESOURCES.getImage('character.xufei');
      if (xufeiImage) {
        drawPlayerSpriteAt(g, x, y, s, t, options, xufeiImage, xufeiCfg);
        return;
      }
    }

    const facing = options.facing != null ? options.facing : -Math.PI / 2;
    const blockAngle = options.blockAngle != null ? options.blockAngle : facing;
    const blockPulse = options.blockPulse || 0;
    const moving = !!options.moving;
    const walk = options.walk || 0;
    const bob = moving ? Math.sin(walk) * 1.4 * s : Math.sin(t * 2.1) * 0.7 * s;
    const ink = '#42313a';
    const lw = Math.max(1.6, 2.3 * s);
    const legSwing = moving ? Math.sin(walk) * 2.6 * s : 0;

    drawShadow(g, x, y + 23 * s, 18 * s, 5.8 * s, 0.15);
    g.save();
    g.translate(x, y + bob);

    // 画笔（背在身后的小道具）
    g.save();
    g.rotate(-0.55);
    g.strokeStyle = '#7d563b';
    g.lineWidth = 2.6 * s;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-15 * s, 8 * s);
    g.lineTo(-22 * s, -2 * s);
    g.stroke();
    g.fillStyle = '#ff7fa8';
    g.strokeStyle = ink;
    g.lineWidth = 1.3 * s;
    g.beginPath();
    g.ellipse(-23 * s, -3.8 * s, 3.3 * s, 4.2 * s, 0.4, 0, TAU);
    g.fill();
    g.stroke();
    g.restore();

    // 腿
    g.strokeStyle = ink;
    g.lineWidth = 5.5 * s;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-4.5 * s, 14 * s);
    g.lineTo(-5.2 * s + legSwing * 0.35, 22.5 * s);
    g.moveTo(4.5 * s, 14 * s);
    g.lineTo(5.2 * s - legSwing * 0.35, 22.5 * s);
    g.stroke();
    g.strokeStyle = '#365c93';
    g.lineWidth = 3.1 * s;
    g.beginPath();
    g.moveTo(-4.5 * s, 14 * s);
    g.lineTo(-5.2 * s + legSwing * 0.35, 22.5 * s);
    g.moveTo(4.5 * s, 14 * s);
    g.lineTo(5.2 * s - legSwing * 0.35, 22.5 * s);
    g.stroke();
    g.fillStyle = '#f4cf9b';
    g.strokeStyle = ink;
    g.lineWidth = 1.6 * s;
    g.beginPath();
    g.ellipse(-6.2 * s + legSwing * 0.35, 23.2 * s, 4.2 * s, 2.2 * s, -0.15, 0, TAU);
    g.ellipse(6.2 * s - legSwing * 0.35, 23.2 * s, 4.2 * s, 2.2 * s, 0.15, 0, TAU);
    g.fill();
    g.stroke();

    // 手臂
    g.strokeStyle = ink;
    g.lineWidth = 5 * s;
    g.beginPath();
    g.moveTo(-9 * s, 2 * s);
    g.lineTo(-14.5 * s, 10 * s);
    g.moveTo(9 * s, 2 * s);
    g.lineTo(14.5 * s, 10 * s);
    g.stroke();
    g.strokeStyle = '#ffe2cb';
    g.lineWidth = 3.3 * s;
    g.beginPath();
    g.moveTo(-9 * s, 2 * s);
    g.lineTo(-14.5 * s, 10 * s);
    g.moveTo(9 * s, 2 * s);
    g.lineTo(14.5 * s, 10 * s);
    g.stroke();

    // 蓝色连帽衫
    g.beginPath();
    g.moveTo(-8 * s, -4 * s);
    g.quadraticCurveTo(-14 * s, -5 * s, -14 * s, 3 * s);
    g.lineTo(-11 * s, 17 * s);
    g.quadraticCurveTo(0, 20 * s, 11 * s, 17 * s);
    g.lineTo(14 * s, 3 * s);
    g.quadraticCurveTo(14 * s, -5 * s, 8 * s, -4 * s);
    g.closePath();
    const hoodie = g.createLinearGradient(0, -6 * s, 0, 18 * s);
    hoodie.addColorStop(0, '#7bbdff');
    hoodie.addColorStop(1, '#3f8de8');
    g.fillStyle = hoodie;
    g.fill();
    g.strokeStyle = ink;
    g.lineWidth = lw;
    g.stroke();

    // 连帽绳和口袋
    g.strokeStyle = '#e9f6ff';
    g.lineWidth = 1.7 * s;
    g.beginPath();
    g.moveTo(-3.5 * s, 0);
    g.lineTo(-4 * s, 5 * s);
    g.moveTo(3.5 * s, 0);
    g.lineTo(4 * s, 5 * s);
    g.stroke();
    g.fillStyle = 'rgba(39, 102, 176, .45)';
    roundRect(g, -5 * s, 9.5 * s, 10 * s, 4.4 * s, 2 * s);
    g.fill();

    // 围巾
    g.beginPath();
    g.moveTo(-8 * s, -3.5 * s);
    g.quadraticCurveTo(0, 1 * s, 8 * s, -3.5 * s);
    g.quadraticCurveTo(6 * s, 4 * s, 0, 4 * s);
    g.quadraticCurveTo(-6 * s, 4 * s, -8 * s, -3.5 * s);
    g.closePath();
    g.fillStyle = '#fff1c6';
    g.fill();
    g.strokeStyle = ink;
    g.lineWidth = 1.6 * s;
    g.stroke();

    // 头
    g.beginPath();
    g.arc(0, -14 * s, 12.4 * s, 0, TAU);
    g.fillStyle = '#ffe2cb';
    g.fill();
    g.strokeStyle = ink;
    g.lineWidth = lw;
    g.stroke();

    // 头发
    g.beginPath();
    g.arc(0, -15.7 * s, 12.5 * s, Math.PI * 1.02, Math.PI * 1.98);
    g.lineTo(11 * s, -11 * s);
    g.quadraticCurveTo(5 * s, -17 * s, 0, -13 * s);
    g.quadraticCurveTo(-5 * s, -17 * s, -11 * s, -11 * s);
    g.closePath();
    g.fillStyle = '#47334a';
    g.fill();

    // 贝雷帽
    g.save();
    g.rotate(-0.08);
    g.beginPath();
    g.ellipse(0, -25 * s, 15.5 * s, 6.8 * s, 0, 0, TAU);
    g.fillStyle = '#334f9c';
    g.fill();
    g.strokeStyle = ink;
    g.lineWidth = lw;
    g.stroke();
    g.beginPath();
    g.ellipse(0, -23.2 * s, 10.6 * s, 3.2 * s, 0, 0, Math.PI, false);
    g.fillStyle = '#ffcf58';
    g.fill();
    g.fillStyle = '#ff8dab';
    g.strokeStyle = ink;
    g.lineWidth = 1.4 * s;
    g.beginPath();
    g.arc(9.5 * s, -30.3 * s, 2.7 * s, 0, TAU);
    g.fill();
    g.stroke();
    g.restore();

    // 五官
    g.fillStyle = '#3d2b33';
    g.beginPath();
    g.ellipse(-4.4 * s, -14.2 * s, 1.55 * s, 2.1 * s, 0, 0, TAU);
    g.ellipse(4.4 * s, -14.2 * s, 1.55 * s, 2.1 * s, 0, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.88)';
    g.beginPath();
    g.arc(-3.9 * s, -15 * s, 0.48 * s, 0, TAU);
    g.arc(4.9 * s, -15 * s, 0.48 * s, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(255, 133, 150, .38)';
    g.beginPath();
    g.ellipse(-8.4 * s, -10.1 * s, 2.5 * s, 1.25 * s, -0.1, 0, TAU);
    g.ellipse(8.4 * s, -10.1 * s, 2.5 * s, 1.25 * s, 0.1, 0, TAU);
    g.fill();
    g.strokeStyle = '#9e5f5c';
    g.lineWidth = 1.4 * s;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(0.2 * s, -7.8 * s, 2.6 * s, 0.15, Math.PI - 0.15);
    g.stroke();

    // 登山杖自动格挡：视觉上跟随移动方向，撞击瞬间自动摆向威胁方向。
    const gripX = Math.cos(facing) * 5 * s + Math.cos(facing + Math.PI / 2) * 10 * s;
    const gripY = Math.sin(facing) * 5 * s + Math.sin(facing + Math.PI / 2) * 10 * s + 1.5 * s;
    drawTrekkingPole(g, gripX, gripY, s, t, facing, blockAngle, blockPulse);

    g.restore();
  }

  function drawEnemyBody(g, type, r, hp, maxHp, t, seed, flash) {
    const ink = '#4b3032';
    const lw = Math.max(1.9, r * 0.14);

    if (type === 'crowd') {
      const body = g.createRadialGradient(-r * 0.34, -r * 0.42, r * 0.12, 0, 0, r * 1.16);
      body.addColorStop(0, '#ffe58a');
      body.addColorStop(0.58, '#ffb635');
      body.addColorStop(1, '#f38a21');
      g.beginPath();
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * TAU;
        const rr = r * (1 + Math.sin(i * 2.3 + seed) * 0.035);
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.fillStyle = body;
      g.fill();
      g.strokeStyle = ink;
      g.lineWidth = lw;
      g.stroke();

      // 瓜纹和叶子
      g.save();
      g.globalAlpha = 0.35;
      g.strokeStyle = '#bd6418';
      g.lineWidth = r * 0.1;
      g.lineCap = 'round';
      g.beginPath();
      g.arc(-r * 0.2, 0, r * 0.72, Math.PI * 0.55, Math.PI * 0.98);
      g.stroke();
      g.beginPath();
      g.arc(r * 0.2, 0, r * 0.72, Math.PI * 0.02, Math.PI * 0.45);
      g.stroke();
      g.restore();

      g.fillStyle = '#59bd6c';
      g.strokeStyle = '#2e7847';
      g.lineWidth = Math.max(1.5, r * 0.08);
      g.beginPath();
      g.ellipse(-r * 0.18, -r * 0.96, r * 0.4, r * 0.18, -0.55, 0, TAU);
      g.fill();
      g.stroke();
      g.beginPath();
      g.ellipse(r * 0.2, -r * 1.01, r * 0.38, r * 0.17, 0.45, 0, TAU);
      g.fill();
      g.stroke();
      g.strokeStyle = '#7d5b2f';
      g.lineWidth = r * 0.07;
      g.beginPath();
      g.moveTo(0, -r * 0.9);
      g.quadraticCurveTo(-r * 0.05, -r * 1.2, r * 0.1, -r * 1.25);
      g.stroke();

      g.fillStyle = '#422b25';
      g.beginPath();
      g.ellipse(-r * 0.28, -r * 0.24, r * 0.09, r * 0.13, 0, 0, TAU);
      g.ellipse(r * 0.28, -r * 0.24, r * 0.09, r * 0.13, 0, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.9)';
      g.beginPath();
      g.arc(-r * 0.3, -r * 0.29, r * 0.025, 0, TAU);
      g.arc(r * 0.26, -r * 0.29, r * 0.025, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(255, 125, 139, .28)';
      g.beginPath();
      g.ellipse(-r * 0.55, r * 0.04, r * 0.14, r * 0.08, 0, 0, TAU);
      g.ellipse(r * 0.55, r * 0.04, r * 0.14, r * 0.08, 0, 0, TAU);
      g.fill();
      setText(g, '瓜', 0, r * 0.34, r * 0.74, '#713518', 'rgba(255, 248, 208, .92)', Math.max(1.8, r * 0.15));
    } else if (type === 'memory') {
      const body = g.createLinearGradient(0, -r, 0, r);
      body.addColorStop(0, '#a8f6d5');
      body.addColorStop(0.52, '#4fd7a4');
      body.addColorStop(1, '#22a97c');
      g.beginPath();
      g.moveTo(-r, r * 0.48);
      g.bezierCurveTo(-r * 1.08, -r * 0.42, -r * 0.62, -r, 0, -r);
      g.bezierCurveTo(r * 0.62, -r, r * 1.08, -r * 0.42, r, r * 0.48);
      g.quadraticCurveTo(r * 0.85, r * 0.86, r * 0.62, r * 0.66);
      g.quadraticCurveTo(r * 0.38, r * 0.94, r * 0.18, r * 0.7);
      g.quadraticCurveTo(-r * 0.04, r * 0.97, -r * 0.24, r * 0.7);
      g.quadraticCurveTo(-r * 0.5, r * 0.94, -r * 0.65, r * 0.66);
      g.quadraticCurveTo(-r * 0.86, r * 0.85, -r, r * 0.48);
      g.closePath();
      g.fillStyle = body;
      g.fill();
      g.strokeStyle = '#155f50';
      g.lineWidth = lw;
      g.stroke();

      g.globalAlpha = 0.35;
      g.fillStyle = '#e7fff7';
      g.beginPath();
      g.ellipse(-r * 0.35, -r * 0.42, r * 0.22, r * 0.11, -0.55, 0, TAU);
      g.fill();
      g.globalAlpha = 1;

      g.fillStyle = '#163f37';
      g.beginPath();
      g.ellipse(-r * 0.27, -r * 0.2, r * 0.095, r * 0.135, 0, 0, TAU);
      g.ellipse(r * 0.27, -r * 0.2, r * 0.095, r * 0.135, 0, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.94)';
      g.beginPath();
      g.arc(-r * 0.29, -r * 0.25, r * 0.026, 0, TAU);
      g.arc(r * 0.25, -r * 0.25, r * 0.026, 0, TAU);
      g.fill();
      setText(g, '忆', 0, r * 0.35, r * 0.78, '#f5fff9', '#155f50', Math.max(1.9, r * 0.15));
    } else {
      const body = g.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.15, 0, 0, r * 1.12);
      body.addColorStop(0, '#ddc7ff');
      body.addColorStop(0.46, '#a97bff');
      body.addColorStop(1, '#7241c7');
      g.beginPath();
      for (let i = 0; i < 11; i++) {
        const a = i / 11 * TAU;
        const rr = r * (1 + Math.sin(i * 1.9 + seed) * 0.04);
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.fillStyle = body;
      g.fill();
      g.strokeStyle = '#45265e';
      g.lineWidth = lw;
      g.stroke();

      // 头顶的两个“催命小卷”
      g.strokeStyle = '#4d2a6b';
      g.lineWidth = Math.max(2, r * 0.08);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-r * 0.34, -r * 0.92);
      g.bezierCurveTo(-r * 0.68, -r * 1.35, -r * 0.96, -r * 1.05, -r * 0.7, -r * 1.17);
      g.moveTo(r * 0.34, -r * 0.92);
      g.bezierCurveTo(r * 0.68, -r * 1.35, r * 0.96, -r * 1.05, r * 0.7, -r * 1.17);
      g.stroke();

      // 生气眉
      g.strokeStyle = '#412358';
      g.lineWidth = Math.max(2, r * 0.075);
      g.beginPath();
      g.moveTo(-r * 0.48, -r * 0.42);
      g.lineTo(-r * 0.15, -r * 0.29);
      g.moveTo(r * 0.48, -r * 0.42);
      g.lineTo(r * 0.15, -r * 0.29);
      g.stroke();

      g.fillStyle = '#efddff';
      g.beginPath();
      g.ellipse(-r * 0.3, -r * 0.13, r * 0.12, r * 0.15, 0, 0, TAU);
      g.ellipse(r * 0.3, -r * 0.13, r * 0.12, r * 0.15, 0, 0, TAU);
      g.fill();
      g.fillStyle = '#3d2254';
      g.beginPath();
      g.ellipse(-r * 0.3, -r * 0.12, r * 0.055, r * 0.09, 0, 0, TAU);
      g.ellipse(r * 0.3, -r * 0.12, r * 0.055, r * 0.09, 0, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.9)';
      g.beginPath();
      g.arc(-r * 0.32, -r * 0.17, r * 0.022, 0, TAU);
      g.arc(r * 0.28, -r * 0.17, r * 0.022, 0, TAU);
      g.fill();
      setText(g, '催', 0, r * 0.36, r * 0.74, '#fff2ff', '#4a2765', Math.max(2.2, r * 0.15));

      // 两格血条小星
      for (let i = 0; i < maxHp; i++) {
        const active = i < hp;
        const px = r * (0.5 + i * 0.28);
        const py = -r * (0.82 + i * 0.18);
        g.globalAlpha = active ? 1 : 0.2;
        starPath(g, px, py, r * 0.1, 5, 0.42);
        g.fillStyle = active ? '#ffd95a' : '#704b83';
        g.fill();
      }
      g.globalAlpha = 1;

      if (hp < maxHp) {
        g.save();
        g.strokeStyle = 'rgba(69, 32, 88, .8)';
        g.lineWidth = Math.max(2, r * 0.08);
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(-r * 0.3, -r * 0.58);
        g.lineTo(-r * 0.05, -r * 0.28);
        g.lineTo(-r * 0.17, r * 0.02);
        g.lineTo(r * 0.22, r * 0.32);
        g.stroke();
        g.restore();
      }
    }

    if (flash > 0) {
      g.globalAlpha = Math.min(0.68, flash * 3.1);
      g.fillStyle = '#fffdf1';
      g.beginPath();
      g.arc(0, 0, r * 1.02, 0, TAU);
      g.fill();
      g.globalAlpha = 1;
    }
  }

  function drawEnemy(e, t) {
    const g = ctx;
    if (!e) return;
    const appear = clamp(e.age / 0.24, 0, 1);
    const pop = Math.max(0.05, easeOutBack(appear));
    const shadowAlpha = 0.13 * appear * clamp(1 - e.age * 0.02, 0.3, 1);
    if (!e.flying) {
      drawShadow(g, e.x, e.y + e.r * 0.92, e.r * 0.9, e.r * 0.3, shadowAlpha);
    }

    g.save();
    g.translate(e.x, e.y);
    g.scale(pop, pop);

    if (e.flying) {
      const speed = Math.hypot(e.vx, e.vy) || 1;
      const ux = e.vx / speed;
      const uy = e.vy / speed;
      g.save();
      g.strokeStyle = 'rgba(255, 255, 255, .56)';
      g.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const offset = i * e.r * 0.42;
        g.globalAlpha = 0.48 - i * 0.08;
        g.lineWidth = Math.max(1.2, e.r * 0.09);
        g.beginPath();
        g.moveTo(-ux * (e.r * 1.1 + offset) - uy * e.r * 0.5, -uy * (e.r * 1.1 + offset) + ux * e.r * 0.5);
        g.lineTo(-ux * (e.r * 2.2 + offset), -uy * (e.r * 2.2 + offset));
        g.stroke();
      }
      g.restore();
      g.rotate(e.spinAngle);
    } else {
      g.rotate(Math.sin(t * 2.8 + e.seed) * 0.055);
      if (e.hitCd > 0) {
        g.globalAlpha = 0.62 + 0.38 * (Math.sin(t * 45 + e.seed) > 0 ? 1 : 0);
      }
    }

    drawEnemyBody(g, e.type, e.r, e.hp, e.maxHp, t, e.seed, e.flash);
    g.restore();
  }

  function drawShockwaves() {
    const g = ctx;
    for (const wave of state.shockwaves) {
      const done = 1 - wave.life / wave.maxLife;
      const radius = wave.maxR * easeOutCubic(clamp(done, 0, 1));
      const alpha = clamp(wave.life / wave.maxLife, 0, 1);
      g.save();
      g.globalAlpha = alpha * 0.87;
      g.strokeStyle = wave.color;
      g.lineWidth = wave.width;
      g.beginPath();
      g.arc(wave.x, wave.y, radius, 0, TAU);
      g.stroke();
      g.restore();
    }
  }

  function drawParticles() {
    const g = ctx;
    for (let i = 0; i < state.particles.length; i++) {
      const p = state.particles[i];
      const alpha = clamp(p.life / p.maxLife, 0, 1);
      g.save();
      g.globalAlpha = alpha;
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.fillStyle = p.color;
      if (p.shape === 'star') {
        starPath(g, 0, 0, p.size, 5, 0.42);
        g.fill();
      } else if (p.shape === 'heart') {
        heartPath(g, 0, 0, p.size);
        g.fill();
      } else if (p.shape === 'confetti') {
        roundRect(g, -p.size * 0.52, -p.size * 0.26, p.size * 1.04, p.size * 0.52, 1.4);
        g.fill();
      } else {
        g.beginPath();
        g.arc(0, 0, p.size, 0, TAU);
        g.fill();
      }
      g.restore();
    }
  }

  function getDialogueBubbleLayout(p) {
    const g = ctx;
    g.save();
    g.font = `850 ${p.size}px ${FONT_STACK}`;
    const textWidth = Math.min(p.maxWidth || 210, g.measureText(p.text).width);
    g.restore();

    const w = textWidth + 18;
    const h = p.size + 13;
    let x = p.x;
    let y = p.y;
    let tail = p.tail || 'down';
    let tailOffset = 0;

    if (p.followPlayer && state.player) {
      const player = state.player;
      const s = view.s;
      const playerTop = player.y - 34 * s;
      const playerBottom = player.y + 24 * s;
      const gap = Math.max(10, 12 * s);
      const safeTop = Math.max(10, view.topBound + 6);
      const safeBottom = view.h - 8;

      // 对话框中心按许飞当前坐标实时计算，并在边缘做画布内修正。
      x = clamp(player.x, w / 2 + 10, view.w - w / 2 - 10);
      const aboveCenter = playerTop - gap - h / 2;
      if (aboveCenter - h / 2 >= safeTop) {
        y = aboveCenter;
        tail = 'down';
      } else {
        y = playerBottom + gap + h / 2;
        tail = 'up';
      }
      y = clamp(y, safeTop + h / 2, safeBottom - h / 2);
      tailOffset = clamp(player.x - x, -w / 2 + 14, w / 2 - 14);
    }

    return { x, y, w, h, tail, tailOffset };
  }

  function drawPopups() {
    const g = ctx;
    for (let i = 0; i < state.popups.length; i++) {
      const p = state.popups[i];
      const progress = 1 - p.life / p.maxLife;
      const fade = Math.min(1, progress * 9, p.life * 3.8);
      const pop = 0.82 + Math.min(1, progress * 7) * 0.18;
      const bubbleLayout = p.style === 'bubble' ? getDialogueBubbleLayout(p) : null;
      const drawX = bubbleLayout ? bubbleLayout.x : p.x;
      const drawY = bubbleLayout ? bubbleLayout.y : p.y;

      g.save();
      g.globalAlpha = clamp(fade, 0, 1);
      g.translate(drawX, drawY);
      g.rotate(Math.sin(p.seed + p.life * 6) * 0.018);

      if (p.style === 'bubble') {
        const w = bubbleLayout.w;
        const h = bubbleLayout.h;
        const tail = bubbleLayout.tail;
        const tailOffset = bubbleLayout.tailOffset;
        g.font = `850 ${p.size}px ${FONT_STACK}`;
        roundRect(g, -w / 2 + 1.5, -h / 2 + 2.5, w, h, Math.min(13, h / 2));
        g.fillStyle = 'rgba(76, 44, 37, .16)';
        g.fill();
        roundRect(g, -w / 2, -h / 2, w, h, Math.min(13, h / 2));
        g.fillStyle = 'rgba(255, 253, 244, .96)';
        g.fill();
        g.strokeStyle = '#42303a';
        g.lineWidth = 2;
        g.stroke();

        g.beginPath();
        if (tail === 'left') {
          g.moveTo(-w / 2 + 2, -3);
          g.lineTo(-w / 2 - 12, 4);
          g.lineTo(-w / 2 + 2, 11);
        } else if (tail === 'right') {
          g.moveTo(w / 2 - 2, -3);
          g.lineTo(w / 2 + 12, 4);
          g.lineTo(w / 2 - 2, 11);
        } else if (tail === 'up') {
          g.moveTo(tailOffset - 6, -h / 2 + 1);
          g.lineTo(tailOffset + 1, -h / 2 - 8);
          g.lineTo(tailOffset + 7, -h / 2 + 1);
        } else {
          g.moveTo(tailOffset - 6, h / 2 - 1);
          g.lineTo(tailOffset + 1, h / 2 + 8);
          g.lineTo(tailOffset + 7, h / 2 - 1);
        }
        g.closePath();
        g.fillStyle = 'rgba(255, 253, 244, .96)';
        g.fill();
        g.strokeStyle = '#42303a';
        g.lineWidth = 2;
        g.stroke();
        g.fillStyle = p.color;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(p.text, 0, 0.5);
      } else {
        g.scale(pop, pop);
        g.font = `950 ${p.size}px ${FONT_STACK}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineJoin = 'round';
        g.strokeStyle = 'rgba(255, 252, 237, .96)';
        g.lineWidth = Math.max(3, p.size * 0.28);
        g.strokeText(p.text, 0, 0);
        g.fillStyle = p.color;
        g.fillText(p.text, 0, 0);
      }
      g.restore();
    }
  }

  /* ============================================================
     11. 场景合成与屏幕效果
     ============================================================ */
  function drawScene(t) {
    drawBarrier(t);
    drawPlayerAura(t);

    const items = [];
    if (state.lena) {
      items.push({
        y: state.lena.y + 5,
        draw: () => drawLenaAt(ctx, state.lena.x, state.lena.y, view.s, t, {
          hurt: state.lena.hurt,
          lives: state.lives,
          seed: 1.7
        })
      });
    }
    if (state.player) {
      items.push({
        y: state.player.y,
        draw: () => drawPlayerAt(ctx, state.player.x, state.player.y, view.s, t, {
          facing: state.player.facing,
          moving: state.player.moving,
          walk: state.player.walk,
          blockAngle: state.lastBlockAngle,
          blockPulse: state.shieldPulse
        })
      });
    }
    for (const e of state.enemies) {
      items.push({ y: e.y, draw: () => drawEnemy(e, t) });
    }
    items.sort((a, b) => a.y - b.y);
    for (const item of items) item.draw();

    drawShockwaves();
    drawGuardFX(t);
    drawParticles();
    drawPopups();
  }

  function drawScreenEffects(t) {
    const g = ctx;
    const w = view.w;
    const h = view.h;

    const vignette = g.createRadialGradient(
      view.cx, view.cy, Math.min(w, h) * 0.28,
      view.cx, view.cy, Math.max(w, h) * 0.76
    );
    vignette.addColorStop(0, 'rgba(82, 48, 36, 0)');
    vignette.addColorStop(0.74, 'rgba(82, 48, 36, .025)');
    vignette.addColorStop(1, 'rgba(82, 48, 36, .115)');
    g.fillStyle = vignette;
    g.fillRect(0, 0, w, h);

    if (state.mode === GAME_STATE.PLAYING && state.elapsed >= 40) {
      const redPulse = (0.5 + 0.5 * Math.sin(t * 3.4)) * 0.022;
      g.fillStyle = `rgba(255, 65, 95, ${redPulse})`;
      g.fillRect(0, 0, w, h);
    }

    if (state.flash > 0) {
      g.save();
      g.fillStyle = `rgba(255, 63, 100, ${state.flash * 0.15})`;
      g.fillRect(0, 0, w, h);
      const red = g.createRadialGradient(
        view.cx, view.cy, Math.min(w, h) * 0.18,
        view.cx, view.cy, Math.max(w, h) * 0.7
      );
      red.addColorStop(0, 'rgba(255, 54, 92, 0)');
      red.addColorStop(1, `rgba(255, 28, 71, ${state.flash * 0.29})`);
      g.fillStyle = red;
      g.fillRect(0, 0, w, h);
      g.restore();
    }

    if (state.mode === GAME_STATE.WIN) {
      const gold = g.createRadialGradient(
        view.cx, view.cy, Math.min(w, h) * 0.24,
        view.cx, view.cy, Math.max(w, h) * 0.76
      );
      gold.addColorStop(0, 'rgba(255, 225, 120, 0)');
      gold.addColorStop(1, 'rgba(255, 190, 65, .13)');
      g.fillStyle = gold;
      g.fillRect(0, 0, w, h);
    } else if (state.mode === GAME_STATE.GAMEOVER) {
      g.fillStyle = 'rgba(94, 34, 45, .08)';
      g.fillRect(0, 0, w, h);
    }
  }

  function render(t) {
    const g = ctx;
    g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    g.clearRect(0, 0, view.w, view.h);
    drawBackground(t);

    const ambient = state.mode === GAME_STATE.PLAYING && state.elapsed >= 40 ? 0.5 : 0;
    const shakeLevel = state.paused ? 0 : state.shake + ambient;
    const shake = reduceMotion ? shakeLevel * 0.16 : shakeLevel;
    const sx = shake > 0 ? rand(-shake, shake) : 0;
    const sy = shake > 0 ? rand(-shake, shake) : 0;

    g.save();
    g.translate(sx, sy);
    drawScene(t);
    g.restore();

    drawScreenEffects(t);
  }

  /* ============================================================
     12. 开始界面小插画
     ============================================================ */
  function drawHeroScene(t) {
    const g = heroCtx;
    g.setTransform(heroDpr, 0, 0, heroDpr, 0, 0);
    g.clearRect(0, 0, HERO_W, HERO_H);

    const bg = g.createLinearGradient(0, 0, HERO_W, HERO_H);
    bg.addColorStop(0, '#fff6d6');
    bg.addColorStop(0.56, '#fff0e8');
    bg.addColorStop(1, '#e8f5ff');
    g.fillStyle = bg;
    g.fillRect(0, 0, HERO_W, HERO_H);

    g.save();
    g.globalAlpha = 0.75;
    drawHeroBlob(g, 88, 38, 120, 'rgba(255, 221, 129, .35)');
    drawHeroBlob(g, 528, 55, 130, 'rgba(159, 211, 255, .28)');
    drawHeroBlob(g, 300, 230, 220, 'rgba(255, 190, 210, .2)');
    g.restore();

    g.save();
    g.fillStyle = 'rgba(126, 86, 64, .12)';
    for (let y = 16; y < HERO_H; y += 26) {
      for (let x = 14; x < HERO_W; x += 26) {
        g.beginPath();
        g.arc(x, y, 0.9, 0, TAU);
        g.fill();
      }
    }
    g.restore();

    // 地面光圈和“牢”
    const lx = 366;
    const ly = 121;
    g.save();
    g.translate(lx, ly + 30);
    g.globalAlpha = 0.18;
    g.fillStyle = '#5b392c';
    g.beginPath();
    g.ellipse(0, 0, 150, 28, 0, 0, TAU);
    g.fill();
    g.restore();

    const rr = 106;
    const circleGrad = g.createRadialGradient(lx, ly, 4, lx, ly, rr);
    circleGrad.addColorStop(0, 'rgba(255, 242, 244, .2)');
    circleGrad.addColorStop(0.76, 'rgba(255, 195, 215, .22)');
    circleGrad.addColorStop(1, 'rgba(255, 161, 192, .04)');
    g.fillStyle = circleGrad;
    g.beginPath();
    g.arc(lx, ly, rr, 0, TAU);
    g.fill();
    g.save();
    g.translate(lx, ly);
    g.rotate(t * 0.12);
    g.setLineDash([7, 8]);
    g.strokeStyle = 'rgba(241, 105, 145, .62)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(0, 0, rr, 0, TAU);
    g.stroke();
    g.restore();
    g.save();
    g.strokeStyle = 'rgba(255, 206, 82, .75)';
    g.lineWidth = 2;
    g.setLineDash([2, 12]);
    g.beginPath();
    g.arc(lx, ly, rr - 15, 0, TAU);
    g.stroke();
    g.restore();

    // 三只小怪在旁边探头
    const crowdBob = Math.sin(t * 2.2) * 3;
    drawShadow(g, 512, 167, 28, 7, 0.12);
    g.save();
    g.translate(512, 145 + crowdBob);
    g.rotate(-0.08);
    drawEnemyBody(g, 'crowd', 22, 1, 1, t, 2.4, 0);
    g.restore();

    const memBob = Math.sin(t * 2.6 + 1.2) * 3;
    drawShadow(g, 91, 126, 22, 6, 0.1);
    g.save();
    g.translate(91, 105 + memBob);
    g.rotate(0.08);
    drawEnemyBody(g, 'memory', 19, 1, 1, t, 4.1, 0);
    g.restore();

    g.save();
    g.translate(555, 72 + Math.sin(t * 2 + 0.4) * 2);
    g.scale(0.7, 0.7);
    g.rotate(0.12);
    drawEnemyBody(g, 'marriage', 27, 2, 2, t, 1.2, 0);
    g.restore();

    // 厉娜与许飞
    drawLenaAt(g, lx, ly, 1.17, t, { lives: 3, hurt: 0, seed: 0.6 });
    drawPlayerAt(g, 206, 151, 1.08, t, { facing: 0.03, moving: false, walk: 0 });

    // 爱心与涂鸦
    const hearts = [
      { x: 292, y: 51, s: 8, p: 0.2 },
      { x: 440, y: 42, s: 6, p: 1.8 },
      { x: 492, y: 92, s: 5, p: 3.3 },
      { x: 260, y: 93, s: 4.5, p: 2.4 }
    ];
    for (const h of hearts) {
      const float = Math.sin(t * 1.8 + h.p) * 3;
      g.save();
      g.translate(h.x, h.y + float);
      g.rotate(Math.sin(t + h.p) * 0.2);
      heartPath(g, 0, 0, h.s);
      g.fillStyle = h.s > 6 ? 'rgba(255, 112, 157, .75)' : 'rgba(255, 192, 79, .8)';
      g.fill();
      g.restore();
    }

    const sparkleA = 0.55 + Math.sin(t * 3.8) * 0.25;
    g.save();
    g.globalAlpha = sparkleA;
    starPath(g, 268, 120, 8, 4, 0.28);
    g.fillStyle = '#fff7bb';
    g.fill();
    starPath(g, 464, 170, 5.5, 4, 0.3);
    g.fillStyle = '#ffd75d';
    g.fill();
    g.restore();

    // 括号式手绘装饰
    g.save();
    g.strokeStyle = 'rgba(83, 60, 58, .24)';
    g.lineWidth = 2.2;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(148, 55);
    g.quadraticCurveTo(132, 84, 150, 112);
    g.moveTo(493, 31);
    g.quadraticCurveTo(510, 57, 500, 83);
    g.stroke();
    g.restore();

    // 气泡台词
    drawHeroBubble(g, '我挡着！', 150, 56, t);
  }

  function drawHeroBlob(g, x, y, r, color) {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }

  function drawHeroBubble(g, text, x, y, t) {
    const size = 19;
    g.save();
    g.font = `950 ${size}px ${FONT_STACK}`;
    const tw = g.measureText(text).width;
    const w = tw + 22;
    const h = 38;
    const bob = Math.sin(t * 2.3) * 1.8;
    g.translate(x, y + bob);
    g.rotate(-0.02);
    roundRect(g, -w / 2 + 2, -h / 2 + 3, w, h, 13);
    g.fillStyle = 'rgba(88, 55, 48, .17)';
    g.fill();
    roundRect(g, -w / 2, -h / 2, w, h, 13);
    g.fillStyle = 'rgba(255, 254, 246, .97)';
    g.fill();
    g.strokeStyle = '#42303a';
    g.lineWidth = 2.4;
    g.stroke();
    g.beginPath();
    g.moveTo(13, h / 2 - 2);
    g.lineTo(28, h / 2 + 26);
    g.lineTo(43, h / 2 - 2);
    g.closePath();
    g.fillStyle = 'rgba(255, 254, 246, .97)';
    g.fill();
    g.strokeStyle = '#42303a';
    g.lineWidth = 2.4;
    g.stroke();
    g.fillStyle = '#2f6bbd';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 0, 1);
    g.restore();
  }

  /* ============================================================
     13. 主循环与启动
     ============================================================ */
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;

    if (!state.paused) {
      state.t += dt;
      if (state.mode === GAME_STATE.PLAYING && !state.audioSettingsOpen) updateGame(dt);
      updateVisuals(dt);
    }

    render(state.t);
    if (state.mode === GAME_STATE.START) {
      drawHeroScene(now / 1000);
    }

    requestAnimationFrame(frame);
  }

  function bindLifecycle() {
    dom.startBtn.addEventListener('click', () => {
      AudioManager.initAudio();
      startRun();
    });
    dom.restartBtn.addEventListener('click', () => {
      AudioManager.initAudio();
      startRun();
    });
    dom.resumeBtn.addEventListener('click', resumeGame);
    dom.pauseBtn.addEventListener('click', () => {
      if (state.mode !== GAME_STATE.PLAYING) return;
      if (state.paused) resumeGame();
      else pauseGame();
    });
    dom.toUpgradeBtn.addEventListener('click', () => {
      if (state.mode !== GAME_STATE.LEVEL_CLEAR) return;
      if (state.level >= getMaxLevel()) showFinalWin();
      else openUpgradeScreen();
    });
    dom.upgradeGrid.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-upgrade]');
      if (!button) return;
      chooseUpgrade(button.dataset.upgrade);
    });
    dom.startNextBtn.addEventListener('click', startNextLevel);

    bindAudioSettings();
    bindKeyboard();
    bindJoystick();

    window.addEventListener('resize', scheduleResize);
    window.addEventListener('orientationchange', () => {
      setTimeout(scheduleResize, 80);
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', scheduleResize);
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.mode === GAME_STATE.PLAYING && !state.paused) {
        pauseGame();
      }
    });
    dom.joyBase.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('pointerdown', () => {
      AudioManager.handleUserGesture();
    }, { once: true, passive: true });
  }

  function boot() {
    const touchCapable = (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) || ('ontouchstart' in window);
    if (touchCapable) document.body.classList.add('touch');
    window.addEventListener('touchstart', () => document.body.classList.add('touch'), { once: true, passive: true });

    state.mode = GAME_STATE.LOADING;
    resizeAll();
    resetRunStats();
    resetLevelRuntime();
    hideAllScreens();
    showScreen(dom.loadingScreen);
    syncBodyClasses();
    updateAudioControls();
    bindLifecycle();
    lastFrame = performance.now();
    requestAnimationFrame(frame);

    const minimumLoading = new Promise((resolve) => setTimeout(resolve, 450));
    Promise.all([RESOURCES.preloadAll(), minimumLoading])
      .then(() => {
        if (state.mode === GAME_STATE.LOADING) enterStartScreen();
      })
      .catch(() => {
        if (state.mode === GAME_STATE.LOADING) enterStartScreen();
      });
  }

  // 调试接口：方便后续改数值或做自动化检查，不影响正常游玩。
  window.__DILINA_GAME__ = {
    state,
    view,
    GAME_CONFIG,
    GAME_STATE,
    assets: RESOURCES,
    audio: AudioManager,
    start: startRun,
    startLevel,
    completeLevel,
    openUpgradeScreen,
    chooseUpgrade,
    startNextLevel,
    showGameOver,
    showFinalWin,
    hitEnemy,
    triggerBarrierDefense,
    getMaxLevel,
    getUpgradeOptions,
    getCurrentLevelConfig: currentLevelConfig,
    getDialogueBubbleLayout,
    showPlayerQuip,
    getSpriteDebug: () => JSON.parse(JSON.stringify(spriteDebug)),
    getSpriteLayout,
    updateSpawner,
    triggerBarrierDefense,
    spawnEnemy,
    damageLena,
    updateHUD
  };

  boot();
})();