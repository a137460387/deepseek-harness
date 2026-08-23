# @deepseek-ai/dsh-client-draft-budget

[English](README.md) | 中文

草稿 token 预算（Web UI）：composer 下方的一条弱化读数，估算当前草稿的 token 成本，并在 provider 报告上下文数据时给出发送后占上下文窗口的百分比。估算镜像 token-meter 自身的启发式——读数给草稿的价，就是草稿发出时 meter 将计的价。

读数是挂载于 composer dock（`conversation.composer.dock`）、与 stats line 相邻的纯 slot 消费者：活草稿经 dock 的 `useInput` 份额、以 250ms 尾随防抖到达；上下文基准经 session 投影 `contextPressure`——优先 provider 锚定的 `projectedTokens`、退化 `pressureTokens`、仅在存在路由容量时给百分比（否则 tokens-only）。composer 永不被写；不注册任何监听器。

数字的工作方式：

- **估算**：`ceil(长度 / 4) + 8`——token-meter 的固定文本密度加块与角色框架开销，恰是纯文本草稿作为已发送用户消息支付的价格。契约规格以 `@deepseek-ai/dsh-token-meter` 的真实 `estimateMessage` 钉住镜像，上游改公式会在下次同步时让本 fork 的测试转红。
- **发送后百分比**：`(基准 + 草稿) / 上下文窗口`，封顶 100%，基准锚定 provider 实报投影——启发式只承担草稿增量段。
- **每个数字都带 `~`**：启发式低估 CJK 与 JSON，社区实测长会话中与 provider 实报可有数十个百分点偏差（见上游 token-meter README 与 discussion #3514）。近似性是明示的，不是暗示的。

## Model Experience

None：浏览器侧插件只读取 slot props（草稿份额与一个 session 投影）并渲染估算值，不注册任何模型可见面。

#### KV Cache effect

None；本包不组装也不发送任何 provider 请求。

## Known Limitations and Deferred Work

- **估算是启发式而非 tokenizer** —— 继承 meter 已记载的误差带（CJK/JSON 低估、可能有数十个百分点偏差）。显示中的 `~` 与本条即披露；发送后基准保持 provider 锚定，误差不进入大数。
- **未计入**：斜杠命令 claim 与 @ 引用 chip（草稿字符串旁的机器态）、排队 steering 行、草稿图片——发送实付 ≥ 显示值，通常略多。
- **无按模型 tokenizer 计价** —— 密度常数是 meter 的，不是当前模型的；未来的精确 token 化 meter 将取代此镜像（契约规格会标记漂移）。
- **无开关** —— 零配置读数；从 `cordis.patch.yml` 摘除插件即整体移除。
