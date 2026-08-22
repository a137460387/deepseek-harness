# extensions/：agent（智能体）修改自身运行时，外加 fork UI 扩展

[English](README.md) | 中文

agent 修改自身运行时：检查已加载的插件与服务接口、定义并运行模型编写的动态包（dynamic package）并再次撤下，外加受限 repository Plugin 运行时。两个浏览器半的包住在这里而不是 `packages/client/`，因为它们是本子系统双半包的其中一半；host 聚合把它们排除在外，让两个契约面各自保有独立的编译 program。设计居所：[工具集 Agent Note](../../.agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.zh.md)。

本组还承载 fork 的 Web UI 输入扩展：自包含的浏览器半插件包，只走官方缝隙（[落位 Agent Note](../../.agents/notes/implemented/architecture/2026-08-19-fork-ui-extensions-placement.zh.md)）；它们不进 `packages/client/`，把 upstream 合并面收敛到本 README。

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`tool-cordis/`](tool-cordis/README.zh.md) | `cordis_inspect`／`cordis_define`／`cordis_run`／`cordis_stop`／`cordis_undefine` 工具：读取当前进程运行时，并在一个自有分组 fiber 下管理内存中的动态包 | 注册到 `ctx.tools` |
| [`cordis-host-runner/`](cordis-host-runner/README.zh.md) | 定义注册表、host 半的 `node:vm` 沙箱，以及 request-run 往返 | 提供 `ctx.dynamicCordisRunner` |
| [`cordis-client-runner/`](cordis-client-runner/README.zh.md) | 双半包的浏览器半：把定义求值成活的浏览器插件，并应答运行请求 | client 面；提供浏览器侧 `ctx.dynamicCordisRunner` |
| [`ui-cordis/`](ui-cordis/README.zh.md) | 浏览器面：操作全部定义的全局面板，与只读的 define 卡片 | client 面；注册 slot |
| [`global-paste/`](global-paste/README.zh.md) | fork：全页粘贴路由——文本走公开 input 服务，图片转发到 composer | client 面；document 捕获监听器 |
| [`text-file-cards/`](text-file-cards/README.zh.md) | fork：composer 上方的文本文件拖拽暂存卡片，点击展开 | client 面；注册 input dock slot |
| [`usage-stats/`](usage-stats/README.zh.md) | fork：`usageStats` 会话投影之上的使用统计设置页——按路由、按天、按月的 token 数量 | 双面；注册投影单元与 settings-section slot |
| [`input-history-recall/`](input-history-recall/README.zh.md) | fork：composer 的 ArrowUp/ArrowDown 历史召回——翻当前会话已发送消息，退出遍历时恢复进入前草稿 | client 面；document 捕获监听器 |
| [`draft-keeper/`](draft-keeper/README.zh.md) | fork：按会话把 composer 草稿镜像进 localStorage，重载后恢复纯文本 | client 面；input 状态订阅 |
| [`composer-guards/`](composer-guards/README.zh.md) | fork：上方各输入插件以模块表行请求的共享 composer 谓词（可见性探测、会话锁、可编辑 input 解析） | client 面；经 `dsh.client.external` 的库行 |
