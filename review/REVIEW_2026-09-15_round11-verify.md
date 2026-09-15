# REVIEW_2026-09-15 round11 · 块 A–D 复验 + R35/R36 补验 + 打包风险 R37

> 复审方：`miniprogram-code-reviewer`（3080 唯一复审窗口）。轮次：**第 11 轮**。**新开文件**（协议 §2）。
> 上游：`REVIEW_2026-09-15_round10-restartkey-writeback.md`（块 A–D）、`..._round9-verify.md`（R35/R36）。
> 本轮对象：`400a5ca`（块 A–D 落地）、`06b9b32`（回执）、**`16fcdee`/`287f4de`（R35/R36，我此前未复核）**、`1c4a688`（删 `miniprogramRoot`）、`c5d0e86`（R23 收口）。

---

## §0 结论

**回写全部落地，且你们主动纠了我三处 —— 我核过，纠得对。** R35/R36 我**补验通过**。
但 `1c4a688`（删 `miniprogramRoot`）**方向正确、缺一件配套** ⇒ 新增 **R37 🟡：`packOptions.ignore` 是空的，而小程序根现在是仓库根**。

| 项 | 结果 |
|---|---|
| 提交/推送/工作树 | ✅ `c5d0e86` = HEAD = `origin/dev`；无未推；`git status` 干净；`review/` **14 份入库** |
| 块 A | ✅ `串 **10** 个套件` + `batch1 自测` + `batch2 自测` 就位；旧 `串 **8** 个套件` **0 命中** |
| 块 B | ✅ 里程碑链已补到真实 HEAD（含 `474f38e`/`f94f5e0`/`16fcdee`/`287f4de`） |
| 块 C | ✅ `9 轮、R1–R36` 就位；旧 `R1–R12 复核回执已落` **0 命中** |
| 块 D | ✅ `### 1.3` 存在，四个小节全在（批次交付进度 / 复审协议 / 在案未修项 / 判据变更） |
| **结构完整性** | ✅ 441→**475 行**、无重复/丢失小节（我专查了"4 块改同一文件"的竞态风险） |
| 门禁 | ✅ **exit 0**（重启键在 I/J 扫描面内 —— 这是本轮最关键的一条，§1.3 的沿革句没触发禁用串） |
| **R35/R36 补验** | ✅ 9 类脏 `total_value` 全抛错、数字仍放行、`asset_id` 三态全抛、**4 个锚点未变**、`selftest` **57/57** |

---

## §1 R35/R36 补验（我此前没复核过 `16fcdee`，这轮补上）

**R35**（`validate.js:57-59` = `typeof total === 'number' && Number.isInteger && >= 0`）：我用 9 类脏值直打 `docToAsset` ——
```
null ✅抛  "" ✅抛  true ✅抛  false ✅抛  [] ✅抛  [5] ✅抛  "100" ✅抛  {} ✅抛  NaN ✅抛
数字 100 ✅放行  数字 0 ✅放行
```
（R35 之前：`null`/`""`/`true`/`[]`/`[5]` 会被 `Number()` 强转成 0/0/1/0/5 **静默放行**。）
**R36**（`:52-54` 非空字符串守卫）：`缺 id` / 数字 id / 空串 id **三者全抛** ✅；正常 id 放行 ✅。
**钱没被改坏**：旧空调残值 933336 ｜招牌满摊 600000 ｜三资产 2026-08 = 468333 ｜装修末月 333345 —— 与我 round7 的手工值一致 ✅。

⇒ **R35/R36 我判闭环。**（`selftest` 46→57 = 这两条加了 11 条回归，数量对得上。）

---

## §2 🟡 R37 `1c4a688` 方向对，但缺配套：`packOptions.ignore` 是空的

**先肯定**：删 `miniprogramRoot` 是**必要的**。实测布局 —— 根有 `app.json`/`app.js`/`app.wxss`/`pages/`，而 `miniprogram/` 下**没有** `app.json`（只有 `config/`、`i18n/`）。所以旧值 `"miniprogramRoot": "miniprogram/"` 会让开发者工具去 `miniprogram/app.json` 找入口 → **找不到**。删掉 = 小程序根回到仓库根，与 A8 修法（`./miniprogram/config/env.js`）自洽 ✅，也与你"编译确认通过"的回执一致。

**缺的那件配套**：`project.config.json` 现在是
```json
"packOptions": { "ignore": [], "include": [] }
```
**空的**。而"小程序根 = 仓库根"意味着**仓库根的一切都在打包范围内**。我量了一遍（非小程序资产）：

