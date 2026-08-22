# @deepseek-ai/dsh-client-draft-keeper

[English](README.md) | 中文

Web UI 的 composer 草稿持久化：每个会话未发送的草稿镜像进 localStorage，重载或崩溃后把存储的文本恢复进空 composer，并附一条 info 提示。仅恢复纯文本。

插件订阅当前会话的 input 状态存储（`ctx.conversation.input.for(actx).state`，公开的 InputZone 通货），并经公开的唯一写路径（`setDraft`）写回——InputBar 与所有 `packages/client` 文件零改动。每次恢复写入都由 `@deepseek-ai/dsh-client-composer-guards` 的共享 `resolveEditableInput` 解析把关（经 `dsh.client.external` 请求的模块表行）。

镜像的工作方式：

- **保存**：草稿编辑经 300 ms 防抖写入单条 localStorage 记录（`{ version: 1, drafts }`，按会话 id 键控）。订阅之前就存在的草稿（启动间隙输入的文本，或 HMR 重挂载时已活着的草稿）按普通编辑采集基线。
- **删除**：草稿清空立即删除该会话条目——发送或手动清空的文本绝不能在重载后复活。唯一例外：草稿因移入 steering 队列而清空时保留条目（队列是易失的；此时重载会把文本恢复成可编辑草稿），队列排空后条目即删。
- **强制 flush**：会话切换（先于旧会话订阅结束）、`pagehide`、`beforeunload`、插件 teardown 都同步写入防抖中的草稿，防抖不扩大丢失窗口。
- **恢复**：每会话每插件生命周期一次，仅在会话成为 current 时，且 composer 确认可写——`resolveEditableInput` 解析成功（会话锁开启、无 submit/adjudication 在途）、phase 为 `plain`（claimed 命令行不能变成纯文本）、活草稿为空、队列为空（待处理的 steering 行拥有这"空"草稿）、且存在非空存储草稿。恢复经 `setDraft` 写入，并在 composer 自有的文案命名空间发出 `notify('info', …)`。
- **修剪**：会话离开 live 会话列表后，其条目在每次列表变化时删除；仅在列表已到达后执行（pending 阶段的空 id 列表是加载态而非无会话世界）。
- **存储失败**：版本不同或结构不符的记录整体弃用——不迁移。任何存储失败（配额、隐私模式）或 localStorage 缺失都会把镜像静默禁用到插件生命周期结束；composer 毫无感知。这与 client runtime 自身存储持久化的契约一致。

## 模型体验

无——本浏览器端插件只把 composer 草稿经公开 input 服务镜像进 localStorage,不注册任何模型可见内容。

#### KV Cache 影响

无;本包不组装或发送任何 provider 请求。

## 已知限制与后续工作

- **仅纯文本** —— slash 命令 claim 与 @ 引用 chip 是草稿字符串旁边的机器状态,恢复时不复存在:composer 以 plain 相位回来,chip 的内联显示文本作为普通草稿文本存活,但 chip 本身不恢复。claim token 按其字面文本恢复。
- **单条记录** —— 一个 localStorage 键持有全部会话的草稿;大小上限于存储配额,配额耗尽会静默禁用持久化(在存储腾出空间且页面重挂插件之前,草稿不再跨重载存活)。
- **每生命周期一次** —— 恢复每会话每插件生命周期只运行一次。同一生命周期内清空已恢复的草稿再重载不会恢复;HMR 重挂载会重新武装恢复,因为内存守卫重置而存储存活。
- **离开期间排空的 steering 队列** —— 队列保留条目的删除只在会话为 current 时运行(订阅是信号);队列在别的会话为 current 时排空,保留的条目要等该会话被再次访问或被修剪。
- **不跨会话恢复** —— 存储的草稿只恢复进它自己的会话。
