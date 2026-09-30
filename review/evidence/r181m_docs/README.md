# R181m · 文档收敛 + 阶段① 上云（2026-10-01）

**本轮性质**：**零风险文档线 + 唯一遗留动作收口**。
授权来源：李老师 2026-10-01 ——「今天的工作不再需要我授权，自行安排，不要停下来」。

---

## 一 本轮做了什么（5 件）

| # | 事项 | 产出 | 判据 |
|---|---|---|---|
| 1 | **A2 决策面板收敛** | `review/决策面板_2026-09-28_待李老师拍板清单.md` 重写为**收敛版** | 20 项终态：已闭环 **6** · 今日落文档 **9** · 排批次 **5** · 待李老师一句话 **1** |
| 2 | **A3 口径固化（消过期）** | `specs/dev-specs/core/外卖核算_专项核对.md` → **V3 已定论版** | §0/§2/§4/§7 四处「待定」→「已定论（R177）」；新增 §9「口径已代码化」 |
| 3 | **A4 prod 播种方案** | `review/PLAN_2026-10-01_prod环境播种方案.md` | 补上 CHECKLIST §2-C **自标的「真缺口」** |
| 4 | **CHECKLIST 订正** | 同上文件 | 25/40 → **27/45**；42 函数 → **43**；§2-C 缺口 → ✅ |
| 5 | 🔴 **部署 `importSalesBill`** | `review/evidence/r181l_stage1_import_feed/deploy/` | 见 §二 |

---

## 二 部署取证（本轮唯一「对外动作」）

**结论**：✅ **已上云**（dev `cloud1-d4gphpoxy337f2a25`）。详细取证见 `../r181l_stage1_import_feed/deploy/README.md`。

| 判据 | 值 |
|---|---|
| 表格行 `success` | **`true`** |
| `filesCount` | **18**（≡ 磁盘实扫 18） |
| `packSize` | `'42.8 KB'`（不含 `xlsx` ⇒ 走云端安装，符合预期） |
| 完成行 | `√ deploy cloudfunctions` |
| 首轮 | `try1` MISS（IDE 通道未起，**常态**）→ `try2` HIT |
| 🔴 两轮 `rc` | **都是 0** ⇒ 再次印证「**`rc` 永不作判据**」 |

**独立第二证据**：`cli cloud functions list -e <env>` ⇒ 本地 **43** ≡ 云端 **43**（`diff` 零差异）。

### 补充 · 阶段①「**真实路径**」本地探针（本轮最有价值的发现）

**问题定位**：批次 F 的自测（`tools/selftest_bill_parse.js`）吃的是 `mk_fixtures.py` 用 **openpyxl** 转出的 JSON 矩阵；
而**云端跑的是 `xlsx` 库那条路**（`cloudfunctions/importSalesBill/service.js::bufferToMatrix`）。
⇒ **测试路径 ≠ 生产路径**。这是「部署成功 ≠ 能跑」的典型盲区，而 `cli` 无 `invoke` 子命令，拿不到云端运行结果。

**做法**：把 `xlsx@0.18.5` 装到**仓库外**（`/tmp/xlsxprobe`，**不污染仓库**），用 `NODE_PATH` 让 `require('xlsx')` 可解析，
然后**直接 `require` 生产的 `service.js`**（**不复制逻辑**）跑真账单。脚本：`probe_xlsx_chain.js`。

**结果**：**6 通过 / 0 失败** —— 两个锚点在**真实 xlsx 路径**下原样复现。

```
[淘宝闪购 2026-08] 认到平台：taobao（明细表 = 外卖账单明细）
  ✅ rowCount = 156   ✅ amountFen = 377965   ✅ qty = 150
[美团 2026-08]      认到平台：meituan（明细表 = 订单明细）
  ✅ rowCount = 50    ✅ amountFen = 182664   ✅ qty = 50
```

**证明了什么**：`XLSX.read(buffer, {type:'buffer', cellDates:true})` +
`XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:null})` 的用法**正确**，
且 `bufferToMatrix` 的输出与 openpyxl 的 fixture **同构**（`billParse` 两条路都能吃）。

