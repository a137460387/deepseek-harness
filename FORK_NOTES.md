# Fork 维护约束(重要)

本仓库是 fork 自官方 `deepseek-ai/deepseek-harness`，需要持续同步 upstream 更新。因此：

- **禁止直接修改官方核心/包私有文件**，包括但不限于：
  - `IConversation` 及其相关 service 文件
  - `ComposerBarInjected` / `ComposerChainProps`
  - `createDraftImages` 及附件相关的包私有实现
  - `ContentBlockMap` 涉及的 adapter/序列化核心文件
  - 任何标注为 "package-internal" 的接口或类型

- **新功能优先通过官方已开放的插件扩展点实现**(slot、chain、declaration merging 等 Cordis 插件机制)，做到零核心文件改动，以保证 `git merge upstream/master` 不产生冲突。

- **如果某个需求确实绕不开、必须改动核心文件**：
  1. 不要直接改 fork 源码
  2. 优先评估走 `patches/` 目录的 patch-package 式补丁管理(可追踪、upstream 更新后重新 apply)
  3. 或考虑向官方仓库提 issue/PR，让官方在其代码库中落地该扩展点
  4. 任何触碰核心文件的改动，必须先单独列出并获得确认，不能默默进行

- 涉及此类判断时，优先参考 `docs/architecture.md` 确认某个接口是否为官方预留的插件扩展点(如 `merge-extensible` 的 `ContentBlockMap`)，还是包私有边界。

- **fork 新增的浏览器端/Web 端插件包落位 `packages/extensions/`**，不进 `packages/client/`(upstream 持有并持续演进，避免组 README、聚合、清单成为合并冲突面)。每个包自包含：只走官方缝隙(公开服务/slot/捕获监听器)，自带 `./invariant` 伴生件。已有八个先例，分三档：`global-paste`、`text-file-cards`、`input-history-recall`、`draft-keeper`、`find-in-chat`、`draft-budget` 是纯浏览器包(node half 只是清单空壳，不进任何聚合)；`composer-guards` 是首条纯库供给行——三个共享 composer 谓词经各消费包的 `dsh.client.external` 模块请求供给，自身无任何行为，现有四个消费者(`global-paste`、`text-file-cards`、`input-history-recall`、`draft-keeper`，最后一个经 `resolveEditableInput` 消费，决策记录见 [draft-keeper Agent Note](.agents/notes/implemented/feature/2026-08-22-composer-draft-persistence.md))；`usage-stats` 是首个带真实 node half 的双面包——host 侧经 projection 缝隙注册 `usageStats` session projection，因此 tsconfig 拆 host/client 双面、两个根聚合各加一条引用。这类供给行附带一条组合期硬约束：供给行自身无服务、无 UI，仅是消费包经 `dsh.client.external` 按名请求的共享模块，任何组合方挂载任一消费包就必须同时挂载其声明的供给行，否则 client boot 图组装期直接报缺少请求的错误，不会留到运行期才暴露；今后再新增此类共享供给行时，需逐一核对消费包的 `dsh.client.external` 清单，并把供给行同步写进组合(`packages/bundle/web-app/cordis.patch.yml`)。另：新增 web e2e 场景文件需在 `apps/web/tsconfig.json` 的 host-plane 排除清单追加一行（fork 先例 `text-file-cards.e2e.ts`，`draft-keeper.e2e.ts`、`find-in-chat.e2e.ts`、`draft-budget.e2e.ts` 同）。决策记录见 [落位 Agent Note](.agents/notes/implemented/architecture/2026-08-19-fork-ui-extensions-placement.md)。

