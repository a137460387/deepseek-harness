# Agent Note: 草稿 token 预算作为 fork 浏览器插件

Status: implemented

[English](2026-08-23-composer-draft-budget.md) | 中文

## Problem

composer 的上下文反馈只显示存量：ContextMeter 圆环读 `contextPressure` 投影、报告上下文已有多满——没有任何东西预警输入框里写到一半的草稿将花掉多少预算。2026-08-22 的选题调研将其评为并列 top 2 空缺（双源干净：上游无面——meter 无草稿增量——社区语料无插件），2026-08-23 的轻量复核维持结论：`draft budget` / `token estimate` / `prompt size` 检索无占位，最新 release（dsh-v0.1.1-rc.2）无信号。

## Decision

`packages/extensions/draft-budget`（`@deepseek-ai/dsh-client-draft-budget`），fork 扩展档位的纯浏览器包（惰性 node half、`./invariant` 伴生件、双语 README、版本钉住 root）。在 `conversation.composer.dock` ——catalog 自己的"关于会话的环境读数"之座、stats line 的条带——注册一条读数（自有 list 条目 `id 'draft-budget'`、order 10），与既有 stats 条目相邻。

- **估算镜像 meter 而非私有猜测**：`ceil(长度/4) + 8` 恰是 `token-meter/src/estimate.ts` 对纯文本用户消息的计价（CHARS_PER_TOKEN 加块与角色框架）。镜像是三个常数加一个表达式；契约规格经包的 `./src/*` 导入真实 `estimateMessage` 并在代表性语料上断言相等，上游改公式会在下次同步时让 fork 自己的测试失败。备选——导入 meter 的 host 面——被否决：client 面只导出类型，host 面携带浏览器包不该拖入的 node 侧服务接线。
- **一切经 slot props 到达**：dock 的 `useInput` 份额（活草稿，250ms 尾随防抖使打字不逐键重渲染）与 `useProjection('contextPressure')`。零订阅、零监听器、零 Observer——插件仅有的注册是字典 effect 与声明绑定的 `slots.inject`，均随插件 fiber 可释放（text-file-cards 的注册形态）。
- **百分比锚定 provider**：发送后占用 = `((projectedTokens ?? pressureTokens) + 草稿) / contextWindow`、封顶 100——provider 实报投影给大数定价，启发式只给草稿增量定价。无容量则无百分比：读数退化为 tokens-only 而非虚构窗口。
- **近似是明示的而非暗示的**：每个数字带 `~`。启发式低估 CJK 与 JSON，社区实测长会话中与 provider 实报可有数十个百分点偏差（discussion #3514）；README 写明误差带与未计入清单（命令 claim、引用 chip、排队行、草稿图片）。

## Testing

`tests/estimate.client.spec.ts` 钉住镜像算术（纯开销空草稿、非整单元进位、UTF-16 计数、线性伸缩）、折算惯例边界、以及与真实 `estimateMessage` 的契约（单一断言点使带 brand 的消息字段不进入本 client 包的导入面）。`tests/draft-budget.client.spec.tsx` 以脚本化 props 覆盖读数：空与纯空白草稿渲染无、无数据时的 tokens-only 分支、full 分支的百分比算术（projectedTokens 优先与 pressureTokens 退化）、退化窗口、100% 封顶、大草稿折算、防抖的落定/合并/卸载、locale 键齐平、经真实 SlotRegistry 与 LocaleRuntime 的启动与干净释放、惰性 node 入口、invariant 伴生件。`apps/web/tests/draft-budget.e2e.ts` 钉住浏览器泳道：replay 适配器不报告路由容量（探针实证：chip 落定为 `data-draft-budget="tokens"`），故本泳道断言确定性草稿的精确折算值（40 字符 `~18 tok`、120 字符 `~38 tok`）、防抖增长、清空即隐。full 分支的百分比算术由单测的脚本化投影钉住。

## Alternatives considered

**直接消费 meter 的 host 面。** 估算器住在 host 包，但其 client 面只导出类型、根面是服务接线；拖进浏览器包会带入 node 侧依赖。本地镜像加契约规格保持浏览器包纯净，让漂移响亮而非无声。

**经模块表行依赖 usage-stats。** fork 的共享先例（draft-keeper → composer-guards）适合共享*谓词*；上下文数据不是 usage-stats 的份额——`contextPressure` 是 token-meter 的 session 投影，dock slot 以标准 prop 直接交付。依赖边只会把两个各自读同一公开投影的插件耦起来。

**浏览器内精确 tokenizer。** client 面不存在，引入一个是 fork 规则排除的新外部依赖。meter 自身即启发式计价，与它同价就是诚实的上限：meter 对的时候读数对，meter 错的时候读数同向错。

**工具行里的可点控件。** `conversation.input.right` 承载发送路径上的控件、单行高度预算；读数按 catalog 自己的路由属于 dock 条带。未来的明细浮层可以迁往彼处而不触碰本座位的契约。

## Consequences

- 长 prompt 作者随草稿增长看到成本与发送后对窗口的占用——恰是下一次请求 meter 将为该增量报告的数字，近似性预先声明。
- draft-budget 是 fork 第八个扩展包、composer dock 的第二个 occupant；该条目证明了条带在 stats line 旁的增量承诺。
- 契约规格把上游公式漂移变成同步时的可见测试失败——镜像必须被有意识地重新对齐，绝不无声分叉。
- replay e2e 泳道构造性地走 tokens-only 分支（无容量通告）；full 分支的浏览器验证需要报告容量的适配器，暂由单测脚本化投影钉住。若上游把草稿增量显示做进 meter（#3514 透明性诉求的自然读法），本插件应退役而非竞争。