🔴 **仍未验的只剩一件**：云端 `xlsx` **是否装上**（真机若报 `Cannot find module 'xlsx'`）—— 那是**安装**问题，本地验不了。

**探针初版踩的坑（留档）**：漏传 `opts.platform` ⇒ `SHEET[null]` = undefined ⇒ 零行 ⇒ 报 0/2 假红。
`parseBillMatrix` 的 `platform` **必须从 `opts` 传入**（`service.js:75`）
⇒ 又一次印证「**判据红先怀疑自己**」。

---

## 三 门禁

`gate_181m_1.txt` —— **122/122 · rc=0 · 真 FAIL=0**
（`grep -c "❌"` = 2，均为**断言描述里的字面量**「输出内零 ❌」「断言数 ≥ 12」，属仓内固定 2 条，非真失败。）

`gate_181m_2.txt` —— **收尾提交前的二次复跑**（扫描树已含本轮新增取证件 `probe_xlsx_chain.*` 与路线单刷新）：
**122/122 · rc=0 · 真 FAIL=0**。判据：`grep "总览"` → `总览：122/122 套件通过`；**无失败清单段**；`grep -c "❌"` = 2（同上，全为字面量）。
✅ 本次改动面**纯文档 + 证据**（**零代码**）⇒ 数值与 `_1` 一致即符合预期。
✅ 另外两个直接受新增文件影响的守卫**单独复跑**：`check_evidence_meta.js` **2 通过 / 0 失败**（S1 = 663 个 .md/.txt）·
`check_suite_coverage.js` **10 通过 / 0 失败**（面 A 122 个判据零漏网 · 面 B 5 个取证脚本全豁免 · 无僵尸条目 · S8 前提成立）。

---

## 四 本轮新增的三个认知（已回写技能/记忆）

1. **specs 也会过期，而且过期指令比没有更危险** —— `外卖核算_专项核对.md` 的 §4 一直写着
   「必须**明早**用美团账单定论」，而 R177 早已定论。**没人回头改 ⇒ 后来者会照过期指令行动**。
   ⇒ 纪律：**结论一旦定论，当天就回填文档**；文档维护段要写清「哪条已闭环」。
2. **「无落地路径」是可以在文档层被单独解决的** —— CHECKLIST §2-C 把缺口标得很清楚（这很好），
   但一直没人补。补法不必是代码：**控制台导出/导入**是零代码零凭证的最优解。
3. **部署器首轮失败是设计内行为**（技能 §0.6）—— 首轮 `ESOCKETTIMEDOUT` 直接重跑即可，
   不要改代码、不要改配置。本轮 `try1` MISS → `try2` HIT，完全复现该规律。
4. 🔴🔴 **「测试路径 ≠ 生产路径」是本批最贵的盲区**：自测用 **openpyxl** 生成的 fixture，
   云端却跑 **xlsx 库** —— 两条路产出的矩阵**可能不同构**，而自测**永远不会发现**这一点。
   ⇒ 纪律：**只要生产侧用了外部库（xlsx / 图像 / 加密…），就要有一条「用同一个库跑真样本」的探针**，
   哪怕它不能进 CI（需要外置依赖）。
5. 🔴 **阶段① 的第二 tab 已静态闭环**（本轮补验）：`app.json:18` 已登记 ·
   入口 = `pages/card/index.js:234 goTakeaway()` ← `pages/card/index.wxml:18` 按钮 ·
   `onTab` 实现存在 · 导入四步（`chooseMessageFile → uploadFile → importSalesBill(confirm=false) → onConfirmImport`）完整 ·
   术语走 `TK.importTab`（i18n 单源，非硬编码）。
   ⚠️ **动态可点性仍需真机**（`pages/card → 工具按钮 → 第二 tab → 选文件`）。

---

## 五 回执

- [2026-10-01 02:2x] **R181m 已落** · 证据：`git status --porcelain` → 3 改 3 新 ·
  `node verify_all.js` → `总览：122/122 套件通过` rc=0 ·
  `_deploy_fns.py importSalesBill` → `try2 HIT` `filesCount=18` ≡ 磁盘 ·
  `cli cloud functions list` → 本地 43 ≡ 云端 43（diff 零差异）· commit `<待填>`
