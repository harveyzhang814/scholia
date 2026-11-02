# ADR: Scholia 定位为阅读 + 批注产品，语音批注在 Scholia 内升级

**日期**：2026-11-02
**状态**：已采纳

## 背景

计划做一种新的读法：边读边说，选中文字时说的话经 CocoScribe 转写整理后自动成为这段文字的评论（设计见 [../superpowers/specs/2026-11-02-voice-comments-design.md](../superpowers/specs/2026-11-02-voice-comments-design.md)）。讨论时需要先回答：这是另起一个项目，还是 Scholia 的升级？以及 Scholia 到底是什么。

讨论起点有一个假设——"Scholia 作为插件服务给 agent-canvas 等项目"。核对后不成立：

- agent-canvas 代码里没有任何对 Scholia 的引用、嵌入或调用；它的 markdown 展示用的是独立的 `markdown-preview-core` 包，不是 Scholia。两者唯一的交集是在 Canvas 的 shell 节点里把 Scholia 当普通本地进程启动。
- Scholia 的实际上游是几个内容生产 skill（`learn-video` 的 VDL 目录、`clip-url` 的双语条目、`sync-xtimeline` 的推文归档），Scholia 是它们产出的阅读和批注界面。

## 决策

1. **定位**：Scholia 是本地优先的「阅读 + 批注」产品。核心资产是绑定在原文上的批注（`highlights.json`、`notes.json`、原文里的 sc 标记）；手写和语音是平级的批注输入方式；markdown 渲染交给 `markdown-preview-core`；不对外提供组件，不作为其他项目的插件。
2. **语音批注在 Scholia 内实现**，不另起项目。

## 理由

- 语音评论改变的是正文的输入方式，产出的仍是"锚定在原文上的一条评论"。锚点捕获与定位、`notes.json` 存储与并发锁、原文标记的写入与回退、内嵌/右栏卡片展示全部可以复用。这些恰是 Scholia 最难、边界情况最多的部分（inline-comments 分三期实施，之后又修了 wikilink、公式、行首等多处标记问题）。
- CocoScribe SDK 是 Node 端客户端，必须放在一个本地 Node 进程里中转给浏览器。Scholia 已经是"浏览器 + 本地 Node 服务"的结构，正好匹配。
- 展示层已经拆到 `markdown-preview-core`，其他产品要复用的是展示而不是批注，不存在"Scholia 被别人当插件用"的约束需要照顾。

## 被否决的方案

**另起一个新阅读项目。** 两种做法都不划算：

- 重写锚点、存储、标记这一整套——重复 Scholia 已经付过的成本，且两边批注数据格式迟早分叉。
- 先把这套批注机制从 Scholia 拆成共享包再让新项目依赖——是一次大重构，而目前除了新项目之外没有第二个使用方，拆出来的接口没有第二个使用方来校验。

## 后果

- Scholia 第一次在运行时依赖一个外部 macOS App（CocoScribe.app）。CocoScribe 不在时语音入口必须失效而不影响阅读和手动批注；Scholia 也因此在语音功能上只支持 macOS。
- 多一个 GitHub Packages 私有依赖，且是根目录（服务端）依赖，安装和全局分发的处理比现有前端私有依赖更麻烦（见设计文档"安装与分发"）。
- 如果未来确实出现第二个需要批注能力的产品，再重新评估把批注机制拆成共享包。
