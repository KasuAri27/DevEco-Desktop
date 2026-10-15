# DevEco Agent Desktop 功能迁移核对

## 核对范围与证据

本次对照的是本机 DevEco Code **0.2.3**、捆绑 DevEco CLI **1.3.4**、官方 develop 分支更新记录，以及当前桌面项目的 README、Renderer、preload、main 和 ACP 桥代码。

只执行了命令帮助并阅读公开文档/程序源文件；没有执行登录、登出、凭据重置、协议同意、证书生成，也没有读取用户的 auth.json、加密 token 或密钥文件。

- [官方 DevEco Code 更新记录](https://raw.gitcode.com/openharmony-sig/deveco-code/raw/develop/CHANGELOG.md)：本次可读取，包含 0.2.3 版本。
- [本机 DevEco Code README](<D:/Dev/tool/npm/node_modules/@deveco/deveco-code/README.md>)：登录、Provider、模型、Build/Plan/Goal、HarmonyOS 工具及扩展说明。
- [本机 DevEco CLI README](<D:/Dev/tool/npm/node_modules/@deveco/deveco-code/node_modules/@deveco/deveco-cli-common/README.md>)：浏览器授权、账号状态、团队、设备、签名与工具链说明。
- [本机 DevEco Code 更新记录](<D:/Dev/tool/npm/node_modules/@deveco/deveco-code/CHANGELOG.md>)：实名认证、工作区信任、隐私设置、配额、技能偏好及上下文裁剪。
- 项目证据：`desktop/preload.cjs` 只有工作区/会话/提示词/配置项/取消/权限应答 IPC；`desktop/acp-client.cjs` 只实现 ACP 会话基础方法；`app.js` 的设置、附件、模式、会话排序、Studio 联动仍是提示占位。

## 账号要求的关键区别

0.2.0 更新记录明确写明：**第三方 Provider 无需登录华为账号，仅内置模型需要华为登录并完成实名认证**。README 中“使用前需华为登录”的概括没有描述这一例外，应以当前版本的更新记录和实际实现继续核对。

桌面端的首次使用流程应支持两条入口：华为内置模型和第三方 Provider。已存在有效登录态时应恢复状态。华为内置模型入口需要授权、实名状态检查、未实名时跳转认证页面、认证后重新查询状态；完成实名操作仍发生在华为官方服务。

“账号登录成功”“实名已通过”“签名所需开发者/团队能力可用”应分别显示。CLI 中可见的 `isRealName` 来自 AGC 用户信息，签名检查还有团队等条件，不能将一次登录成功直接当作全部开发者资质已满足。

至少需要管理三类认证：华为账号；模型 Provider 的 API Key/OAuth；远程 MCP 的 OAuth。还需核对 DevEco Code 和 devecocli 的登录状态是否完全共享，当前没有证据支持直接合并两套状态。

## 功能差距表

“部分”表示已写入接入代码，仍有功能缺口或没有完成真实链路验收；“未迁移”指桌面客户端缺少界面和管理调用，不表示 CLI 后台没有该能力。

| 功能 | CLI / 原生能力证据 | 桌面现状 | 需要完成 | 优先级 |
|---|---|---|---|---|
| 华为登录与账号中心 | providers/auth login、logout；浏览器授权 | 未迁移，假定 CLI 已登录 | 登录页、系统浏览器授权、取消/超时、状态恢复、账号展示、过期重登录、退出 | P0 |
| 实名与开发者能力 | 更新记录的实名引导；devecocli 的实名/团队检查 | 未迁移 | 区分未知/未通过/通过；认证页面跳转、返回复核；签名能力检查 | P0 |
| 协议与隐私偏好 | providers consent；0.2.2 按账号记录、体验改进默认关闭 | 未迁移 | 展示协议、记录用户选择、协议更新提示、隐私设置；后端执行用户的决定 | P0 |
| Provider 管理 | providers list/login/logout/reset；自定义 Provider 配置 | 未迁移 | 添加/编辑/删除 Provider，API Key/OAuth、端点配置、状态反馈、模型刷新 | P0 |
| 模型与思考强度 | models；模型目录派生 variants | 部分 | 当前仅消费 ACP configOptions；核对 0.2.3 实际响应、默认模型、模型可用性、切换结果和每模型档位 | P0 |
| 配置中心 | 全局/项目配置、环境变量、Provider/MCP/Agent 等 | 未迁移，设置按钮为提示 | 分清配置作用域、校验、保存、变更生效与重启提示；敏感值管理 | P0 |
| 环境与工具链检测 | DEVECO_HOME / Studio / SDK / Node / devecocli | 部分，只找 exe 和检查工程目录 | 首次检测、版本/路径配置、故障说明、运行时兼容检查 | P0 |
| 工程与工作区 | 项目发现、工作区信任、worktree | 部分，只记住一个工程路径 | 项目列表、最近工程、信任状态、会话与工程绑定、worktree/分支显示 | P1 |
| 会话管理 | session list/delete、continue/fork、export/import | 未迁移，UI 对话只在内存中 | 历史列表、加载/恢复、切换、搜索、删除、分叉、导入导出 | P1 |
| Agent 与模式 | Build / Plan / Goal、agent list/create | 未迁移，Build 为固定显示 | 动态模式选择、自定义 Agent、Goal 阶段/任务状态、切换确认 | P1 |
| 自定义/斜杠命令 | 命令配置与原生交互 | 未迁移 | 命令发现、搜索、参数输入与执行结果；避免把所有命令当普通提示词 | P1 |
| 对话与上下文 | 文本/文件上下文、工具结果、计划 | 部分，纯文本回复与简单工具状态 | Markdown/代码块、附件、资源块、完整工具输入输出、计划、文件修改/diff、产物入口 | P1 |
| 权限与用户交互 | 工具权限、工作区信任、其他客户端交互 | 部分，仅 request_permission 单弹窗 | 并发请求队列、取消联动、授权选项校验、策略设置；核对其他客户端请求方法 | P1 |
| 扩展管理 | Skill / MCP / Plugin，MCP OAuth，技能启停 | 未迁移 | 安装/配置/启停、全局与项目作用域、MCP 状态与认证、插件更新和重载 | P1 |
| 用量和配额 | stats、usage、模型统计、配额条 | 未迁移 | 用量/剩余额度/刷新状态、耗尽提示、错误分类；不将统计值冒充实时额度 | P1 |
| 子 Agent / 长任务 | 子 Agent 监控、上下文裁剪与 Goal 工作流 | 未迁移 | 子任务进度、关联工具与消息、上下文状态、取消与完成反馈 | P1 |
| HarmonyOS 工具界面 | build/run/device/emulator/log/docs/check/ui | 未迁移；后台可能已能调用工具 | 构建/运行结果、设备与模拟器选择、日志、截图、产物展示、Studio 工程打开 | P1/P2 |
| 开发者团队和签名 | devecocli auth team list、signature generate | 未迁移 | 团队选择、签名状态与证书生成流程、目标设备与 product 设置 | P1/P2 |
| 故障诊断与进程恢复 | debug、日志、认证与地区错误 | 部分，stderr 当前被丢弃 | 可用的脱敏诊断、错误分类、连接重试、启动/退出清理、会话恢复 | P0 |
| 安装与更新 | CLI upgrade、原生更新记录与通知配置 | 未迁移，依赖 npm start | 桌面安装包、后端运行时供应/检测、升级兼容、通知与窗口生命周期 | P2 |

## 当前桥接的具体限制

1. ACP initialize 返回的认证方法没有被存储/呈现，没有实现认证方法调用。仅声明空 clientCapabilities，未知客户端请求统一返回 method-not-found，不能视为完整 ACP 客户端。
2. 模型菜单和滑块只读取 configOptions，尚未验证本机 ACP 是否用相同结构发布全部模型和推理档位，也没有对旧 models/modes 结构做兼容。
3. 新任务会停止现有 ACP 进程并创建新会话；没有 session/list、load/resume、会话恢复或 UI 历史持久化。
4. 授权弹窗未处理多个并发请求的排队；工具结果/diff/资源和很多会话事件尚未渲染。
5. 外部窗口和导航当前被阻止，尚未提供受控的系统浏览器授权入口或 OAuth 回调协调。
6. Agent 的 stderr 目前直接丢弃，导致认证/环境问题只能显示粗略连接失败信息。
7. 当前代码不含账号服务、Provider 服务、配置服务、扩展服务、配额服务或 devecocli 管理适配器。
8. Electron 二进制已经装好，但完整的华为登录、实名检查和 ACP 首轮任务尚未通过端到端验收。

## 接入方式与源码需要

建议保留本机 DevEco Agent 运行时，并补齐桌面应用的管理服务层：

```text
桌面 UI
  └─ 受限 preload / IPC
       └─ Desktop 服务
            ├─ 账号、协议、实名状态和授权协调
            ├─ Provider / 模型 / 全局与项目配置
            ├─ 会话、工程、扩展和用量管理
            ├─ DevEco Agent 会话通道（ACP 或已核实的 HTTP API）
            └─ devecocli 工具链、开发者账号、团队和签名适配
```

`deveco serve` 的无界面服务存在已经由帮助确认。但本次未验证它的具体账号/配置/配额路由，也未验证原生账号授权能否完整由 ACP 驱动。不能把 OpenCode 上游的路由直接当成本机 DevEco 的可用 API。

因此，最初“先做对话接入不必克隆源码”的结论适用于会话原型。**做完整 CLI 功能的桌面迁移，下一步建议获取 DevEco Code 和 DevEco CLI 的参考源码**，核对 Huawei auth、产品协议、账号状态、配额、Provider 配置和 TUI onboarding 的实现，再决定复用公开服务 API、增加最小适配层，还是维护必要的 fork。DevEco Studio IDE 本体不在重做范围内。

本次官方 README/CHANGELOG 可通过 raw 读取，但尝试读取若干 server 源文件的 URL 返回 418；账号等管理路由与源码路径仍是待核对项。没有据此声称接口已可用。

## 实施顺序

1. 固定本机版本的后端契约，完成真实 ACP/服务初始化与错误诊断；同时核对账号和配置接口。
2. 做首次使用引导：环境检查、协议选择、内置/第三方入口、华为授权、实名复核、Provider 配置与默认模型。
3. 做账号中心、Provider 管理和设置页，恢复有效登录态，处理过期/登出/模型刷新。
4. 做会话历史、工程列表、动态 Agent 模式、完整工具结果、权限交互及上下文附件。
5. 做 MCP/Skill/Plugin、用量配额、子任务监控，以及设备/模拟器/签名等鸿蒙工作流。
6. 做安装包、后端版本管理、更新和桌面通知，验收首次安装到完成一个 HarmonyOS 任务的完整流程。
