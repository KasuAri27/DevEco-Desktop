# DevEco Agent Desktop

DevEco Agent Desktop 是基于 Electron 的本机客户端，Windows 包内置 DevEco Code Agent、devecocli 和 Node.js。启动应用后即可完成账号、Provider、模型、配置和 HarmonyOS 工程管理，不要求用户另外安装或预先启动 CLI。

## 启动

```powershell
npm install
npm run prepare:release-runtime
npm start
```

应用启动时会优先启动桌面包内置的 DevEco Code Agent ACP 运行时。设置 → 运行环境可查看 Agent、devecocli、Node.js、DevEco Studio 和 SDK 的路径与版本；如果内置运行时不可用，可以重新检测或手动选择 `deveco.exe`。打包时使用 DevEco Code 0.2.3、devecocli 1.3.4 和 Node.js 24.15.0。

桌面包内的 Node.js 满足 DevEco CLI 22+ 运行要求。DevEco Studio 6.1 或更新版本提供签名工具条件，SDK 需要与所选工程匹配；Studio/SDK 不包含在桌面包内。桌面端只检查账号/团队签名前置条件，不生成证书或签名材料。

## 账号和 Provider

- Huawei 登录从桌面账号中心启动，由 DevEco Code 核心认证模块在系统浏览器中完成；可取消，超时会调用核心取消接口。Renderer 不读取或显示 token。主进程的原生隐私适配器只读解密核心凭据以识别按账号保存偏好的 owner，不返回 token 或账号标识，也不修改凭据；登录状态由核心认证接口/CLI helper 提供。
- 账号页使用账号卡片、认证信息列表和模型通道卡片。昵称来自账号服务，手机号/邮箱会遮蔽显示；未提供的认证类型和额度不会使用截图中的示例值。切换账号会开启官方授权流程。
- 内置 DevEco 模型需要 Huawei 登录、实名认证和当前协议同意。实名状态来自核心账号记录，明确标为缓存值；认证后可通过新的授权回调复核。
- 第三方 Provider 可以不登录 Huawei。桌面端支持原生 Provider 的 API Key/OAuth 凭据入口，以及自定义 OpenAI 兼容 Provider 定义、端点、模型和凭据管理。
- API Key 由 DevEco Code 加密保存。模型目录刷新不会向模型端点发请求，也不会验证远程计费或 API Key 有效性。旧 Provider 配置里发现明文 API Key 时，需要用户重新输入后才迁移并清除旧配置值。
- 协议须由用户主动阅读和同意。当前产品协议在启动时与每次提交任务前复核；当前会话使用内置 DevEco 模型时，也会复核 Huawei 服务协议更新状态。应用不会自动同意或自动登录。
- 体验改进偏好按 Huawei 账号保存，首次默认关闭。分析数据与崩溃报告是独立的本机开关，遵循核心默认值（开启），两者不会被体验改进开关混为一谈。

## 模型、配置与会话

- 模型、思考档位和工作模式直接读取本机 ACP `configOptions`；支持的构建、规划、目标及自定义模式按核心返回显示，切换通过 `session/set_config_option` 生效。思考滑块随模型 variants 改变，无 variants 时禁用。默认模型可保存到全局或当前工程。
- 配置中心分全局与工程作用域，显示项目覆盖/全局继承来源，只提交用户修改过的字段。项目 JSONC 只写入当前选中的工程目录，不把合并后的全局密钥复制到项目。
- Desktop 在启动时创建一个常驻 `deveco.exe acp` 运行时，其内部 HTTP 服务同时供账号、配置和 Provider 管理使用。新建、恢复、切换会话及模型/模式切换复用该进程；修改工具路径、退出账号或显式重启运行时会重建它。内核仍是桌面端管理的独立原生进程。
- 最近会话只在 Agent 明确声明 `loadSession` 后恢复；断线不会自动重发尚未完成的任务。工作区连接完成前保留输入并禁用发送；连接失败时可从顶部“重新连接”重试。
- 左侧仅显示 Agent 已保存至少一条用户消息的会话，空白新会话及发送前被拒绝的请求不会加入列表。首次发送后会读取原生消息确认，再刷新列表。
- 会话行的“⋯”菜单支持归档和删除；“已归档会话”入口支持恢复。删除前由桌面原生对话框确认，删除后无法恢复。归档或删除当前会话会打开一个新的空白会话，并继续复用常驻 Agent。
- OAuth 同时只运行一个流程。授权等待期间，配置、Provider、隐私或服务重启操作会被拒绝，直到授权完成或取消；会话提示只在协议复核通过后发出。

