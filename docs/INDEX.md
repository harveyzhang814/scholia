# docs/ 文档索引

## tutorials/ — 教程

| 文件 | 用途 |
|------|------|

## how-to/ — 操作指南

| 文件 | 用途 |
|------|------|
| [how-to/markdown-preview-core-integration-handover.md](how-to/markdown-preview-core-integration-handover.md) | agent-canvas 接入 `markdown-preview-core` 的经验交接：依赖方式取舍（直接用 GitHub Packages，跳过 `file:` 阶段）、核心渲染 vs host 数据层的集成边界表、scholia 特有阻塞项（`react-markdown` v9→v10 版本落差、DOM 后处理式高亮批注 `injectAnchorMarks` 未被包支持需实测验证）、React/mermaid 重复模块去重、像素级视觉对比验证方法 |

## reference/ — 参考文档

| 文件 | 用途 |
|------|------|
| [reference/git-workflow.md](reference/git-workflow.md) | 分支命名规范、保护规则与合并流程 |

## explanation/ — 理解类

| 文件 | 用途 |
|------|------|

## adr/ — 架构决策记录

已落地的架构决策，记录决策过程与取舍，不随实现变化而回改。

| 文件 | 用途 |
|------|------|
| [adr/2026-07-20-no-idle-auto-shutdown.md](adr/2026-07-20-no-idle-auto-shutdown.md) | 为什么 `scholia serve`/`start` 不做空闲自动退出 |

## 未分类

| 文件 | 用途 |
|------|------|
| [acceptance-testing.md](acceptance-testing.md) | 发布前人工验收测试清单 |
