# 我画地为牢啊，厉娜！

单页 H5 街机守护小游戏。当前版本在原有 60 秒生存玩法上增加了牢笼耐久、5 关难度成长和通关四选一强化。

## 启动

直接双击 `index.html` 打开即可，支持 `file://`，无需构建或服务器。

必须保留 `assets/` 目录与 `index.html` 的相对位置；PNG 资源说明见 [assets/README.md](assets/README.md)。全部声音由 Web Audio API 实时合成，不包含任何音频媒体文件。

## 当前功能

- 每关 60 秒，共 5 关，通关后进入最终胜利界面
- 许飞自由移动，登山杖自动格挡；牢笼另有一套独立自动弹敌机制
- 牢笼有独立耐久，耐久归零后不再防御，但许飞仍可自由进出
- 每关结束后：
  1. 关卡胜利统计
  2. 四选一强化
  3. 下一关准备
  4. 点击开始下一关
- 移动速度、最大生命、牢笼上限和范围可跨关继承；每关成功后当前生命恢复至当前最大值
- 牢笼当前耐久每关恢复满值；破碎动画结束后清除裂痕，只保留失效轮廓
- 牢笼耐久圆点只读取实际当前/最大耐久，换关时重建为完整可用状态，不继承上一关消耗标记
- 许飞对话气泡实时跟随角色，支持顶部下翻、画布边缘修正和指向尾巴
- PC 键盘、手机摇杆、暂停和失败重开
- 纯 Web Audio 实时合成音频：落笔、碰撞、破墙、胜利、弹飞、牢笼、受伤和按钮音效
- 声音设置面板：总静音开关、音乐与音效独立开关、独立 0–100 音量、即时生效、localStorage 恢复
- 统一 PNG 资源加载层、失败降级和正式 PNG 替换接口；许飞、厉娜角色 PNG 按自然宽高比和 `displayWidth/displayHeight` 绘制，不裁切、不影响碰撞与数值
- 游戏场景中不再绘制许飞、厉娜的角色脚底名称标签；顶部 HUD、关卡提示与对话文字保留

## 统一配置

所有关卡难度、成长数值和牢笼参数集中在 `index.html` 顶部的 `GAME_CONFIG`。

### 添加或调整关卡

编辑 `GAME_CONFIG.level.levels`：

```js
{
  title: '第6关：新的围攻！',
  hint: '下一关提示文案。',
  speedMultiplier: 1.6,
  spawnInterval: 1.1,
  spawnCount: [2, 4],
  weights: { crowd: 0.35, memory: 0.37, marriage: 0.28 }
}
```

同时把 `GAME_CONFIG.level.maxLevel` 改成和实际关卡数组一致。每关的 `spawnInterval` 是 20–40 秒段基准值；`GAME_CONFIG.level.spawnRamp` 负责关内前慢后快，`minSpawnInterval` 是刷新间隔下限。

### 调整牢笼

`GAME_CONFIG.barrier`：

- `initialDurability`：初始耐久
- `maxDurability`：耐久上限
- `durabilityUpgradeAmount`：单次耐久强化量
- `initialRadius`：基础防御半径
- `radiusUpgradeRate`：单次范围强化比例
- `maxRadiusMultiplier`：最大范围倍率
- `knockbackDistance`：单次弹飞距离
- `knockbackDuration`：弹飞时长
- `enemyHitCooldown`：同一敌人再次触发前的免疫时间

实际屏幕半径会按屏幕空间等比缩放，以保证 5 关内扩建牢笼仍能完整显示。

### 调整强化

`GAME_CONFIG.upgrades` 只负责名称、图标与主题；实际数值来自对应属性：

- 速度：`player.moveSpeedUpgradeRate`、`player.maxMoveSpeedMultiplier`
- 生命：`lina.healthUpgradeAmount`、`lina.maxHealth`
- 牢笼耐久：`barrier.durabilityUpgradeAmount`、`barrier.maxDurability`
- 牢笼范围：`barrier.radiusUpgradeRate`、`barrier.maxRadiusMultiplier`

强化卡片上的百分比、当前值和强化后值由代码从这些配置实时计算，修改数值后不需要同时改 HTML 文案。

### 调整角色与敌人

- 许飞：`GAME_CONFIG.player`
- 厉娜：`GAME_CONFIG.lina`
- 敌人基础血量、速度、体型：`GAME_CONFIG.enemyTypes`
- 敌人生成上限与粒子上限：`GAME_CONFIG.performance`
- 每关 20 秒、40 秒特殊播报：`GAME_CONFIG.milestones`

## 音频系统

全部声音由 Web Audio API 实时合成，不加载任何音频媒体文件。

- 配置：[`AUDIO_CONFIG`](assets/audio-config.js)，集中管理默认音量、音色类型、循环、最小间隔和音量倍率。
- 管理器：[`GameAudioManager`](assets/audio-manager.js)，接口包括 `initAudio()`、`playMusic()`、`stopMusic()`、`pauseMusic()`、`resumeMusic()`、`playSfx()`、`setMasterEnabled()`、`setMusicEnabled()`、`setSfxEnabled()`、`setMusicVolume()`、`setSfxVolume()`、`stopAllAudio()`。
- 首次点击、触摸或按键时才创建 `AudioContext`；不支持 Web Audio API 的设备静默降级，游戏照常运行。
- 默认设置：总声音开启、音乐开启 40%、音效开启 70%；可在 `AUDIO_CONFIG.defaults` 修改。
- 最终音量：总开关 × 用户分类音量 × 单条音效 `volume`。
- 设置写入 `localStorage` 的 `dilina-audio-settings-v2`。
- `minGapMs` 用于限制高频重叠；音乐只保留一个当前曲目，切换时停止旧曲目的合成节点。

