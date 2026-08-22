# Agent Note: 会话内查找作为 fork 浏览器插件

Status: implemented

[English](2026-08-22-chat-find-in-bar.md) | 中文

## Problem

Web UI 没有会话内查找：命令面入口只有 composer 的 `/` 菜单与 `+` launcher，侧栏搜索是跨会话的标题/内容检索，Ctrl/Cmd+F 落到浏览器原生查找——它看不见已加载 DOM 窗口之外的内容、不感知应用的会话边界。2026-08-22 的选题调研证实了双源空缺：上游无任何查找面（命令/键盘域均无），社区无占位（"Show Your Plugins!" 全量语料与两份 awesome 列表里有命令面板与导航轨，没有会话内文本查找）。

## Decision

`packages/extensions/find-in-chat`（`@deepseek-ai/dsh-client-find-in-chat`），fork 扩展档位的纯浏览器包（惰性 node half、`./invariant` 伴生件、双语 README、版本钉住 root）。三层拆分，让状态机脱离 React 可测：`find-engine`（纯 DOM 匹配与覆盖探针）、`find-controller`（全部监听器、状态机、高亮绘制与居中滚动）、以及挂载为单个 `shell.overlay` 条目的薄 `FindBar` 视图——在既有条目旁新增自有 id（list 类、root 域、点击穿透层、`occupants: []`），不接管任何既有座位。

- **拦截沿 global-paste 先例**：document 级 capture 相 keydown，只接管不带 Shift/Alt 的 Ctrl/Cmd+F，以 `[data-chat-flow]` 存活为门（无会话 hero 与 trajectory 标签页都不含 chat DOM——一个探针覆盖全部三种让位态）且页面无打开的 `[role="dialog"]`。让位态保留浏览器原生查找。
- **匹配为字面、不区分大小写、单文本节点语义**（跨 React 切分节点的查询不命中，与原生查找一致），跳过 `aria-hidden` 装饰；代码块文本与普通文本同等匹配。
- **高亮走 CSS Custom Highlight API**：对现有 DOM 建 Range，零 React 树改动，每次变更重扫时重建。DOM 包裹（注入 `<mark>`）被否决——下一次 React reconciliation 会破坏它。无该 API 的平台（jsdom、旧浏览器）降级为只计数与滚动、不绘制。
- **覆盖诚实而非穷尽**：搜索范围是 chat 流的活 DOM——与原生查找所见一致——查找栏报告已搜索的定稿消息数并附「更早消息未加载」注记。不自动 `loadOlder`：ChatView 将已加载消息全量挂载（无窗口化），自动翻页会无界增长 DOM；视图自带的 Load earlier 按钮加重扫即可纳入更早窗口。
- **一切关闭走同一路径**：绑定输入框内的 Escape、当前会话变更（runtime 会话列表 store，draft-keeper 的订阅模式）、或流卸载（MutationObserver，200 ms 防抖，同时让流式重扫保持实时并钳制序号）。关闭清除两个高亮注册项并恢复打开前焦点；teardown 移除监听器、Observer、注入样式与注册项——零残留，由规格证明。

## Testing

`tests/find-engine.client.spec.ts` 钉死纯 DOM 语义：文档序出现、大小写折叠、空查询门、代码块命中、不跨节点拼接、aria-hidden 跳过、行数/更早页探针。`tests/find-in-chat.client.spec.ts` 在 jsdom chat 文档与伪造会话列表上启动 controller：全部拦截门与组合键排除、已开态 revision 递增、查询重研与回绕步进、绑定输入框内的 Enter/Escape 家族、焦点捕获与恢复、会话切换与变更驱动的关闭/重扫、stub（注册表在）与降级（不在）两种高亮绘制、两条滚动路径、零残留 dispose；外加惰性 node 入口与 invariant 伴生件。`tests/find-bar.client.spec.tsx` 以可脚本 controller 覆盖视图。`apps/web/tests/find-in-chat.e2e.ts` 在真实浏览器免 key 组合上跑播种长会话 fixture：与真实 chromium 高亮注册表一致的计数、代码块命中、居中滚动步进、双向回绕、Escape 清除与重开、会话切换自动关闭、composer 共存。

## Alternatives considered

**命令面板式查找（`dsh-spotlight` 邻接）。** 社区已有键盘命令面板；会话内文本查找是另一件事（内容检索而非动作分发），调研未发现占位。面板整合还会迫使查询走 composer 的触发管线，而本插件刻意完全不碰它。

**DOM 包裹（`<mark>` span）做高亮。** 改动 React 拥有的树会破坏 reconciliation：下一次渲染要么剥掉 mark、要么对着被改的 DOM 做 diff。Highlight API 以零 DOM 改动画 Range；代价只有降级无绘制路径，而计数与滚动已覆盖其价值。

**搜索时自动 `loadOlder`。** runtime 每页 50 条（`PAGE_MESSAGES`）且无窗口化——每条已加载消息都保持挂载——搜索触发的翻页会把整个长会话拖进 DOM。覆盖注记加视图自带的 Load earlier 按钮以用户自己的节奏达到同一结果。

**经 store 而非 DOM 探针跟踪激活视图。** 视图环把标签页切换放在组件状态里，无公开投影；`[data-chat-flow]` 探针就是诚实的信号（恰好是「chat 视图已挂载」），且上游改视图集时自动退化为「查找不可用」。

## Consequences

- chat 视图获得带会话感知（切换自动关、视图内匹配、覆盖诚实）的原生手感查找，零上游文件成本；插件让位的每个场合浏览器原生查找仍是回退。
- find-in-chat 是 fork 第七个扩展包、`shell.overlay` 的首个消费者——该条目证明了这一层的增量承诺（在零既有占位旁新增 id，仅由 bar 自行恢复指针事件以保住点击穿透）。
- Ctrl/Cmd+F 接管是显式且可争议的：偏好原生栏的用户在 chat 视图内失去它。门控保住了所有非 chat 上下文的原生行为；若上游出自带查找，本插件应退役而非竞争。
- 单节点匹配语义继承 React 的文本切分：被切分到两个节点的命中在重渲染合并前不命中。这与原生查找在同一 DOM 上的行为一致，作为边界记录而非掩盖。
