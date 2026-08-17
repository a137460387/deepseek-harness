# @deepseek-ai/dsh-client-global-paste

[English](README.md) | 中文

Web UI 全页文本粘贴:在窗口任意位置按 Ctrl/Cmd+V,会把剪贴板的纯文本路由到当前会话的 composer 草稿中,无需先点击输入框。对标 Claude.ai 的"任意位置粘贴"行为。

插件在 **捕获阶段** 挂载一个 document 级 `paste` 监听器,在 composer textarea 自身的 React `onPaste` 之前运行。判断顺序如下:

- 剪贴板无 `text/plain` → 忽略(图片/文件粘贴仍由 composer 自身处理)。
- 无当前会话 → 忽略。
- 输入状态机处于 `adjudicating` 或 `submitting` → 忽略(提交事务进行中)。
- composer textarea 已是 `document.activeElement` → 忽略(交给原生 `onPaste` 处理,避免重复插入)。
- 焦点在其它可编辑元素(input/textarea/contenteditable)→ 忽略(尊重该元素自身的粘贴)。
- composer 被接管面板(审批/用户提问)遮挡 → 静默忽略。
- 其它情况 → `preventDefault()`,通过 `ctx.conversation.input.for(actx).setDraft(draft + text)` 把文本追加到草稿末尾,并以 `preventScroll` 聚焦 composer。

文本追加到草稿**末尾**;不保留已有非折叠选区(这是已确认的设计选择)。草稿中已有的引用 chip(occurrences)会被保留——`setDraft` 以 U+FFFC 占位符携带它们,只追加新文本。

## 模型体验

无。本包只触及浏览器的剪贴板事件和公开的 `ctx.conversation.input` 服务;不发送任何 prompt、消息、schema、流或工具结果。

#### KV Cache 影响

无;本包不组装或发送任何 provider 请求。

## 已知限制与后续工作

- **仅文本** —— 剪贴板图片和文件不在此路由。草稿图片创建服务(`browserDraftAttachment`)是 `ConversationController` 的包私有成员,未对插件暴露。因此图片粘贴仍需先聚焦 composer。未来版本可暴露草稿图片入口并扩展此监听器。
- **无 paste-upgrade** —— composer 自身的 `onPaste` 会把文本送入输入状态机的 `pasteBegin` 事务,可把粘贴文本升级为 slash 引用 chip。本插件改用公开的 `setDraft` 路径(状态机的 keyboard 面是 InputBar 私有,不跨插件边界),因此粘贴的 URL 和路径保持为纯文本,不会变成 chip。对于全页粘贴这正是期望行为。
- **可见性探测** —— composer 被遮挡的判断用 `elementFromPoint` 在 composer 中心点检测。若覆盖层遮住 composer 但未遮住中心点(如细侧栏),则无法检测;粘贴会路由到一个部分可见的 composer,这是无害的。
