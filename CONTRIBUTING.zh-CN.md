# 为 DevEco Code 做贡献

我们希望让你能够轻松地为 DevEco Code 做贡献。以下是最常见、并且通常会被合并的改动类型：

- 修复缺陷
- 新增语言服务器（LSP）/格式化器
- 改进大语言模型（LLM）的性能
- 支持新的服务提供商
- 修复特定环境下的问题
- 补齐标准行为
- 改进文档

不过，任何 UI 或核心产品功能，在开始实现之前都必须先经过核心团队的设计评审。

如果你不确定某个 PR 是否会被接受，可以询问维护者，或查找带有以下标签的问题：

- [`help wanted`](https://gitcode.com/openharmony-sig/deveco-code/issues?q=is%3Aissue%20state%3Aopen%20label%3Ahelp-wanted)
- [`good first issue`](https://gitcode.com/openharmony-sig/deveco-code/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22good%20first%20issue%22)
- [`bug`](https://gitcode.com/openharmony-sig/deveco-code/issues?q=is%3Aissue%20state%3Aopen%20label%3Abug)
- [`perf`](https://gitcode.com/openharmony-sig/deveco-code/issues?q=is%3Aopen%20is%3Aissue%20label%3A%22perf%22)

> [!NOTE]
> 忽视这些规范的 PR 很可能会被关闭。

想要着手处理某个问题？请留下评论。除非维护者已经在处理该问题，否则维护者可能会将它分配给你。

## 添加新的服务提供商

添加新的服务提供商通常不需要（如果需要，也只需要很少的）代码改动。若要支持新的服务提供商，请提交包含其配置的 PR。模型数据库与本仓库一同维护。

## 开发 DevEco Code

- 环境要求：Bun 1.3+
- 在仓库根目录安装依赖并启动开发服务器：

  ```bash
  bun install
  bun dev
  ```

### 针对其他目录运行

默认情况下，`bun dev` 会在 `packages/opencode` 目录中运行 DevEco Code。若要针对其他目录或仓库运行：

```bash
bun dev <directory>
```

若要在仓库根目录本身运行 DevEco Code：

```bash
bun dev .
```

### 构建一个 “localcode”

要编译成独立可执行文件：

```bash
./packages/opencode/script/build.ts --single
```

然后运行：

```bash
./packages/opencode/dist/deveco-<platform>/bin/deveco
```

将 `<platform>` 替换为你的平台，例如 `darwin-arm64` 或 `linux-x64`。

- 核心组成部分：
  - `packages/opencode`：DevEco Code 的核心业务逻辑与服务器。
  - `packages/opencode/src/cli/cmd/tui/`：TUI 代码，使用 SolidJS 和 [opentui](https://github.com/sst/opentui) 编写。
  - `packages/app`：共享 Web UI 组件，使用 SolidJS 编写。
  - `packages/desktop`：原生桌面应用，使用 Electron 构建（封装 `packages/app`）。
  - `packages/plugin`：`@opencode-ai/plugin` 的源代码。

### 理解 bun dev 与 deveco 的区别

在开发过程中，`bun dev` 是已构建的 `deveco` 命令的本地等效形式。两者运行相同的 CLI 接口：

```bash
# 开发环境（在项目根目录运行）
bun dev --help           # 显示所有可用命令
bun dev serve            # 启动无头 API 服务器
bun dev web              # 启动服务器并打开 Web 界面
bun dev <directory>      # 在指定目录启动 TUI

# 生产环境
deveco --help            # 显示所有可用命令
deveco serve             # 启动无头 API 服务器
deveco web               # 启动服务器并打开 Web 界面
deveco <directory>       # 在指定目录启动 TUI
```

### 运行 API 服务器

要启动 DevEco Code 无头 API 服务器：

```bash
bun dev serve
```

默认情况下，服务器会在端口 4096 上启动。你也可以指定其他端口：

```bash
bun dev serve --port 8080
```

### 运行 Web 应用

要在开发过程中测试 UI 改动：

1. **先启动 DevEco Code 服务器**（参见上面的[运行 API 服务器](#运行-api-服务器)一节）。
2. **然后运行 Web 应用：**

```bash
bun run --cwd packages/app dev
```

这会在 `http://localhost:5173`（或输出中显示的类似端口）启动本地开发服务器。大多数 UI 改动都可以在这里测试，但要获得完整功能，服务器必须处于运行状态。

### 运行桌面应用

桌面应用是一个封装 Web UI 的 Electron 应用。

要在开发过程中运行桌面应用：

```bash
bun run --cwd packages/desktop dev
```

要创建生产构建并打包应用：

```bash
bun run --cwd packages/desktop build
bun run --cwd packages/desktop package
```

> [!NOTE]
> 如果你修改了 API 或 SDK（例如 `packages/opencode/src/server/server.ts`），请运行 `./script/generate.ts` 重新生成 SDK 及相关文件。

请尽量遵循[风格指南](./AGENTS.md)。

### 设置调试器

Bun 的调试功能目前还不够完善。希望本指南能帮助你完成设置并避开一些常见问题。

调试 DevEco Code 最可靠的方法是在终端中手动运行 `bun run --inspect=<url> dev ...`，然后通过该 URL 附加调试器。其他方法可能导致断点映射不正确，至少在 VSCode 中是如此（具体情况因环境而异）。

注意事项：

- 如果你想运行 DevEco Code TUI，并且要在服务器代码中触发断点，可能需要运行 `bun dev spawn`，而不是通常使用的 `bun dev`。这是因为 `bun dev` 会在 worker 线程中运行服务器，导致断点可能无法正常工作。
- 如果 `spawn` 不适用于你的情况，可以单独调试服务器：
  - 调试服务器：`bun run --inspect=ws://localhost:6499/ --cwd packages/opencode ./src/index.ts serve --port 4096`，然后使用 `deveco attach http://localhost:4096` 附加 TUI。
  - 调试 TUI：`bun run --inspect=ws://localhost:6499/ --cwd packages/opencode --conditions=browser ./src/index.ts`

其他提示：

- 根据你的工作流程，可以考虑使用 `--inspect-wait` 或 `--inspect-brk` 代替 `--inspect`。
- 每次运行都指定 `--inspect=ws://localhost:6499/` 可能会很繁琐；你可以改为设置 `BUN_OPTIONS=--inspect=ws://localhost:6499/`。

#### VSCode 设置

如果你使用 VSCode，可以参考示例配置：[.vscode/settings.example.json](.vscode/settings.example.json) 和 [.vscode/launch.example.json](.vscode/launch.example.json)。

以下调试方式可能会遇到问题：

- `"request": "launch"` 调试配置可能导致断点映射错误，从而无法使用。
- 在 VSCode 的 `JavaScript Debug Terminal` 中运行 DevEco Code 也会出现相同问题。

尽管如此，你仍可以尝试这些方式，它们在你的环境中或许能正常工作。

## Pull Request 要求

### 先提 Issue 的规则

**所有 PR 都必须关联一个已有 Issue。** 提交 PR 之前，请先创建一个描述问题的 Issue。这有助于维护者进行分类处理，也能避免重复工作。没有关联 Issue 的 PR 可能会在未经评审的情况下被关闭。

- 在 PR 描述中使用 `Fixes #123` 或 `Closes #123` 来关联 Issue。
- 对于小型修复，Issue 可以写得很简短，只要能提供足够背景，让维护者理解问题即可。

### 一般要求

- 让 PR 保持小巧且聚焦。
- 说明问题是什么，以及你的改动为何能够解决它。
- 添加新功能之前，先确认代码库中其他地方尚未实现该功能。

### UI 改动

如果 PR 包含 UI 改动，请提供展示改动前后效果的截图或视频。这能帮助维护者更快完成评审，也能让你更快获得反馈。

### 逻辑改动

对于非 UI 改动（例如缺陷修复、新功能或重构），请说明**你如何验证改动有效**：

- 你测试了什么？
- 评审者要如何复现或确认这个修复？

### 不要提交由 AI 生成的大段文字

过长的 AI 生成 PR 描述和 Issue 描述不可接受，也可能会被忽略。请尊重维护者的时间：

- 描述要简短、聚焦。
- 用你自己的话说明改了什么，以及为什么要改。
- 如果你无法简短说明改动，你的 PR 可能范围过大。

### PR 标题

PR 标题应遵循 Conventional Commits 规范：

- `feat:` 新功能或新能力
- `fix:` 缺陷修复
- `docs:` 文档或 README 改动
- `chore:` 维护工作、依赖更新等
- `refactor:` 不改变行为的代码重构
- `test:` 添加或更新测试

你可以选择添加作用范围，以标明受影响的包：

- `feat(app):` app 包中的新功能
- `fix(desktop):` desktop 包中的缺陷修复
- `chore(deveco):` deveco 包中的维护工作

示例：

- `docs: update contributing guidelines`
- `fix: resolve crash on startup`
- `feat: add dark mode support`
- `feat(app): add dark mode support`
- `fix(desktop): resolve crash on startup`
- `chore: bump dependency versions`

### 风格偏好

以下内容不是强制要求，只是通用建议：

- **函数：** 尽量将逻辑放在单个函数中；只有拆分后能明显改善复用或组合能力时，才将逻辑拆出去。
- **解构：** 避免对变量进行不必要的解构。
- **控制流：** 避免使用 `else` 语句。
- **错误处理：** 条件允许时，优先使用 `.catch(...)`，而不是 `try`/`catch`。
- **类型：** 尽量使用精确类型，避免使用 `any`。
- **变量：** 遵循不可变数据的写法，避免使用 `let`。
- **命名：** 在仍能清楚表达含义的前提下，选择简洁的单词标识符。
- **运行时 API：** 适用时使用 Bun 的辅助方法，例如 `Bun.file()`。

## 功能请求

对于全新的功能，请先开启设计讨论。创建一个描述问题的 Issue，并可选择说明你的方案，以及该功能为何适合 DevEco Code。核心团队会协助判断是否应该推进；请等待他们批准后再提交功能 PR。

## Issue 要求

所有 Issue **都必须使用 Issue 模板**：

- **Bug report（缺陷报告）** — 用于报告缺陷（必须填写描述）
- **Feature request（功能请求）** — 用于提出改进建议（必须勾选验证复选框并填写描述）
- **Question（问题）** — 用于提问（必须填写问题）
- **Document（文档）** — 用于提出文档改进（必须填写改进描述和分支信息）
- **Refactor（重构）** — 用于提出代码重构建议（必须填写重构描述和验证信息）

不允许提交空白 Issue。新建 Issue 时，自动检查会验证它是否使用了模板并符合贡献指南。如果 Issue 不符合要求，你会收到一条评论，说明需要修改的内容，并有 **6 小时**进行编辑；逾期后，Issue 会被自动关闭。

Issue 可能会因以下原因被标记：

- 未使用模板
- 必填项未填写，或只填写了占位文字
- 包含由 AI 生成的大段文字
- 缺少有实际意义的内容

如果你认为自己的 Issue 被错误标记，请告知维护者。
