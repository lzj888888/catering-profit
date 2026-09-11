# 分支与版本策略（落地版）

> 依据：`06_工程治理与运维规范.md` G1~G13。本文件把"规范里的原则"落成"这个仓库怎么用"。
> 适用仓库：`lzj888888/catering-profit`（本机路径 `C:/Users/lzj/WorkBuddy/Claw/catering-profit`）

## 0. 当前仓库现状（重要，先读）

| 项 | 状态 |
|---|---|
| 本地分支 | `dev`（已从 master 建出并 **SSH 推上 origin**；`main` 远程仅保留早期骨架历史，未动） |
| 远程 `origin` | `https://github.com/lzj888888/catering-profit.git` |
| 远程 `main` 分支 | **已存在且有历史**（早期"餐饮毛利核算"骨架，2026-08 前后 push 过） |
| `gh` CLI | **本机未安装** |
| PAT | **当前环境不可用**（仅运行时使用、未落盘） |
| inscode 连接器 | **无**（需用户在 inscode 网页登录操作） |

⚠️ **关键结论**：本地 `master` 与远程 `main` **没有共同祖先**。本机已把"店算"全量锁定规范 + POC 归档进 `specs/dev-specs/`，并建立 `dev` 分支（**已 SSH 推上 origin**，作为写码前准备收官资产的归口）；`main` 远程保留早期骨架、受保护，等各批次投喂完成后再统一 PR 合入，期间**不直推 main**。

## 1. 分支命名（与 06 规范一致）

| 分支 | 用途 | 谁来 |
|---|---|---|
| `main` | 受保护主干，**只接收合并**，禁止直推 | 保护由 GitHub 网页设置 |
| `feature/inscode-<模块>-<日期>` | inscode 生成的代码（如 `feature/inscode-M1-20260910`） | inscode（通过 GitHub 同步） |
| `feature/local-<模块>` | 本机 WorkBuddy 直接改的代码 | 本机 |
| `fix/<问题>` | 缺陷修复 | 任意 |

> 当前先建 `main` 本地基线；inscode 接通后，让它往 `feature/inscode-*` 推，你（或我在本机）提 PR 合入 `main`。

## 2. 本机已做的基线（已建 dev 并 SSH 推上 origin）

```
git checkout -b dev              # 写码前准备收官资产归口分支
git add -A && git commit -m "feat: 归档写码前准备收官地基资产 — seed_demo验收套件(41/41)+core/09-14规范+init_db/calcM2原型"
git -c url."git@github.com:".insteadOf="https://github.com/" push -u origin dev   # SSH 推送，remote 配置不动、不留 token
```

`specs/dev-specs/` 已含：
- `core/`：01 架构、02 测试集、03 写码提示词、04 核对清单、05 审计、06 工程治理、09 统一错误码、10 云函数契约、11 微信审核、12 云开发配额、13 上线查缺补漏、14 种子数据验收规范、Module A/M1/M2/M3 规范、商业化 v1.1/v1.4
- `poc/`：POC1 摊销 / POC2 BOM / POC3 双利润
- `prototype/`：POC 双利润/摊销/BOM 引擎 + M2 沙盘 `calcM2` + `init_db` 建库 + `seed_data`/`verify_seed_data`/`seed_demo` 验收套件（verify 41/41 全绿）
- `i18n/terms.js`：文案 + 错误码映射
- `★知识存储点_2026-09-10.md`（重启键，已同步至 v1.4 现状）、`商业化方案_v1.4_融合版.md`、`BRANCH_STRATEGY.md`、写码手册

## 3. 远程 `main` 保护（你在 GitHub 网页做，3 步）

> 因 `gh` 未装 + 无 PAT，这一步**只能你手动在 GitHub 网页点**。我不会代操作远程。

1. 打开 https://github.com/lzj888888/catering-profit/settings/branches
2. 点 **Add rule** → Branch name pattern 填 `main`
3. 勾选：✅ Require a pull request before merging ｜ ✅ Require status checks（如有）｜ ✅ Do not allow bypassing the above ｜ 点 **Create**

## 4. 本机与远程对接方案（待你决策，二选一）

- **方案 A（保留远程历史）**：本机 `git fetch origin` 后，把 `specs/dev-specs/` 作为新目录合并进远程 `main`（保留早期骨架历史），再 push。
- **方案 B（用本机覆盖）**：确认早期骨架已无用 → `git push --force-with-lease origin main`（覆盖远程）。⚠️ 破坏性，需你明确同意。

> 当前我**不做任何 push**，等你确认方案或由 inscode 自然接管（inscode 同步 GitHub 时通常会自己建结构）。

## 5. 版本号与 tag

- 语义化版本：`v0.1.0`（首个可用 POC 验证版）→ `v0.2.0`（模块打通）→ `v1.0.0`（可提审）
- tag：`git tag -a v0.1.0 -m "..."`，只打在 `main` 已合并的提交上
- 每次发版前：自动备份（见 06 规范）+ 集合回档（云开发仅 7 天，自建 JSON 备份 12 周）

## 6. 密钥与配置铁律

- 云环境 ID、AppID、密钥 **只放环境变量 / 云开发配置**，绝不直接写进 Git
- 金额/限额**读表（`subscription_plan` 等）禁硬编码**
- 环境切换用 `DYNAMIC_CURRENT_ENV`，**禁硬编码 env**
