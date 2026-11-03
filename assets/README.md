# PNG 资源目录

本目录是《我画地为牢啊，厉娜！》的独立 PNG 资源层。游戏本体仍保持轻量，所有图片均由 `assets/asset-manifest.js` 统一登记，由 `assets/resource-manager.js` 预加载、缓存和降级。

本次增量改造只替换表现层：许飞的盾牌视觉改为登山杖自动格挡，厉娜生命值改为鸭舌护符；原移动、刷怪、碰撞半径、击退冷却、生命值、60 秒计时、胜负判定和重开逻辑保持不变。

## 启动

直接双击根目录的 `index.html` 即可运行（支持 `file://`，不需要构建或本地服务器）。`index.html` 与 `assets/` 必须保持相对位置，移动时请整体移动整个目录。

## 目录结构

```text
index.html
assets/
├─ asset-manifest.js      统一资源配置表
├─ resource-manager.js    独立 PNG 加载/缓存/降级系统
├─ README.md
├─ ui/
│  └─ duckbill.png        厉娜生命值鸭舌图标（已接入 HUD）
├─ props/
│  └─ trekking_pole.png   许飞登山杖（已接入自动格挡视觉）
├─ fx/
│  └─ guard_spark.png     登山杖格挡火花（已接入）
├─ characters/
│  ├─ xufei.png           许飞角色 PNG（已接入游戏内 Canvas）
│  └─ lina.png            厉娜角色 PNG（已接入游戏内 Canvas）
└─ enemies/
   ├─ crowd.png           吃瓜群众 PNG 占位图（预留）
   ├─ memory.png          回忆怪 PNG 占位图（预留）
   └─ marriage.png        催婚怪 PNG 占位图（预留）
```

## 替换正式 PNG

1. 保持文件名，直接覆盖同名 PNG 即可；也可以在 `asset-manifest.js` 中改 `src`。
2. 建议使用透明背景 PNG。
3. 当前已经接入的资源：
   - `ui.lifeDuckbill`：HUD 生命值鸭舌图标。透明背景 PNG，HUD 会按原比例等比缩放；当前正式素材为 1696×1472。
   - `character.xufei`：许飞角色，已接入主场景与开始页 Canvas。完整 PNG 会被直接绘制，按原图自然比例 contain 到 `displayWidth: 64`、`displayHeight: 58` 的目标框内；`anchor` 为脚底定位点。
   - `character.lina`：厉娜角色，已接入主场景与开始页 Canvas。完整 PNG 直接绘制，按自然比例 contain 到 `displayWidth: 64`、`displayHeight: 58` 的目标框内；`anchor: [0.5, 0.45]` 对应原角色脚下的定位点。只有图片加载失败时才回退到 Canvas 矢量造型。
   - `prop.trekkingPole`：登山杖，建议竖版透明 PNG，`anchor` 为握把位置（0–1），`displayWidth` / `displayHeight` 为游戏内目标框。
   - `fx.guardSpark`：格挡瞬间火花，正方形透明 PNG 效果最佳，`displayWidth` / `displayHeight` 为游戏内目标框。
4. 角色与敌人 PNG 都会预加载。`character.xufei` 与 `character.lina` 的 `useInGame` 已为 `true`；三个敌人目前仍是占位图，`useInGame` 保持 `false`，不会覆盖现有 Canvas 卡通造型。
5. `displayWidth` / `displayHeight` 只影响绘制尺寸，不影响碰撞半径、防御范围或任何玩法数值。两者同时配置时默认按 contain 保持原始宽高比；只有显式配置 `stretch: true` 才会拉伸。渲染使用 5 参数 `drawImage`，不裁切、不按 Sprite Sheet 帧切图，也不把清单里的 `width` / `height` 当成加载上限。

## 运行时接口

主脚本中可直接使用：

```js
RESOURCES.getPath("ui.lifeDuckbill");   // 解析后的图片路径
RESOURCES.getImage("prop.trekkingPole"); // 加载完成的 HTMLImageElement，未完成时为 null
RESOURCES.getStatus("fx.guardSpark");   // idle | loading | loaded | failed
RESOURCES.getStats();                   // 总数、成功、失败、加载中状态
```

加载失败不会抛出异常，也不会阻塞游戏；Canvas 绘制会使用内置矢量兜底，HUD 使用内联 SVG 兜底，因此项目在缺少图片时仍然可玩。
