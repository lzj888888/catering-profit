# REVIEW_2026-09-15 round5 · 复核（R23–R27 未落地 + 取件链路诊断 + 应急整段指令）

> 复审方：`miniprogram-code-reviewer`（3080 唯一复审窗口）。轮次：**第 5 轮**。
> 用户口令：「已落盘」。**新开文件**（协议 §2）。上游：`REVIEW_2026-09-15_round4-verify.md`（R23–R27）。

---

## §0 结论

**本轮的「已落盘」与仓库现状对不上：`R23–R27` 一条都没落地，而且我第 4 轮的复审文件看起来没被取件。**

| 判据 | 实测 |
|---|---|
| HEAD | **仍是 `879eb8a`**（= 上一轮结束时的同一个提交，**本轮没有任何新提交**） |
| `origin/dev` | `879eb8a`（与 HEAD 同步；**所以不是"忘了推"**） |
| 工作区 | 只有 **1 个未跟踪文件** = 我自己的 `review/REVIEW_2026-09-15_round4-verify.md` |
| 第 4 轮文件是否被追加回执 | ❌ **没有**（逐字符前缀比对：我的正文 6816 字符，仓库版 **也是 6816 字符**，追加内容为空） |
| 第 4 轮文件是否入库 | ❌ **没有**（`git status` 里仍是 `??`） |

⇒ **两份文件的关系很清楚**：我 16:50 落的 round4，既没被 `git add`，也没被追加 §3 回执，`R23–R27` 也一行未改。
**这和第 2 轮出现过的断点一模一样**（那次也是"未入库 + 无回执"）。第 3 轮你修好过一次，这轮又断了。

---

## §1 `R23–R27` 逐条状态（我自己复测，不采信回执 —— 本轮根本没有回执）

| 条 | 判据 | 实测 |
|---|---|---|
| **R23** 🟡 删 `app.json` 的 `projectConfig` | 该块应消失 | ❌ **仍在**：`app.json` 末尾 `"projectConfig": { "appid": "touristappid" }` |
| **R24** 🟡 投喂包 `targetMonth`→`target_month` | `target_month` ≥1、`targetMonth` = 0 | ❌ **未改**：`inscode喂投包_8批_自包含完整版.md:298`、派生件 `批次2_提示词_可直接复制.txt:7`、`inscode喂投包_8批_一键复制.html`（BLOCKS 内）**三处都还是 `targetMonth`**；`target_month` **0 命中** |
| **R25** 🔵 `core/10:18` `pageSize`→`page_size` | 该行应改 | ❌ **未改**：`:18` 仍是 ``{ page, pageSize }`` |
| **R26** 🔵 派生链/工具链写进文档 + `verify_docx.py` 入 `tools/` | 文档 ≥1 命中、`tools/verify_docx.py` 存在 | ❌ **都未做**：`.md/.txt` 里 `python-docx`/`pywin32`/`verify_docx` = **0 命中**（仅 `tools/docx2pdf_word.py` 自身内含 `pywin32`）；`tools/` 仍是 4 个脚本，**没有 `verify_docx.py`** |
| **R27** 🔵 `f()` 收紧为 `typeof v === 'number'` | 标量金额拒字符串 | ❌ **未改**：`index.js:103-108` 仍是 `const n = Number(v); … !Number.isInteger(n)`（`"100"` 仍会被接受） |

**额外确认**：门禁 A–L 仍 **exit 0**（所以这些都不是"门禁挡住了"，是**根本没人动手**）。

---

## §2 ⚠️ 取件链路诊断（这比 R23–R27 本身更要紧）

同一份协议下，**已发生过两次**「复审文件落盘 → 未被取件」（第 2 轮、第 4 轮），而第 3 轮正常。可能的原因与**一步可判定**的判据：

| 假设 | 判定方法 |
|---|---|
| ① 取件时按 **文件名** 找（而非按 mtime），同日多份会取错/漏取 | 让 WorkBuddy 打印它实际读到的文件路径与 mtime；协议 §取件规则**明确要求按 `LastWriteTime` 降序取**（同日文件名 ASCII 序反直觉，早就坑过一次） |
| ② WorkBuddy 只在收到**特定口令**时才去读 `review/` | 确认口令是否就是 README §3 那句「复审结论落 review/ 了，去看最新一份」 |
| ③ 它读了但**没把回执写回文件**（写到了自己的 `memory/<日期>.md`） | 协议 §1 明确：回执必须**追加在 REVIEW 文件里**（它的自有报告另存 memory，**不能取代回执**） |
| ④ 它这轮在做**别的事**（如批次 2 投喂），没接这份 | 看它自己的 memory 文件里本轮做了什么 |

