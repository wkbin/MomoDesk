# 桌面宠物猫项目需求文档与实施方案

## 1. 项目定位

本项目是一款 Windows 优先的轻量级桌面宠物应用。核心体验是一只猫咪常驻桌面，以透明置顶窗口显示，在用户工作时进行低打扰陪伴：自主走动、坐下、睡觉、舔毛、伸懒腰，也能被点击、拖拽、喂食或召回。

你已经具备两类关键 AI 资产生产能力：

- `gpt-image-2`：生成猫咪完整多视图、表情设定、静态姿态和图标。
- `seedance2.0`：生成猫咪动作动画图，用于提取帧序列或参考动作。

因此本项目不建议从一开始做复杂 3D 或骨骼动画，而应采用“AI 生成角色资产 + 精灵图帧动画 + 桌面窗口控制”的路线，先快速做出稳定、可爱的 MVP，再逐步扩展行为和皮肤。

## 2. 产品目标

### 2.1 核心目标

- 猫咪能以透明背景悬浮在桌面上，不遮挡用户主要工作。
- 猫咪有自然的自主行为，不显得机械或重复。
- 用户可以通过点击、拖拽、托盘菜单与猫咪互动。
- 应用长期运行稳定，低 CPU、低内存、无明显卡顿。
- 素材生产流程可复用，后续可以快速增加新猫咪、新动作和新皮肤。

### 2.2 非目标

首版不做以下内容：

- 复杂养成系统。
- 联网账号、云同步、社交系统。
- 3D 猫咪或物理毛发。
- 多只猫咪复杂群体互动。
- 商店、付费内容、在线素材市场。

这些能力可以在 v1.0 后作为扩展方向。

## 3. 用户场景

### 场景 A：陪伴工作

用户打开电脑后，猫咪随应用自启动。猫咪在屏幕底部附近散步、坐下、睡觉，不频繁打扰。用户偶尔看到猫咪的小动作，获得陪伴感。

### 场景 B：短暂互动

用户点击猫咪，猫咪喵叫、舔毛或伸懒腰。用户拖拽猫咪到另一处，松手后猫咪有轻微掉落或落地动作。

### 场景 C：管理与控制

用户通过托盘菜单召回猫咪、暂停活动、关闭音效、设置开机启动或退出应用。

### 场景 D：换皮肤和扩展动作

开发者或用户用 AI 生成新的猫咪外观和动作资源，按既定资源规范导入应用，不需要修改核心代码。

## 4. 功能需求

### 4.1 桌面窗口

| 功能 | 优先级 | 说明 |
|---|---:|---|
| 透明无边框窗口 | P0 | 只显示猫咪本体，背景透明 |
| 始终置顶 | P0 | 猫咪悬浮在普通窗口上方 |
| 跳过任务栏 | P0 | 不在任务栏显示主窗口 |
| 系统托盘 | P0 | 提供退出、召回、暂停等入口 |
| 可拖拽移动 | P0 | 用户能把猫咪拖到桌面任意位置 |
| 多显示器边界检测 | P1 | 不跑出可见工作区 |
| 点击穿透 | P1 | 非猫咪区域不拦截鼠标 |
| DPI 适配 | P1 | 高分屏不模糊、不错位 |

### 4.2 猫咪行为

| 行为 | 优先级 | 说明 |
|---|---:|---|
| Idle 站立呼吸 | P0 | 默认状态，低帧率循环 |
| Walk 行走 | P0 | 随机选择目标点并移动 |
| Sit 坐下 | P0 | 行走或空闲后进入坐姿 |
| Sleep 睡觉 | P0 | 长时间无交互后进入 |
| Stretch 伸懒腰 | P1 | 点击或随机触发 |
| Groom 舔毛 | P1 | 点击或空闲随机触发 |
| Dragging 被拖拽 | P0 | 鼠标按住猫咪时触发 |
| Fall/Land 掉落落地 | P1 | 松开拖拽后触发 |
| Eat 喂食 | P1 | 托盘菜单或右键菜单触发 |
| LookAtMouse 看鼠标 | P2 | 鼠标靠近时短暂转头 |

### 4.3 用户交互