- **upstream 合并后的固定人工收尾**(三轮实测):其一,upstream 的 release bump 不会带动 `packages/extensions/*` 下的 fork-only 包,合并后需人工核对这些包的 `version` 是否仍对齐 root 版本——constraints 门会报不匹配,但不会提示原因是 bump 漏掉;其二,upstream 删除某包后,本地曾构建过该包的话会留下未跟踪的 `lib/`、`node_modules/` 等构建产物残留,跑 `pnpm run clean` 清理(clean 脚本即为此设计);其三,upstream 已收紧 pairing 门——zh 侧文档里指向配对文档(README/Agent Note)的链接必须指向 `.zh.md` 对应文件,fork 早前写的 zh 链接指英文侧会在 corpus 检查报 wrong locale,修正后逐对 `verify-translation-pairing --write` 重录;其四,upstream 重构了 `ProjectionDefinition`(`schema` → `stateSchema` + `wire: { viewSchema, view }`,注册 API 按客户端可见/仅 host 两态分派),fork 的投影包(usage-stats)在每次涉及 `packages/session/session-projection` 的合并后需照 upstream 自己的 token-meter 形态迁移,state 语义未变时 `stateVersion` 不动。

- **upstream 同步操作纪律**(2026-08-22 增补)：同步前必做——`git fetch upstream` 后用 git 对象 diff 逐个核实冲突面文件（`packages/llm/token-meter/src/usage-projection.ts`、`packages/client/ui-conversation/src/client/skeleton/InputBar.tsx`、`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`、`packages/client/connection/src/client/fixture.ts`、`apps/web/tests/scaffold.ts`），结论追加到下方「Upstream 同步基线」小节；合并后必做——重新生成 `slot-catalog.ts`（脚本产物，禁止手工编辑）；合并后必查——`InputBar.tsx` 的 `data-dsh-composer` 属性仍存在（`global-paste`、`text-file-cards`、`input-history-recall` 的 composer 选择器依赖它）。

- **重新构建 fork 扩展包后必须重启长驻的 `dsh web` 进程**(第二次踩同型坑：8/20 一次是旧进程不刷新新 UI、静默服务旧版本，8/21 一次是浏览器端直接报错)——进程的 client boot 图在启动时固化，而 `/plugins/*/client.js` 路由每次请求都从磁盘现读，旧图配新 bundle 时，消费新供给行(新增或修改了 `dsh.client.external` 模块请求)的包在加载期报"模块表缺失"，浏览器端呈现 "Failed to load plugins" 失败页；该报错文案中的 "build-time externals drift" 措辞有误导性——实际是进程比磁盘产物旧，与构建配置无关；排查：用 netstat 定位监听目标端口的 PID 并核对其启动时间是否早于本次改动，是则停掉旧进程重启。

## Upstream 同步基线（2026-08-22 已核实）

- 当前基线：`upstream/master` = `b150a551b8`（tag `dsh-v0.1.1-rc.2`），fork 落后 0 提交、领先 36 提交；`99f6f02fec`（rc.7）是其祖先——上游自 rc.7 起 fast-forward +743 提交，master 历史从未重写；fork 对上游的净差为 146 文件、+8,466/-71。
- 2026-08-22 审计的「上游谱系漂移」（中等风险）已核实关闭：假象来自本地 upstream 引用过期叠加 raw.githubusercontent CDN 缓存返回 rc.7 时代的文件内容，与 git 对象证据矛盾。
- 教训：判断上游状态一律以 `git fetch` 之后的本地 git 对象为准，禁止依赖 raw/CDN 网页内容下结论。

## 上游贡献政策（2026-08-22 核实）

上游 CONTRIBUTING 声明当前不接受外部 PR；外部贡献走 GitHub Discussions（bug 上报/特性请求）与社区插件生态，修复以 fork 分支链接的形式附在帖子中。因此本文件的本地补丁登记是当前政策下的稳态实践而非过渡措施——每条补丁的上报状态登记在「已知本地补丁」条目内，上游若在 master 落地对应修复，按同步纪律合并后撤本地补丁。

## Fork 工作流程（2026-08-23 沉淀）