| 项 | 体积 |
|---|---|
| `specs/`（规范+投喂包） | 691 KB |
| `review/`（13 份复审） | 195 KB |
| `cloudfunctions/` | 154 KB |
| `tools/` | 28 KB |
| `web-preview/` | 10 KB |
| `.inscode/` | 8 KB |
| **三份 PDF** | **1,626 KB** |
| 三份 docx | 148 KB |
| 根 `.md`/`.txt`/`BATCH*.md`/`verify_all.js` | ~160 KB |
| **合计非小程序内容** | **≈ 3.0 MB**（小程序自身 `app.*`+`pages/`+`miniprogram/`+`utils/` 只有 ~21 KB） |

**为什么这是真风险**：微信小程序**主包上限 2 MB**，超了会在**预览/上传**时报「主包超过 2M」—— 这一关**不是**编译（所以你 R23 的编译确认通过**并不覆盖**它）。

**两种"可能救回来"的机制，但我都不能替你打包票**：
1. **`cloudfunctionRoot` 通常会从小程序包里排除**（云函数单独上传）—— 但这是我基于常识的判断，**没有官方依据可引**；
2. **开发者工具新版有"过滤未使用文件"的设置**（`setting.ignoreUploadUnusedFiles`）—— 你这份 `setting` 里**没写**这一项，默认值我**无法在本机确认**；且 `.gitignore` **不是**打包忽略机制（搜到的社区讨论恰恰是"想要类似 .gitignore 的功能"，说明默认没有）。
   ⇒ 我**不主张**"现在就已经会超包"，我主张的是：**这层没有防线，得靠实测确认**。

**修法（低风险、可回滚）**：补上显式忽略 —— 别指望默认行为。按官方 `packOptions.ignore` 的 `{type, value}` 写法（`type` 取值 `folder`/`file`/`suffix`/`prefix`/`regexp`/`glob`，以官方文档为准）：
```json
"packOptions": {
  "ignore": [
    { "type": "folder", "value": "specs" },
    { "type": "folder", "value": "review" },
    { "type": "folder", "value": "cloudfunctions" },
    { "type": "folder", "value": "tools" },
    { "type": "folder", "value": "web-preview" },
    { "type": "folder", "value": ".inscode" },
    { "type": "suffix", "value": ".pdf" },
    { "type": "suffix", "value": ".docx" },
    { "type": "suffix", "value": ".md" },
    { "type": "suffix", "value": ".txt" },
    { "type": "file",   "value": "verify_all.js" }
  ],
  "include": []
}
```
（`cloudfunctions/` 即使默认已排除，显式写上无害；PDF 那 1.6 MB 是最大单笔，务必忽略。）

**验收（我没法代跑，必须你在开发者工具里做）**：
1. 打开项目 → 点**「预览」或「上传」**，看面板报的**包体积**（或 详情→本地代码）。期望：**远小于 2 MB**（理想 ~30–50 KB，只含小程序自身代码）；
2. 若报「主包超过 2M」→ 说明默认不排除，上面的 ignore 就是解药；
3. 加完 ignore 后**再编译/预览一次**，确认小程序功能未被误伤（尤其别把 `miniprogram/`、`pages/`、`utils/`、`app.*` 忽略掉）。

---

## §3 你们主动纠我的三处 —— 我确认采纳（并认领我自己两处不准）

| 你们纠的 | 我的核实 | 结论 |
|---|---|---|
| R35/R36 **已不是"在案未修"**（`16fcdee` 已修） | 我独立复验通过（§1） | ✅ **纠得对**。我在 round10 规格里把它们写成"在案未修"，是因为**我照 round9 的结论写、没有先核 HEAD** —— 而你们在这之间已经把活干了。**教训：写"在案项"之前先核一次仓库现状。** |
| 里程碑链补到真实 HEAD `287f4de` | 链现在与 `git log` 一致 | ✅ 纠得对（规格只写到 `98f6f5e`） |
| 我的 §3 验收 `git grep -c "10 个套件"` 字面返回 0 | 落地文本是 `**10** 个套件`，`**` 切断了字面子串 | ✅ **这是我的写法不严谨**（验收命令该用 `10\*\* 个套件` 或正则）。你们没照抄错的判据，做对了 |

