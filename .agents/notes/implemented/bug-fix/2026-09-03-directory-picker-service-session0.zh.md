# Agent Note: Web composition pins the browse directory-picker pair (session-0 service)

Status: implemented

English | [中文](2026-09-03-directory-picker-service-session0.md)

## Problem

在本 fork 的生产部署形态——`dsh web` 经 NSSM 注册为 Windows 服务——每次点击「添加工作区…」都完全静默：无对话框、无错误弹窗、任何反馈都没有。[自适应默认](../feature/2026-07-29-directory-picker-adaptive-default.zh.md)对该宿主解析出 `native`（回环绑定、`win32`、无 SSH 环境变量），而 native 后端 spawn 的对话框子进程，其 `IFileOpenDialog` 创建在**父进程所在的会话**——服务即会话 0。对话框在不可见的会话 0 桌面上成功创建，于是没有任何失败：worker 发出 `showing` 后永久阻塞在 `Show` 里，`error` 与 `exit` 都不会触发，pick RPC 永不落定（整条链路按设计无超时），客户端零反馈。[自适应默认笔记](../feature/2026-07-29-directory-picker-adaptive-default.zh.md)预期错选 `native` 时会「退化为后端既有的可重试失败弹窗」；会话 0 宿主正是反例——错选不会失败，而是不可见地挂起，因此该笔记给出的出路「此类部署直接组合 `-browse`」是唯一正确的组合方式。

## Decision

`packages/bundle/web-app/cordis.patch.yml` 固定挂载 browse 对：上游 `directory-picker` 行（`dsh-host-directory-picker-auto`）原位置 `disabled: true`（保留 stock name，与 webserver 两行同形），另以两行挂载双面 browse 后端——`directory-picker-browse`（`dsh-host-directory-picker-browse`，后端在前）与 `directory-picker-surface`（`dsh-client-ui-directory-picker-browse`）。应用内「选择工作区目录」对话框在浏览器中渲染、经 wire 驱动 `list`/`createDirectory`，交互不再依赖宿主进程拥有可见桌面。回退为三行互换；待上游 resolver 学会探测服务/会话 0 宿主并自行解析 `browse` 后撤除固定。两个包本就因 chooser 门声明在 bundle manifest 里，本次改动不触碰任何 manifest。

## Verification

- `verify-cordis-config` 报告的错误集与改动前完全一致（唯一一项为环境项：`apps/cli/tests/profiles/acp/cordis.yml` 是 git symlink，本机无 symlink 权限被物化为文本——即已知的无 symlink 权限白名单族）。
- 隔离 `DSH_HOME` 的 boot 冒烟：干净启动，无 loader 诊断。
- 走真实流程的浏览器测试（新建会话 → 添加工作区）：应用内对话框弹出且目录列表为实时数据；`EnumWindows` 找不到任何 `Select Workspace Directory` 窗口，宿主无对话框 worker 子进程。
- 改后 enabled LAN 冒烟：无凭据 `GET /api/session/list` → 401（同文件内 webserver 行替换链完好）。

## Alternatives considered

- **修 resolver**（在 `resolveDirectoryPickerBackend` 加会话 0/服务探测）。本次否决：resolver 是 chooser 的包私有实现，改它意味着核心文件补丁或上游变更——另行评估（见下），不属于组合层修复。
- **部署侧 overlay**（服务宿主的 `$DSH_HOME/cordis.patch.yml`）。否决：fork 的 web 组合在本仓库受版本控制，不允许按部署漂移；固定应作用于本 fork web profile 的每一次启动，不依赖额外状态。
- **保留 native 并给 pick 加超时。** 否决：任何超时都不能让不可见的对话框变得可见；有界等待只会杀掉操作者可能正在查看的对话框，且依然误报失败。`showing` 前阶段的有界等待与会话 0 fail-loud 检查仍是上游加固候选。
- **把服务切到 LAN 模式**，让 `bindHost` 变为 `0.0.0.0` 从而 auto 解析 `browse`。否决：为无关目的翻转绑定/认证拓扑；固定方案在不触碰门禁的情况下得到同样的解析结果。

## Consequences

- 工作区添加流程在 NSSM 服务与隧道形态下可用；代价是本 fork web profile 内一律放弃原生 OS 选择器，包括有人值守的本地运行——可接受，应用内对话框功能完整（浏览、新建文件夹、显示隐藏文件）。
- 该固定是对上游文件的 fork 增量：directory-picker 段对上游的 `git diff` 必须恰为 Fork 注释、`disabled: true` 与两行插入；超出即上游改动了该行，需重新对账。已按此登记 FORK_NOTES.md。
- 重启纪律适用：运行中的 NSSM 服务在重启前保持启动时固化的组合，而该次重启同时完成仍待执行的 alpha.4 切换（FORK_NOTES.md 服务条目）。
- 上游侧评估（resolver 探测 vs 特性请求）另行推进，不阻塞本组合修复。
