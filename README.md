# MomoDesk

MomoDesk 是一个桌面猫咪宠物应用。Momo 会待在桌面上走动、坐下、睡觉、看向鼠标，也能被拖起来、被投喂、和你聊天。它还有心情、昵称和记忆，会慢慢变得更像你的陪伴猫。

目前项目仍在开发中，但基础体验已经可以使用。

## 动作预览

| 待机 | 行走 | 鼠标提起 |
| --- | --- | --- |
| ![待机](docs/previews/idle.png) | ![行走](docs/previews/walk.png) | ![鼠标提起](docs/previews/drag.png) |

| 放下 | 睡觉 | 伸懒腰 |
| --- | --- | --- |
| ![放下](docs/previews/fall.png) | ![睡觉](docs/previews/sleep.png) | ![伸懒腰](docs/previews/stretch.png) |

## 当前功能

- 桌面猫咪会待机、走动、坐下、睡觉、伸懒腰、舔毛、吃东西和看向鼠标。
- 可以拖起猫咪、投喂猫咪、哄它睡觉，也可以和它聊天。
- 猫咪有心情，互动、休息和打扰都会影响它的状态。
- 可以查看猫咪档案、今日互动记录和心情状态。
- 可以修改猫咪昵称，聊天和气泡都会使用新名字。
- 支持长期记忆。猫咪会询问是否记住重要偏好，确认后才会保存。
- 支持主动陪伴气泡，例如提醒休息、撒娇、说饿了或问候你。
- 托盘菜单用于显示、隐藏、召回、设置和退出。
- 猫咪右键菜单用于投喂、哄睡、聊天和让它看向你。
- 支持全局快捷键 `Ctrl+Shift+M` 显示或隐藏 Momo。

## 菜单分工

MomoDesk 有两套菜单：

- 托盘右键：管理应用，比如显示、隐藏、召回、设置和退出。
- 猫咪右键：和猫互动，比如投喂、哄睡、聊天和看向你。

简单说：托盘是遥控器，猫咪右键是互动面板。

## 运行

Windows 下可以直接双击：

```text
run-momodesk.bat
run-browser-preview.bat
```

开发者可以手动运行：

```powershell
npm install
npm run dev
npm run tauri dev
```

开发环境说明见 [docs/runtime-environment.md](docs/runtime-environment.md)。

## 后续计划

- 让 Momo 的心情和反应更自然。
- 增加抚摸、小鱼干掉落、不同位置反馈等互动。
- 增加陪伴记录，例如今日互动、陪伴天数和心情变化。
- 支持用真实猫照片制作专属猫咪。
- 加入开机自启和音效。

## 开发资料

素材和开发规范见 [docs/action-assets.md](docs/action-assets.md)、[docs/pet-package.md](docs/pet-package.md)。
