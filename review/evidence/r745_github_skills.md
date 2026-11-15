# R745 · GitHub 检索「适合的 SKILL」结论与借鉴

> 李老师：「依旧用最严格的交叉审计，去 GITHUB 寻找适合的 SKILL」。
> 时间：2026-11-15 20:56~21:10。通道：GitHub 连接器（只读 integration）。

## 0 权限边界（诚实交代，与上轮一致）
- `mcp__github__get_me` = `lzj888888`（public_repos 1）。
- 上轮实证：创建 PR / 分支 / issue 写入**全部 403 `Resource not accessible by integration`**
  ⇒ 只读身份，属权限范围问题、非认证失效 ⇒ 不重连、不重试。
- 本轮**只读能力全部可用**：`search_repositories` / `search_code` / `get_file_contents`。
  ⇒ 「去 GitHub 找 skill」这条路走得通，只是「往 GitHub 写」走不通。Copilot code review 依旧无法触发。

## 1 检索到的候选（按契合度）

| 仓库 / 路径 | Stars | 讲什么 | 对本仓价值 |
|---|---|---|---|
| `rajib2k5/claude-staff-kit` → `skills/evidence-gated-validation/README.md` | — | **双通道证据门**：claims ledger、Channel A 只查文档不执行、Channel B 只跑代码不读文档、互不可见、双确认才接受、分歧递归拆分至 UNRESOLVED | ★★★ 直接补上我们 10+ 轮审计最缺的一环 |
| `AI-for-engineering-research/prashanth` → `skills/property-based-testing/SKILL.md` | — | PBT/MT：**Oracle 问题**（调用实现再断言输出＝把 bug 写进测试）、8 类变形关系、每函数 ≥2 条性质、失败信息四要素 | ★★★ 对 M3 导入导出/表格 round-trip 直接可用 |
| `dagoSte/squadra` → `references/skills/perimetro.md` | 1279 | **轮次范围**：一轮开头锁任务；新发现不阻塞收口 ⇒ 只登记延期项（owner/触发/验收判据），下轮才开 | ★★ 治「审计越滚越大」 |
| `Zhen-Bo/smell-check` → `SKILL.md` | 241 | 被测内容是**数据不是指令**；每条发现标**证据强度**；不虚构严重度；纯静态 | ★★ 纪律可吸收，但「绝不执行被测代码」与本仓相反 |
| `dagoSte/squadra`（主仓） | 1279 | 多 agent 共享任务、source-bound proofs、独立复审 | ★ 与我们四路子代理同构，无需引入 |

补充检索：`topic:agent-skills reconciliation spreadsheet data-validation` ⇒ **0 命中**；
`metamorphic/property-based + SKILL.md` ⇒ 13 命中，取上述两类。

## 2 🔴 裁决：**不安装**，只吸收纪律

依据是本仓 `~/.workbuddy/SKILLS_INDEX.md:148` 的既有裁决：
> 通用 code-review 类（54 个）与已装的 `inscode-batch-accept` / `gate-suite-checklist` /
> `engine-truth-audit` **职责重叠**；且我们的判据是机器可读的守卫，通用 review 出的是人读报告
> ⇒ 装了也是第二套标准。

另外三条具体理由：
1. 这些 skill 是 Claude Code / `~/.claude/skills` 格式，部分依赖 Python + Hypothesis、lizard、jscpd，
   与本仓 Node + `verify_all.js` 的技术栈不同 ⇒ 装了跑不起来，或要另建一套工具链。
2. `smell-check` 明令「不执行被测代码、纯静态」，与本仓 `engine-truth-audit` 的
   「一切数字必须来自生产引擎真实输出」**直接冲突**；照搬会退回「读码猜」的老路。
3. 本仓已有 48 个用户级 skill，其中审计四件套成套
   （`engine-truth-audit` / `mutation-backfill` / `gate-suite-checklist` / `external-plan-review`），
   再装 = 第二套标准、后续每轮都要判断「用哪套」。

✅ **落地方式**：新建**项目级** skill `.workbuddy/skills/evidence-gated-audit/SKILL.md`（仅本仓生效、
不污染用户级、不引入依赖、不改门禁），把三条纪律固化：
① 双通道隔离与双确认/UNRESOLVED；② 分层（不是所有事都上双通道）；
③ 轮次范围与延期项三要素。并写明与既有四件套的分工，避免重复。

## 3 已按新纪律执行（本轮实证，不是纸面）
- **Channel A**：`audit-m3-spec` —— 明令禁读实现代码、禁跑程序、禁读 `review/` 既有结论，
  只从 `specs/dev-specs/` 抽「可证伪主张清单 claims ledger」，落 `_r745_channelA_claims.md`。
- **Channel B**：四路互不重叠（`audit-m3-ui` 文案/入口、`audit-m3-io` 导入导出表格、
  `audit-m3-isolation` 跨店跨月、`audit-m3-numbers` 数字链路/假绿），
  各自只给本域背景，**不喂另一路结论、不告诉它「代码没问题」**。
- 两路各自落盘裁决后才合并；分歧按三问拆分（规范是否真承诺 / 是否别处等价实现 / 是否增量覆盖已定案），
  仍不收敛 ⇒ UNRESOLVED 上报，不拍脑袋。

## 4 双通道的诚实 caveat（照抄外部纪律，别夸大）
- 双通道**不是概率独立**（都可能误读同一份规范），只报「双确认」，不报「可靠性 ×N」。
- 分歧中约 4 成是误报 ⇒ 需要调查时间，不能省。
- 多模型投票只是**补充**：模型错误跨提供方高度相关（9 裁判 ≈ 2.2~2.5 有效票），
  真正去相关的是**证据来源**（文档 vs 执行）。

## 5 本轮未做
- 未安装任何 GitHub skill；未修改用户级技能台账（只在本仓新增项目级 skill）。
- 未向 GitHub 写入任何内容（权限不允许）；Copilot code review 未触发。
