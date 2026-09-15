# REVIEW_2026-09-15 round4 · 复核（R12–R22 全落地确认 + 剩余 1 项漏做）

> 复审方：`miniprogram-code-reviewer`（3080 唯一复审窗口）。轮次：**第 4 轮**。
> 用户口令：「已落盘」。**新开文件**（协议 §2）。
> 上游：`REVIEW_2026-09-15_round3-batch1.md`（R19–R22）+ `..._round2-verify.md`（R12–R18）。

---

## §0 结论

**这一轮是真的落地了** —— `R12–R22` 我逐条用**自己的方法**复测通过，且**已推送**（`origin/dev = 879eb8a`，工作区干净，两份 review 已入库）。
剩下的只有 **1 项漏做**（裁决① `app.json`）、**1 项随你裁决的连带改动**（投喂包 `targetMonth`）、**3 个 🔵**。

**最要紧的一条**：我第 3 轮设的那个验收判据 —— **「`+1 分` 变异必须把第 9 条锚点打红」—— 达成了**（见 §1 R19）。

---

## §1 逐条复测（我的方法 / 结果）

| 条 | 我的复测方法 | 结果 |
|---|---|---|
| **R19** 🔴 | 把**新** `service.js`+`selftest.js` 拷到会话工作区，**自己重做两个变异**（① 🔵全要素末步 `+1 分` ② 🟢经营参考改用倒轧破锁），跑**它自己的** selftest | ✅ **基线** exit=0（`12/12 锚点 + 2 项自洽断言`）；**变异①** exit=1，**失败锚点 = [6, 9, 12]**（第 9 条**终于转红**）+ 断言B 报三场景不一致；**变异②** exit=1，锚点 8 红 + **断言A 破锁**。⇒ 判据真的有鉴别力了 |
| **R20** 🔴 | 直接读 `core/10` 与 `index.js` 对字段 | ✅ `:43` 已改为实现的真实形态（`shop_id`/`income_items[{amount_fen}]`/`direct_consume_fen`/`inventory{*_fen}`/`client_request_id`）；`:8-10` 三条硬声明；`:46` `calcAmortize`=`{ asset, target_month }`；`:80` `calcSandbox` 也回「分」；`:139` 明确「本表第 1~7 章 = 契约层形态，**禁止**以"前端调用形态"留存 camelCase」。全表字段我已逐行看过：**入参/出参字段均为 snake_case** |
| **R21** 🔵 | `verify_all.js` 静态核对 + **逐个跑 9 个套件** | ✅ `SUITES` = **9** 项且含 `batch1 代码自测`（`:24`）；`:3` 注释同步为 9、`:5` 加了「增删须同步数量」。⚠️ **`verify_all` 端到端在我这沙箱跑不了**（`spawnSync … EPERM` → 它自己报 `0/9`，是**沙箱假象不是产品失败**，见 §4）；我改为**逐个跑**：门禁 A–L / verify_seed_data / test_poc1(12) / test_poc2(16) / test_poc3(15) / test_poc4(14) / batch0(20) / batch1(12+2) / 静态路径检查 → **9/9 全 exit=0** |
| **R22** 🔵 | 读 `service.js:128` | ✅ 死三元已删，改 `return String(fen / 100);`，并留了沿革注释 |
| **R12** 🔴 | **独立**用 `python-docx` 结构化提取（段落+表格单元格，跨 run 合并）扫三份 docx | ✅ 旧串 `A7 成立`/`9 个 unique`/`__probe`/`判据④唯一未完项`/`第 14–15 行`/`env.js:14-15`/`8 套件` **三份全 0**；新串 `39 条索引`/`probe_tmp` 在位。Runbook 残留的 2 处 `touristappid` 我逐行看过 = **合法**（`:54` 新措辞「若哪天退回 touristappid 才需替换」+ `:56` 判据「不等于 touristappid」）。三份 `.pdf` 已重生（16:37~16:38，624/487/515 KB） |
| **R14/R15/R16/R17** | 全树 `.md+.txt+.js` 扫旧串 | ✅ `判据④唯一未完项`/`第 14–15 行`/`未完成（待你建环境后替换`/`AppID 还是 touristappid`/`AppID 是 touristappid`/`8 套件`/`8 个套件` = **全 0**；Runbook `:39` 的 `三悬案` 是**改后新句**（「三悬案已于 … 答完」）不是残留 |
| **R18** 🔵 | 读门禁源码 + 哈希比对 | ✅ `DOC_PAIRS` = 3 项（含 `下一步工序清单`）；`:558` 改为 `DOC_PAIRS.join(' / ')` 不再写死；三对 `.md ≡ .txt` **哈希全等** |
| **流程** | `git` | ✅ `origin/dev = 879eb8a`（**已推**，无未推提交）；工作区干净；`review/REVIEW_2026-09-15_round2-verify.md` 与 `..._round3-batch1.md` **已入库**；本轮回执**追加在复审文件末尾**（前缀比对：只追加 ✓） |

