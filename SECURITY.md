# 安全策略

本文件规定本仓库的漏洞报告政策。它与 [SECURITY_ADVISORY.md](SECURITY_ADVISORY.md) 是两回事:后者是已发布的安全通告,记录已公开且已修复的缺陷;本文件只规定往哪报、报什么、可预期什么。

## 支持范围

本仓库是个人维护的 fork(见 [FORK_NOTES.md](FORK_NOTES.md)),安全支持仅覆盖:

- fork 自有代码:`packages/extensions/` 下的扩展包等本仓库新增文件;
- 根目录交付文档与部署配方:如 [DEPLOY_TUNNEL.md](DEPLOY_TUNNEL.md)。

## 不在本仓库报告的问题

属于上游原版代码的缺陷,请直接报告上游仓库 https://github.com/deepseek-ai/deepseek-harness ,不在本仓库报告。归属口径:`packages/` 下非 extensions 的包与上游文档均属上游;边界存疑时先查 FORK_NOTES.md 的「已知本地补丁」账本。

## 报告渠道

由于本仓库是 fork，GitHub 不支持在其上启用私有漏洞报告功能。本仓库暂无原生的私密报告通道，以下为可用渠道：

- **上游代码漏洞**：请前往上游仓库 `deepseek-ai/deepseek-harness` 的 Security 页面，用其私有漏洞报告功能报告（若上游已启用）。
- **本 Fork 专属代码漏洞**：
  1. 请先在本仓库提一个公开 Issue，标题写“Security report request”，正文**只写“我在某文件发现了疑似安全漏洞，请求私下沟通渠道”，不要写任何漏洞细节或可复现步骤**；
  2. 仓库维护者收到 Issue 后会回复一个临时的私密联系方式（一次性邮箱或加密渠道）；
  3. 报告者通过该私密渠道发送完整漏洞详情。

这样做的目的：既不暴露维护者真实邮箱，又确保漏洞详情不进入公开记录。

## 报告前

已公开且已修复的缺陷先看 [SECURITY_ADVISORY.md](SECURITY_ADVISORY.md),勿重复报告。未公开缺陷一律走上述私有渠道,请勿在公开 Issue、讨论或帖子中描述细节。

## 响应预期

个人维护,尽力 7 天内确认收悉,无 SLA 承诺。修复后的披露以 SECURITY_ADVISORY.md 发布为准。