事件绑定：

- `drawLine`：每关开场自动画圈成牢时的轻微落笔声
- `collision`：许飞格挡敌人、牢笼被撞击时的短促碰撞声
- `enemyKnockback`：许飞命中/弹飞敌人
- `barrierCrack`：牢笼每次实际减少耐久
- `barrierBreak`：牢笼耐久归零时的清脆碎裂声
- `linaHurt`：厉娜实际减少生命
- `uiClick`：所有按钮点击
- `uiVictory`：普通关卡结算，以及最终胜利界面
- `uiDefeat`：游戏失败
- `game` BGM：PLAYING 到 LEVEL_CLEAR / UPGRADE / NEXT_LEVEL 连续播放
- `victory` BGM：WIN；`gameover` BGM：GAMEOVER
- 暂停时 BGM 暂停，继续时恢复；设置面板打开期间游戏逻辑冻结但 BGM 保持

## 小工具打包

- 页面主逻辑已从内联脚本外置为 [`assets/game.js`](assets/game.js)，`index.html` 仅通过包内经典 `<script src>` 加载。
- 上传用静态目录为 `dist/`，最终 zip 为 `dilina-minitool.zip`。上传包已完全扁平化：`index.html`、全部脚本和图片都位于 zip 根目录，不使用任何子目录、反斜杠、`..` 或前导斜杠，也不包含任何音频媒体文件。
- 打包副本按实际显示尺寸压缩了角色和鸭舌 PNG；工作区原始素材未改动。
- 已加入 Chrome 61 关键 CSS 回退、`replaceChildren` 小型 polyfill、Flex gap 行为检测；平台振动使用 `window.xhs.miniTool.vibrateShort`，不支持时静默降级。

## 状态机

`GAME_STATE` 包含：

- `LOADING`
- `START`
- `PLAYING`
- `LEVEL_CLEAR`
- `UPGRADE`
- `NEXT_LEVEL`
- `GAMEOVER`
- `WIN`

非 `PLAYING` 状态下不会调用 `updateGame`，所以结算、强化和下一关准备期间敌人不会继续移动或生成；主循环只有一个 `requestAnimationFrame`。

## 调试接口

`window.__DILINA_GAME__` 暴露了 `state`、`view`、`GAME_CONFIG`、`assets`、`audio`、`startLevel`、`completeLevel`、`openUpgradeScreen`、`chooseUpgrade`、`startNextLevel`、`spawnEnemy`、`showPlayerQuip`、`getDialogueBubbleLayout` 等接口，便于测试关卡、数值、音频和对话布局。

## 验证

已完成 Edge/Chromium 无头浏览器定向回归（对话/生命/裂痕 23 项、耐久圆点同步 16 项、PNG 加载与绘制 17 项、Web Audio 与完整流程 16 项、厉娜 PNG 与角色名称移除 12 项，均全部通过），并覆盖原有启动、资源、键盘/摇杆和关卡流程基础回归：

- 8/8 PNG 资源加载；许飞 1092×1092 PNG 以完整图和非裁切 5 参数 `drawImage` 绘制
- 厉娜 1092×1092 PNG 已预加载并接入主场景/开始页，调试日志输出路径、状态、自然尺寸和 67.92×67.92 绘制尺寸
- 原始宽高比适配、`displayWidth/displayHeight` 目标框、不同宽高比 contain、显式 stretch
- 许飞进出牢笼不受阻挡
- 牢笼弹飞不扣血、不击杀、不增加弹飞数
- 单次防御只扣 1 耐久、免疫时间、重复接近
- 耐久归零后失效且不再防御
- HUD 生命图标、耐久圆点、2 行布局
- 5 关速度 / 刷新间隔 / 刷新数量配置
- 四种强化生效、单次选择、跨关继承、上限控制
- 关卡胜利、最终胜利、游戏失败、重开；通关恢复生命，暂停/失败不恢复
- 牢笼破碎动画后裂痕清理、失效不防御、下一关完整恢复
- 对话气泡左右/上下跟随、顶部下翻、左右边缘修正、结束后消失
- 牢笼圆点随每次防御、归零、换关、耐久强化和多关连续切换同步
- 暂停、键盘移动、手机摇杆
- 手机竖屏、横屏、最高 6 生命和 12 耐久 HUD
- 首次点击/触摸前无 AudioContext；首次手势后创建并恢复运行；暂停/继续与关卡切换音乐状态正确
- 总静音开关、音乐/音效独立开关和音量；设置写入 localStorage
- 落笔、碰撞、破墙、胜利、弹飞、牢笼裂纹、厉娜受伤和按钮音效均有独立合成音色
- 完整 5 关流程、最终胜利、失败重开均无 JS 报错，BGM 与提示音触发正确
- 运行环境移除 AudioContext 后游戏仍能进入 PLAYING、无未捕获异常
- 设置面板遮罩/关闭按钮、内部点击不误关、手机竖屏和横屏布局
- 许飞和厉娜 PNG 下方的角色名称不再绘制；顶部 HUD 的“厉娜”、关卡提示和对话文字保留
