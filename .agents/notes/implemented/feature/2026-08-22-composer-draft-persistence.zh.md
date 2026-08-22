# Agent Note: Composer 草稿持久化作为 fork 浏览器插件

Status: implemented

[English](2026-08-22-composer-draft-persistence.md) | 中文

## Problem

Web UI composer 的草稿只存在于输入状态机的内存里:页面重载或浏览器崩溃都会丢掉用户已输入但未发送的文本。状态机(`InputMachine`)及其接线是 `dsh-client-ui-conversation` 的包私有实现,第一方的持久化层是 fork 无法在不触碰核心文件的前提下完成的上游改动——这正是 fork 红线。但公开缝隙足以观察并恢复草稿:每会话的 input 状态存储(`ctx.conversation.input.for(actx).state`)发布草稿,`setDraft` 是唯一公开写路径,而共享的 `resolveEditableInput` 解析早已回答"插件现在能否写 composer"。

## Decision

`packages/extensions/draft-keeper`(`@deepseek-ai/dsh-client-draft-keeper`),fork 扩展档位的纯浏览器包(node half 空壳、`./invariant` 伴生件、双语 README、版本对齐 root)。它订阅当前会话的 input 状态存储,把草稿镜像进单条 localStorage 记录——`{ version: 1, drafts: Record<sessionId, string> }`,单一键 `dsh.draft-keeper`——并在重载后恢复进空 composer:

- **写入 300 ms 防抖;删除立即执行。** 草稿清空(发送或手动清空)即刻删除该会话条目,重载绝不能复活用户亲眼看着消失的文本。例外:草稿因移入 steering 队列而清空时保留条目(队列是易失的,此时重载会把文本恢复成可编辑草稿),队列排空后条目即删。
- **强制 flush 出口关闭防抖窗口**:会话切换先于旧会话订阅结束前 flush,`pagehide`、`beforeunload`、插件 teardown 同步 flush——localStorage 写入内联完成,不存在会丢失的异步间隙。
- **恢复门槛即完整的 composer 安全清单**:每会话每插件生命周期一次,仅在会话成为 current 时,且 `resolveEditableInput` 解析成功(composer-guards 模块行的第 4 个消费者)、phase 为 `plain`、活草稿为空、队列为空、存在非空存储草稿。恢复经 `setDraft` 写入,并从插件自有的 locale 命名空间发出 info 提示(`notify`),沿 text-file-cards 的词典模式。
- **订阅之前就存在的草稿按普通编辑采集基线**(启动间隙输入的文本,或 HMR 重挂载时已活着的草稿)。
- **条目随 live 会话列表修剪**,在每次列表变化时执行,以列表的 `ready` 相位为门槛(pending 相位的空 id 列表是加载态而非无会话世界)。
- **存储经过校验且静默失败**:版本不符或结构不符的记录整体弃用(不迁移——未来格式自增版本并自负迁移);任何存储失败(配额、隐私模式)或 localStorage 缺失都把镜像禁用到插件生命周期结束,与 client runtime 自身存储持久化的契约一致。

## Testing

`packages/extensions/draft-keeper/tests/draft-store.client.spec.ts` 钉住存储层(往返与落盘形态、整体弃用、写入失败/首次读取失败/无存储下的静默禁用闩)。`tests/draft-keeper.client.spec.ts` 以真实 LocaleRuntime 与 jsdom localStorage 在伪造服务上启动浏览器半包:防抖窗口、清空即删、全部强制 flush 出口、恢复门槛的每个条件与每生命周期一次守卫、steering 队列保留与排空删除、ready 门槛修剪、与 history-recall 遍历的共存(非空活草稿被采集基线而非覆写)、模拟重载与 HMR 重挂载路径、生命周期中段的存储失败。`apps/web/tests/draft-keeper.e2e.ts` 以真实组合在真实浏览器内 keyless 运行:输入→镜像记录、重载→恢复 composer 并附 info 提示、清空→条目即删→再次重载不恢复。发送路径与手动清空共享"清空草稿即删条目"的存储语义,由单测钉住,浏览器 lane 保持零模型调用。

## Alternatives considered

**输入状态机内的上游持久化。** 自然居所——状态机本就持有草稿——但它是 `dsh-client-ui-conversation` 的包私有实现,且草稿不进模型上下文,session log 没有它的席位。fork 侧这等于核心文件补丁;按红线拒绝。

**用 sessionStorage 或 IndexedDB 替代 localStorage。** sessionStorage 随标签页死亡,而崩溃恢复正是一半目的。IndexedDB 是异步的,`pagehide`/`beforeunload` 的 flush 无法保证在页面消失前完成——零丢失窗口保证直接排除它。

**每会话一个存储键。** 按键存储需要按键校验与 N 次修剪写入;单一版本化记录让校验与修剪原子化(一次读、一次写、一次删),代价是每次防抖重写整条记录——任何现实的会话数量下不过是几百字节。

**只镜像变更(不采基线)。** 订阅建立之前输入的文本(启动间隙、HMR 重挂载)要等下一次编辑才会持久化。基线采集关掉这个洞,也让与 history-recall 遍历的共存自然成立:活的非空草稿即真相,向前镜像;存储绝不覆写 composer。

## Consequences

- 未发送草稿如今跨重载与崩溃存活,以纯文本恢复并附可见提示。slash 命令 claim 与 @ 引用 chip 是草稿字符串旁边的机器状态,恢复时不复存在——chip 的显示文本作为普通文本存活;这是文档明示的 MVP 边界,恢复门槛的 `plain` 相位要求也保证 claimed 行不会在会话中途被悄悄降级成惰性文本。
- draft-keeper 是 composer-guards 模块行的第 4 个消费者;web-app bundle 现在五行同挂,任何挂载 draft-keeper 的自定义组合必须同时挂载 composer-guards,否则组合期报缺少请求错误。
- 恢复按设计每会话每插件生命周期一次:同一生命周期内清空已恢复草稿再重载不恢复,HMR 重挂载则有意重新武装(内存守卫重置而存储存活)。
- 队列保留让排队消息的文本在杀死易失队列的重载后仍可找回——这是输入状态机自身没有给出的小承诺;若上游将来原生持久化草稿,本插件应当退役而不是长出迁移。
