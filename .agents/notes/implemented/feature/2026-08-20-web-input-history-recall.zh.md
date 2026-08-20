# Agent Note: 纯浏览器插件形态的 composer 历史召回

Status: implemented

[English](2026-08-20-web-input-history-recall.md) | 中文

## 问题

fork 需要 Claude.ai 的 composer 手势:光标在第 0 位且无选区时,ArrowUp 把当前会话上一条已发送消息召回进草稿;连续按键往更早翻;ArrowDown 往回翻;翻过最新一条后恢复进入遍历前的草稿。FORK_NOTES.md 禁止改动官方核心或包私有文件,而 composer 的键盘面恰恰如此:`ComposerKeyboard` 面(arbitrate、track、pasteBegin)是 InputBar 私有、不跨插件边界,InputBar 自身的 `onKeyDown` 拥有既有的全部按键认领。该功能因此必须只走公开缝隙,否则就成为 upstream 合并负担。

## 决策

功能以 `packages/extensions/input-history-recall`(`@deepseek-ai/dsh-client-input-history-recall`)落地,一个自包含的浏览器半插件,落位遵循[落位 Agent Note](../architecture/2026-08-19-fork-ui-extensions-placement.md)。所有输入输出均走公开缝隙:

- **按键捕获**:document 级 `keydown` 监听器挂在捕获阶段,先于 InputBar 的 React `onKeyDown` 运行。被认领的按键 `preventDefault()`(不做原生光标移动)且 `stopPropagation()`(composer 自身的处理器不会看到——InputBar 的菜单仲裁不受影响)。composer 经 `textarea[data-dsh-composer]` 只读定位,global-paste 与 text-file-cards 已在消费该选择器。
- **历史来源**:`ctx.sessions.sessionOf(actx).getSnapshot().nodes`,过滤 `user` 与 `steering` 节点并拼接文本块,每次按键现读。不存在第二份历史副本,也未新增任何事件或服务。
- **草稿写入**:公开的 `ctx.conversation.input` 服务(`setDraft`),召回即一次普通草稿编辑——经状态机的草稿镜像持久化、可撤销,并受 global-paste 同款锁对齐(会话移除、可续接父会话离线)拒绝。
- **菜单让位**:slash 候选菜单打开期间其方向键仲裁优先,经 `ctx.get('inputTriggers')` 读取——可选,未组合 input-trigger 管线的组合仍有召回。

基础设计之上的四点实现细化:

1. `inputTriggers` 经 `ctx.get` 读取而非硬注入:硬服务依赖会让插件 fiber 在无管线的组合里永远 PENDING,而菜单检查只需要"打开或不存在"。
2. 遍历进行中的按键不复查光标:`setDraft` 之后 React 受控重渲染把光标留在引擎决定的位置,插件无法稳定观察;只有遍历**进入**要求第 0 位且无选区。
3. 已在最旧一条时 ArrowUp 吞掉按键但不改内容(Claude.ai 行为);遍历中读到空历史时同样保持原位。
4. 召回门槛仅接受 `plain` 输入相——比 global-paste 的粘贴路由更严,因为召回是整体替换草稿,不得覆写已认领的命令行或进行中的提交。

遍历状态是一个内存槽(会话 id、游标下标、暂存草稿)。会话切换经 `ctx.sessions.list` 订阅者重置——list store 默认同步 flush,按键不可能观察到陈旧槽,keydown 路径因此不存在防御性复查。草稿清空在下一次按键时惰性重置:遍历写入必为非空文本,空草稿即意味着消息已发送或草稿被清空。

## 测试

`packages/extensions/input-history-recall/tests/input-history-recall.client.spec.ts` 以有状态草稿 fake 覆盖遍历往返(召回顺序、暂存恢复、空草稿恢复)、最旧一条保持、遍历中空历史保持、会话切换与发送清空重置、完整守卫矩阵(经 `isComposing` 与旧式 `keyCode` 229 的输入法组合、未聚焦/不存在的 composer、无会话/scope/face、会话移除、可续接父会话离线、submit/adjudicate/claim 相、候选菜单打开时放行至 composer 自身处理器)、stopPropagation 隔离、fiber 拆除(HMR 安全)、惰性 node 半,以及 invariant 伴生件的所有权登记。

## 备选方案

**把手势内嵌进 InputBar.tsx。** 否决:`packages/client` 核心文件改动违反 FORK_NOTES.md,是反复出现的 upstream 合并面,且重复公开缝隙已暴露的状态。与粘贴路由不同——后者需要知道 composer 私有的焦点与接管面板遮挡——本手势所需的全部事实(composer 焦点、会话锁、输入相、菜单状态、已发送历史、草稿写入)均可从外部观察,核心文件耦合的论据不成立。

**把 `inputTriggers` 硬注入为服务依赖。** 否决:召回功能在没有 slash 管线时优雅降级(菜单视为关闭),硬注入会让插件 fiber 在无管线组合里永久 PENDING。`ctx.get` 与 hub 自身的可选解析模式一致。

**订阅输入状态 store 检测发送清空重置。** 否决:订阅会在每次草稿变化时触发,只为捕获一次转移;按键侧惰性检查(遍历中草稿为空)行为等价,因为遍历写入必为非空。

**在 keydown 处理器里保留防御性陈旧会话复查。** 作为不可达代码否决:sessions list store 同步通知(默认 flush),订阅者在任何后续按键之前已完成重置;为同进程类型化保证设防会给逐文件 100% 覆盖率门增加一个无法覆盖的分支。

**用消息身份(seq)而非数组下标锚定游标。** 否决:活跃会话的节点列表只增不减,下标游标唯一的竞态(遍历中 `loadOlder` 前插更早一页)只是让下一次按键落在另一条已发送消息上——仍是已发送消息,代价是该手势并不需要的身份簿记。

## 后果

- InputBar.tsx、输入状态机与所有 `packages/client` 包零改动;upstream 合并面是三份组合清单(`cordis.patch.yml`、web-app manifest、tsconfig paths/聚合)、`extensions/` 组 README 行,以及 FORK_NOTES.md 的先例计数。
- InputBar 自身的 ArrowUp/ArrowDown 处理不变:候选菜单打开时按键原样放行;菜单关闭时 InputBar 的 arbitrate 对本插件已认领的按键返回 `pass`——两个方向都不存在双重认领。
- 召回仅限当前会话与已加载窗口、召回的是模型序列化文本(引用已展开、图片丢弃)、暂存草稿仅在内存;这些限制记录在包 README 的已知限制中,而非掩盖。