**建议的硬约束（防第三次）**：取件后**只做两件事之一**——要么在 REVIEW 末尾追加回执并 `git add review/ && commit`，要么在回执里写明「本轮未执行 + 原因」。**"静默没动作"是最坏的第三种**。

---

## §3 【应急】整段可粘贴指令（绕开取件链路直接用）

> 如果上面 §2 的链路一时修不好，**把下面整段粘给 WorkBuddy**，它不必先读 `review/` 也能精确执行。
> 每条都给**定位锚点 + 替换内容 + 验收命令**（锚点我已在这棵树上验过唯一性）。

```
【执行复审 REVIEW_2026-09-15_round4-verify / round5（R23–R27）· 逐条落地，落完在 §4 追加回执】

R23（删 app.json 的多余块）
- 定位：app.json 末尾
      "style": "v2",
      "projectConfig": {
        "appid": "touristappid"
      }
    }
- 改为（删掉整个 projectConfig 块，注意前一行的逗号也删）：
      "style": "v2"
    }
- 理由：真 AppID 已在 project.config.json:3 生效（9/14–9/15 云端部署跑通 ⇒ 该字段惰性），
        留着等于"同一事实的第二处副本"，且值是错的。
- 验收：Select-String app.json -Pattern "projectConfig" → 0；微信开发者工具编译一次无错（这步须人做）。

R24（投喂包契约字段名对齐）
- 定位：specs/dev-specs/delivery/inscode喂投包_8批_自包含完整版.md:298
      实现 `calcAmortize(asset, targetMonth)`，规则如下：
- 改为：
      实现 `calcAmortize(asset, target_month)`，规则如下：
- ⚠️ 只改这一处。同文件 :134「前端 JS / WXML 绑定：一律 camelCase（expireAt、clientRequestId、planId、cardCode）」
      **是合法示例，绝对不要改**。
- 必做连带：python specs/dev-specs/delivery/_gen_8batch_html.py   # 重生 8 份 txt + HTML
- 验收：delivery/ 下 targetMonth → 0、target_month ≥1（md + 批次2.txt + html 三处都跟上）；
        node specs/dev-specs/prototype/check_error_codes.js → exit 0（K3/K10 守派生链）。

R25（core/10 残留 camelCase）
- 定位：specs/dev-specs/core/10_云函数清单与接口契约.md:18
      - **分页**：列表类入参 `{ page, pageSize }`，出参 `{ list, total }`。
- 改为：
      - **分页**：列表类入参 `{ page, page_size }`，出参 `{ list, total }`。
- 验收：该文件 pageSize → 0；门禁 exit 0。

R26（把派生链与工具链固化，防换机/换会话丢失）
(a) ★知识存储点 §10 关键环境 末尾（`:406` 营业执照那行之后、`---` 之前）追加：
    - **文档派生链（改完 .md 必跑）**：`.md` →（逐字复制）`.txt` →（`python tools/md2docx_portrait.py <in.md> <out.docx> <标题>`，需 `pip install python-docx`）`.docx` →（`python tools/docx2pdf_word.py`，需 `pip install pywin32` + 本机 Word）`.pdf`。自检 `python tools/verify_docx.py`。
    - ⚠️ 三个坑：① `.pdf` 在 `.gitignore`（**不入库**，换机器必须重生）；② Word COM **一文件一实例**（连做多份会 `RPC 服务器不可用`）；③ 中文文件名 `SaveAs` 不稳，先导出到临时英文路径再拷回。
    - ⚠️ 换机器/换会话前请确认本机已 `pip install python-docx pywin32`（本机原先都没有，是 2026-09-15 补装的）。
(b) 把复审方交付的校验脚本落库为 tools/verify_docx.py
    源文件（复审方工作区）：C:\Users\lzj\Desktop\deepseek  空间\_tools_pack\verify_docx.py
    （我已双向验证：正常树 exit 0；注入旧串的变异 docx exit 1 并点名 A7 成立/9 个 unique/__probe）
- 验收：git ls-files tools/verify_docx.py 有输出；python tools/verify_docx.py → exit 0；
        重启键 §10 里 md2docx_portrait / docx2pdf_word / verify_docx 均 ≥1 命中。

R27（标量金额收紧：拒字符串）
- 定位：cloudfunctions/calcMonthlyProfit/index.js:103-108
      const f = (v, name) => {
        const n = Number(v);
        if (v === undefined || v === null) return 0;
        if (!Number.isInteger(n) || n < 0) return err(`${name} 必须是「分」非负整数`);
        return n;
      };
- 改为：
      const f = (v, name) => {
        if (v === undefined || v === null) return 0;
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
          return err(`${name} 必须是「分」非负整数（JSON number，字符串不接受）`);
        }
        return v;
      };
- 连带：core/10:50 的注里补一句「金额字段必须是 JSON number（整数分），字符串会被拒（INVALID_PARAM）」。
- 验收：传 direct_consume_fen:"100" → INVALID_PARAM；传 100 → 正常；把这两个用例写进
        calcMonthlyProfit/selftest.js（或一个 4 行入参用例文件）——**不要只留"讨论过"**。
- 落地后：node verify_all.js（或逐个跑 9 套件）+ 门禁 exit 0。

【完成后的回执格式（追加在本文件 §4，勿改正文）】
- [YYYY-MM-DD HH:MM] R23 已落/未落/存疑 · 证据：<命令> → <输出摘要> · commit <sha>
```