## 验证

运行本地测试：

```powershell
npm test
```

其中的 ACP 和管理服务集成测试使用临时工程、独立 XDG 目录、`--pure`/`DEVECO_PURE`、本地空模型目录和一次性凭据；套件串行运行。ACP 测试只执行 initialize、session、模型/档位切换及有条件的会话加载，不发送模型 prompt。测试不读取或修改用户凭据，不登录/退出真人账号，也不提交协议同意。

详细实现状态、契约证据、已知限制和真实账号手工验收步骤见 [实现报告](docs/P0-implementation-report.md) 与 [验收清单](docs/P0-review-checklist.md)。

## Windows 安装包

在 Windows x64 环境执行：

```powershell
npm run prepare:release-runtime
npm run package:win
npm run package:win:installer
```

便携 ZIP 和 NSIS 安装程序会生成到 `release/`。包内含 DevEco Code Agent、devecocli、Node.js 运行时及其许可证文件，用户无需另行安装 CLI 或 Node.js。`prepare:release-runtime` 会下载固定版本的 Agent runtime，并确保随包的 Node.js 为 24.15.0。HarmonyOS 构建/签名仍需按需安装 DevEco Studio 和 SDK。

## GitHub Actions 与版本发布

Pull Request 和推送到 `main` 时，GitHub Actions 会在 Windows x64 runner 上构建安装程序与便携 ZIP，并保留构建产物供下载。发布新版本时，先同步 `package.json` 与 `package-lock.json` 中的版本号，再创建匹配的版本标签并推送，例如：

```powershell
git push origin main
git tag v0.1.0
git push origin v0.1.0
```

推送 `v*` 标签会自动创建 GitHub Release，并附上 NSIS 安装程序和便携 ZIP。标签版本必须与 `package.json` 一致。该流水线负责构建和发布安装包；应用内自动下载和安装更新尚未实现。

## 当前范围

这次实现覆盖功能差距表中的 P0，并接入了工作模式、最近会话列表、会话删除/归档/恢复和 Windows x64 安装包。会话分叉/导出、附件/文件 diff、远程 MCP/Skill/Plugin 管理、用量配额、子 Agent 面板、设备/模拟器/Studio 工作流界面仍属后续阶段。

### 本轮修改的手工查看方式

关闭旧窗口，双击 `start-dev.cmd` 重新启动。连接工程后打开工作模式菜单；在模型菜单用滚轮、触控板或键盘滚动，确认能看到底部供应商。打开“设置与账号”，查看新的账号卡片、认证列表及模型通道；“协议与隐私”位于左侧导航底部。

思考滑块已拉过的区域使用深色实色，未拉到的区域使用浅色，最低档没有填充层边线；最高档保留粒子动画。新建空白会话时左侧不新增记录。用现有会话的“⋯”菜单归档后，可在“已归档会话”中恢复；删除操作可先选“取消”查看确认流程。

本轮只做语法与静态结构检查，未运行测试套件、实际桌面交互或真实模型请求。

## 主要文件

- `desktop/main.cjs`、`desktop/preload.cjs`：受限 IPC、账号与管理服务生命周期。
- `desktop/control-plane.cjs`：本机 DevEco Code 管理 API、配置作用域、环境和脱敏。
- `desktop/native-privacy.cjs`：对照 0.2.3 原生存储格式读写设备与账号隐私偏好。
- `desktop/acp-client.cjs`：ACP v1 流、权限应答、脱敏诊断和生命周期清理。
- `desktop/session-library.cjs`：原生会话列表、用户消息确认、分页缓存及删除/归档/恢复。
- `index.html`、`styles.css`、`app.js`、`management-ui-state.js`：桌面界面和交互状态。
