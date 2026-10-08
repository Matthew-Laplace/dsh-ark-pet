# dsh-ark-pet

DeepSeek Harness 桌宠插件：内置干员素材库，也能导入你自己的图片。
A DeepSeek Harness desktop pet with an Arknights operator library and custom image import.

## 功能 / Features

- **干员素材库**：内置 486 位明日方舟干员与皮肤的目录（固定上游版本）。选择后插件直接从上游仓库下载该干员的 Codex v2 图集，逐个校验 Git blob 哈希，再装到本地。
- **导入自己的图片**：Codex 图集（必须正好 1536×1872 或 1536×2288）或普通 PNG / WebP / GIF（单张不超过 8 MiB）。
- **状态联动**：思考、调用工具、等待确认、完成、出错分别切换动作，等待确认时显示气泡。
- **互动**：拖动换位置，悬停挥手，双击跳跃，v2 图集可开启鼠标视线跟随。

- **Operator library**: a pinned catalogue of 486 Arknights operators and skins. Selecting one downloads that operator's Codex v2 atlas straight from the upstream repository, verifies every Git blob hash, then installs it locally.
- **Custom import**: a Codex atlas (exactly 1536×1872 or 1536×2288) or a plain PNG, WebP, or GIF up to 8 MiB.
- **Activity mirroring**: thinking, tool calls, waiting for your approval, done, and error each drive a different animation, with a bubble while a decision is pending.
- **Interaction**: drag to move, hover to wave, double-click to jump, and optional v2 eye tracking.

## 与上游的关系 / Relation to upstream

本插件的渲染器改编自 [Signalight/codex-to-dsh-pet](https://github.com/Signalight/codex-to-dsh-pet)（MIT，固定版本 `d41f0121552f837c36a9cc7fbcb073881f391616`，署名见 `licenses/Signalight-MIT.txt`）。
新增行为：干员素材库与哈希校验下载、普通图片导入、按会话聚合的活动状态。上游内置的 Nastya 图片与音频不包含在本包内。

The renderer derives from [Signalight/codex-to-dsh-pet](https://github.com/Signalight/codex-to-dsh-pet) (MIT, pinned at `d41f0121552f837c36a9cc7fbcb073881f391616`; notice in `licenses/Signalight-MIT.txt`).
New behaviour here: the operator catalogue with verified downloads, plain image import, and per-session activity aggregation. The upstream Nastya artwork and audio are not part of this package.

## 安装 / Install

```sh
dsh plugin --profile desktop add github:Matthew-Laplace/dsh-ark-pet
```

`--profile` 填你实际在用的那个：桌面应用是 `desktop`，`dsh web` 是 `web`。装完重启 DSH（桌面应用要完全退出再打开，不是刷新页面）。

预构建包也放在 [Releases](https://github.com/Matthew-Laplace/dsh-ark-pet/releases/latest) 里。pnpm 11.9 及以上可以直接装 `dsh-ark-pet-0.1.0.tgz`；pnpm 11.0–11.8 装裸 tarball 链接会报 `ERR_PNPM_MISSING_TARBALL_INTEGRITY`，请用上面的 GitHub 路径。

Use the profile you actually run: `desktop` for the desktop app, `web` for `dsh web`. Restart DSH after installing.

A prebuilt `dsh-ark-pet-0.1.0.tgz` is attached to [Releases](https://github.com/Matthew-Laplace/dsh-ark-pet/releases/latest). pnpm 11.9 and later can install that tarball; pnpm 11.0–11.8 fails on a bare tarball URL with `ERR_PNPM_MISSING_TARBALL_INTEGRITY`, so use the GitHub path above instead.

## 使用 / Usage

1. 打开 设置 → 方舟桌宠。
2. 在「干员素材库」里勾选权利说明，搜索干员，点一下开始下载。
3. 或用「导入自己的图片」添加本地图片。
4. 尺寸、停靠位置、显示、视线跟随、状态气泡都在同一页调整。

## 素材与权利 / Artwork and rights

本包**不包含**任何明日方舟图片、动画或转换脚本。目录只记录干员名称、标识符与 Git 文件哈希，下载直接读取上游固定版本文件。
明日方舟角色与美术权利属于鹰角网络及相关权利人。上游 [lockon-n/Arknights-Codex-Pets](https://github.com/lockon-n/Arknights-Codex-Pets) 明确不授予再分发或商业使用权。公开链接与下载确认都不产生授权，请自行确认使用方式。本插件与鹰角网络、OpenAI、DeepSeek 均无官方或授权关系。

This package contains **no** Arknights artwork, animation, or conversion script. The catalogue stores names, identifiers, and Git blob hashes only, and each download reads the pinned upstream file directly.
Arknights characters and artwork belong to Hypergryph and their respective rights holders. The upstream repository grants no redistribution or commercial-use rights. A public URL and a download confirmation grant nothing. This plugin is not affiliated with or endorsed by Hypergryph, OpenAI, or DeepSeek.

内置的 Rookie 机器人与插件图标是本项目原创，使用 MIT 许可。导入图片的权利归你所有。

## 安全边界 / Security boundary

- 所有接口挂在 `/ark-pet/` 前缀下，写操作要求同源请求并带 `x-dsh-ark-pet: 1` 标头，同时复用 DSH 的 `connection.requestRejection` 检查。
- 图片只做头部解析，不做解码；单张上限 8 MiB，动画图片被拒绝。
- 下载逐个校验 Git blob 哈希，且只从固定 commit 读取；重定向被拒绝。
- 数据目录 `${DSH_HOME:-~/.dsh}/ark-pet`，安装前拒绝符号链接与越界路径。

## 兼容性 / Compatibility

在 DSH `0.2.0-rc.2`、Node.js `>= 22.19` 上开发与测试。插件通过 `@deepseek-ai/dsh*` 的 `peerDependencies` 参与版本判定。

Developed and tested on DSH `0.2.0-rc.2` and Node.js `>= 22.19`.

## 开发 / Development

```sh
npm install
npm test          # 单元测试
npm run build     # 构建 lib/client.js
```

`data/ark-catalog.json` 由 `scripts/make-catalog.mjs` 从固定的上游 revision 生成，不要手工编辑。

## 许可 / Licence

MIT，见 `LICENSE`。上游与第三方声明见 `NOTICE.md`。
