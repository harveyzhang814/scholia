# TODO / Backlog

## 🚧 待开发

### 支持读取 task 目录的 meta.json
**优先级**: P2 | **日期**: 2026-07-07

当前 `video-source.js` 的 `listVideos` 和 `getVideoTask` 依赖 `<taskId>/meta.json` 识别任务，读不到则静默跳过。VDL 目录实际不生成此文件，导致前端显示空列表。需在 `server/video-source.js` 中支持读取 `meta.json`（VDL 补齐后）：确保字段映射（`title`、`uploader`、`duration`、`url`、`ts`）与 `listVideos` / `getVideoTask` 返回结构一致。可与 Video-Learner 侧生成 meta.json 的任务配套落地。

---

## ✅ 已完成
