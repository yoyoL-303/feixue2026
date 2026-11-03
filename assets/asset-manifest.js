/*
 * 《我画地为牢啊，厉娜！》统一 PNG 资源配置表
 * ------------------------------------------------------------
 * 路径相对于 index.html（basePath 统一指向 assets/）。
 * 正式美术只需覆盖同名 PNG，或修改此表中的 src。
 *
 * usage:
 *   active   - 当前版本已经接入渲染/UI 的资源
 *   reserved - 已预加载、已登记，等待正式角色/敌人 PNG 后接入的资源
 *
 * useInGame:
 *   true 表示后续渲染代码可直接通过 GameResourceManager 取用；
 *   reserved 资源目前保持 false，以免占位图覆盖现有 Canvas 角色。
 */
window.GAME_ASSET_MANIFEST = {
  version: 1,
  basePath: "assets/",
  assets: {
    "ui.lifeDuckbill": {
      src: "ui/duckbill.png",
      label: "厉娜鸭舌生命图标",
      kind: "ui",
      usage: "active",
      preload: true,
      useInGame: true,
      width: 1696,
      height: 1472,
      alt: "鸭舌生命图标"
    },
    "prop.trekkingPole": {
      src: "props/trekking_pole.png",
      label: "许飞登山杖",
      kind: "prop",
      usage: "active",
      preload: true,
      useInGame: true,
      width: 72,
      height: 180,
      displayWidth: 40,
      displayHeight: 94,
      anchor: [0.5, 0.34]
    },
    "fx.guardSpark": {
      src: "fx/guard_spark.png",
      label: "登山杖格挡火花",
      kind: "fx",
      usage: "active",
      preload: true,
      useInGame: true,
      width: 128,
      height: 128,
      displayWidth: 42,
      displayHeight: 42
    },
    "character.xufei": {
      src: "characters/xufei.png",
      label: "许飞角色 PNG",
      kind: "character",
      usage: "active",
      preload: true,
      useInGame: true,
      width: 1092,
      height: 1092,
      displayWidth: 64,
      displayHeight: 58,
      anchor: [0.5, 0.65]
    },
    "character.lina": {
      src: "characters/lina.png",
      label: "厉娜角色 PNG",
      kind: "character",
      usage: "active",
      preload: true,
      useInGame: true,
      width: 1092,
      height: 1092,
      displayWidth: 64,
      displayHeight: 58,
      anchor: [0.5, 0.45]
    },
    "enemy.crowd": {
      src: "enemies/crowd.png",
      label: "吃瓜群众 PNG 占位图",
      kind: "enemy",
      usage: "reserved",
      preload: true,
      useInGame: false,
      width: 256,
      height: 256
    },
    "enemy.memory": {
      src: "enemies/memory.png",
      label: "回忆怪 PNG 占位图",
      kind: "enemy",
      usage: "reserved",
      preload: true,
      useInGame: false,
      width: 256,
      height: 256
    },
    "enemy.marriage": {
      src: "enemies/marriage.png",
      label: "催婚怪 PNG 占位图",
      kind: "enemy",
      usage: "reserved",
      preload: true,
      useInGame: false,
      width: 256,
      height: 256
    }
  }
};