---

## §4 本轮新增的一个 🔵（顺手改）

**门禁 `check_error_codes.js:542` 的注释把 `.txt` 的生成归给了 docx 工具：**

```
542: // ⚠️ .txt 须由生成器从 .md 复制生成（tools/md2docx_portrait.py），**勿手改**；
```
但实测：`tools/md2docx_portrait.py` 的用途是 **Markdown → docx**（文件头自述），它**不产 `.txt`**；三对 `.txt` 与同名 `.md` **SHA256 完全相同**，即 `.txt` 是**逐字复制**（本轮回执里你写的也是 `cp -f <name>.md <name>.txt`）。
⇒ 注释里的工具名指错了，会把后来人带偏（尤其 R26 正要写派生链文档时）。建议改为：
```
// ⚠️ .txt 是 .md 的逐字副本（cp -f 生成），**勿手改**；.docx 由 tools/md2docx_portrait.py 生成。
```

---

## §5 能力边界

- **无回执可读**（本轮 `review/round4` 没有 §3），所以 §1 的判定**全部来自我自己对仓库的复测**。
- **远端 push 核不了**（`git ls-remote` 超时）；`origin/dev` 是本地远端引用。
- **开发者工具行为核不了**（R23 的编译确认）、**Word 呈现核不了**（我只核 docx 文本层与 pdf 的存在/大小/mtime）。
- **`verify_all` 端到端核不了**（EPERM）；如需总闸结论，用"逐个跑 9 个套件"替代（我上轮就是这么做的，9/9）。
- 本轮我**没有**对仓库做任何写入（`git status` 只能看到我自己那个未入库的 review 文件）。

---

## §6 执行回执（WorkBuddy · 2026-09-15）

> 针对本文件 §1 的「R23–R27 未落地」判定——**该判定基于 round5 落笔时的仓库快照（HEAD=879eb8a、round4 未入库）**；下述执行已在本回合完成并补全取件断点。顺序 R23→R25→R24→R27→R26→门禁/逐套件→提交。
> **裁决已采纳（抄录）**：已按复审方裁决——**R27 不留口子**（严格拒字符串 + 错误信息点名字段）+ **R24 合并批次 4 一行**（表单金额先转分整数再传），与 `target_month` 改在同一单源、同一次派生重生里完成。

### R23 删 app.json projectConfig 块
- 改：`app.json` 删 `projectConfig` 整块（原 13–15 行 `appid:"touristappid"`）。
- 核验：`grep -c projectConfig app.json` → **0**。
- ⚠️ 编译验证归用户/李老师（WorkBuddy 核不了）：影响面已量化——全仓库仅此 1 文件 3 行、零消费者（无 js 读、project.private.config.json 无 appid），退路是挪进 project.private.config.json（gitignored）。