**给你（WorkBuddy）记一功**：本轮回执把「变异脚本必须自证变异生效」也照做了，而且用 `python-docx` 结构化提取替代我上一轮的"剥 XML"（我原方法只能证"有"不能证"没有"）—— 这个替代比我的做法更硬。

---

## §2 待办（R23 顺延）

### R23 🟡 裁决①（删 `app.json` 的 `projectConfig`）**没做** —— 本轮唯一漏项

- 证据：`app.json` 末尾仍是
  ```
  "projectConfig": {
    "appid": "touristappid"
  }
  ```
- 我在 round2 §1.5 **裁决过**：**删掉整个 `projectConfig` 块**（实证：真 AppID 已生效 —— 9/14–9/15 云端部署跑通 ⇒ 该字段是惰性的；删它只移除"同一事实的第二处副本"）。本轮 R12–R22 清单里没有它，所以漏了。
- **修法**：删 `app.json:13-15` 整块；删后在**微信开发者工具编译一次**确认（这一步我核不了，须你或李老师实测）。
- **验收**：`Select-String app.json -Pattern "projectConfig"` → 0；开发者工具编译无错。

### R24 🟡 投喂包 `targetMonth` → `target_month`（**我的裁决：改**，见 §3-①）

- 证据（**我先把范围查清楚了，别照我上一封草稿的"5 处"改**）：全 8 批投喂包 MD 里，camelCase **只有 2 行**：
  - `inscode喂投包_8批_自包含完整版.md:134`「**前端 JS / WXML 绑定**：一律 `camelCase`（`expireAt`、`clientRequestId`、`planId`、`cardCode`）」→ **合法，不许动**（它就是讲前端形态的）；
  - `inscode喂投包_8批_自包含完整版.md:298`「实现 `calcAmortize(asset, targetMonth)`」→ **契约级，改成 `target_month`**（`core/10:46` 已改）。
- **必须连带的动作**：改完 **MD 单源**后**重跑 `python specs/dev-specs/delivery/_gen_8batch_html.py`** 重生 8 份 `.txt` + `inscode喂投包_8批_一键复制.html`（否则门禁 **K3/K10** 会点名「派生件落后」—— 这正是 D4/D7 复发过两次的地方）。
- **验收**：`git grep -n "targetMonth"` 在 `delivery/` 下 → 0；门禁 exit 0（K 组绿）；8 份 txt + HTML 与 MD 逐字一致。

### R25 🔵 `core/10:18` 残留一个 camelCase：`pageSize` → `page_size`

- 证据：`:18`「**分页**：列表类入参 `{ page, pageSize }`」，而**同文件** `:107`/`:110` 用的是 `{ … page, page_size }`；且 `:8/:9` 刚立下「本表一律 `snake_case`，不列小驼峰」。
- 修法：`:18` 改 `page_size`。**验收**：该文件搜 `pageSize` → 0；门禁 exit 0。

### R26 🔵 派生链与工具链前提**没有写进任何文档**（0 命中）

- 证据：全仓库 `.md/.txt` 搜 `python-docx` / `pywin32` / `md2docx_portrait` / `docx2pdf` → **全部 0 命中**。
  也就是说：**「`.md` 改完怎么重生 `.txt`/`.docx`/`.pdf`」这件事，目前只存在于本轮回执和你的脑子里**，换台机器/换个会话就丢（R12 这轮你恰好踩到"环境原本没装 python-docx"）。
- 修法（两件）：
  1. 把**派生链与前提**写进 `★知识存储点 §10 关键环境`：`.md` →（`cp`）`.txt` →（`python tools/md2docx_portrait.py`，需 `pip install python-docx`）`.docx` →（`python tools/docx2pdf_word.py`，需 `pip install pywin32` + 本机 Word；**一文件一实例**，中文文件名先走临时英文路径）`.pdf`；并注明 **`*.pdf` 在 `.gitignore` 里、不入库**。
  2. 把本轮的 **docx 内容校验脚本**从 `%TEMP%` 固化到 `tools/verify_docx.py` 并入库 —— 它是 R12 这类「派生件装了旧结论」的唯一机械化防线（`%TEMP%` 会被清、也不是 git 资产；本项目已经吃过一次「资产游离在 git 外 → 跨回合消失」的亏）。
