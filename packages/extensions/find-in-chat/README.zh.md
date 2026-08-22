# @deepseek-ai/dsh-client-find-in-chat

[English](README.md) | 中文

会话内查找（Web UI）：Ctrl/Cmd+F 在当前 chat 视图上方打开顶部居中的查找栏——对已加载消息做字面、不区分大小写的匹配，双向回绕步进、居中滚动高亮，并如实标注覆盖范围。本插件不接管的场合，浏览器原生查找栏行为不变。

拦截方式是 document 级 capture 相 keydown 监听（global-paste 先例）。只接管不带 Shift/Alt 的 Ctrl/Cmd+F，且仅在 chat 流已挂载、页面无 dialog 接管时生效：无会话的 hero 与 trajectory 标签页都不含 chat DOM，拦截随之让位——这些状态保留浏览器原生查找。composer 完全不被触碰；本包不消费任何 `conversation.input` 动词，也不请求 composer-guards 模块行。

查找的工作方式：

- **匹配**：字面子串、不区分大小写、单文本节点语义（跨两个文本节点的查询——React 切分渲染文本的产物——刻意不匹配，与原生查找在切分节点上的行为一致）。代码块文本与普通文本同等匹配；跳过 `aria-hidden` 装饰文本。
- **导航**：Enter 前进、Shift+Enter 后退，两端回绕；当前命中滚动至会话滚动容器中央，并经 CSS Custom Highlight API 绘制高亮——对现有 DOM 建 Range，零 React 树改动，每次步进与关闭时清理。不支持该 API 的平台（旧浏览器、jsdom）降级为只计数与滚动、不绘制。
- **覆盖**：搜索范围是 chat 流的活 DOM——与原生查找可见的范围一致——查找栏如实说明：显示已搜索的定稿消息数，并在已加载窗口未达会话头部时附注「更早消息未加载」。本包不自动调用 `loadOlder`：chat 视图将已加载消息全量挂载，自动翻页会无界增长 DOM；点击视图自带的 Load earlier 后重新搜索即可纳入更早窗口。
- **关闭**：查找栏内 Escape、会话切换、或 chat 视图卸载（会话关闭、切到 trajectory）即关闭查找栏、清除全部高亮并恢复打开前焦点。流式更新保持实时：DOM 变更经 200 ms 防抖后重扫窗口，命中缩减时当前序号钳制。

## Model Experience

None：浏览器侧插件只读取已渲染的会话 DOM 并绘制高亮，不注册任何模型可见面。

#### KV Cache effect

None；本包不组装也不发送任何 provider 请求。

## Known Limitations and Deferred Work

- **仅限已加载窗口** — 窗口外的消息（初始页为最近 50 条）不在搜索范围。这与浏览器原生查找一致（原生同样只能搜 DOM）；覆盖注记显式说明窗口，而非无界翻页。
- **不支持正则与大小写敏感** — 仅字面、不区分大小写匹配。
- **不做跨会话搜索** — 仅当前会话的 chat 视图；跨会话检索仍由侧栏会话搜索承担。trajectory 视图文本不搜索。
- **单文本节点语义** — 被 React 切分到两个文本节点的匹配不命中；重渲染或 Load earlier 往返常会使节点重新合并。
- **chat 视图内接管 Ctrl/Cmd+F** — 插件接管该键时，浏览器原生查找栏不再弹出。所有让位状态（无会话、trajectory 标签页、任意打开的 dialog）保留原生行为。