| 交互 | 优先级 | 说明 |
|---|---:|---|
| 单击 | P0 | 随机触发喵叫、舔毛、伸懒腰 |
| 拖拽 | P0 | 猫咪跟随鼠标移动 |
| 右键菜单 | P1 | 喂食、睡觉、召回、暂停 |
| 托盘菜单 | P0 | 应用控制入口 |
| 快捷键 | P2 | 显示/隐藏、召回、退出 |

### 4.4 设置项

| 设置 | 默认值 | 优先级 |
|---|---|---:|
| 开机自启动 | 关闭 | P1 |
| 音效开关 | 开启 | P1 |
| 活跃度 | 中 | P1 |
| 猫咪尺寸 | 100% | P1 |
| 置顶模式 | 开启 | P1 |
| 当前皮肤 | 默认猫咪 | P2 |

## 5. 非功能需求

| 指标 | 目标 |
|---|---|
| 平台 | Windows 10 21H2+、Windows 11 |
| CPU 占用 | 空闲状态 < 1%，动画状态尽量 < 3% |
| 内存占用 | MVP < 120 MB，优化目标 < 80 MB |
| 启动速度 | 冷启动 1 秒内显示猫咪 |
| 崩溃恢复 | 异常退出后不破坏配置 |
| 离线可用 | 所有核心功能不依赖网络 |
| 资源可扩展 | 新动作通过 JSON 配置接入 |

## 6. 技术选型

### 6.1 推荐方案：Tauri 2 + TypeScript + PixiJS

| 层 | 技术 | 说明 |
|---|---|---|
| 桌面壳 | Tauri 2 | 透明窗口、置顶、托盘、原生能力 |
| 后端 | Rust | 窗口控制、配置、系统集成、状态持久化 |
| 前端 | TypeScript + Vite | 快速开发和模块化 |
| 渲染 | PixiJS 优先，Canvas 2D 备选 | 精灵动画、缩放、透明渲染 |
| 动画资源 | PNG/WebP 精灵图 + JSON Atlas | 从 AI 视频或多帧图提取 |
| 配置 | JSON/TOML + serde | 用户设置和宠物状态 |
| 打包 | Tauri Bundler | 生成 NSIS/MSI 安装包 |

Tauri 官方文档支持窗口配置、透明窗口、托盘图标、窗口 API 和插件生态；PixiJS 是成熟的 2D WebGL 渲染方案，适合大量精灵、帧动画和缩放。实际实现中，若 MVP 只有一个角色且动作不多，Canvas 2D 也足够；但为了后续皮肤、特效、多个宠物，建议从 PixiJS 开始。

### 6.2 为什么不优先选 Electron

Electron 开发效率高，但需要打包 Chromium，安装包和内存占用明显更大。桌面宠物是常驻型小应用，用户对资源占用敏感，因此 Electron 不适合作为首选。

### 6.3 为什么不优先选 Python/PyQt

Python/PyQt 适合快速验证透明窗口和拖拽，但分发体积、启动速度、长期运行稳定性和 Windows 托盘体验都弱于 Tauri。可以作为一两天的技术验证工具，但不建议作为正式产品底座。

### 6.4 可选方案对比

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| Tauri + PixiJS | 轻量、跨平台、渲染能力强 | Rust/Tauri 有学习成本 | 推荐 |
| Tauri + Canvas 2D | 实现简单、依赖少 | 后续特效和多角色扩展较弱 | MVP 可用 |
| Electron + PixiJS | 开发最顺手、社区大 | 常驻内存高、包大 | 不推荐首版 |
| Python + PyQt | 原型快 | 分发和性能一般 | 仅用于验证 |
| Godot | 动画和状态机友好 | 桌面透明窗口/托盘集成需额外处理 | 不作为首选 |

## 7. 总体架构

```text
┌──────────────────────────────────────────────┐
│                 前端渲染层                    │
│  TypeScript + PixiJS                          │
│  - 精灵图加载                                 │
│  - 帧动画播放                                 │
│  - 鼠标命中检测                               │
│  - 本地 UI 菜单或气泡                         │
└───────────────────┬──────────────────────────┘
                    │ Tauri IPC / Events
┌───────────────────▼──────────────────────────┐
│                 Rust 应用层                   │
│  - 宠物状态机                                 │
│  - 行为决策                                   │
│  - 窗口位置控制                               │
│  - 托盘菜单                                   │
│  - 配置持久化                                 │
│  - 开机自启动                                 │
└───────────────────┬──────────────────────────┘
                    │ Filesystem
┌───────────────────▼──────────────────────────┐
│                 资源与配置                    │
│  assets/pets/default/cat.atlas.json           │
│  assets/pets/default/cat_spritesheet.png      │
│  settings.json                                │
│  pet_state.json                               │
└──────────────────────────────────────────────┘
```

