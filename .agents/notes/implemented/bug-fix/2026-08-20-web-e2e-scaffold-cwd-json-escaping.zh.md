# Agent Note: Web e2e 种子夹具以 JSON 字面量形态拼接路径

Status: implemented

[English](2026-08-20-web-e2e-scaffold-cwd-json-escaping.md) | 中文

## 问题

Web e2e 脚手架的种子夹具机制用裸字符串 `split().join()` 直接在夹具的 JSONL 文本上替换 `{{sessionId}}`/`{{cwd}}` 占位符。已提交的夹具把占位符放在 JSON 字符串值内部(`"cwd":"{{cwd}}/workspace"`),因此替换值必须以 JSON 字符串字面量形态进入。Windows 上脚手架的工作区 cwd 是反斜杠路径(`C:\Users\...\dsh-web-e2e-ws-xxxx`);裸拼接产生 `"cwd":"C:\Users\..."`,其中 `\U`、`\A` 以及每个路径段开头都是非法 JSON 转义,`realizeSeedFixture` 的首行 `JSON.parse` 抛出 `SyntaxError: Bad escaped character in JSON`。所有依赖种子会话的套件在 Windows 上因此整档失败——最近一次完整 replay 运行中是 25 个文件——而 CI 保持绿色,因为 POSIX 路径不含任何会被 JSON 转义的字符(拼接在那里是恒等变换),这同样是该 bug 自脚手架引入以来一直存活的原因。同根的两个姊妹缺陷:`recordFixture` 用原始形态的 cwd 作 split 键,而收割出的 JSONL 文本携带的是转义形态(Windows 录制永远无法把 cwd token 化);`normalizeAria` 对 Windows 路径有两重遗漏——basename 用 `'/'` 切分在反斜杠路径上取到整条路径,cwd token 化只匹配原始拼写而工具参数与结果以原始 JSON 文本渲染、携带的是转义拼写——`{{workspace}}` 与 `{{cwd}}` 的 golden 归一化同时静默失效。

## 决策

所有触及夹具 JSON 文本的替换现在统一走一个 helper:`jsonLiteral(value)` 返回 `JSON.stringify(value).slice(1, -1)`——JSON 写在引号之间的字面量主体。`realizeSeedFixture` 以转义形态 join 两个占位符值(`{{sessionId}}`、`{{cwd}}`),并把同样的形态应用到第二段录制 cwd 重写(split 键与 join 值,因为该段同样操作 JSON 文本)。`recordFixture` 以转义形态的 cwd 作 split 键——`JSON.stringify` 产出的日志行只可能包含这一形态。`normalizeAria` 对 aria 快照携带的两种 cwd 拼写都做 token 化——纯文本区域里的原始形态,以及以原始 JSON 文本渲染的工具参数/结果内部的 JSON 转义形态——并用覆盖双平台的分隔符类(`/[\\/]/`)取工作区 basename。POSIX 上这些变换全部是恒等变换,已提交的夹具、golden 与录制模式输出与之前逐字节一致;只有 Windows 运行改变行为。

## 验证

Windows 上完整跑一次 `DSH_SNAPSHOT=replay pnpm run test:web`:`Bad escaped character` 出现次数归零(修复前那次运行是 29 处),失败文件数从 42 降到 19,且没有任何原本绿色的文件转红。25 个整档 JSON 转义受害者中,21 个直接全绿——包括依赖 `{{workspace}}` 的 `stats-paged-history` golden,以及最新的两个受害者 `message-feedback-layout` 与 `reference-composer`(它们的 golden 还需要 `normalizeAria` 的转义拼写 split)。其余四个越过种子阶段进入本修复不触及的失败:`background-job-list` 与 `chat-long-interactions` 到达 Windows shell 工具组合层(种子里的 `bash` 行渲染不出终端卡,场景执行工具处报 `unknown tool "bash"`——即既有 `minimal-preset.snapshot` 与 `turn-tail-actions` golden 的同类),`chat-scroll-contract` 在 88 轮历史上撞滚动几何超时,`navigation-panes` 的 trajectory golden 通过、另两个 bash 终端卡用例仍超时。基线中另有 `models-settings` 与 `onboarding-deepseek-config` 两个失败本轮也通过;它们是整跑负载下的超时抖动,隔离重跑即绿,且不触及任何被改函数。

## 备选方案

**逐行解析夹具、在解码后的对象上替换、再重新序列化。** 占位符位于事件载荷的任意深度,替换需要全树遍历,且重新序列化会改变空白与转义拼写,而 `stabilizeFixtureMessageIds` 与已提交的 golden 正是按这些比较——巨大的 diff 换来零行为收益,不如转义拼接值。

**只转义反斜杠(`replace(/\\/g, '\\\\')`)。** 对观察到的路径正确,但手写了 JSON 字符串转义的子集;`JSON.stringify` 派生的字面量以相同代价顺带覆盖引号与控制字符。

**跳过第二段 cwd 重写与录制方向的修复,反正今天不可达。** 录制路径需要 API key,第二段在已 token 化的夹具上基本是空操作,但两处都是同样的一行对称修正;留成原始形态会在这份改动已经理解的代码里保留已知损坏的 Windows 行为。

**给受影响的套件加 Windows 跳过清单。** 缺陷在测试基础设施而非场景;跳过会把一处单文件修复藏进逐套件豁免,并让 Windows 车道与 CI 覆盖永久分叉。

## 后果

Windows replay 运行现在与 CI 同等地解析种子夹具,恢复了本地车道作为推送前信号的价值;JSON 转义失败类整体消失,而不是随每个新的基于种子的套件继续增长(message-feedback-layout 与 reference-composer 是最近两个受害者)。Windows 上的录制模式现在能正确把 cwd token 化,未来 Windows 录制的夹具将以与 POSIX 录制一致的形态提交。剩余的 Windows-only 失败是场景内容里真实的平台差异——工具可用性与真实工具输出内的路径拼写——它们保持可见,而不是被更早的崩溃掩盖。
