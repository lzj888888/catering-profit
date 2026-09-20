# NOTE · round59 自驱动巡检（2026-09-20 10:37–10:5x）

> 执行方：WorkBuddy（巴迪）｜仓库 `C:\Users\lzj\WorkBuddy\Claw\catering-profit`｜分支 `dev`

## 1 · 探针（唯一入口 `probe_agents.py`）

| 代理 | 判据 | 结论 |
|---|---|---|
| InsCode | `inflight_turn`=0、`message_count`=**1465（六连持平，与 round52/53/55/58 同值）**、`idle_sec`=156623.4（**43.5h**）、`last_approval`=`approved_once`、`model`=deepseek-v4-flash | **idle**，无待批、无在跑 |
| dsh | hwnd=855322、rect=[852,105,1764,924]（未最小化）；OCR 文本 `…1270．0．1：3080` 与 `餐饮闭店决…` | 窗口在，但**当前会话是「餐饮闭店决策指标模型咨询」，与仓库复审非同一上下文** |

⇒ 按技能 §3.2「会话上下文不匹配 ⇒ 不投递」（投了是上下文污染），**本轮未向 dsh 投递**。

## 2 · 并发写入方判定（§0.7）

- 进程级采样**写成 .py 文件再跑**（命令行只剩路径）+ 按 `ProcessId` 排除 `os.getpid()`（规避 round58「把自己匹配成并发方」的坑）。
- 间隔 75s 两采：**SAMPLE1=0 / SAMPLE2=0 ⇒ CONCURRENT=False**。
- HEAD `38f6d66` == 上轮（round58）记录 ⇒ **无未复核新 commit**。
- ⇒ 本轮可正常写，未降级只读。

## 3 · 本轮核心：`c24e0a2` 守卫由「绑字面」改「语义级」

### 3.1 缺口（round55 发现、round58 给出加固模板，本轮闭环）

`tools/selftest_ui_fix.js:65` 原判据：

```js
check('🔴 设置页不再有库存/摊销开关', !/inventorySwitch|amortizeSwitch/.test(read("pages/shop/setting.wxml")));
```

守的是「**旧 key 名回归**」，不是「**单源被破坏**」这个真实意图。用新名（如 `calcMethod.invMode`）
把开关放回设置页，它**不会红**。与 round57 的 E1 收入口径守卫同族（§0.3 ⑧）。

### 3.2 加固（沿用 round58 为 E1 跑通的两条腿模板）

- **① 锚点（fail-closed，且不绑 key 名）**
  - a：选择入口必须在月度录入页 —— 从 `input.wxml` 抽 `data-kind` 取值集合，须同时含 `inventory`+`amortize` 且有 `bindtap`（**不绑 handler 名**）。
  - b：设置页去向说明必须来自单源 —— 正则从 `setting.js` 抽 `: TERMS.calcMethod.movedNote` 的 **key 名**，
    再回查 `setting.wxml` 是否真渲染 `{{t.<key>}}`（**key 改名不误报**）。
- **② 禁用框架（控件/指令 + 受限字符窗，不裸扫关键词）**
  - a：设置页**有效代码面**（剥 `<!-- -->` 与 `//`、`/* */`）不得引用 `movedNote` 之外的**任何** `calcMethod.*` 取值。
  - b：不得出现 `<picker|<switch|<radio-group|<checkbox-group|<slider`、`data-kind="inventory|amortize"`、
    `switches:`、`saveShopSetting…240 字符窗内 switches`。

⚠️ 设计要点：设置页**合法地**引用 `calcMethod.movedNote`（去向说明），
所以「设置页不得出现 calcMethod」这种粗判据会**误杀正确实现** ⇒ 必须走「锚点 + 白名单外禁用」。

### 3.3 双向变异回灌（round58 定式，三条全做）

| 变异 | 内容 | 期望 | 实测 |
|---|---|---|---|
| **M1 漏** | 用**新 key 名** `calcMethod.invMode` 在设置页加回开关 + `data-kind="inventory"` | 旧判据漏 / 新判据红 | 旧判据 `OLD_JUDGMENT_GREEN=True`（**证实漏**）；新判据 **RC=1，2 条红**（`invMode`、`data-kind="inventory"`）✅ |
| **M2 误报** | **正确实现换写法**：key `calcMoved`→`calcTip`、wxml/js 注释换措辞 | 须**仍绿** | **31/31 RC=0** ✅ |
| **M3 fail-closed** | 删除去向说明整条（锚点拿不出证据） | 须红 | **RC=1**，`设置页去向说明来自单源…(MISS)` ✅ |

🔴 **M3 首次 `MUTATION_NOT_APPLIED`** —— 本仓是 CRLF，Python 里用 `\n` 拼的多行锚点**恒不命中**（静默 SKIP，非报错）。
改 `\r\n` 后命中并如期转红。与 §0.3 ⑨ 完全同族，已复现一次。

