# `tb gui` / `tb app` 启动流程 (pencil)

[`npm.md`](./npm.md) 的配套图：命令行怎样把桌面 App 拉起来。代码是
`build/npx/shared/gui.js`，图与代码不一致时以代码为准。端到端的演练见
[`harness-npm.md`](./harness-npm.md)。

图例：`▶` 入口 · `◇` 分支 · `✖` 退出码 1 · `⎘` 目录

## 1. 两个入口，一份实现

```
  ▶ npx tingly-box-gui                     ▶ tb gui | tb app
    tingly-box-gui/bin.js                    tingly-box/bin.js（第一个参数是 gui / app）
           └──────────────▶  launchGui(ctx) · shared/gui.js  ◀──────────────┘
```

只有 npm 用户会在 shell 里启动 App（其余人点图标），而取回、缓存、版本匹配这些
能力本来就在 `build/npx/shared/`，所以命令挂在 shim 上，Go CLI 不加 `gui` 子命令。

## 2. 启动流程

```
  launchGui
   ◇ 平台受支持？ linux x64/arm64 · win32 x64 · darwin arm64          否 → ✖ 指引
   ◇ linux：有 DISPLAY / WAYLAND_DISPLAY，且 ldconfig 里有 libgtk-3 和
     libwebkit2gtk-4.1？                                              否 → ✖ 点名缺的项
   resolveSource ──▶ { package | registry | download, tag }           （§3）
   ⎘ <cacheDir>/tingly-box-gui/<tag>/bin/ 里已有 App？                 有 → 直接启动
       package  解压旁边的平台包里的 zip
       registry npm install 同版本平台包 → 解压 → 删掉临时的 pkg/
       download 从 GitHub release 取 zip（仅显式 --transport-version）
   清理旧 tag 的缓存
   启动，并让提示符立即返回：
       linux   detached；stderr 写到 <cache>/tingly-box-gui/app.log（不能是管道，见 §5）；
               盯 2 秒：早退 → 报错并贴日志；退出码 0 = 已有实例接管，不算失败
       win32   detached
       darwin  codesign 校验（必要时重签）→ open -a
```

## 3. App 从哪来：`resolveSource`

```
  显式 --transport-version → download（那个版本，从 GitHub）
  否则：旁边装了同版本的 GUI 平台包？ 是 → package
        否 → tb gui：registry（npm install <平台包>@<tb 自己的版本>）
             npx tingly-box-gui：download（同 tag 的 release zip）
```

| 入口 | 通常的来源 | 说明 |
|---|---|---|
| `npx tingly-box-gui` / `npm i -g tingly-box-gui` | package | 平台包是它的 optionalDependencies |
| `tb gui` / `tb app` | registry | `tingly-box` 的依赖是 CLI 的平台包，不该把 App 塞进每个 CLI 安装 |

registry 里没有该版本，或没有 `npm`，都是**报错**，不回退到别的版本或渠道：App 和 CLI
必须同版本。`tb gui` 不引用全局安装的 GUI 包，也不看手装的 `.app` / `.exe` / deb，只认
GUI 缓存里与自己同版本的那一份。

## 4. 缓存与版本

```
  <cacheDir>/tingly-box/<tag>/bin/        CLI 二进制
  <cacheDir>/tingly-box-gui/<tag>/bin/    桌面 App（tb gui 与 npx tingly-box-gui 同 tag 时共用）
  <cacheDir>/tingly-box-gui/app.log       Linux：App 的 stderr
```

- 启动时打印 `Tingly Box desktop app <tag>`，能看出实际开的是哪个版本。
- 同一个配置目录同一时刻只有一个实例（文件锁）：已有 GUI 就聚焦它，已有 CLI 服务就提示
  接管。先后用不同版本打开同一份数据的风险见 [config-migration.md](./config-migration.md)；
  想隔离就用不同的 `--config-dir`（`tb gui` 不转发该参数）。

## 5. 已知取舍

- 首次运行要 `npm install` 一次平台包，所以需要 `npm` 在 PATH 上，且 GUI 包的这个版本已发布
  （GUI 的发布任务可能跳过某些平台）。
- Windows 上经 `npm.cmd` 和 shell 调用，路径含空格靠手动加引号：只验证了逻辑，没在真机上跑。
- Linux 的 App 不能拿管道当 stderr：shim 退出时管道关闭，Go 程序下一次写日志就会被
  SIGPIPE 杀死，表现为"打开了又消失"。
