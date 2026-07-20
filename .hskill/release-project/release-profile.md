# Release Profile
<!-- 由 project-release skill Init 阶段生成，可随时手动编辑 -->
<!-- 生成时间：2026-07-20 -->

## 分支模型

```
master (生产，受保护，禁止直接提交)
  ← staging (集成/预发布，受保护，禁止直接提交)
```

发版**不单独切 release/x.y.z 分支**，版本号改动通过 `chore/release-x.y.z` 分支提交后合并进 `staging`，然后合并 `staging → master` 并在 `master` 上打 tag。

> `staging` 也受 pre-commit hook 保护，**不能在 staging 上直接提交**，即使是发版这种改动也必须走 `chore/*` 分支再合并。这是 Init 阶段最初遗漏的一点，Execute 时被 hook 拦截才发现。
>
> workflow-config.yml 中 `master.merge_from` 同时允许 `release/*`，为可选的热修复通道（见 docs/reference/git-workflow.md 的「紧急热修复」FAQ），日常发版不使用。

标准流程：

```bash
git checkout staging
git pull
git checkout -b chore/release-X.Y.Z
# ...更新版本文件、CHANGELOG，提交到 chore/release-X.Y.Z...
git checkout staging
git merge --no-ff chore/release-X.Y.Z -m "chore: merge chore/release-X.Y.Z into staging"
git push origin staging

git checkout master
git pull
git merge staging          # --no-ff（仓库配置了 merge.ff false）
git tag -a vX.Y.Z -m "vX.Y.Z"
```

## 版本文件

按以下顺序更新，两个文件版本号必须保持一致：

1. `package.json` — 根包版本，直接编辑 `"version"` 字段
2. `web/package.json` — 前端子包版本，直接编辑 `"version"` 字段（历史上曾独立演进，但此后与根版本同步）

无 lockfile 版本号需要单独处理（`package-lock.json` / `web/package-lock.json` 由 `npm install` 自动同步，发版脚本不手动改）。

## 发布方式

不发布到 npm registry（package.json 无 `publishConfig`/`private` 字段，且无 `.github/workflows` CI）。发布产物只有两样：

1. **git tag**（`vX.Y.Z`，annotated，规则见 `.hskill/init-workflow/workflow-config.yml` 的 `tags` 节）—— 本地打好后由用户手动 `git push origin vX.Y.Z`
2. **本地全局安装**，供用户自己使用：
   ```bash
   npm run release:local   # npm pack + npm install -g scholia-X.Y.Z.tgz，装完自动清理 .tgz
   ```
   此步骤由用户在确认 tag 推送后自行执行，release skill 不代为执行。

## 特殊规则

- **发版前检查**：在 staging 分支提交版本改动前跑一遍测试，全部通过再继续：
  ```bash
  npm test                 # 后端测试
  cd web && npm test       # 前端测试（vitest run）
  ```
- **CHANGELOG.md**：本项目此前没有 CHANGELOG，从 0.2.0 这次发版开始新建，使用 [Keep a Changelog](https://keepachangelog.com/) 格式：
  ```markdown
  # Changelog

  All notable changes to this project will be documented in this file.

  The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

  ## [Unreleased]

  ## [0.2.0] - 2026-07-20
  ### Added
  - ...
  ```
  每次发版：把 `[Unreleased]` 下的条目移到新的 `[X.Y.Z] - YYYY-MM-DD` 区段下，并在文件顶部保留一个空的 `[Unreleased]`。条目分类沿用 Keep a Changelog 的 `Added` / `Changed` / `Fixed` / `Removed` 等小节，没有对应类型的小节就不写。
- **commit message**：遵循 Conventional Commits（`workflow-config.yml` 已强制），版本改动提交建议用 `chore(release): bump version to X.Y.Z`。
- **tag message**：`vX.Y.Z`，annotated（`git tag -a`），message 可以是 `vX.Y.Z` 本身或简短的版本摘要。
- **不做**：不创建 `release/*` 分支、不推送、不执行 `npm run release:local`、不执行任何 npm publish —— 这些交给用户在本地确认后手动完成。