## 8. 模块设计

### 8.1 Rust 后端模块

```text
src-tauri/src/
├─ main.rs
├─ app_state.rs              # 全局状态
├─ commands/
│  ├─ mod.rs
│  ├─ pet.rs                 # 前端调用：设置状态、保存位置
│  └─ settings.rs            # 设置读写
├─ core/
│  ├─ mod.rs
│  ├─ behavior.rs            # 行为决策
│  ├─ pet.rs                 # Pet 数据结构
│  └─ state_machine.rs       # 状态转换
├─ desktop/
│  ├─ mod.rs
│  ├─ monitor.rs             # 显示器和工作区
│  └─ window_controller.rs   # 移动窗口、边界限制
├─ config/
│  ├─ mod.rs
│  ├─ settings.rs
│  └─ storage.rs
└─ system/
   ├─ mod.rs
   ├─ tray.rs
   └─ autostart.rs
```

### 8.2 前端模块

```text
src/
├─ main.ts
├─ app/
│  ├─ bootstrap.ts           # 初始化 Pixi、加载资源
│  └─ loop.ts                # 前端渲染循环
├─ renderer/
│  ├─ atlas.ts               # 图集解析
│  ├─ animator.ts            # 动画播放器
│  ├─ pet_sprite.ts          # 猫咪显示对象
│  └─ hit_test.ts            # 像素/矩形命中检测
├─ interaction/
│  ├─ click.ts
│  ├─ drag.ts
│  └─ pointer.ts
├─ api/
│  └─ tauri.ts
├─ types/
│  ├─ animation.ts
│  └─ pet.ts
└─ styles/
   └─ global.css
```

## 9. 状态机设计

### 9.1 状态枚举

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PetState {
    Idle,
    Walk,
    Sit,
    Sleep,
    Stretch,
    Groom,
    Eat,
    Play,
    Dragging,
    Falling,
}
```

### 9.2 状态优先级

| 优先级 | 类型 | 示例 |
|---:|---|---|
| 最高 | 用户强交互 | Dragging、右键菜单命令 |
| 高 | 用户弱交互 | 点击、喂食、召回 |
| 中 | 生理/内部状态 | Sleep、Eat |
| 低 | 随机行为 | Idle、Walk、Groom |

### 9.3 状态转换

```text
Idle
├─ random -> Walk
├─ random -> Sit
├─ click  -> Stretch / Groom / Meow
└─ inactive long enough -> Sleep

Walk
├─ target reached -> Idle / Sit
├─ edge reached   -> turn around
└─ click/drag     -> interaction state

Sit
├─ timeout -> Idle / Sleep
└─ click   -> Groom / Stretch

Dragging
└─ pointer up -> Falling -> Idle
```

### 9.4 行为决策参数

| 参数 | 默认值 | 说明 |
|---|---:|---|
| idle_to_walk_chance | 0.35 / 5s | 空闲转行走概率 |
| idle_to_sit_chance | 0.20 / 8s | 空闲转坐下概率 |
| sit_to_sleep_seconds | 30 | 坐下后多久可睡觉 |
| walk_speed | 80 px/s | 标准移动速度 |
| active_level | medium | 影响随机行为频率 |
| drag_release_gravity | 1200 px/s^2 | 掉落效果参数 |

## 10. 动画与资源方案

### 10.1 资源格式

首版采用精灵图加 Atlas JSON：

```text
assets/pets/default/
├─ pet.json
├─ cat_spritesheet.png
├─ cat_spritesheet.webp
├─ cat.atlas.json
└─ sounds/
   ├─ meow_01.mp3
   ├─ meow_02.mp3
   └─ purr_loop.mp3
