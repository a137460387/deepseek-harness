---
description: "composer 的 ArrowUp/ArrowDown 历史召回：翻当前会话已发送消息，退出遍历时恢复进入前草稿。"
kind: "package-reference"
---
# @deepseek-ai/dsh-client-input-history-recall

[English](README.md) | 中文

## 概述

Web UI 的 composer 历史召回:光标处于输入框最前面(第 0 位、无选区)时按 ArrowUp,把当前会话最近发送的一条消息召回进草稿;继续按往更早翻;按 ArrowDown 往回翻到更新的一条;翻过最新一条后恢复按 ArrowUp 之前正在编辑的草稿。对标 Claude.ai 的 composer 行为。

插件在**捕获阶段**挂载一个 document 级 `keydown` 监听器,先于 composer textarea 自身的 React `onKeyDown` 运行。被认领的按键同时 `preventDefault()`(不做原生光标移动)与 `stopPropagation()`(composer 自身的处理器不会看到);未认领的按键原样到达 composer。InputBar 与所有 `packages/client` 文件均不改动——composer textarea 通过 `textarea[data-dsh-composer]` 选择器只读定位,global-paste 与 text-file-cards 已在消费同一选择器。

遍历的工作方式:

- **历史来源**:每次按键时从当前会话的会话快照现读——`user` 与 `steering` 消息节点、文本块拼接。纯图片消息不贡献内容;非文本块跳过。不维护第二份历史副本。
- **草稿写入**走公开的 `ctx.conversation.input` 服务(`setDraft`),召回的消息即一次普通草稿编辑:经状态机的草稿镜像持久化,可用 Ctrl/Cmd-Z 撤销。
- **草稿暂存**:进入遍历前的草稿保存在一个内存槽里;ArrowDown 翻过最新一条时写回(进入前为空的草稿恢复为空)。
- **遍历状态**就是这一个内存槽:不跨刷新存活,由会话切换、草稿清空(发送成功)与用户编辑召回文本重置。

按键被认领前的判断顺序:

- 非 ArrowUp/ArrowDown → 忽略。
- 输入法组合中(`isComposing` 或旧式 `keyCode` 229)→ 忽略;候选窗拥有方向键。
- composer textarea 不在文档中,或不是 `document.activeElement` → 忽略。
- 无当前会话、scope 或 session face → 忽略。
- 会话级 composer 锁关闭(会话已被移除;可续接 subagent 子会话的精确父会话离线)→ 忽略,与 composer 的只读状态一致(与 global-paste 相同的对齐)。
- 输入状态机不在 `plain` 相(`claimed` 命令行、`adjudicating`、`submitting`)→ 忽略:召回是整体替换草稿,不得覆写命令行或进行中的提交。
- slash 候选菜单打开 → 忽略:input-trigger 管线自身的方向键仲裁优先,按键放行至 composer 的 React 处理器。
- 未在遍历中时,ArrowUp 额外要求 `selectionStart === selectionEnd === 0`;未在遍历中时,ArrowDown 一律放行。
- 已在最旧一条时,ArrowUp 被吞掉但不改变显示内容。
- 遍历进行中,草稿不再等于遍历最近一次写入的内容(用户编辑了召回文本)→ 结束遍历,该次按键交还原生行为。

遍历进行中,ArrowUp/ArrowDown 不复查光标(草稿重写后光标位置由引擎决定),因此遍历中的编辑不会打断游标。但编辑召回文本本身会结束遍历:内存槽记录插件最近一次写入的内容,下一次按键时草稿与之不符即意味着用户已接管——遍历结束、该次按键放行,后续方向键表现得如同从未进入过遍历(之后的 ArrowUp 经光标在第 0 位的门槛重新进入)。编辑后又改回与写入内容完全一致的文本则保持遍历(纯字符串比较)。input-trigger 服务经 `ctx.get` 可选读取,未组合 slash 管线的组合仍有历史召回。

## 目录

- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="model-experience"></a>
## 模型体验

无——本浏览器端插件只读取会话快照、经公开的 `ctx.conversation.input` 服务路由草稿写入,不注册任何模型可见内容。

#### KV Cache 影响

无;本包不组装或发送任何 provider 请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **序列化差异** —— 召回的文本是消息的模型序列化形态:内联引用已展开为模型所见内容,而非发送前的显示态草稿。设计上已接受;不存在显示态重建。
- **仅当前会话** —— 不做跨会话历史召回。
- **仅已加载窗口** —— 事件窗口之外(尚未经 `loadOlder` 拉取)的消息在加载前不可召回。
- **仅文本** —— 召回消息时丢弃图片等非文本块。
- **内存态暂存** —— 暂存草稿不跨刷新与插件 fiber 替换存活;遍历中刷新会把召回文本留作持久化草稿。
- **无 paste-upgrade** —— 与 global-paste 的文本路径一样,`setDraft` 不运行输入状态机的 paste-upgrade,召回文本保持纯文本,不会升级为引用 chip。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
