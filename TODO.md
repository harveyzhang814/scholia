# TODO / Backlog

## 🚧 待开发

### 字幕列表虚拟滚动优化
**优先级**: P3 | **日期**: 2026-07-11

`web/src/components/subtitle-list.tsx` 的字幕/转写侧栏无条件把每一段字幕渲染成真实 DOM 节点，不做虚拟滚动。全面设计审查时用一个 811 段字幕的任务实测，滚动容器高度撑到约 88000px。当前长度还撑得住，但首页列表里已经有 6:44:38、3:48:01 这类数小时视频，字幕段数可能上到 3000+，DOM 节点数、初始渲染耗时会随视频变长而线性变差，是个会逐渐恶化的性能隐患。

建议方向：引入 `@tanstack/react-virtual`（项目已用 `@tanstack/react-query`，同生态，且原生支持变长行高的动态测量，适配字幕文本长短不一、换行不固定的场景）。核心改动点：`<ul>` 渲染循环换成虚拟化器给出的 `virtualItems`；现有"滚动到当前播放段"逻辑（`querySelector` + `scrollIntoView`）需换成虚拟化器自带的 `scrollToIndex` API，因为不在视口内的段落没有真实 DOM 节点可查。点击跳转播放、当前段高亮背景色等逻辑不受影响。单文件改动，风险可控。

---

## ✅ 已完成

### 支持读取 task 目录的 meta.json
**优先级**: P2 | **日期**: 2026-07-07 | **完成**: 2026-07-11

`server/video-source.js` 的字段映射本就与预期一致；VDL 侧已于 2026-07-10 补上 `runTask()` finalize 时写出 `meta.json`（含历史任务回填脚本）。今天用真实 work 目录 `/Users/harveyzhang96/Vault/VL/work`（40+ 个已完成 task）跑通端到端验证：`scholia serve --open` 后任务列表正确渲染标题/来源/时长，详情页字幕/播放器均正常加载，无新增报错。未做代码改动。