```

`pet.json` 示例：

```json
{
  "id": "default_cat",
  "name": "Momo",
  "version": 1,
  "frameWidth": 256,
  "frameHeight": 256,
  "anchor": { "x": 0.5, "y": 0.92 },
  "scale": 0.65,
  "animations": {
    "idle": { "fps": 8, "loop": true, "frames": ["idle_000", "idle_001"] },
    "walk": { "fps": 12, "loop": true, "frames": ["walk_000", "walk_001"] },
    "sleep": { "fps": 4, "loop": true, "frames": ["sleep_000", "sleep_001"] }
  }
}
```

### 10.2 首版动作清单

| 动作 | 帧数建议 | FPS | 循环 | 来源建议 |
|---|---:|---:|---|---|
| idle | 4-8 | 6-8 | 是 | gpt-image-2 多姿态或 seedance 提帧 |
| walk_left | 6-10 | 10-12 | 是 | seedance2.0 |
| walk_right | 6-10 | 10-12 | 是 | walk_left 水平翻转或单独生成 |
| sit | 4-6 | 8-10 | 否 | seedance2.0 |
| sit_idle | 4 | 6 | 是 | gpt-image-2/seedance |
| sleep | 4-6 | 3-5 | 是 | seedance2.0 |
| stretch | 6-10 | 10-12 | 否 | seedance2.0 |
| groom | 8-12 | 8-10 | 是 | seedance2.0 |
| drag | 2-4 | 8 | 是 | gpt-image-2 |
| fall | 4-6 | 12 | 否 | seedance2.0 或手工旋转 |
| eat | 6-10 | 8-10 | 否/是 | seedance2.0 |

### 10.3 AI 素材生产流水线

#### Step 1：角色设定图

用 `gpt-image-2` 生成一张标准角色设定图：

- 正面、侧面、背面、三分之四视图。
- 同一只猫，毛色、眼睛、尾巴、花纹保持一致。
- 透明背景或纯色背景。
- 明确是可用于桌面宠物的卡通风格。
- 建议 1024x1024 或更高分辨率。

示例提示词方向：

```text
一只可爱的桌面宠物猫角色设定图，软萌但不过度幼稚，橘白相间，圆眼睛，蓬松尾巴。
同一角色的正面、左侧面、右侧面、背面、三分之四视图排列在同一张图中。
干净线稿，柔和上色，透明背景，适合制作 2D 精灵动画，保持比例一致。
```

#### Step 2：动作动画生成

用 `seedance2.0` 基于角色设定生成每个动作短动画：

- 每条动作 1-2 秒。
- 固定机位。
- 透明背景优先；如果不支持透明，使用纯绿色/纯蓝背景便于抠图。
- 猫咪大小和脚底位置尽量稳定。
- 单个动作单独生成，避免一个视频包含多个复杂动作。

#### Step 3：提帧

从动画中提取关键帧：

- idle/sleep：每秒 4-8 帧即可。
- walk/play：每秒 10-12 帧。
- stretch/groom/eat：保留动作峰值和起止帧。

建议工具：

- `ffmpeg` 提帧。
- `rembg` 或图像工具抠背景。
- TexturePacker / Free Texture Packer 打包图集。

#### Step 4：清理与对齐

每帧必须统一：

- 画布尺寸一致，例如 256x256。
- 脚底锚点一致，例如 `{ x: 0.5, y: 0.92 }`。
- 角色比例一致。
- 无残留背景色。
- 左右行走方向一致。

#### Step 5：图集打包

输出：

- `cat_spritesheet.png` 或 `cat_spritesheet.webp`
- `cat.atlas.json`
- `pet.json`

图集 JSON 应包含帧名、坐标、尺寸、trim 信息和 anchor 信息。

### 10.4 资源质量验收

| 检查项 | 标准 |
|---|---|
| 背景透明 | 无色块、无边缘残影 |
| 动作循环 | idle/walk/sleep 首尾自然 |
| 脚底稳定 | 行走时脚底不明显漂浮 |
| 角色一致 | 花纹、眼睛、尾巴形状不跳变 |
| 可读性 | 缩放到 96px 仍能看清 |
| 文件体积 | 单皮肤图集尽量 < 5 MB |

## 11. 窗口与桌面集成细节

### 11.1 Tauri 窗口配置

```json
{
  "app": {
    "windows": [
      {
        "label": "pet",
        "title": "Desktop Cat",
        "width": 220,
        "height": 220,
        "decorations": false,
        "transparent": true,
        "alwaysOnTop": true,
        "skipTaskbar": true,
        "resizable": false,
        "visible": true,
        "center": true
      }
    ]
  }
}
```

### 11.2 命中检测策略

推荐分两层处理：

- 前端使用 PixiJS sprite bounds 或 alpha hit test 判断用户是否点到猫咪。
- 后端在需要时切换窗口是否忽略鼠标事件。

MVP 可以先不做像素级点击穿透，只保证透明窗口尺寸尽量贴近猫咪。P1 再加入透明区域穿透。

### 11.3 窗口移动策略

猫咪视觉上的位置由窗口位置决定，前端只负责在窗口内部绘制猫咪。这样可以避免一个巨大透明窗口覆盖整个桌面。

窗口尺寸建议：

- 默认逻辑帧：256x256。
- 实际窗口：根据用户缩放设置调整到 160-260px。
- 锚点：猫咪脚底中心用于边界检测。

### 11.4 多显示器与任务栏

优先使用当前显示器可用工作区，而不是完整显示器区域，避免猫咪跑到任务栏下面。猫咪移动目标点应限制在 work area 内。

## 12. 配置与持久化

### 12.1 settings.json

```json
{
  "version": 1,
  "autostart": false,
  "soundEnabled": true,
  "activeLevel": "medium",
  "scale": 1.0,
  "alwaysOnTop": true,
  "skinId": "default_cat"
}
```

### 12.2 pet_state.json

```json
{
  "version": 1,
  "lastPosition": { "x": 1200, "y": 760 },
  "lastState": "Idle",
  "lastActiveAt": "2026-06-08T22:00:00+08:00"
}
```

状态持久化只保存轻量信息，不保存复杂随机队列。应用启动后根据位置和设置恢复即可。

## 13. 项目目录结构

```text
desktop-cat/
├─ src/                         # 前端 TypeScript
│  ├─ main.ts
│  ├─ app/
│  ├─ renderer/
│  ├─ interaction/
│  ├─ api/
│  ├─ types/
│  └─ styles/
├─ src-tauri/                   # Rust/Tauri
│  ├─ Cargo.toml
│  ├─ tauri.conf.json
│  ├─ build.rs
│  ├─ icons/
│  └─ src/
├─ assets/
│  ├─ pets/
│  │  └─ default/
│  │     ├─ pet.json
│  │     ├─ cat_spritesheet.png
│  │     ├─ cat.atlas.json
│  │     └─ sounds/
│  └─ app-icons/
├─ tools/
│  ├─ extract-frames.ps1
│  ├─ pack-atlas.md
│  └─ validate-assets.ts
├─ docs/
│  ├─ asset-pipeline.md
│  ├─ prompts.md
│  └─ release-checklist.md
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
├─ README.md
└─ PLAN.md
```

## 14. 开发计划

### Phase 0：技术验证，1-2 天

- 搭建 Tauri 2 + Vite + TypeScript 项目。
- 创建透明、无边框、置顶窗口。
- 加载一张透明 PNG 猫咪静态图。
- 支持托盘退出。
- 验证 Windows 10/11 透明窗口表现。

验收标准：运行应用后，桌面出现一只透明背景猫咪，可从托盘退出。

### Phase 1：MVP，1 周

- 接入 PixiJS 或 Canvas 动画播放器。
- 实现 idle/walk/sit/sleep 四个状态。
- 实现随机行走和边界检测。
- 实现拖拽移动。
- 保存上次位置。
- 准备第一版默认猫咪资源。

验收标准：猫咪可以自主在桌面上走动、坐下、睡觉，并且可以拖拽。

### Phase 2：互动增强，1 周

- 实现点击互动。
- 实现 stretch/groom/eat/fall 动画。
- 加入托盘菜单：召回、喂食、睡觉、暂停、退出。
- 加入音效开关和基础喵叫音效。
- 配置文件持久化。

验收标准：用户能通过点击和托盘菜单触发主要动作。

### Phase 3：体验优化，1 周

- 加入点击穿透或更精细命中检测。
- 加入活跃度设置。
- 优化高 DPI 和多显示器。
- 优化动画帧缓存和低功耗模式。
- 增加错误日志。
- 完成安装包构建。

验收标准：长时间运行稳定，资源占用低，基础设置完整。

### Phase 4：资产扩展与发布，1 周

- 完成资源导入规范文档。
- 增加至少 2 个猫咪皮肤。
- 增加资产校验工具。
- 做 24 小时运行测试。
- 准备 README、截图、发布包。

验收标准：v1.0 可分发，后续能稳定扩展皮肤和动作。

## 15. 任务拆解

### 15.1 工程任务

- 初始化 Tauri 2 项目。
- 配置透明窗口和托盘。
- 搭建 PixiJS 渲染器。
- 实现动画播放器。
- 实现 Rust 状态机。
- 实现前后端事件通信。
- 实现窗口移动和边界检测。
- 实现拖拽。
- 实现设置存储。
- 实现打包脚本。

### 15.2 美术/资产任务

- 生成默认猫咪角色设定图。
- 生成 idle/walk/sit/sleep/stretch/groom/eat 动画。
- 提帧、抠图、统一画布。
- 打包图集。
- 编写 `pet.json`。
- 生成托盘图标和应用图标。
- 生成音效或收集授权音效。

### 15.3 测试任务

- 透明窗口测试。
- 拖拽和点击测试。
- 边界和多显示器测试。
- 高 DPI 测试。
- 长时间运行测试。
- 安装包安装/卸载测试。
- 配置兼容性测试。

## 16. 关键实现建议

### 16.1 先做单窗口小猫，不做全屏透明层

全屏透明层容易拦截点击，也更难处理多显示器。首版应使用一个与猫咪大小接近的小窗口，通过移动窗口模拟猫咪在桌面行走。

### 16.2 状态机放 Rust，动画播放放前端

Rust 决定“现在做什么”和“窗口去哪儿”，前端负责“怎么画”。这样可以让行为逻辑稳定、可测试，同时保持动画开发灵活。

### 16.3 资源配置驱动

不要在代码里写死帧名和动作帧数。所有动作信息放在 `pet.json`，新增皮肤只需要新增资源文件和配置。

### 16.4 MVP 不追求像素级点击穿透

Windows 下透明区域穿透和交互区域切换会增加复杂度。MVP 可以接受 180-220px 的小窗口轻微占用；等核心体验稳定后再做精细穿透。

### 16.5 先接受 AI 资产不完美

AI 动画早期可能有花纹漂移、脚底抖动、帧间变形。不要因此阻塞工程。先用临时资源跑通完整管线，再逐步替换为高质量资源。

## 17. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| AI 动画角色不一致 | 动画跳变明显 | 先生成强设定图；每个动作基于同一参考图 |
| 透明窗口点击穿透复杂 | 影响桌面操作 | MVP 缩小窗口；P1 再做像素命中 |
| 高 DPI 坐标错位 | 拖拽/边界不准 | 统一使用 logical/physical 坐标转换 |
| 多显示器行为复杂 | 猫咪跑出屏幕 | MVP 限制在主显示器；P1 扩展 |
| Tauri 插件版本变化 | 开发卡顿 | 固定版本，建立最小可运行样例 |
| 常驻性能过高 | 用户卸载 | 动态降低 FPS，静止状态低频更新 |

## 18. 验收标准

### MVP 验收

- 应用启动后显示透明背景猫咪。
- 猫咪能 idle、walk、sit、sleep。
- 猫咪不会走出主屏幕工作区。
- 用户能拖拽猫咪。
- 托盘菜单能退出应用。
- 关闭后再次打开能恢复上次位置。

### v1.0 验收

- 支持完整动作：idle、walk、sit、sleep、stretch、groom、eat、drag、fall。
- 支持托盘菜单：召回、喂食、睡觉、暂停、设置、退出。
- 支持音效开关和活跃度设置。
- 支持至少 2 套猫咪皮肤。
- Windows 10/11 基本兼容。
- 空闲 CPU < 1%，内存稳定，无明显泄漏。
- 可以生成安装包并正常安装/卸载。

## 19. 下一步推荐动作

1. 先创建 Tauri 2 + Vite + TypeScript 项目脚手架。
2. 用 `gpt-image-2` 生成默认猫咪角色设定图和一张透明 PNG 静态图。
3. 用静态图验证透明窗口、置顶、托盘和拖拽。
4. 用 `seedance2.0` 生成 idle/walk/sleep 三个动作视频。
5. 提帧并打包第一版精灵图。
6. 实现动画播放器和基础状态机。

建议第一周只追求“猫咪能活在桌面上”，不要同时做设置页、皮肤市场和复杂养成。桌面宠物的体验核心是“可爱、稳定、轻盈”，先把这个手感打磨出来。