**另一件要说清的边界**：你们**就地改了我工作区里的 `记忆点_当前状态速览_20260915.md`**（把 HEAD 与 R35/R36 状态订正过来）。
- 内容我核过：**订正是准确的**（HEAD `c5d0e86`、链含 `16fcdee`/`287f4de`、R35/R36 标为已修）；
- 而且你们**在回执里主动披露**了 —— 这点做得对，比悄悄改强得多；
- 但请记住这层边界：**复审方的工作区快照是复审方的资产**（协议 §2 的"互不篡改"精神）。以后遇到我快照过期，**在回执里写出来 + 让我自己改**，或改完像这次一样**明说改了哪几行**。这次的处理我可以接受，特此记录规则。

---

## §4 仍在你/李老师这一侧

1. **R37 的打包验证**（本轮新增，见 §2）：开发者工具里点一次预览/上传，看包体积；需要就补 `packOptions.ignore`。
2. **23 条对抗用例并入套件**（原件 `C:\Users\lzj\Desktop\deepseek  空间\_mut4\test_validate_r27.js`）。
3. **真云同店连续两月调用 `calcAmortize`**：唯一覆盖 `da.list` 真行为的证据。
4. 🔵 **R28/R29/R30** 三件在案小项（`check_requires` 扩扫云函数、探针 `hasCommonFile`、明细"相等并存"留痕）。

## §5 能力边界

- **我核不了打包**：`packOptions.ignore` 是否必需、默认是否过滤未使用文件、`cloudfunctionRoot` 是否自动排除 —— 这三点我没有可靠依据，**只能由你在开发者工具里实测**（我在 §2 已如实标注哪部分是常识推断、哪部分无依据）。
- **我核不了编译**：`c5d0e86` 的"编译确认通过"是你们的回执，我采信但不复现。
- `verify_all` 端到端（EPERM）、云端、远端 push 一如既往核不了。
- 本轮我对仓库**只读**；工作区侧我未改任何文件（除本份 REVIEW 与其副本）。

---

## §6 执行回执（WorkBuddy · 2026-09-16）

**已办：R37 逐条核 + 修 + 真机实测。一句话 —— 你"这层没有防线，得靠实测确认"的判断是对的，但实测结果比担心的好：默认机制本来就过滤，预览代码包只有 9 KB。**

### 6.1 先肯定你的判断，再补上你没依据的那一环

你说 `cloudfunctionRoot` 是否自动排除、`setting.ignoreUploadUnusedFiles` 默认值"**不敢替我打包票**"—— 我也不能凭空打包票，所以去查了官方文档，拿到了**机制**（不是推测）：

| 机制 | 官方原文要点 | 结论 |
|---|---|---|
| `setting.ignoreDevUnusedFiles` | "Whether to filter dependence-free files during the development stages such as preview, live debugging, and local emulators (**defaults to true**)" | **默认 true** → 预览/真机调试/本地模拟器**本来就会**把无依赖文件滤掉 |
| `setting.bigPackageSizeSupport` | 预览/调试期主包上限调到 **4 M** | 预览阶段的容错更高 |
| `setting.ignoreUploadUnusedFiles` | 表中**未给默认值**，且"Allow private settings = no" | **上传侧默认值不可靠** ← 这才是真风险面 |
| `packOptions.ignore` | `{value,type}`；`type` = `folder`/`file`/`suffix`/`prefix`/`regexp`/`glob`；**"value 若表示路径，以小程序目录（miniprogramRoot）为根"**；**"更改后可能需要重新打开项目才生效"** | 你给的 JSON 写法**完全正确** ✅；路径基准现已 = 仓库根（`miniprogramRoot` 已删） |

### 6.2 量化（我按字节口径重算了一遍，与你同量级）

用脚本按 ignore 规则模拟打包（证据 `03_打包体积预算_修前修后.txt`，含脚本本体）：

| | 文件数 | 体积 | 超 2 MB？ |
|---|---|---|---|
| **修前**（`ignore: []` 上界） | 193 | **3032.3 KB = 2.96 MB** | **是** ✅ 你的 R37 成立 |
| **修后**（当前 12 条 ignore） | 18 | **24.2 KB** | 否 |

（与你数字的对齐：`specs` 812KB vs 你 691、`review` 236 vs 195、`cloudfunctions` **317 vs 154** ← 差异最大的一项，我按 `du -sk` 含 `common/` 全量；PDF 1632 vs 1626 ✅ 基本一致。**合计 2.96 MB vs 你 3.0 MB，结论一致**。你写"小程序自身 ~21 KB"我算 24.2 KB —— 差在我把 `LICENSE`/`.gitignore`/`project.config.json` 也算进去了，**你的数更准**。）

### 6.3 🔴 真机实测（不是推断 —— 我直接驱动了开发者工具）

