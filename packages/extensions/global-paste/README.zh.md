# @deepseek-ai/dsh-client-global-paste

[English](README.md) | 中文

Web UI 全页文本粘贴:在窗口任意位置按 Ctrl/Cmd+V,会把剪贴板的纯文本路由到当前会话的 composer 草稿中,无需先点击输入框。对标 Claude.ai 的"任意位置粘贴"行为。

插件在 **捕获阶段** 挂载一个 document 级 `paste` 监听器,在 composer textarea 自身的 React `onPaste` 之前运行。两条路由路径:

- **文本**(有 `text/plain`):通过公开的 `ctx.conversation.input` 服务(`setDraft(draft + text)`)追加到草稿末尾。
- **文件(图片)**:重新派发一个 paste 事件到 composer textarea,让 composer 自身的 `onPaste` 跑完整的图片 intake(格式/数量预检、预览 URL 创建、附件 rail 渲染)。这避免复制 `ConversationController` 上包私有的草稿图片创建路径(`browserDraftAttachment`),保持官方图片行为不变。已在 Chromium 验证可行:脚本构造的 `ClipboardEvent` + 携带 File 的 `DataTransfer` 能被目标 `onPaste` 正常接收(`clipboardData.items` 和 `getData` 均可读)。
- **混合(文本 + 图片)**:拆分——文本走 `setDraft`,图片转发给 composer。转发的事件只复制 file 项(不含 `text/plain`),因此 composer 的 `onPaste` 不会重复插入文本。

路由前的判断顺序:

- 无 `text/plain` 且无文件 → 忽略。
- 无当前会话 → 忽略。
- 输入状态机处于 `adjudicating` 或 `submitting` → 忽略(提交事务进行中)。
- composer textarea 已是 `document.activeElement` → 忽略(交给原生 `onPaste` 处理,避免重复插入)。这也保护了重新派发的图片事件:`forwardImagePaste` 聚焦 composer 并派发后,冒泡的事件重新进入捕获监听器,但命中此守卫直接返回。
- 焦点在其它可编辑元素(input/textarea/contenteditable)→ 忽略(尊重该元素自身的粘贴)。
- composer 被接管面板(审批/用户提问)遮挡 → 静默忽略。
- 其它情况 → `preventDefault()` 并按上述路由。

文本追加到草稿**末尾**;不保留已有非折叠选区(这是已确认的设计选择)。草稿中已有的引用 chip(occurrences)会被保留——`setDraft` 以 U+FFFC 占位符携带它们,只追加新文本。

文本文件**拖拽**由伴生插件 `@deepseek-ai/dsh-client-text-file-cards` 负责:它把拖入的文本文件暂存为 composer 上方的卡片,而不是直接内联进草稿。

## 模型体验

无——本浏览器端插件只通过公开的 `ctx.conversation.input` 服务路由剪贴板粘贴事件,不注册任何模型可见内容。

#### KV Cache 影响

无;本包不组装或发送任何 provider 请求。

## 已知限制与后续工作

- **无 paste-upgrade** —— composer 自身的 `onPaste` 会把文本送入输入状态机的 `pasteBegin` 事务,可把粘贴文本升级为 slash 引用 chip。本插件改用公开的 `setDraft` 路径(状态机的 keyboard 面是 InputBar 私有,不跨插件边界),因此粘贴的 URL 和路径保持为纯文本,不会变成 chip。对于全页粘贴这正是期望行为。图片路径不受影响:它重新派发到 composer,因此 composer 自身的 `onPaste`(含其 paste-upgrade)对图片部分照常运行。
- **浏览器支持** —— 图片转发路径依赖浏览器支持脚本构造的 `ClipboardEvent` + 携带 File 的 `DataTransfer`。已在 Chromium 验证;Firefox 和 Safari 可能限制此项(合成事件的 `clipboardData` 可能为 null)。在那些浏览器上,图片粘贴会静默落到无文件分支;文本粘贴不受影响。
- **可见性探测** —— composer 被遮挡的判断用 `elementFromPoint` 在 composer 中心点检测。若覆盖层遮住 composer 但未遮住中心点(如细侧栏),则无法检测;粘贴会路由到一个部分可见的 composer,这是无害的。
