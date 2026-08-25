# Agent Note: global-paste 与 composer-guards 的守卫分支钉死收口

Status: implemented

[English](2026-08-25-guard-branch-pin-closure.md) | 中文

## Problem

2026-08-25 的只读测试覆盖盘点确认四个同伴包的行为健壮，但钉死密度不均：global-paste 的监听器守卫链有四个未测分支——其中 takeover 面板遮挡守卫是用户可感知路径（审批面板遮住 composer 时的粘贴被静默留给原生处理），零钉死；composer-guards 的四个对称视口比较只钉了两个（左与下）。盘点的结论是：缺口在守卫矩阵，不在行为。

## Decision

纯测试收口——零源码改动，两个包的实现未触碰：

- **global-paste 补四例守卫钉死。**bench 增加两个选项（`occluded` 挂载一个遮挡用兄弟元素，让 `elementFromPoint` 探测返回它而非 composer；`noComposer` 在挂载后移除 textarea），钉死覆盖：无剪贴板数据的粘贴（按浏览器的 `null` 形状构造，而非 jsdom 的 `undefined`）、无 composer 挂载时的粘贴、takeover 面板遮挡 composer 时的粘贴、焦点在 contenteditable 区域时的粘贴（该区域的 `isContentEditable` 以桩补齐，因为 jsdom 未实现它——与 bench 既有的 `elementFromPoint` 与剪贴板构造器同款平台事实桩惯用法）。
- **composer-guards 补齐两个缺失的对称视口钉死**（中心在视口上方、中心在视口右方），各与既有左/下用例同构。

## Alternatives considered

**顺带补盘点列出的其余低价值缺口**（text-file-cards 的 expand 时 scope 失解、input-history-recall 的重复 parent-offline 谓词与多块拼接）。保持不补：盘点评级为理论缺口且性价比差，本轮只收口盘点推荐的部分。

**为遮挡用例重写独立 bench 而非加两个选项。**独立 bench 构造器会重复服务伪造管道；两个布尔选项扩展既有惯用法。

## Consequences

- global-paste 钉死数 23（19+4）：监听器守卫链每个分支都有钉死，包括唯一用户可感知的那条。composer-guards 钉死数 27（25+2）：四个视口比较全部闭合。
- jsdom 平台桩清单新增一项（`isContentEditable` 桩），测试内以平台事实名义具名，不是行为捷径。
- 零源码、零依赖、零组合、零上游文件变化；`.github/` 零触碰不变量与本轮零源码改动边界均维持。
