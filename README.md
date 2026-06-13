# MomoDesk

MomoDesk 是一个正在开发中的桌面猫咪宠物应用。目标是让 Momo 像一只小猫一样停在桌面上，会待机、走动、坐下、睡觉、被鼠标拖起来、被喂食、看向鼠标，也会因为互动和休息改变心情。

项目目前使用 Tauri 2 + Vite + TypeScript 构建，前端用 Canvas 渲染透明背景猫咪动画，桌面端负责窗口置顶、透明窗口、点击穿透、拖动、托盘菜单和本地状态持久化。

## 动作预览

| 待机 | 行走 | 鼠标提起 |
| --- | --- | --- |
| ![待机](docs/previews/idle.png) | ![行走](docs/previews/walk.png) | ![鼠标提起](docs/previews/drag.png) |

| 放下 | 睡觉 | 伸懒腰 |
| --- | --- | --- |
| ![放下](docs/previews/fall.png) | ![睡觉](docs/previews/sleep.png) | ![伸懒腰](docs/previews/stretch.png) |

## 当前功能

- 透明桌面宠物窗口，默认悬浮在桌面上。
- Canvas 渲染猫咪序列帧动画，并保留程序化 fallback 绘制。
- 支持待机、左右行走、坐下、拖拽提起、放下、睡觉、醒来、伸懒腰、舔毛、吃东西、看向鼠标等动作。
- 鼠标拖动时播放提起和挣扎动画，松开后播放落下动画。
- 心情值会随喂食、点击、拖拽、空闲和睡觉变化，并影响散步、睡觉、舔毛、伸懒腰和靠近鼠标的概率。
- 鼠标靠近时可短暂看向光标，心情较好时会主动走到光标附近坐下。
- 支持系统托盘菜单和桌面右键菜单，可召回、喂食、睡觉、聊天、设置、显示、隐藏和退出。
- 支持设置窗口，可配置置顶、尺寸、活跃度、音效开关和 AI 聊天参数。
- 支持 AI 聊天气泡，可配置 DeepSeek、OpenAI、Ollama 或自定义 OpenAI-compatible 接口。
- 支持全局快捷键 `Ctrl+Shift+M` 显示或隐藏 Momo。
- 动作资源通过 `assets/pets/default/pet.json` 统一配置，后续可以继续扩展动作包。

## 快速运行

开发环境说明见 [docs/runtime-environment.md](docs/runtime-environment.md)。

Windows 下可以直接双击：

```text
run-momodesk.bat
run-browser-preview.bat
```

也可以手动执行：

```powershell
npm install
npm run dev
npm run build
```

安装 Rust 和 Cargo 后，可以运行桌面端：

```powershell
npm run tauri dev
```

## 素材目录

猫咪动作资源集中放在：

```text
assets/pets/default/actions/
```

每个动作通常包含：

- `frames/`：运行时使用的透明 PNG 序列帧。
- `source/`：原始视频位置，仅保留 `.gitkeep`，视频源文件不提交。
- `metadata.json`：抽帧、帧率、循环等动作信息。

资源包入口是：

```text
assets/pets/default/pet.json
```

更完整的素材规范见 [docs/action-assets.md](docs/action-assets.md) 和 [docs/pet-package.md](docs/pet-package.md)。

## 后续计划

- 继续打磨心情系统，让高兴、无聊、困倦和不想理人时的行为更有差异。
- 增加抚摸识别、不同身体区域反馈、小鱼干掉落等互动事件。
- 增加极简统计面板，例如今日抚摸次数、陪伴天数和心情趋势。
- 继续整理 AI 生成、抽帧、抠图和序列帧打包流程，支持基于真实猫照片生成专属动作包。
- 接入开机自启和音效系统，完善发布前的 Windows 常驻体验。
