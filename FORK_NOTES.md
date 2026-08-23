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

## Fork 扩展交付流程（七步，2026-08-23 沉淀）

从 draft-keeper（[#3999](https://github.com/deepseek-ai/deepseek-harness/discussions/3999)）、find-in-chat（[#4029](https://github.com/deepseek-ai/deepseek-harness/discussions/4029)）、draft-budget（[#4138](https://github.com/deepseek-ai/deepseek-harness/discussions/4138)）三次完整交付沉淀；每步裁决的理由归各特性 Agent Note，本节只立流程规则。

1. **调研（双源查重）**：选题先在两个源上查重——上游面（最新 release 与 master 是否已提供该表面：slot、公开服务、设置项）与社区面（官方 Discussions "Show Your Plugins!" 语料与 awesome 类清单）。双源皆空才立项；调研结论与复查日期记入特性 Agent Note 的 Problem 段（先例：draft-budget Note 的 top-2 gap 评分）。
2. **技术核实**：确认需求只走官方缝隙即可实现（先例：input-state store 与 `setDraft`、`conversation.composer.dock` 座位、document 捕获监听器）；任何触碰包私有实现的路线（如 `InputMachine`）触发上方禁改条款，改走 `patches/` 或上游提案，不得默默改核心。
3. **规格展开**：动工前把决策写成完整规格——包名与档位（纯浏览器包/双面包/库供给行）、缝隙与注册形状（slot id、order、locale 字典）、行为边界与降级路径、测试计划（单测 + 真浏览器 e2e + invariant 伴生）、双语 README。
4. **人工批复**：规格须经维护者批复后才动工——单人维护加 agent 执行的流程里，这是实施前唯一的人工决策点；未批复的规格不进入提交。
5. **实施（四笔主提交 + 门修复）**：按 scaffold → feat(core) → test → docs 四笔主提交推进；门修复与 slot-catalog 再生成各自独立成提交（先例：`134593bd79`、`c9cfc288be`、`2baed59f30`），不折进主提交。全程纪律：零 `any`、零 skip 测试、零新增外部依赖、注册一律 `ctx.effect` 带 teardown。
6. **验收（逐门真实退出码 + 基线失败文件集对照）**：每个门单独执行并记录真实退出码，禁止管道吞码。Windows 本机已知失败白名单仅三类：symlink EPERM（本机无 symlink 权限）、POSIX 信号/进程树语义失败、负载抖动（隔离重跑可绿）；对照法：把当前失败文件集与白名单基线比对，白名单外的失败文件必须先归因才能收尾。doc-sync 唯一许可残留是 doc-site 门的 symlink EPERM 环境项。
7. **发布（展示帖 + GIF）**：成品按上方贡献政策以官方 Discussions "Show Your Plugins!" 类目展示帖发布，附演示 GIF，发布后把帖子 URL 追加进本节开头的先例列表。上游若原生落地同类功能，对应插件退役而非竞争（draft-keeper 与 draft-budget 两篇 Note 的 Consequences 均载此原则）。

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
