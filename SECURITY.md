# 安全策略

本文件规定本仓库的漏洞报告政策。它与 [SECURITY_ADVISORY.md](SECURITY_ADVISORY.md) 是两回事:后者是已发布的安全通告,记录已公开且已修复的缺陷;本文件只规定往哪报、报什么、可预期什么。

## 支持范围

本仓库是个人维护的 fork(见 [FORK_NOTES.md](FORK_NOTES.md)),安全支持仅覆盖:

- fork 自有代码:`packages/extensions/` 下的扩展包等本仓库新增文件;
- 根目录交付文档与部署配方:如 [DEPLOY_TUNNEL.md](DEPLOY_TUNNEL.md)。

## 不在本仓库报告的问题

属于上游原版代码的缺陷,请直接报告上游仓库 https://github.com/deepseek-ai/deepseek-harness ,不在本仓库报告。归属口径:`packages/` 下非 extensions 的包与上游文档均属上游;边界存疑时先查 FORK_NOTES.md 的「已知本地补丁」账本。

## 报告渠道

由于本仓库是 fork 仓库，GitHub 不支持在其上启用私有漏洞报告功能。

- **上游代码漏洞**：请前往上游仓库 `deepseek-ai/deepseek-harness` 的 Security 页面报告。
- **本 Fork 专属代码漏洞**：请通过以下两种方式之一报告：
  1. 提交一个公开的 GitHub Issue（请尽量隐去可直接用于攻击的敏感细节）。
  2. 发送邮件至 `a137460387@users.noreply.github.com`（此为 GitHub 官方匿名邮箱，仅仓库所有者可见）。

## 报告前

已公开且已修复的缺陷先看 [SECURITY_ADVISORY.md](SECURITY_ADVISORY.md),勿重复报告。未公开缺陷一律走上述私有渠道,请勿在公开 Issue、讨论或帖子中描述细节。

## 响应预期

个人维护,尽力 7 天内确认收悉,无 SLA 承诺。修复后的披露以 SECURITY_ADVISORY.md 发布为准。
