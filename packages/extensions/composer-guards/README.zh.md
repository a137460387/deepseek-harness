# @deepseek-ai/dsh-client-composer-guards

[English](README.md) | 中文

fork 浏览器输入插件（`global-paste`、`text-file-cards`、`input-history-recall`、`draft-keeper`）共享的 composer 守卫：插件侧写入被允许到达 composer 之前，各方需要的三个谓词。

- **`composerVisible(composer)`** —— composer 文本域可见且未被接管浮层遮挡（在 composer 中心用 `elementFromPoint` 探测）。
- **`sessionAcceptsEdits(session)`** —— 所有会话级 composer 锁均处于开启状态：会话未被移除，且 continuable 子代理的精确父会话仍然在线。
- **`resolveEditableInput(ctx)`** —— 当前会话的 input 门面此刻可以接受草稿编辑（存在当前会话、scope 可解析、所有锁开启、输入状态机不在 submit/adjudication 事务中）；返回该门面及其状态快照、会话 id 与当前会话 id 列表。

本包是库行（library row），不是功能插件：两个半面的 `apply` 均为空操作，也不提供任何服务或 slot。它作为一条动态 `dsh.client` 行存在，消费包才能共享这份代码——每个消费包在自己的 `dsh.client.external` 中声明 `@deepseek-ai/dsh-client-composer-guards/client`，boot 图组装器把本行排在消费包之前，浏览器模块表把该请求解析到本包 `lib/client.js` 的导出。挂载了消费包的组合必须同时挂载本行，否则图组装会以缺少请求报错拒绝。

这些辅助函数只保持对公开缝隙的纯粹性：DOM 探测，以及每个消费包本就注入的 `sessions` / `conversation` 服务。owner 侧的 composer 锁原因（无工作区的 inert hero、owner block）没有公开信号、无法触达，因此每个消费包在它们外围保留各自的当前会话守卫。

## Model Experience

无：本包只向其他浏览器半插件提供守卫谓词，不注册任何模型可见内容。

#### KV Cache effect

无：本包从不组装或发送 provider 请求。

## Known Limitations and Deferred Work

- **roster 耦合** —— 消费包经 `dsh.client.external` 到达本包，因此挂载任一消费包的组合必须同时挂载本行。web-app bundle 将五者一同挂载；省略供给行的自定义组合会在图组装处以缺少请求错误失败，而不是留到运行时。
- **可见性探测精度** —— 遮挡检查在 composer 中心使用 `elementFromPoint`。覆盖了 composer 但未盖住中心的浮层不会被检出；调用方会写入一个部分可见的 composer，这无伤大雅。
