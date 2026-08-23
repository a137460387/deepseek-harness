# Agent Note: 按审计发现加固 fork 扩展批

Status: implemented

[English](2026-08-23-fork-hardening-batch.md) | 中文

## 问题

一次仓库审计以 file:line 证据核实了 fork 自有包的三个中等缺陷与两个覆盖缺口：text-file-cards 的 expand 处理器对 `entry.file.text()` 无任何防护（`packages/extensions/text-file-cards/src/client/index.ts`），读取被拒会沿 slot inject 路径整体抛出；usage-stats 的补洞把 history 调用被拒、传输抛错、确认缺键三种结果折进同一个 `absentCount`（`packages/extensions/usage-stats/src/client/stats-store.ts`），传输全线失败时会把状态未知的会话渲染成「单元未注册」提示；usageStats 值形状存在三份无同步机制的定义（wire viewSchema、stateSchema 的 quarters、client 手写窄化）。另有：connection fixture 的 compaction 用量镜像分支零测试覆盖；b43d7a8648 拆分 global-paste 时删掉的 drop/expand 边界场景从未按暂存语义重新表达。

## 决策

expand 读取对齐 global-paste `forwardImagePaste` 的 fail-soft 先例——读取隔离为唯一的抛出步骤，被拒即静默放弃展开、卡片保留原处——而非 draft-keeper 的 lifetime latch：单个文件读取失败不应禁用其他暂存文件的展开。

补洞结果分流为 `absentCount`（ok 尾页仍缺键——确认未注册，是分区提示唯一信任的输入）与新增的 `failedCount`（调用被拒或传输抛错——状态未知、永不缓存、下次加载重试）。分区组件的 `absentCount === sessionCount` 判定不变；它现在只可能在零失败时成立。确认缺失本身每次加载都重查而非缓存，因为 host 组合可能在两次打开之间注册该单元。两种错误共用一个计数器，因为没有消费者区分服务端拒绝与传输抛错。

三份形状定义保持三份：在 client 复用 zod schema 会把第一批 zod 字节放进浏览器 bundle，而当前没有任何 client 侧源码引用 zod。改为由形状契约 spec 用同一语料对拍三份定义，并把唯一有意的分歧钉死（窄化容忍桶级多余键——它是图表运算的读取守卫，不是 wire 校验器）。该 spec 首跑即抓到窄化在每一层 record 都接受数组、而两份 schema 均拒绝；窄化现已同样拒绝数组。

fixture 镜像配 usage 契约 spec：同一语料（chunk、同步骤替换、等值重复、新步骤、带与不带用量的 summary）分别过真实 `tokenUsageProjectionDefinition` 与 fixture 的 `tokenUsageOf`，要求日志每个前缀处的 wire 值一致，任一侧漂移都会在下一次同步时变红。`tokenUsageOf` 与 `isUsageStats` 为契约 spec 导出，沿投影定义自身 export-for-spec 的先例。

补回的 drop/expand 场景按暂存语义重写而非照抄被删的 global-paste 用例：读中翻 busy 与读中 unmount 从 drop 期移到 expand 期，e2e 卡片落点场景断言暂存而非内联。审计怀疑的空文件语义反转未复现——拆分前后的守卫顺序与 `TEXT_EXTENSIONS` 完全一致——真实缺口是覆盖，已在两侧钉死：global-paste 侧的放行钉死（它不挂任何 drop 监听）与 text-file-cards 侧的空批次/空内容钉死。

## 备选方案

**expand 读取用 draft-keeper 的 catch+latch。** 否决：latch 在一次存储失败后禁用整个 store，对持久化正确，但会让一个不可读文件阻断其他所有暂存文件的展开。

**三个公开结果计数（缺失、被拒、抛错）。** 否决：下游没有任何消费者区分服务端拒绝与传输抛错；两个计数器已承载全部可观察契约，不引入无用表面。

**client 窄化复用 zod schema。** 否决：浏览器 bundle 当前零 zod 引用，为一个窄化首次引入不值得。

**把确认缺失当完成的补洞一样缓存。** 否决：完成的值是不可变历史，而缺失是 host 事后注册单元即可改变的组合事实。

## 验证

`browser-plugin.client.spec.tsx` 钉住读取被拒 fail-soft、读中翻 busy、读中 unmount、dataTransfer null、空批次、空内容六个行为；`global-paste.client.spec.ts` 钉住 drop 放行；`stats-store.client.spec.ts` 钉住三路分流与缺失重查；`shape-contract.client.spec.ts` 契约三份定义；`fixture-token-usage-contract.client.spec.ts` 按前缀对拍 fixture 镜像并附手算算术用例；`text-file-cards.e2e.ts` 在真实组装浏览器中对 composer 卡片落点暂存。

## 影响

被拒的 expand 读取让卡片原地保留、无提示——重试入口就是卡片本身。`UsageStatsSectionState` 新增 `failedCount`；分区不为它渲染新内容，「未注册」提示现在只认确认缺失。fixture 与形状契约随每次测试运行，镜像在漂移点当场失败，而不是默默分叉直到某次 UI 排查才暴露。
