# TODO / Backlog

## 🚧 待开发

---

## ✅ 已完成

### 支持读取 task 目录的 meta.json
**优先级**: P2 | **日期**: 2026-07-07 | **完成**: 2026-07-11

`server/video-source.js` 的字段映射本就与预期一致；VDL 侧已于 2026-07-10 补上 `runTask()` finalize 时写出 `meta.json`（含历史任务回填脚本）。今天用真实 work 目录 `/Users/harveyzhang96/Vault/VL/work`（40+ 个已完成 task）跑通端到端验证：`scholia serve --open` 后任务列表正确渲染标题/来源/时长，详情页字幕/播放器均正常加载，无新增报错。未做代码改动。
