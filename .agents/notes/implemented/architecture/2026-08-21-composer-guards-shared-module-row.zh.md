# Agent Note: 作为首条模块请求行的共享 composer 守卫

Status: implemented

[English](2026-08-21-composer-guards-shared-module-row.md) | 中文

## Problem

三个 fork 浏览器插件——global-paste、text-file-cards、input-history-recall——各自持有一份 composer 谓词拷贝：`composerVisible` 遮挡探测、`sessionAcceptsEdits` 会话锁检查、`resolveEditableInput` 门面解析。duplication 门在 global-paste 与 text-file-cards 之间标记了三处克隆，input-history-recall 还持有同一逻辑的第三份 `sessionAcceptsEdits`。对一份拷贝修正锁对齐会静默漏掉其余两份，而每个新的 composer 插件都会再复制一遍这套谓词。但共享这份代码会撞上 client bundle 纯度门：跨插件值导入被禁止，除非导入方声明模块表请求（`dsh.client.external`）或改为经 cordis 服务协作。

## Decision

这些谓词移入 `packages/extensions/composer-guards`（`@deepseek-ai/dsh-client-composer-guards`），即仓库首条纯供给（supplier-only）动态行。本包遵循[落位 note](2026-08-19-fork-ui-extensions-placement.zh.md)确立的全部 fork 扩展惯例——自包含于 `packages/extensions/`、惰性 node 半、`./invariant` 伴生件、双语 README、版本对齐 root——外加 [client shell 分层 note](2026-08-15-client-shells-and-dynamic-packages.zh.md) 定义的模块请求机制：

- 浏览器半导出三个谓词与一个惰性 `apply`；不提供任何服务或 slot。每个消费包在自己的 `dsh.client.external` 中声明 `@deepseek-ai/dsh-client-composer-guards/client`，并以对等的 peer 与 dev 依赖持有该包；boot 图组装器把供给行排在消费包之前，浏览器模块表把请求解析到该行的导出（`<id>/client` 与裸包名归一化到同一行）。
- `sessionAcceptsEdits` 直接接收 `SessionFace`——input-history-recall 的签名。另外两份拷贝内联的 `(ctx, actx)` 形态只是每个调用点一次 `ctx.sessions.sessionOf(actx)` 调用，SessionFace 形式才是共享内核。
- `resolveEditableInput` 返回超集 `{ input, state, sessionId, liveSessionIds }`：global-paste 消费 `state`，text-file-cards 消费 `sessionId`/`liveSessionIds`（其暂存文件的清理货币），多余字段对另一方零成本。
- 部署耦合显式且在装载期报错：挂载任一消费包的组合必须同时挂载供给行，否则图组装以缺少请求拒绝；web-app bundle 将五者一同挂载。

## Testing

`packages/extensions/composer-guards/tests/composer-guards.client.spec.ts` 覆盖可见性探测的每个分支（零尺寸、中心出视口、探测落空、直命中/后代/祖先命中）、会话锁矩阵（removed、plain、continuable 父在线/离线、one-shot）、可编辑 input 的守卫次序（无会话、无 scope、无 face、removed、父离线、adjudicating、submitting、claimed 仍接受）、当前会话 id 列表、两个惰性半面，以及 invariant 伴生件的所有权登记。三个消费包的既有 spec 在共享实现上原样通过（四包共 117 个测试），client 构建经 bundle 纯度门验证了声明的 external 边。

## Alternatives considered

**用 cordis 服务替代模块行。** 这些谓词是无状态函数，不是带生命周期或可替换身份的能力；服务会引入完整的 Service Definition / Provider / Consumer 缝隙，让每个消费包的 fiber PENDING 于提供方，而且代码本身仍需要一个共享居所。

**jscpd ignore 标记。** 仓库用 ignore 块标记"属于其主题"的重复（invariant 伴生件是先例），但三份锁对齐逻辑是维护隐患而非契约：克隆是偶然形成的，ignore 标记只会把它们冻结。

**跨 fork/upstream 边界提取。** usage-stats ↔ token-meter 的克隆刻意保持红：token-meter 由 upstream 持有，跨该边界提取共享抽象是与其约二十行重复不相称的合并负担。

**内联进某个消费包再由其余包导入。** 那正是纯度门拒绝的未声明跨插件值导入；无服务身份的共享代码，库行才是被认可的形态。

## Consequences

- duplication 门剩余的红恰好是三处已记录的 usage-stats 克隆（usage-stats 内部 ×1、usage-stats ↔ token-meter ×2），作为接受的存量保留。
- composer-guards 是首个被实际使用的 `dsh.client.external` 供给方。该机制本就为此形态设计——包行与精确静态键是仅有的两类供给方——但这是它首个在用的消费组合；第二个使用者应对照本先例确认该路径。
- 四个消费包（composer 草稿持久化插件 draft-keeper 作为第四个加入）现在在组合期硬性依赖供给行。在 fork 唯一的已发布组合（web-app bundle）内这不可见，但挂载了 global-paste 却缺 composer-guards 的下游组合会在图组装处以缺少请求报错，而不是留到运行时。
- 未来新的 composer 插件应请求同一行而不是再复制谓词，draft-keeper 已如此落地；各消费包的模块文档与 extensions README 均指名了供给方。
