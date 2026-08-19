# 运行时诊断

[English](README.md) | 中文

面向包自有运行时不变量检查的注册设施。组规则:[组](../AGENTS.md)、[根](../../AGENTS.md#conventions)。

| 包 | 职责 |
|---|---|
| [`invariants/`](invariants/README.md) | 可配置的 `InvariantRegistry` 服务(`ctx.invariants`),每个包的 `./invariant` 伴生件都注册其下 |