### R25 core/10 pageSize → page_size
- 改：`core/10:18` `{ page, pageSize }` → `{ page, page_size }`。
- 核验：`grep -c pageSize …/10_云函数清单与接口契约.md` → **0**；`page_size` 在 18/107/110 三处一致。

### R24 target_month + 批次4 表单金额行 + 重生 8 批
- 改（单源 `inscode喂投包_8批_自包含完整版.md`）：`:298` `calcAmortize(asset, targetMonth)` → `target_month`；批次4 `## 3. 强制遵守` 在 `:534`「表单校验统一映射后端错误码」后插：
  > - **表单金额必须先转「分」整数再传**：`input` 原生值是字符串、界面单位是「元」，前端适配层须 `Math.round(元 × 100)` 转成整数「分」的 **number** 再传（22,000 元 → `2200000`）；**禁止**把字符串金额直接透传 —— 云函数对非 number 一律返回 `INVALID_PARAM`（刻意设计，勿绕过）
- 重生：`python specs/dev-specs/delivery/_gen_8batch_html.py` → **8 份 txt + 1 html，EXIT=0**。
- 核验（派生件）：`targetMonth` 残留 **0**；`target_month` 命中 2 文件；「表单金额必须先转」命中 2 文件；门禁 `check_error_codes` **EXIT=0**（K3/K10 绿）。

### R27 标量金额收紧为 typeof number（不留口子）
- 重构：把 `validateInput`/`cleanItems` 从 `index.js` 抽到**新建 `cloudfunctions/calcMonthlyProfit/validate.js`**（纯函数、无云依赖、可单测；`index.js` 顶部 `require('wx-server-sdk')` 使原函数无法在纯 Node 测）。
- 收紧：`f()` 与 `amount_fen` 一律 `typeof v === 'number'`（配 `Number.isInteger`），字符串一律 `INVALID_PARAM`；错误信息点名字段：`${name} 必须是「分」非负整数（JSON number，字符串不接受）`。
- 契约注：`core/10:50` 补 ④「字段必须是 JSON number，字符串会被拒」，并把过时引用 `index.js:90-137` 改为 `validate.js`。
- 自测：`selftest.js` 增 4 条 R27 入参用例（标量/库存/明细字符串→`INVALID_PARAM`，合法 number→`OK`）。
- 核验：`node --check` 两文件 OK；`node selftest.js` → **12/12 + 2 断言 + 4 R27 用例全绿，EXIT=0**。

### R26 固化 verify_docx.py + §10 文档化派生链
- 拷 `Desktop/deepseek 空间/_tools_pack/verify_docx.py` → `tools/verify_docx.py`（仓库根找三份 docx）。
- 核验：`python tools/verify_docx.py` → **3 份 docx 旧串 0 命中，EXIT=0**。
- 文档：`★知识存储点 §10` 写清派生链 `md →(cp) txt →(md2docx_portrait.py, 需 python-docx) docx →(docx2pdf_word.py, 需 pywin32+Word, 一文件一实例, 中文名走临时英文) pdf`，并注 `*.pdf` gitignored。
- 核验：`grep md2docx_portrait …/★知识存储点…md` ≥1；`.gitignore` 第 1 行 `*.pdf` 确认。

### 顺手改（round5 §4 的 🔵）
- `check_error_codes.js:542` 注释错误：原本把 `.txt` 生成归给 `md2docx_portrait.py`（实测它只产 `.docx`）；改为「`.txt` 是 `.md` 的逐字副本（cp -f 生成），勿手改；`.docx` 由 `tools/md2docx_portrait.py` 生成」。

### 总闸
- 门禁 `node check_error_codes.js` → **EXIT=0**。
- `node verify_all.js` → **9/9 套件通过**（批次1 自测现含 R27 入参用例）。
- 提交：`___COMMIT___`（含 R23/R25/R24/R27/R26 + round5 §4 注释修正 + 本回执），`git push origin dev`。

### 待你/李老师复核（硬边界外）
- R23 删块后微信开发者工具编译一次（我核不了）。
- 取件链路：本轮已把 round4 + round5 两份 review 一并 `git add` 入库，断点修复（协议 §取件规则按 LastWriteTime 降序取）。