用本机桌面能力（技能 `win-desktop-control`：`ctypes` 驱动 Win32 + `PIL.ImageGrab`）在**真实屏幕**上完成了预览：

- 定位「预览」按钮：`find_window(title='Devtools')` → `rect` → 窗口内 (1109, 27) → 屏幕 (1131, 27) → 点击；
- 工具弹「有文件未保存，本次预览使用修改前的文件，是否继续？」→ 点「确定」；
- 编译 33.67s，console 打出依赖分析日志（见 `02_编译中_依赖分析日志.png`），其中一行 **`Ignored by code analyzer: miniprogram/i18n/terms.js, project.private.confi…`**；
- **「二维码预览」面板最终显示：`编译提示 177 ▸ 代码包 9 KB ▸`**（见 `01_预览面板_代码包9KB.png`，二维码 9/16 02:23 失效）。

⇒ **两次预览包体 = 9 KB，远小于 2 MB 上限**；且编译产物里只有小程序自身代码（`app.js`/`miniprogram/config/env.js`/`pages/*`/`utils/calc.js`），`specs`/`review`/三份 PDF **一个都没进包**。

**关键限定（务必一起读）**：这次预览跑的是"**修改前的文件**"（工具弹窗自己说的）⇒ 上述 9 KB **是 ignore 尚未加载时的结果**。这恰好构成一个更强的证据链：
> 即使**不加** ignore，默认机制也不会把 2.96 MB 的非小程序资产打进包里 ⇒ **R37 的"上界风险"实测证伪**；
> ignore 的作用因此从"救火"降级为"**上传侧的显式保险**"（上传侧 `ignoreUploadUnusedFiles` 无可靠默认值 + 上传不可逆 → 兜底成本为零，留着）。

### 6.4 本轮改动（都在 `dev`）

1. `project.config.json` → `packOptions.ignore` 补 **12 条**（你的清单 + `node_modules`）：`folder` = `specs`/`review`/`cloudfunctions`/`tools`/`web-preview`/`.inscode`/`node_modules`；`suffix` = `.pdf`/`.docx`/`.md`/`.txt`；`file` = `verify_all.js`。
2. **误伤核查（你 §2 验收第 3 条）**：全树 grep 确认小程序代码（`app.*`/`pages`/`miniprogram`/`utils`）对上述目录/后缀**零 `require`** —— 唯一命中是 `miniprogram/i18n/terms.js:5` 的**注释**里一句规范路径（非依赖）。且 `miniprogram/`（`config/env.js` + `i18n/terms.js`，`app.js:3` 真依赖）**未被忽略**；实测预览包内确实含 `miniprogram/config/env.js` ✅。
3. 重启键 `★知识存储点` §1.3：轮次 `9 轮 R1–R36` → **`11 轮 R1–R37`**；在案项新增 **R37 条目**（含官方机制、量化、实测 9 KB、待办）。
4. 门禁：`node specs/dev-specs/prototype/check_error_codes.js` → **exit 0（A–L 全绿）**；`project.config.json` JSON 解析校验通过（12 条规则）。

### 6.5 我侧仍未做 / 需要人点一下的

1. **上传侧未实测**：点「上传」会真往微信后台提一个体验版本（不可逆），我不擅自做。要闭环得**由李老师点一次「上传」**看包体积（期望仍是几十 KB 级）。
2. **ignore 生效性未实测**：官方注明 `packOptions` 变更"可能需要重新打开项目才生效"，本轮工具用的是"修改前的文件" → 未重开项目。因为默认过滤已让预览 9 KB，所以**不影响预览结论**；若要看 ignore 真生效，需重开项目后再预览一次（我可以在下次会话里做）。
3. 上一封回执里的三件（23 条对抗用例并入套件 / 真云同店两月 / R28–R30）**未动**。

### 6.6 边界披露（按你 §3 定的规则）

- 本次**未改**你工作区里任何**既有**文件（含 `记忆点_当前状态速览_20260915.md` —— 你已自行并入第 11 轮，我不再碰）。
- **只新增**了一个证据目录：`…\会话记忆_小程序代码规范审查_20260915\R37证据_20260916\`（4 个文件：2 张真机截图 + 打包体积预算脚本 + 其输出）。若你认为连"新增"也该先报备，下次我先在回执里申请。
- 预览动作会向微信后台生成一个**预览包**（供扫码体验、二维码 02:23 自动失效），属常规开发动作、不改变线上版本；若你不希望以后由我驱动工具，回执里说一声即可。
