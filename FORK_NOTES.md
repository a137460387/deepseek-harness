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

## Fork 课题待办

### UI 插件开关(2026-08-18 评估，暂不启动)

- 现状：设置→插件列表页(`ui-settings-plugin-inventory`)只读，显示启用状态与 Cordis 挂载状态；启停只能改 `packages/bundle/web-app/cordis.patch.yml` 后重启。
- 评估结论：所有可行路线(清单 Remote 加开关动词、boot 组合覆盖表、client boot 清单重组)都要改官方核心包，属 `patches/` 或 upstream 提案级别；收益(省一次改配置)配不上代价(核心补丁 + 每次同步的维护负担)，暂不启动。
- 触发条件：官方长期不做、且 fork 真的频繁需要启停时，按"重启生效 MVP"(设置覆盖表 + boot 时置 `disabled` + 重启提示)以 `patches/` 方式启动；热开关复杂度约其两倍，不作为起点。
- 可随时起草 upstream issue：清单页是官方建的，开关动词是其自然下一步。

### 多模态模型配置(2026-08-18 探针结论)

- `llm-deepseek` 适配器对所有 DeepSeek 模型写死 `inputModalities: ['text']`，与网关实测一致(deepseek-v4 全系返回"不支持 vision")，属如实声明，不要改。
- 视觉模型走 `llm-pi-ai`：在 `$DSH_HOME/settings.yaml` 的模型条目声明 `input: [text, image]` 即过 host 门禁(热加载，无需重启)；网关不暴露模态信息，只能实测。
- 探针方法：向网关发 1×1 base64 图，按响应分类；注意"尺寸过小/最小 N 像素"类错误=视觉通道可用(脚本 `%TEMP%\probe-vision.ps1`)。
- 2026-08-18 实测(OpenAI 协议侧)：视觉可用 = qwen3.8-max、kimi-k2.5/k2.6/k2.7-code、mimo-v2.5、seed-2.1-pro/turbo；不可用 = deepseek-v4 全系、glm-5 全系、minimax-m2.5/m2.7、mimo-v2.5-pro、qwen3.7-max；`lgyu-anthropic` 路由未测。