- **验收**：`git grep -n "md2docx_portrait" -- "specs/"` ≥1；`tools/verify_docx.py` 存在且 `git ls-files` 可见；跑它三份 docx 旧串 0。

### R27 🔵 裁决：`index.js` 标量金额的"字符串数字"宽容度（**我的裁决：收紧**，见 §3-③）

---

## §3 对回执三个提问的裁决

### ① `delivery/批次2` 的 `targetMonth` —— **改**（方向：以契约表为准）
理由：`core/10` 现在已把「契约层一律 snake_case + 金额分」写成硬声明（`:8-10`、`:139`），而 `target_month` 是该表当前值；批次 2 **尚未投喂**，此刻改成本最低。
⚠️ 同时提醒：**不要顺手把 `:134` 那行的 camelCase 也改了** —— 那行讲的就是「前端 JS/WXML 一律 camelCase」，改它反而会把规范改错。（我自己也犯过同类的越界 sweeping，这次专程把范围核清了才给结论。）

### ② `.pdf` 出法 —— **接受你的定案**，并**要求写进文档**（并入 R26）
`.md → .docx（md2docx_portrait.py，需 python-docx）→ .pdf（docx2pdf_word.py，需 pywin32 + Word，一文件一实例）`。
「一文件一实例」「中文名先走临时英文路径」这两个坑**必须写进 §10**，否则下一个人照直连做三份必崩（你已实测过）。

### ③ 标量金额收 `"100"` 字符串 —— **收紧**
- 裁决：把 `index.js` 标量金额校验的 `f()` 收紧为 **`typeof v === 'number'`**（配 `Number.isInteger`），字符串一律 `INVALID_PARAM`；并在 `core/10:50` 的注里补一句「**金额字段必须是 JSON number（整数分），字符串会被拒**」。
- 理由：① 云函数入参本来就是 JSON，`wx.cloud.callFunction` 会把 JS number 序列化成 JSON number，**合法的 number 不会因此被拒**；② 收字符串等于**静默掩盖前端 bug**（表单 `<input>` 的原生值就是字符串，前端漏了 `Number()` 转换就会一路"看起来正常"），与本项目「响亮失败优于静默漏检」一致 —— 同族的 `amount_fen` 双收你本轮已经收紧了，标量是同一个洞的另一半。
- 反面权衡（供你/李老师推翻）：若批次 4 前端图省事直接透传表单值，收紧后会立刻报错。**但那是好事**：错误出现在开发期、而不是账目里。
- 验收：`calcMonthlyProfit` 传 `direct_consume_fen: "100"` → 返回 `INVALID_PARAM`；传 `100` → 正常；把这条加进 `selftest.js` 或一个 4 行的入参用例里（**别再只留"我们讨论过"**）。

---

## §4 能力边界（本轮）

- **`verify_all` 端到端我跑不了**：`spawnSync … EPERM`（沙箱禁管道型子进程）⇒ 它在我这儿恒报 `0/9`。**这不是产品失败**，我把 9 个成员**逐个单独跑**作为替代证据（9/9 exit=0）。你回执里的 `9/9 PASS` 我无法直接复现，但**结论已被逐成员验证支持**。
- **远端 push 我核不了**：`git ls-remote` 超时；`origin/dev = 879eb8a` 是**本地远端引用**，我按"WorkBuddy 从本仓推送"这一前提采信（前几轮该引用都随提交前进，故可信度高）。
- **开发者工具行为核不了**（R23 删块后能否编译）；**Word/PDF 呈现核不了**（我只核了 docx 文本层的旧串/新串与 pdf 文件存在性、大小、mtime）。
- **`.docx` 我这次用的是 `python-docx` 结构化提取**（比 round3 的"剥 XML"强），但仍**不是像素级复核**。

## 附 · 本轮我的方法论自检

- 上一轮我踩过「变异脚本 CRLF 不匹配 → 没生效却跑绿」的坑；本轮**先 `if(out===src) exit(9)` 自证变异写入**，再跑判据（输出里那两个 `✅ 两个变异均已确认写入` 就是这道闸）。
- 我上一封草稿把投喂包的 camelCase 写成「5 处 / 3 文件」，**核上下文后发现 `:134` 是合法的前端绑定示例**，真问题只有 `:298` 一处。⇒ **纪律重申：sweeping 出的命中必须逐条看上下文再定性，"命中数"不是结论。**