还原一律 `git checkout -- <file>`；变异脚本与 `.r59bak` 已删，**未进库**。

## 4 · 门禁（改文件后）

| 套件 | 结果 |
|---|---|
| `node verify_all.js` | **68/68 套件通过，RC=0** |
| `node specs/dev-specs/prototype/check_error_codes.js`（A–L） | **RC=0** |
| `node tools/selftest_ad_gates.js` | **24/24，RC=0** |
| `node tools/selftest_ui_fix.js` | **31/31，RC=0**（28 → 31：撤 1 条绑字面、加 4 条语义级） |

证据：`review/evidence/selfdrive_20260920_r59/`（`verify_all.txt` / `check_error_codes.txt` / `ad_gates.txt` /
`ui_r59_base.txt` / `ui_r59_M1.txt` / `ui_r59_M2.txt` / `ui_r59_M3.txt` / `proc_scan_r59.txt`）。

## 5 · 队列状态（§6）

- ① A6b ✅ ② R91 F1/F2 ✅ ③ AD G1–G8 ✅ ④ R86 ✅（round46/50 双独立回读 42/42，**后续不再回读**）⑤ 14 页走查 ✅
- 🆕 **本轮闭**：`c24e0a2` 守卫语义级加固（原记忆 §「待下轮 ⑦」）。
- 仍开着（**均需李老师裁决，我方无解**）：
  1. **dsh 四选一**（放开写+node / 改只读判据 / 退场 / 允许重启 dsh web）—— round39 等 5 份 NOTE 复审仍悬；
  2. 并发方 **1033 个过程 PNG** 悬在工作区（不代提交不代删，round58/59 实测仍未动）；
  3. 隐私政策**按 6 处**填占位符（旧清单会漏 2 项，直接卡提审）；
  4. 建 prod 时重走 R86 定值回读 + 替换 `ENV_MAP.prod` 占位符。

## 6 · 回执

见文末第 8 节（提交后回填 sha）。

## 7 · 未落 / 存疑

- **未落**：dsh 复审投递 —— 理由：当前会话「餐饮闭店决策指标模型咨询」与仓库复审**上下文不匹配**（§3.2），且后端历 10 轮不可用。
- **未落**：1033 个 PNG 归属处置 —— 归属待李老师裁决，不代提交不代删。
- **存疑**：dsh 后端健康度本轮仅作窗口级观察（OCR 读不准，未做 `/api/*` 与 uptime 侧证）—— 因不投递故未深入，
  若下轮要投递须先补 round50 四步侧证。

## 8 · 回执（round59）

- [2026-09-20 10:52] R59-01 已落 · 证据：`probe_agents.py` → InsCode inflight=0 / msg=1465 六连持平 / idle 43.5h；dsh hwnd=855322 未最小化 · commit `90fad10`
- [2026-09-20 10:52] R59-02 已落 · 证据：`_proc_scan_r59.py`（排除自身 PID，间隔 75s 两采）→ SAMPLE1=0 / SAMPLE2=0 / CONCURRENT=False · commit `90fad10`
- [2026-09-20 10:52] R59-03 已落 · 证据：`git log --oneline -12` → HEAD `38f6d66` == 上轮 ⇒ 无未复核新 commit · commit `90fad10`
- [2026-09-20 10:52] R59-04 已落 · 证据：`tools/selftest_ui_fix.js` 撤 1 条绑字面判据、加 4 条语义级（锚点 a/b + 禁用 a/b） · commit `90fad10`
- [2026-09-20 10:52] R59-05 已落 · 证据：M1 新 key 名变异 → 旧判据 `OLD_JUDGMENT_GREEN=True`（漏）/ 新判据 RC=1 两红 · commit `90fad10`
- [2026-09-20 10:52] R59-06 已落 · 证据：M2 正确实现换写法 → 31/31 RC=0（不误杀） · commit `90fad10`
- [2026-09-20 10:52] R59-07 已落 · 证据：M3 抽锚点（CRLF 修正后）→ RC=1 `movedNote…(MISS)` · commit `90fad10`
- [2026-09-20 10:52] R59-08 已落 · 证据：`verify_all.js` → `总览：68/68 套件通过` RC=0；A–L RC=0；AD 24/24；UI 31/31 · commit `90fad10`
- [2026-09-20 10:52] R59-09 未落 · dsh 复审投递 —— 会话上下文不匹配（餐饮闭店决策 ≠ 仓库复审）+ 后端历 10 轮不可用 · 待李老师四选一 · commit `90fad10`
- [2026-09-20 10:52] R59-10 未落 · 1033 个并发方过程 PNG —— 归属待裁决，不代提交不代删 · commit `90fad10`
- [2026-09-20 10:52] R59-11 存疑 · dsh 后端健康度仅窗口级观察，未做 round50 四步侧证（本轮不投递故未深入） · commit `90fad10`
