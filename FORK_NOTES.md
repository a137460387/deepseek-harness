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

- **fork 新增的浏览器端/Web 端插件包落位 `packages/extensions/`**，不进 `packages/client/`(upstream 持有并持续演进，避免组 README、聚合、清单成为合并冲突面)。每个包自包含：只走官方缝隙(公开服务/slot/捕获监听器)，自带 `./invariant` 伴生件。已有五个先例，分三档：`global-paste`、`text-file-cards`、`input-history-recall` 是纯浏览器包(node half 只是清单空壳，不进任何聚合)；`composer-guards` 是首条纯库供给行——三个共享 composer 谓词经各消费包的 `dsh.client.external` 模块请求供给，自身无任何行为；`usage-stats` 是首个带真实 node half 的双面包——host 侧经 projection 缝隙注册 `usageStats` session projection，因此 tsconfig 拆 host/client 双面、两个根聚合各加一条引用。这类供给行附带一条组合期硬约束：供给行自身无服务、无 UI，仅是消费包经 `dsh.client.external` 按名请求的共享模块，任何组合方挂载任一消费包(当前的 `global-paste`、`text-file-cards`、`input-history-recall`)就必须同时挂载其声明的供给行，否则 client boot 图组装期直接报缺少请求的错误，不会留到运行期才暴露；今后再新增此类共享供给行时，需逐一核对消费包的 `dsh.client.external` 清单，并把供给行同步写进组合(`packages/bundle/web-app/cordis.patch.yml`)。决策记录见 [落位 Agent Note](.agents/notes/implemented/architecture/2026-08-19-fork-ui-extensions-placement.md)。

- **upstream 合并后的固定人工收尾**(两轮实测踩坑)：其一，upstream 的 release bump 不会带动 `packages/extensions/*` 下的 fork-only 包，合并后需人工核对这些包的 `version` 是否仍对齐 root 版本——constraints 门会报不匹配，但不会提示原因是 bump 漏掉；其二，upstream 删除某包后，本地曾构建过该包的话会留下未跟踪的 `lib/`、`node_modules/` 等构建产物残留，跑 `pnpm run clean` 清理(clean 脚本即为此设计)。

- **重新构建 fork 扩展包后必须重启长驻的 `dsh web` 进程**(第二次踩同型坑：8/20 一次是旧进程不刷新新 UI、静默服务旧版本，8/21 一次是浏览器端直接报错)——进程的 client boot 图在启动时固化，而 `/plugins/*/client.js` 路由每次请求都从磁盘现读，旧图配新 bundle 时，消费新供给行(新增或修改了 `dsh.client.external` 模块请求)的包在加载期报"模块表缺失"，浏览器端呈现 "Failed to load plugins" 失败页；该报错文案中的 "build-time externals drift" 措辞有误导性——实际是进程比磁盘产物旧，与构建配置无关；排查：用 netstat 定位监听目标端口的 PID 并核对其启动时间是否早于本次改动，是则停掉旧进程重启。

## Fork 课题待办

### UI 插件开关(2026-08-18 评估，暂不启动)

- 现状：设置→插件列表页(`ui-settings-plugin-inventory`)只读，显示启用状态与 Cordis 挂载状态；启停只能改 `packages/bundle/web-app/cordis.patch.yml` 后重启。
- 评估结论：所有可行路线(清单 Remote 加开关动词、boot 组合覆盖表、client boot 清单重组)都要改官方核心包，属 `patches/` 或 upstream 提案级别；收益(省一次改配置)配不上代价(核心补丁 + 每次同步的维护负担)，暂不启动。
- 触发条件：官方长期不做、且 fork 真的频繁需要启停时，按"重启生效 MVP"(设置覆盖表 + boot 时置 `disabled` + 重启提示)以 `patches/` 方式启动；热开关复杂度约其两倍，不作为起点。
- 可随时起草 upstream issue：清单页是官方建的，开关动词是其自然下一步。
