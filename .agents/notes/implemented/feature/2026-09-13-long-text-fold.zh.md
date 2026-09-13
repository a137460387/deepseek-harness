# Agent Note: 长文本粘贴折叠的 fork 浏览器插件

Status: implemented

[English](2026-09-13-long-text-fold.md) | 中文

## Problem

往 Web composer 粘贴超长纯文本会刷爆草稿:上游 `PASTE_COMMAND` 处理器对 `text/plain` 无条件全量插入、没有任何长度阈值(`packages/client/ui-conversation/src/client/input/editor/keymap.ts:156-163`),聊天侧对发送后的用户文本全文渲染、没有折叠(`packages/client/ui-chat/src/client/chat/MessageItem.tsx:216-219`)。特性目标是对标 Claude 网页版的卡片化:输入框呈现紧凑卡片、发送后的消息呈现可展开卡片,而模型收到与内联粘贴逐字节一致的文本。

双源查重(复查日期 2026-09-13)的结论是**社区面被占、上游面沉默**——这是首个在社区面非空时获维护者特批立项的课题(官方缝隙上的高品质交付)。社区面:官方 Discussions [#1031](https://github.com/deepseek-ai/deepseek-harness/discussions/1031) 的 `long-draft-input`(输入侧摘要卡片,其自述设计原则即"只优化展示、不改模型输入";自 2026-08-14 发布当日起未再更新,且早于上游 Lexical composer——其局限性自述所描述的 `textarea`/`backdrop`/`mirror` 结构已是旧世代);dsplugin.app 目录(13,258 条)另有五个同域插件——`dsh-paste-collapse`(标记占位、发送时展开)、`dsh-paste-code-block`(可折叠粘贴卡)、`dsh-auto-paste`(长文本存为附件)、`dsh-longtext-input` 与 `dsh-web-text-drop`(长文本转工作区文件加 `@` 引用)。第 1 步报告曾引为发送侧折叠最近实现依据的 `dsh-input-enhancement` 降级为不可核实:其仓库现已 404。上游面:无第一方表面(无粘贴阈值、无聊天折叠、Lexical 0.49.0 的 paste 路径无 `isTrusted` 门),而通用文件附件已于 2026-08-26 落地——第 1 步的前提「附件管道 image-only、需动 `createDraftImages`」已对树修正:管道对文件字节是媒体中立的(`FileBlock`,`packages/llm/llm/src/types.ts:84-88`),`createDraftImages` 符号不存在,对应的包私有入口是 `createDrafts`(`packages/client/ui-conversation/src/client/service.ts:308`,不在冻结的 `IConversation` 面上)。第 2 步核实钉死了承重链:提交面只在唯一一处读取草稿(`packages/client/ui-conversation/src/client/input/facade.ts:397`),`setDraft` 以 discrete 同步提交(facade.ts:286 加 Lexical `_flushSync`),document 捕获监听先于元素级 Lexical keydown 与 React 委托 click——占位符总能在文本发出前还原。

## Decision

`packages/extensions/long-text-fold`(`@deepseek-ai/dsh-client-long-text-fold`),纯浏览器 fork 扩展包(惰性 node half、`./invariant` 伴生件、双语 README、版本对齐 root)。路线 B、批复的 B-1 形态:文本仍是消息正文,每个缝隙都是官方的。

- **粘贴接管、标记暂存**:document 捕获阶段 `paste` 监听把越过阈值(2,000 字符或 50 行)的纯文本剪辑按会话存入 localStorage,草稿里放进纯 ASCII 的 `[LongText#N]` 标记——composer 聚焦时经仅含标记的合成 `ClipboardEvent` 重派发到 composer,让上游粘贴路径在光标处插入(global-paste 的转发手法,`packages/extensions/global-paste/src/client/index.ts:86`);无焦点时经公开 `setDraft` 追加到草稿末尾。组合中本行挂 global-paste 之前,非聚焦接管才能先看到事件;聚焦场景与顺序无关,因为 global-paste 让回聚焦态。文件与混合剪辑整体放行。
- **提交拦截、同步还原**:composer 手势上游的捕获 keydown/click 监听——composer 上的 Enter,或以 `aria-label` 对照经公开 locale 服务读取的上游 `input.send` / `input.send.steer` / `input.send.queue` 识别的主发送按钮——经公开 `setDraft`(discrete,刷新后的投影正是 `facade.ts:397` 读到的那份)展开每条暂存标记,然后放行原生提交。提交面只有一处草稿读取、没有第二次读取(`packages/client/ui-conversation/src/client/input/machine.ts:145-160`),`inputActions.submit()` 无生产调用方,两个手势即完整的旁路面。
- **聊天折叠按长度判定,不按标记**:替换 `conversation.chat.node` 的 `'user'`/`'steering'` keyed 渲染器(目录文档化的 occupant 替换机制),达到渲染阈值的文本块原位折叠——真实气泡经 CSS max-height 限高、底部渐隐遮罩上浮着展开按钮,展开体经公开 `projectUserText` 原语投影消息自身文本。伪造或失效的标记发出短字面文本、短到无法折叠,渲染器因此永不信任标记、永不触碰存储;打字或他端而来的长文本同样折叠。
- **两处失败点都开放失败**:无法暂存的粘贴(超限、配额、无存储)继续流向原生粘贴并给出错误提示;条目被逐出的标记只通知、不阻塞,字面短文本照常发送。暂存仓以 LRU 限容(50 条 / 200 万字符),带死会话修剪与 localStorage 的重载持久化。
- **常量而非 Config**:阈值与预算是带依据说明的包常量——text-file-cards 先例(`MAX_FILE_BYTES`);Config 表面会引入浏览器 fork 包从未携带的 config-catalog 面。

## Testing

`tests/markers.client.spec.ts` 钉文法(往返、不与命令裁定的 `/` 前缀相撞、与门面占位符消毒正则 facade.ts:112 不相交、无 `lastIndex` 漂移)与展开语义。`tests/staged-store.client.spec.ts` 以 fake localStorage 驱动往返、会话隔离、重载持久化、序号续接、移除、三种拒绝原因、按条目上限与按种子超预算源头的 LRU 逐出、提交期新旧度、死会话修剪。`tests/browser-plugin.client.spec.tsx` 在真实 Context/SlotRegistry/LocaleRuntime(挂真实上游 `conversation` 词典)加 fake 会话/对话面上启动浏览器半:承重时序(聚焦粘贴向 composer 转发仅含标记的事件且原事件未达、非聚焦追加、Enter 经镜像真实状态提交的 fake 门面收到全文)、完整守卫矩阵、两条 fail-open 路径、缺条目通知不阻塞、损坏标记惰性、Shift/组合排除、keydown+click 幂等、teardown,以及经探针属性的 dock/预览/折叠组件。`tests/contract.client.spec.tsx` 对真实上游代码钉防漂移契约:Lexical discrete 更新同步性与非 discrete 反差、上游 keymap 的 paste→`pasteText` / 文件→`intakeFiles` / Enter→`submit` 路由、主按钮五个 locale 键、六条镜像文案与上游 `chat` 词典逐字节相等、生成物 slot catalog 携带全部三处注册。`apps/web/tests/long-text-fold.e2e.ts` 落地浏览器泳道(种子两轮会话上按探针属性的折叠/展开断言),在已登记的 web-e2e scaffold 议题下运行;视觉证据按既有交接由演示 GIF 承接。

## Alternatives considered

**路线 A——真附件(文本文件走附件管道)。**主选被否:模型收到的是 handle 而非内容(投影路径让模型用工具读文件),偏离特性对标的 Claude 网页语义;且聊天侧仍需同样的 `'user'` 键替换,因为官方文件卡没有展开阅读。重派发进 composer 自身 intake 在机械上可行(Lexical 0.49.0 无 `isTrusted` 门),但它对本就拦截事件的做法而言,更深地耦合了上游 `PASTE_COMMAND` 处理器的内部分支行为。维护者批复的备选:若路线 B 的展开机制在现场被证明不可靠再切换。

**B-2——发送层展开(dsh-paste-collapse 的架构)。**社区插件包裹运行时 `conversation` 服务的非接口成员 `sendSession`——绕开冻结 `IConversation` 面的私有契约依赖,且其绑定的签名已被上游改名过一次(`imageIds` → `attachmentIds`)。fork 的官方缝隙纪律下不存在干净的单点发送钩子,故选择经核证完备的手势对枚举;其 localStorage 加 host 路由的持久化思路以仅 localStorage 形态采纳。

**标记驱动的渲染。**聊天侧按标记存在折叠可让卡片标题携带暂存元数据,但这让渲染器信任一个用户可编辑的令牌,预览还需要存储访问——伪造标记会渲染空卡、失效标记渲染坏卡。按长度折叠自愈(短字面按文本渲染)、免存储,且对任何来源的长文本一致。

## Consequences

- 长文本粘贴者得到紧凑的 composer、带预览的暂存条目 dock,以及长消息原位折叠为限高可展开区域的聊天历史——模型可见形状与内联粘贴逐字节一致(`user/message` 内一个逐字文本块)。
- long-text-fold 是 fork 第十个扩展包:第七个纯浏览器成员、第五个 `conversation.input.dock` 消费者、首个 `conversation.chat.node` keyed 替换(`replaceRisk: 'shadows-shipped-ui'` 席位——上游用户气泡改动须在每次同步时与 `fold-view.tsx` 对照,已列为 FORK_NOTES 核查项),以及把 composer-guards 带到第五个消费者的包。
- 契约 spec 把上游漂移(Lexical 更新语义、keymap 路由、locale 键、镜像文案、slot catalog)变成同步时的可见测试失败。
- 提交回显在准入前的短暂窗口按上游构造显示全文,折叠区随持久化节点出现。若上游原生落地长文本卡片化,本插件退役而非竞争(第 7 步既行规则)。
