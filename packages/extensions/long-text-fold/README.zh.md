---
description: "把粘贴的超长文本暂存为 composer 卡片,提交时还原全文,并把发送后的消息原位折叠为限高可展开区域。"
kind: "package-reference"
---
# @deepseek-ai/dsh-client-long-text-fold

[English](README.md) | 中文

## 概述

Web UI 长文本粘贴暂存卡片:粘贴超过字符或行数阈值的纯文本时,文本按当前会话存入 localStorage,草稿里只落下短短的 `[LongText#N]` 标记而非数千字符;composer 聚焦时,标记经一次仅含标记的重派发粘贴落在光标处。提交时,每条暂存标记都会在 composer 自身发送路径读取草稿之前同步还原为全文,聊天侧则把发送后的长文本原位折叠为限高可展开区域。模型收到的是与内联粘贴逐字节一致的文本。

## 目录

- [详细说明](#details)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

## 上限

- **粘贴阈值**:纯文本达到 2,000 字符或 50 行即暂存为卡片;更短的剪辑保持原生内联粘贴。
- **单条暂存**:超过 1,000,000 字符(≈25 万 token)的文本被拒绝并显示输入区提示、按原生粘贴——展开后内容原样进入模型上下文,更大的暂存对谁都没有意义。
- **存储预算**:LRU 在全部会话间最多持有 50 条 / 2,000,000 字符;最旧条目被逐出后,其标记按原文发送并给出提示。

## 暂存模型

暂存文本整体存放在 localStorage 的 `dsh-long-text-fold:v1:s:<sessionId>:<seq>` 下,并镜像进插件自有的快照 store,该 store 经 dock 注册的 `hooks` 隔间供给组件。新旧度在暂存时与提交期展开时各提升一次;新增暂存会顺带清理已不存在会话的条目。暂存条目也随发送退役:提交期展开会登记它消费的序号,展开后的草稿一旦清空——经公开 `input.state` 仓读到的输入机 commit-draft——被登记的条目即被移除,dock 卡片随消息一同消失。保留草稿的输入路径(裁定落空、命令结算失败、飞行中的 release)永远看不到清空、条目保留;草稿改写为其它内容而未清空时解除登记。不再被任何草稿引用的条目由 LRU 兜底回收。任何存储拒绝(超限、配额、不可用)都以类型化错误向上抛出,接管随之**开放失败**:事件继续流向原生粘贴——或 global-paste——全文照常落入草稿,外加一条可见的错误提示;什么都不暂存、什么都不丢失、什么都不阻塞。页面重载后暂存文本仍在(localStorage);被逐出的标记退化为字面短文本,聊天侧按其长度原样渲染——折叠判定基于长度。

-----

<a id="details"></a>
## 详细说明

插件在 document 上挂一个**捕获阶段**的 `paste` 监听,先于 composer 自身的粘贴路径运行。一次粘贴只有满足以下全部守卫才被接管;否则事件交由原生处理:

- 剪贴板不含任何 `File` 项——图片与混合剪辑整体留给 composer 原生 intake(文本文件的拖拽暂存是姊妹包 `text-file-cards` 的领地)。
- 文本越过粘贴阈值。
- 存在当前会话,会话级 composer 锁全部敞开(会话未被移除;可续接的子代理其父会话恰好在位),且输入状态机不处于 `adjudicating`/`submitting`——三者由 `@deepseek-ai/dsh-client-composer-guards` 的共享 `resolveEditableInput` 谓词一并作答。
- composer 已挂载且可见(未被接管浮层遮挡),焦点也不在其它可编辑元素上。

标记刻意采用纯 ASCII 的 `[LongText#N]`:它能在输入门面的占位符消毒中幸存(消毒只剥私用区与 U+FFFC 码点),永远不会触发 `/` 开头的命令裁定,在任何可能泄漏的场合读起来都只是普通文本。

插入复用 composer 自身的粘贴路径。composer 聚焦时,插件拦停原事件并向 composer 重派发一个**仅含标记的合成 `ClipboardEvent`**——与 global-paste 转发图片所用的脚本构造手法相同——让上游 `PASTE_COMMAND` 在光标处插入标记并自带历史边界。无焦点时,标记经公开的 `setDraft` 追加到草稿末尾并聚焦 composer。组合中本行挂在 **global-paste 之前**,非聚焦接管才能先看到 document 捕获事件;聚焦场景与顺序无关,因为 global-paste 会把聚焦态的粘贴让回 composer。

插件还挂了 document 捕获阶段的 `keydown`/`click` 监听,先于 composer 自身手势。在 composer 上按 Enter——或点击主发送按钮,其 `aria-label` 经公开 locale 服务对照上游 `input.send` / `input.send.steer` / `input.send.queue` 三个键识别——会运行一轮同步展开:草稿中每条暂存标记经公开 `setDraft` 原位替换为全文,该离散更新在手势抵达 composer 提交路径前已提交,发出的消息因此与内联粘贴的形状逐字节一致。条目已被逐出的标记只通知、不阻塞(字面短文本照常发送);Shift+Enter 与输入法组合期永不展开;展开是幂等的,同一手势的 keydown+click 对只展开一次。

聊天侧替换 `conversation.chat.node` 的 `'user'` 与 `'steering'` 两个 keyed 渲染器。折叠判定是文本块拼接后的**长度**达到渲染阈值——而非标记:被手改或失效的标记抵达发送消息时短到不足以折叠、按字面渲染,渲染器因此既不需要信任标记也不需要访问存储,打字或他端而来的长文本同样折叠。被折叠的文本块原位渲染真实内容:气泡经 CSS max-height 限高、底部渐隐遮罩上浮着展开按钮,展开后去掉限高与遮罩、气泡下方提供收起按钮;展开体用上游气泡同款的 `projectUserText` 原语投影消息自身全文,短文本以本包自有 CSS module 镜像上游气泡形状(附件行、引用汇总、copy+时钟动作行)。输入 dock 列出当前会话的暂存条目,并经 `shell.overlay` 提供只读预览浮层。

-----

<a id="model-experience"></a>
## 模型体验

无。展开后的文本作为 `user/message` 内一个逐字文本块走普通草稿——没有新 session 事件、没有内容块词汇表变化、没有模型侧注册。模型所见与内联粘贴逐字节一致。

#### KV Cache 效应

无;本包从不组装或发送 provider 请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **chat-node 渲染器替换需要跟涨上游**——替换 `'user'`/`'steering'` 两键即遮蔽官方 `UserMessageNodeView`;上游对用户气泡镜像面(内容分拣、附件行、引用汇总)的每次改动,都需要在同步时与 `fold-view.tsx` 对照(FORK_NOTES 已载核查项)。
- **提交回显短暂显示全文**——本地 pending-submission 回显不经 keyed slot,从提交点击到持久化 `user/message` 之间,回显气泡会短暂显示全文,随后才出现折叠卡。
- **按长度折叠是全局的**——用户手工敲出的长文本与暂存粘贴折叠得完全一致;这是有意的一致性设计,不是意外。
- **标记可被伪造**——手打的 `[LongText#N]` 若无暂存条目则按原文发送(短到不折叠,自愈);若与存活条目撞号则会展开该条目。seq 空间与标记的特异性使其可忽略;不存在运行时防伪。
- **明文暂存**——暂存文本未加密存于 localStorage,与 draft-keeper 的草稿镜像同一隐私级别。
- **简化动作行与时钟**——官方动作组件为包内私有,折叠视图自带 copy+时钟行;时钟用简化的日期感知格式,非上游 message-chrome 模板。
- **混合剪辑放行**——剪贴板同时携带文件与长文本时不接管;文件保持第一方 intake,文本原生内联。
- **固定上限**——client 插件装载链不携带按行 `config`,阈值与存储预算是包常量,不是部署配置。
- **暂存条目丢失退化为字面标记**——LRU 逐出、清空的源存储或换浏览器都会让标记不可还原;提交时给出提示并发送字面标记,不阻塞草稿。
- **清理跟随任何草稿清空**——提交清理在展开后的草稿清空时触发,无论清空来自哪条路:经失败命令路径保留全文的草稿若被用户手动清空,其暂存条目同样退役。草稿从未清空的条目(被吞掉的手势、偏航的编辑)留待 LRU 兜底回收。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

`fold-view.tsx` 镜像官方 `UserMessageNodeView`(`packages/client/ui-chat/src/client/chat/MessageItem.tsx`)——内容分拣、附件行、引用汇总——因为上游组件及其 CSS module 为包内私有;镜像的 locale 字符串由契约 spec 与上游词典钉成逐字节相等。提交拦截所依赖的 `setDraft` `discrete` 同步性,以及上游 keymap 的 paste→`pasteText`、Enter→`submit` 路由,均由契约 spec 对真实 Lexical 钉死。

</details>