三轮完整交付——draft-keeper（[#3999](https://github.com/deepseek-ai/deepseek-harness/discussions/3999)）、find-in-chat（[#4029](https://github.com/deepseek-ai/deepseek-harness/discussions/4029)）、draft-budget（[#4138](https://github.com/deepseek-ai/deepseek-harness/discussions/4138)）——沉淀的七步工作流程；新帖发布后把 URL 追加进本行。特性 Note 均在 `.agents/notes/implemented/feature/` 下，正文以 `文件名:行号` 引用；提交形状以 hash 引用；仓库无记录的会话级细节标注（交付记录），出处为历次交付汇总与交接提示词。

### 七步流程定义

1. **调研（双源查重 + 评分排序）**：候选题在两个源上查重——社区面（官方 Discussions "Show Your Plugins!" 语料与 awesome 类清单）与上游面（最新 release 与 master 是否已提供该表面：slot、公开服务、设置项）；再按痛点证据强度与自家协同点评分排序取题（先例：draft-budget 的 top-2 gap 评分，`2026-08-23-composer-draft-budget.md:9`）。双源皆空才立项，调研结论与复查日期记入特性 Note 的 Problem 段。
2. **核实（技术未知点逐项钉死）**：调研阶段的每个技术预设核实到 file:line 级证据，允许推翻调研结论——先例：调研以「聊天视图将虚拟化、原生 find 会漏未挂载行」为前提（`2026-08-22-chat-find-in-bar.md:9`），核实确认 ChatView 无 windowing、已加载消息全量挂载、`PAGE_MESSAGES`=50 分页（同文件 :18、:31），虚拟化预设撤销，设计改为覆盖已加载窗口并诚实披露。核实结论须同时确认实现只走官方缝隙；触碰包私有实现的路线触发上方禁改条款，改走 `patches/` 或上游提案。
3. **规格展开（实施提示词七要素）**：动工前把决策写成完整实施提示词，七要素齐备才进入批复：背景与包定位；API 通路消费与不消费清单；行为规格状态机；测试断言清单；MVP 边界与已知取舍；登记面四段式（包 README 与特性 Agent Note 的英中四件，随附 i18n sidecar 与组清单登记）；交付约束（提交序列、门与白名单、发布动作）。
4. **人工批复（三个动作）**：维护者对规格定夺点逐一裁决；对可预见的实现分支预授权（预授权范围内的实施不再回头请示）；封堵悬空点（规格未覆盖且未预授权的问题，实施期上报定夺而非自行发挥）。单人维护加 agent 执行的流程里，这是实施前唯一的人工决策点。
5. **实施（四笔主序列 + 门修复跟进）**：按 scaffold → feat(core) → test → docs 四笔主提交推进，三轮先例：`8d507b2ea0`→`d8351fd702`→`26acff319f`→`9ad8bcc9e8`、`b91568cdbd`→`be915f3b77`→`cb1262142c`→`df0a318586`、`1d18c4f1e2`→`8b052b6e73`→`f9e6729741`→`3d586cbdc8`；门修复独立跟进一笔（`134593bd79`、`c9cfc288be`、`2baed59f30`），不折进主序列。实现级问题（与已批规格一致、仅实现选择差异）自行修复并在交付汇总记录；设计级偏离（改变规格行为）停止实施上报。全程纪律：零 `any`、零 skip 测试、零新增外部依赖、注册一律 `ctx.effect` 带 teardown。
6. **验收（逐门真实退出码 + 白名单对照 + 自查）**：每个门单独执行并记录真实退出码，禁止管道吞码。Windows 本机已知失败白名单仅三类：symlink EPERM（本机无 symlink 权限）、POSIX 信号/进程树语义失败、负载抖动（隔离重跑可绿）；对照法：把当前失败文件集与白名单基线逐文件比对，白名单外的失败文件必须先归因才能收尾。doc-sync 唯一许可残留是 doc-site 门的 symlink EPERM 环境项。收尾前按验收自查清单逐项核对。
7. **发布（展示帖 + GIF）**：成品按上方贡献政策以官方 Discussions "Show Your Plugins!" 类目发布展示帖，发布前对帖子正文做字节级校验（与定稿一致，防发布工具静默改写），附演示 GIF，发布后把 URL 追加进本节开头先例行。上游若原生落地同类功能，对应插件退役而非竞争（`2026-08-22-composer-draft-persistence.md:41`、`2026-08-23-composer-draft-budget.md:39`）。

### 三轮演进

- **draft-keeper（首轮：流程成型 + 跨机交接极限测试）**：首个走完整七步的交付，四笔主序列形状在此定型。中途遭遇断电跨机交接（交付记录载约 85% 完成时推送了三笔主提交加一笔 WIP 检查点 `5543c13e89`），新机接手把 WIP 检查点改写为干净尾段（docs `9ad8bcc9e8`、`836d616332` + 门修复 `134593bd79`）后强推；该 WIP 原件现存于 `fork-wip-5543c13` 侧枝。
- **find-in-chat（二轮：核实步与预授权机制引入）**：核实步首次执行并推翻调研预设（虚拟化预设撤销，先例见七步第 2 步）；预授权分支机制引入——规格批复时预授权的实现分支，实施期不再回头请示；e2e 排障方法论成型：先列假设清单，再向页面注入最小探针逐项取证，按证据收敛，不盲改实现（交付记录）。
- **draft-budget（三轮：效率面优化）**：调研结果复用——2026-08-22 选题调研的直接结论加 2026-08-23 轻量复查即通过调研步，未重做全量调研（`2026-08-23-composer-draft-budget.md:9`）；lint 门首跑即绿；test 门引入消抖动法：串行跑 + 失败文件集与基线逐文件对比 + 隔离重跑复核（交付记录）；规格批复的预授权三项全部落地、零悬空上报（交付记录）。

### 可复用方法惯例

- **探明-钉死-记录**：对环境相关行为，先写最小探针查明实际值，再把查明值钉死为条件断言，最后把探明结论记入文档。两次应用：find-in-chat e2e 对 chromium 高亮注册表行为的探查（交付记录）；draft-budget e2e 对 replay 适配器无路由容量的探查——chip 落位 `data-draft-budget="tokens"` 被钉为断言（`2026-08-23-composer-draft-budget.md:22`）。
- **演示层承接断言层证据**：自动化断言因环境构造覆盖不到的面（无稳定选择器、replay 适配器能力受限），改由演示 GIF 承接证据并明示承接关系。先例：draft-budget 全分支（百分比）算术由单测钉死，e2e 按构造只走 tokens-only 分支，全分支的真实呈现由 #4138 帖 GIF 承接（`2026-08-23-composer-draft-budget.md:22`，交付记录）。
- **契约测试防漂移**：镜像上游公式时，契约 spec 经包的子路径导出（`./src/*`）导入上游真实实现对拍代表性语料，上游改公式在下一次同步即 fail——draft-budget 的 `estimateMessage` 对拍（`2026-08-23-composer-draft-budget.md:15`）。
- **test 门归因法**：门失败先归因再处置：串行跑消并行抖动；失败文件集与白名单基线逐文件对比；同家族互换判定（失败从 A 文件移到同族 B 文件视为同一问题，不新增归因项）；隔离重跑复核负载抖动（交付记录）。
- **交付汇总披露纪律**：交付汇总必须披露三类偏离，缺一即视为验收未完成：计数偏离（提交数/断言数与规格不符）；分支证据（预授权是否按授权范围执行）；duplication 判定（克隆检测命中及豁免理由）（交付记录）。
- **实施期修正并入未推送提交**：主序列尚未推送时，实现级修正 amend 进对应主提交，保持提交分界与规格段落一致；已推送后一律新起提交。唯一改写已推送历史的例外是接手他人未收尾的 WIP 检查点（见三轮演进 draft-keeper 条），且必须走侧枝备份 + 强推。
- **门修复独立成笔**：验收阶段暴露的门失败，修复独立成提交、不折进主序列——先例 `134593bd79`（oxlint）、`c9cfc288be`（gate suite）、`2baed59f30`（slot-catalog 再生成）。

### 跨机协作惯例（2026-08-23 新增先例）

- **会话上下文不迁移**：agent 会话存储是本机状态，不跨机；接手依赖三件套——git 状态对齐（仓库对象是唯一事实）、仓库文档（本文件与各 README/Agent Note）、交接提示词（任务定义与流程骨架）。
- **WIP 孤儿提交处置**：接手发现被改写历史孤儿化的 WIP 提交时：先核实其产物是否已被新历史取代（`git cherry` 补丁等价性 + 产物在位核对），再侧枝备份后 `git reset --hard origin/master` 对齐基线；reset 属破坏性操作，必须维护者批复后执行。先例：`fork-wip-5543c13` 侧枝保有 `5543c13e89`，master 对齐 `2baed59f30`（2026-08-23 华为机接手实例）。
- **新机背景恢复六步**：定位/克隆仓库 → remote 审计（origin=fork、upstream=官方）→ 状态对齐（未提交改动先停止报告；HEAD 与 origin/master 不一致时报告差异、禁止擅自 reset）→ 基线核实（预期基线提交在位）→ 环境与完整 build（node/pnpm 版本核查、install、`pnpm run build` exit 0）→ 读本文件与 `packages/extensions/README.md`。

## 已知本地补丁（fork 对上游文件的直接修改）

- **token-meter compaction 用量修复**（commit `016d287703`）：`packages/llm/token-meter/src/usage-projection.ts`（tokenUsage `stateVersion` 1→2、`compaction/summary` 用量全额累计分支）+ 同包 `token-usage-projection.spec.ts` + token-meter README×3 + `packages/client/connection/src/client/fixture.ts` 镜像分支。已核实 `b150a551b8` 不含此修复；状态：已上报 Discussions [#1886](https://github.com/deepseek-ai/deepseek-harness/discussions/1886)（评论 [discussioncomment-18113603](https://github.com/deepseek-ai/deepseek-harness/discussions/1886#discussioncomment-18113603)，与既有 fork 实现 63688b0 语义对比一并附上；修复分支 `upstream-pr/token-meter-compaction-usage` 已推送 origin）。上游若自行修复，diff 语义等价后撤本地补丁。fixture.ts 在 fork master 上另含 `9dbb6f2f66` 的类型窄化足迹（`dsh-compaction/types` type-only 导入、connection 的 peer+dev 依赖声明、`tsconfig.client.json` 工程引用、lockfile importer 记录）——均为 fork 侧写法偏好，不随上报内容提交（上报内容的 fixture.ts 保留 `as unknown as` 断言，与文件内 `usageSampleOf` 惯用法一致）。
- **InputBar 稳定选择器**：`packages/client/ui-conversation/src/client/skeleton/InputBar.tsx` 的 `data-dsh-composer=""` 单行注入（`global-paste`、`text-file-cards`、`input-history-recall` 经 `textarea[data-dsh-composer]` 定位 composer）。当前与上游的净差仅此 1 行；状态：已上报 Discussions [#3981](https://github.com/deepseek-ai/deepseek-harness/discussions/3981) 请求官方稳定 composer 标记或公开定位 API；采纳前维持单行注入并按上方合并收尾清单必查。
- **web e2e scaffold Windows 修复**：`apps/web/tests/scaffold.ts` 的 `jsonLiteral` 占位符替换（Windows 反斜杠 cwd 裸拼接产生非法 JSON 转义，曾致 25 个 e2e 整文件失败；POSIX 上为恒等变换）；状态：已上报 Discussions [#3983](https://github.com/deepseek-ai/deepseek-harness/discussions/3983)（修复分支 `upstream-pr/windows-e2e-json-escape` 已推送 origin）。
- **slot-catalog 再生成**：`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` 是脚本再生成产物而非手工补丁，与上游的冲突以重新生成解决（见上方同步操作纪律）。

## Fork 课题待办

### UI 插件开关(2026-08-18 评估，暂不启动)

- 现状：设置→插件列表页(`ui-settings-plugin-inventory`)只读，显示启用状态与 Cordis 挂载状态；启停只能改 `packages/bundle/web-app/cordis.patch.yml` 后重启。
- 评估结论：所有可行路线(清单 Remote 加开关动词、boot 组合覆盖表、client boot 清单重组)都要改官方核心包，属 `patches/` 或 upstream 提案级别；收益(省一次改配置)配不上代价(核心补丁 + 每次同步的维护负担)，暂不启动。
- 触发条件：官方长期不做、且 fork 真的频繁需要启停时，按"重启生效 MVP"(设置覆盖表 + boot 时置 `disabled` + 重启提示)以 `patches/` 方式启动；热开关复杂度约其两倍，不作为起点。
- 可随时起草 upstream issue：清单页是官方建的，开关动词是其自然下一步。
