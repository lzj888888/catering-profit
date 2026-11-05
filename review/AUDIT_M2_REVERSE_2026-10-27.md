# M2「寻找铺面 / 新开店」路径（mode=reverse）审计报告

- 日期：2026-10-27
- 审计人：m2-reverse-auditor（只读，未改动任何业务文件）
- 范围：`subpkg/tools/sandbox/matrix.js/.wxml/.wxss`（默认 `mode='reverse'`）、入口 `index.js:772`、
  `compare.js` / `list.js` 的 reverse 部分、`cloudfunctions/calcSandbox/*`、`utils/bizPreset.js`、
  `utils/openCash.js`、守卫 `tools/check_m2_matrix.js` / `check_m2_reverse_rent.js` / `check_biz_preset.js`、
  文案双副本 `miniprogram/i18n/terms.js` ≡ `specs/dev-specs/i18n/terms.js`
- 取证脚本（仓库根，新建）：`_audit_m2rev_sanity.js`（5 组老板样例全链路）、
  `_audit_m2rev_edge.js`（透视/空档/字符串键/结论判别力/现金卡数量级）、
  `_audit_m2rev_parity.js`（A 项一致性对拍 + 死代码可达性）、`_audit_m2rev_probe.js`（术语映射/cash 装修/引擎指标消费）
- 方法：把 `matrix.js` 的 Page 对象原样 require 进 Node（stub `wx/Page/getApp`），再把 `api.call`
  劫持到 **本机生产引擎**（`cloudfunctions/calcSandbox` 的真 `validateClean` + 真 `calcSandbox`）。
  ⇒ 跑的是页面自己的 `buildClean / toRow / buildPivot / buildInsight / buildCash / fixedBreakOf`，零改写。

---

## 一句话结论

**算数链路是干净的（900 个对拍点 0 分叉、13 业态 × 3 城市全通），但「寻找铺面」这条路径给老板的三个核心结论不可信：
①「可承受最高月租」不含任何可行性判据，恒等于老板自己填的最高租金档（引擎已经把房租占比 level=bad 算出来而页面不读）；
② 现金卡「能撑几个月」因字符串拼接被放大 10 倍（填非档位租金时放大 1 万倍），结论被系统性翻成"危险"；
③ 透视表完全不过滤人工维，两个人档位时被最后一档静默覆盖，而页面上的「固定人工」输入框改了对结果零影响。**
三条全是静默失效（零报错、守卫全绿），其中①②直接决定"要不要签这份租约"，属高危。

---

## 问题清单

| # | 问题 | 位置（文件:行号） | 证据 | 风险 | 建议 |
|---|---|---|---|---|---|
| P1 | 「可承受最高月租」无可行性判据，恒 = 你设的最高租金档 | `matrix.js:1012-1014` `buildInsight` 的 `bestVal = Math.max(...filtered.map(r=>r.rent))`；渲染 `matrix.wxml:145` | 唯一过滤条件是 `!r.red`，而 `red` 只由「毛利率 + 2% 杂支 ≥100%」决定，**与房租/目标利润/投入全部无关**。实跑：毛利率 5%、目标利润 50 万、同一座楼层 ⇒ 仍报「可承受最高月租 ¥10000」（`_audit_m2rev_edge.js` E5）；县城档组报 5000、二三线报 10000、一线报 28000 —— 全是各自 dims 的上限 | **高** | 图纸上补一条房租可行性判据。引擎**已经在算**：同一行 `indicators_at_target` 里 `rent: {pct:18.1, lo:6, hi:12, level:'bad'}`（一线 40㎡ 面馆、租 28000 实测），页面 `matrix.js` / `matrix.wxml` 中 `grep indicators_at` = 0 命中。最低修法：把可行定义成「该行房租占比 ≤ BANDS.rent 上限」或用 Hausdorff；在此之前结论卡应降级为"你扫到的最高档"（或直接不显示） |
| P2 | 现金卡「每月净流出」被字符串拼接放大 10 倍/10000 倍 ⇒ 「能撑几个月」恒不正 | `matrix.js:944`（`api.fenToYuan()` 返回 **String**）→ `matrix.js:484` `return Math.round(best.fixedExAmort + rentDelta);` | 实跑：`row.fixedExAmort = "14250" (typeof string)`；`fixedMonthlyYuan(3000) = 142500`（应 14250）；`fixedMonthlyYuan(5500) = 142502500`（应 17250）。后果：同一样例（预算 20 万、花 10.8 万）真值 runway=6.5 个月 level=safe，页面显示「危险。开完只剩 9.2 万，撑不到一个月」 | **高** | `Number(best.fixedExAmort)`；并补一条行为守卫（给一组固定实例，断言 fixedMonthly === 14250 与 level==='safe'），现有 R325 守卫只查了 `best.fixedExAmort` 字面出现次序，抓不到这一层 |
| P3 | 透视表未按「人工」维过滤 ⇒ 多人工档位时被最后一档静默覆盖；页面上的「透视表固定人工」输入框改了对结果零影响 | `matrix.js:1051-1058`（`pool`/`filtered` 只按 `marginPct`/`rent` 过滤、`cells[k]=…` 同键覆盖）、`matrix.js:1061` `fixLabor: null` 写死；输入 `matrix.wxml:253-256` + `matrix.js:1070 onPivotFixInput` | 实跑（labor=[2,3]）：16 行，`pivot.cells["3000|0"]=1136.79` = **labor=3** 那一行的日均，而 labor=2 是 896.23（差 26.8%）；把 `pivotFix.labor` 改成 999 后 `cells` **逐字节不变** | **高** | ① `filtered` 增加 `&& r.labor === fixLabor`，`fixLabor` 按 R331 同一套「优先 pivotFix、不在结果里就退到实际第一档」取值；② 表格上方明写"本表按 N 人"；③ 若产品上不打算筛人工，就把那个输入框删掉——留着就是"改了没反应"的假控件 |
| P4 | 「房租每涨 ¥1000 需多卖」与结论里的房租杠杆，系统性低估约 2 倍 | `matrix.js:947-948` `leverYuan = Math.round(1000/(marginPct/100))`；同式 `matrix.js:1020-1022` insight.leverText | 页面自己的固定成本里 utility/manage 是**房租的比例派生**（`bizPreset.js:439-475` + 各业态 `rentPct`），房租涨 1000，固定成本实际涨 1000×(1+1.2)=2200（面馆：水电 40% + 管理 80%）。实测：C1 面馆/县城/63% 保本随租 **+3606.6 元/千元**，表格与结论却写 **¥1587**；C2 ¥1818 vs 4151；C3 ¥1493 vs 3000；C5 ¥1667 vs 3224。另：分母用毛利率而非边际贡献率，漏了 2% 杂支 | **中** | 算式改成 `Δ房租×(1+Σ rentPct) ÷ 边际贡献率`；或更稳：直接读相邻两档的行做差分（不编公式）。这条的方向是"低估代价 ⇒ 看着更乐观"，是最危险的方向 |
| P5 | 维度留空被当成 0 ⇒ 生成「房租 0 元 / 人数 0 人」的行，人数 0 时人工归零、保本被砍一半 | `matrix.js:768`（`raw === '' ⇒ continue`，明确不当越界）、`matrix.js:826-829`（只判 `isFinite`，而 `Number('')===0`） | 实跑 E4：`badDimOf()` 返回空串（不拦），生成 8 行其中 6 行含 0；same rent=3000 下 labor=2 ⇒ 保本 26886.79，labor=0 ⇒ **12452.83**（人工项直接消失，且该列 `laborYuan=null` 页面显示"—"），零提示 | **中** | 空档在 `onGenerate` 里跳过（与 `badDimOf` 的"空=没填"语义对齐），或至少对 labor=0/rent=0 的行标 ⚠ 并给原因 |
| P6 | 手改档位带尾随小数（如 `3000.00`）⇒ 透视表整行渲染成「—」 | `matrix.js:1063` `rows: this.data.dims[dim].slice()`（**原始字符串**）vs `matrix.js:1058` `cells[r.rent+'|'+r.targetYuan]`（**数值**）；渲染 `matrix.wxml:270` `cells[rrow+'|'+cc]` | 实跑 E3：`dims.rent=["3000.00","5000"]`，cells 键是 `"3000|0"`，行 `"3000.00|0"` ⇒ 该行两个单元格全「—」 | **中** | `rows/cols` 用 `Number(...)` 归一，或用行下标而非行值做键 |
| P7 | 首屏默认值与页面显示的业态互不认账：经营类型已选「通用餐饮」（预设 60% 毛利率 / 3-4 人），实际按 45% / 2-3 人算 | `matrix.js:58-63 DEFAULT_DIMS`（margin 首档 45、labor [2,3]）+ `matrix.js:256-316 onLoad` **不同步**这两项；同步只写在 `matrix.js:350-375 onPresetChange` | 实跑：默认进页 `presetIdx=0(other)、dims.margin=[45,55,60,65]、dims.labor=[2,3]`，`advNote="按毛利率 45% 测算…"`；而 `findPreset('other').params.grossMarginPct.v=60`、`LABOR_DIMS.other=[3,4]`。老板看着"通用餐饮"以为就是业态口径 | **中** | `onLoad` 末尾复用 `onPresetChange(0)` 的同步逻辑（R331 只覆盖了"切业态"这一个动作，没覆盖"首屏默认"） |
| P8 | `data.t` 缺 `buildSumText` 键 ⇒ 合计行静默退化成页内硬编码、丢语义 + 脱离术语单源 | `matrix.js:748` `String(T.buildSumText \|\| '{total} · {amort}')`；`matrix.js:67-180` 的 `t` 映射里没有该键；terms 里**有**：`terms.js:2583 buildSumText: '合计 {total} · 每月摊 {amort}'` | 实跑：投入 13 万时 `buildSumOf() = "13.0万 · 2722元"`，应为「合计 13.0万 · 每月摊 2722元」。与 M1 的 `result.js:542 T.beHealthyScope` 同族（读了但没映射 ⇒ 静默） | **中** | 补 `buildSumText: M.buildSumText`；并把 `check_m2_matrix.js:307-315` 的 ⑦号判据从「只扫 buildCash 函数体」扩到「扫全文件所有 `T.xxx`/`t.xxx`」 |
| P9 | 现金卡的「装修」恒按 面积×900 元/㎡ 自算，完全不看老板在上面「开店要投多少」里填的装修；设备还得再填一次 | `matrix.js:505-512`（只传 `areaM2/rentFen/budgetFen/equipFen/stockFen`）；`utils/openCash.js:73-74` **根本没有 decorFen 入参** | 实跑：老板填装修 5 万、设备 8 万 ⇒ 页面上方"合计 13.0万"，现金卡却写「装修 3.6万 ＋ … 设备 8.0万」（3.6 万 = 40㎡×900）。同屏同一笔钱两个数；且两份设备输入不同步 | **中** | 现金卡装修优先取 `global.buildDecorYuan`（没有才落面积×单价），设备默认带 `global.buildEquipYuan` 作初值；或页面上明写两处口径不同（不建议） |
| P10 | 派生固定费用的量级失真：水电/管理费按房租的百分比派生 ⇒ 房租越高两者越高，一线可达房租的 1.2 倍 | `bizPreset.js:439-475`（`energy_split` / `fixed_opt` 走 `rent × rentPct`）；各业态 rentPct 见 `bizPreset.js:88-89/108/112/156-157/213-214/233-234` | 一线 40㎡ 面馆房租 28000 ⇒ 房租 28000 + 水电 11200 + 管理 22400（=房租×1.2），月固定 71950 ⇒ 保本 13.6 万/月。真实 40㎡ 面馆水电约 2~3 千、杂费几百。**方向 = 保本系统性偏高（保守）**，代价是与 P4 共同作用使杠杆数失真 | **中** | 这条既有写入式标注（`bizPreset.js:59-68` 已注明 manage 是连锁口径）。建议：① 给 `rentPct` 派生值加**绝对额上限**（如 max(房租×rentPct, RATE_COST_FLOOR)）；② 或让矩阵页在便利店同时显示"按 X 元/㎡ 水电"的实输入框，把估算权还给老板 |
| P11 | 「共 {n} 组组合」永远渲染成带花括号的占位符 | `matrix.wxml:135` `<text class="count">{{t.count}}</text>`；`terms.js:2602 count:'共 {n} 组组合'`；`matrix.js:894` 算了 `count: rows.length` 但**全仓无人渲染 `result.count`** | 直接读源码 + `grep "result.count\|t.count"` 只有一个命中 | **中**（可见且像坏了，但不算错账） | 用 `fmt(t.count,{n:result.count})` 渲染，或把 terms 里的 `{n}` 去掉。建议同时补守卫：`wxml` 中出现的 `{xxx}` 占位符必须在 js 里有对应 fmt 替换 |
| P12 | reverse 方案的「保存 / 对比 / 场景标签」链路在当前 UI 上已不可达（matrix 无保存入口；`index.js` 的 `mode` 恒为 `'forward'`） | `matrix.js:1137-1139`（只有 回沙盘/去对比，无保存）；`index.js:452` 初值 `'forward'`，全文件**没有任何写入点**把它改成 reverse；`compare.js:57`、`list.js:183`、`index.js:1083` 的 reverse 分支因此只对历史存量方案成立 | `grep "'reverse'"`：index.js 里只出现在比较运算与注释中 | **中**（低-中，取决于是否还有历史数据） | 二选一：① 给矩阵页加「保存为方案」并带上 `mode:'reverse'`（老板算了半天没地方存）；② 明确下线该场景，删掉 compare/list/sceneRev 的死 UI。**不能继续留着"看得见、点不到"的入口** |
| P13 | 矩阵/对比/列表的「回本月数」列未标注口径，与 index 页回本卡口径不同 | `matrix.js:968`（读引擎 `payback_months` = 总投入÷目标利润，`service.js:109`）、`compare.js:119`、`list.js:155` 同源；另有一套 `bizPreset.js:540 paybackCash` = 投入÷(目标利润+月摊销)，用于 `index.js:1922` | 火锅半自助场景：引擎 13.1 个月 vs paybackCash 10.0 个月（同一笔 26.2 万、2 万/月净利）。两者在 index 页是**并列标注**展示的，但矩阵/对比/列表只显示 invest 口径且无标签 | **低** | 列名前加口径（"回本（不含折旧回收）"），或三处统一跟 index 页的双口径展示 |
| P14 | `matrix.js` 自带一份「每月摊销」算式，违反 bizPreset 头部明文的分层铁律 | `matrix.js:736-751 buildSumOf`（`amortFen += fen/(years*12)`）；铁律见 `bizPreset.js:9`（唯一合法前端除法只有 `paybackCash`） | 实测与引擎一致（A2 对拍 900 点 0 差），所以现在是"流程正确"而不是"算错"。但引擎的 `build_amort_monthly_fen` 就从没被这行读过 | **低** | 读引擎出参 `build_total_fen` / `build_amort_monthly_fen` |
| P15 | 被云端拒掉的档位（`result.rejected`）从未在页面上渲染；`t.redAlertHint` / `t.unfeasible` 映射了也无人引用 | `matrix.js:894` 把 rejected 放进 result；`matrix.wxml` 全文无 `rejected`；`matrix.js:105/107` 映射的 `redAlertHint`/`unfeasible` 无引用（键差集扫描） | 只在 `matrix.js:901-906` 弹一句 toast（首条 msg + 数量），表外籍红利；红警行只有颜色，没有"为什么不可行"的一句 | **低** | 表内给一行提示（可与 partialText 同一个 `.partial-note` 样式） |
| P16 | 死键（`data.t` 映射了但无人引用） | `matrix.js:71-74, 90-91, 103-107`：`bizLabel`、`bizTypes`、`buildTotalLabel`、`buildYearsLabel`、`empty`、`pivotCellBreak`、`pivotCellTarget`、`redAlertHint`、`unfeasible` | `_audit_m2_tkeys.py` 差值输出 + 逐键人工复核（`colLeverExport/colCushionExport` 是扫描器只认大写 `T.` 造成的误报，`onExport` 里用小写 `t.` 正常使用） | **低** | 清理；顺带把扫描器扩到小写 `t.` 避免下次误判 |

---

## A. 口径与引擎一致性

**A-1 装配是否只有一份实现 —— 是。**
全仓扫描「同时含 `form ===` 判别 与 `rentPct`/`energy_split` 派生语义」的文件只有 4 个命中：
`utils/bizPreset.js`（唯一实现）、`subpkg/tools/sandbox/index.js`（**只读** `m.form === 'revenue_rate'` 找杂支项，见 `index.js:1552/1587`，不重算任何金额）、
`tools/check_biz_preset.js`（守卫）、`utils/selfcheck_bizPreset.js`（自测）。云端 `calcSandbox` 只收已经装配好的
`fixed_items / var_items / build_items`，里面不存在第二份"业态 → fixed_items"的逻辑
（`cloudfunctions/calcSandbox/index.js:29` 的 `assembleItems` 只出现在注释里）。

**A-2 行为对拍 —— 900 个比对点，0 不一致。**
拦截页面自己的 `buildClean`（拿到它真正送出的入参），对 5 个预设 × 3 城市 × 3 租金档 × 2 目标利润档
= 90 组、180 行，逐行比对 5 项：总投入 / 月摊销 / 固定（不含摊）/ 人工月额 / 固定+摊销=保本分母。
结果：**900 点全等**（`_audit_m2rev_parity.js` A2）。
⇒ 结论：数值链路**没有退化也没有第二套算法**，本报告发现的问题全部是**语义层**（结论怎么得出、哪些维度参与、
UI 是否真把值送出去），不是算式漂移。这一点请读者不要混淆。

**A-3 `calcSandboxReverse` 是否真的无调用方 —— 结论要分两层说。**
- 云函数入口 `cloudfunctions/calcSandbox/index.js:83-85` **仍在调用它**（`if (v.clean.mode === 'reverse')`），
  所以它不是"语法上的死代码"。
- 但**矩阵分支永远走不到**：`index.js:44-50` 是 `calcSandbox(v.clean)`，没有 reverse 分派；
  而且矩阵送出的 clean 里根本不带 `mode`（`matrix.js:696-705`），`validate.js:52` 会补成 `'forward'`。
- 前端**已无任何地方**向 `calcSandbox` 的 wire 入参里送 `mode:'reverse'`
  （`index.js:452` 初值 `'forward'`、全文件无写入点；`compare.js:57` / `list.js:183` 只读存量 `param_json`）。
⇒ 所以：**它是"契约可达、产品不可达"的僵尸代码**——只有 `selftest` 与 `savePlan` 的内联副本在跑它。
  ⚠️ 副作用：`snapshot.reverse` 这个"真正的反推答案"永远不会被新增 ⇒ compare/list 的 reverse 分支（P12）是真僵尸。
  ⚠️ 命名风险：守卫 `tools/check_m2_reverse_rent.js` 守的是**这个僵尸分支**（房租去重算法），
  而用户看到的「寻找铺面」（matrix?mode=reverse）**不受这条守卫保护**，只受 `check_m2_matrix.js` 保护。两个 reverse 同名不同物。

---

## B. 数值常识量级回归（实跑，引擎 = 生产 service.js）

统一约定：**下列数字都是同一条链路的产物** —— 页面 `buildClean`（含 `assembleItems` 派生）→ 真 `validateClean` → 真 `calcSandbox`，
未截入驻 Entry 成本因此 unit=0。

### B-1 县城 40㎡ 面馆（preset=fastfood_noodle / 县城系数 rent 0.75、labor 0.85 / 2 人，人均 4500 / 毛利率 63% / 未填投入）
行工况：**utility = 房租×40%、manage = 房租×80%**（`bizPreset.js:88-89`）⇒ 房租 1000 时水电仅 400 元/月。

| 月租 | 保本月营收 | 目标月营收（净赚1万） | 保本日均 | 房租占营收 | 人工/月 |
|---|---|---|---|---|---|
| 1000 | 16,147.54 | 32,540.98 | 538 | 6.2% | 7,650 |
| 3000 | 23,360.66 | 39,754.10 | 779 | 12.8% | 7,650 |
| 5000 | 30,573.77 | 46,967.21 | 1,019 | 16.4% | 7,650 |

**判定：**数值本身在常识区间（县城小面馆保本 1.6~3.1 万/月、日均 540~1020 元 ≈ 45~85 碗 @12 元，可做出来的）。
**偏离的两项：**① 房租 1000 时水电 400 元/月偏低（真实 40㎡ 面馆水电气 ≈ 800~1500 元），管理杂费 800 元偏高方向不明；
② 房租占营收最高到 16.4%，**已越过 BANDS.fastfood.rent 的 5~10% 带**（tier23），页面不提示。

### B-2 同上 + 8 万设备（5 年摊）→ 现金保本出现
| 月租 | 保本月营收(账面) | 现金保本 | 回本月数 |
|---|---|---|---|
| 3000 | 29,402.51 | 26,887 | 8 |

双保本口径自洽（差额 = 摊销÷边际贡献率，见守卫 R336-⑦，绿）。**回本 8 个月用"总投入÷目标利润"，没有把每月摊销（1,333 元）加回现金流** ⇒ 相对 index 页的 cash 口径（7.1 个月）偏保守（P13）。

### B-3 二三线 30㎡ 茶饮（毛利 67%）
房租 3000 ⇒ 保本 22,846 元/月；房租 10000 ⇒ 保本 43,846 元/月，房租占比 22.8%。
其中"管理杂费 = 房租×71% = 2,130 元/月"——**比房租 ×0.71**，对 30㎡ 奶茶店是不可信的（真实或 300~800 元）。
方向：**保本偏高（保守）**。这条笔墨扰人，但被 `bizPreset.js:59-68` 显式注明过来自 mandates BANDS.manage[4,8] 的连锁中值。

### B-4 二三线 120㎡ 火锅烧烤（半自助预设，含 26.2 万 buildRef）
房租 6000~12000 ⇒ 保本 8.4~10.7 万/月、人工 25,000/月、回本 13.1 个月。
**判定：符合常识**（120㎡ 火锅簇 5 人、月人工 2.5 万、保本 8~11 万/月是内地常见量级）。这组是全部 5 组里最合理的一组。

### B-5 一线 150㎡ 中式正餐（5 人，毛利 60%）
房租 10000 ⇒ 保本 86,767 元/月（水电 3,500 + 管理 5,200 + 人工 31,625）；
房租 28000 ⇒ 保本 144,802 元/月、房租占比 19.3%（已越 BANDS.rent 12% 上限，无提示）。
判定：绝对量级合理。**偏差项：** 人工 31,625 = 5,500×1.15×5，一线服务员 6,325/人偏高（常见 4,500~6,000），方向=保本偏高。

### B-6 结论卡的反向自洽（重点，对应审计要求 B 最后一条）
「可承受最高月租 ¥5000」这个数是否自洽？——**不存在自洽关系，因为链条里压根没有定义"可承受"。**
把它代回同一个引擎：C1 县城面馆租房 5000 ⇒ 目标月营收 46,967 元/月 = 1,566 元/天 ≈ 130 碗 @12 元/天（40㎡ 小店，注：座位约束不在本页模型的假设里，属我按常识补的判断）。
再推到极限：一线 40㎡ 面馆房租 28000 ⇒ 目标月营收 **154,623 元/月 = 5,154 元/天 ≈ 430 碗/天**，引擎同时又给你贴上 `rent level='bad'`（18.1% vs 带 6~12%），
结论卡却继续打印「可承受最高月租 ¥28000」。**结论与证据同屏矛盾，且零报错。**

### B-7 常识偏离汇总（方向标注）
| 项 | 方向 | 量级 | 出处 |
|---|---|---|---|
| 管理杂费 = 房租×52%~80% | **保本偏高（保守）** | 30㎡ 茶饮房租 3000 ⇒ 管理费 2130（≈房租的 0.71 倍） | `bizPreset.js:214` rentPct=71 |
| 水电气 = 房租×24%~43% | **保本偏高（保守）** | 一线房租 28000 ⇒ 水电 11200 | `bizPreset.js:88` rentPct=40 |
| 「涨租需多卖」= 1000÷毛利率 | **代价低估（乐观）** | 低估 1.9~2.3 倍 | `matrix.js:947` |
| 现金卡每月净流出 | **资金"能撑几个月"低估（保守）** | ×10 / ×10000 | `matrix.js:484` |
| 透视表按最后一档人工取值 | 双向（视老板心里想的是几人） | 2 人 vs 3 人日均差 26.8% | `matrix.js:1055-1058` |
| 人数 0 的空档 | **保本乌托邦（乐观）** | 26887 → 12453 | `matrix.js:826` |

---

## C. 静默失效扫描（同族病）

**C-1 「读了但映射侧没产出」—— 全量差集扫描（本次重点，做了两趟）**
方法 1：复用仓库根已有的 `_audit_m2_tkeys.py`（取 `data.t` 的字面量键集合 vs `wxml` 的 `t.X` + js 的 `T.X`）。
方法 2：我另加一趟小写 `t.` 扫描（`onExport` 里用的是 `const t = this.data.t`），避免误报。

结论：**只有 1 个真缺键 —— `buildSumText`**（P8）。它就是 M1 那个 `result.js:542 T.beHealthyScope` 的同族：
`terms.js` 里有、**`data.t` 里没有** ⇒ `T.buildSumText === undefined` ⇒ 走 `|| '{total} · {amort}'` 兜底 ⇒
数字照出、语义前缀永久丢失、且改 terms 也不会生效，全程零报错。
反向差集（映射了但没人用）= 9 个死键（P16），其中 `redAlertHint` / `unfeasible` 说明"不可行的人类话术"当初写了却没接上。

**C-2 「读到了 ≠ 送出去了」—— 抓到 2 例**
- P3：透视表`pivotFix.labor`被 `wxml` 渲染、被 `onPivotFixInput` 写入、被 `setData` 回调触发重算 —— 三个动作都做了，
  但 `buildPivot` 的过滤条件里**没有它** ⇒ 老板只看见"数字没动"。这是最典型的一例。
- P11：`result.count` 算出来了，`wxml` 却直接渲染未经 fmt 的模板串。

**C-3 条件恒真/恒假 —— 2 例**
- P1 的 `!r.red` 对房租维**恒定为真**（红线只挂毛利率）⇒ maxRent 过滤器等价于"没过滤"。
- `index.js:1083` `this.data.mode === 'reverse'` 恒假（超出我的边界，只登记：forward 页面的 `planType` 永远走 site_select）。

**C-4 分批失败 / 被拒档位 —— 有可见提示，但只在静置层**
`partialText`（R357）已实现且 `check_m2_matrix.js:249-257` 用「变量捕获 + emit 断言 + wxml 渲染」三重钉住，实测名句会在明细表上方出现。
`rejected` 只有一句 toast，**表内没有位置**（P15）。

---

## D. 透视表与结论卡

**D-1 R331 的"回落"修复 —— 生效了（实跑验证，不是只读代码）**
`matrix.js:992-996`（buildInsight）与 `matrix.js:1051-1054`（buildPivot）两处的
`if (pool.indexOf(fixVal) < 0) fixVal = pool[0];` ：
- C1 实跑：结果里只有毛利率 63 一档，`pivotFix.margin` 写死 55 ⇒ `fixVal` 落到 63，透视表和结论卡都出数了 ✅
- E2 实跑：把 `pivotFix.margin` 改成 63（不在结果档里）后 cells 仍能出数 ✅
⇒ 这条历史 bug 已经修好且可用。但判据强度不足：守卫 `check_m2_matrix.js:466` 只认那一句正则，
只要两处任一存在就绿（删掉其中一处也照样通过），且只对回滚逻辑做了静态检查，没做"跑一次真数据看 cells 是否非空"的行为腿。

**D-2 两形态（forward 首列扫毛利率 / reverse 首列扫租金）都正确吗？**
- reverse（`rows=dims.rent`、`固定=margin`）：**形态对、内容不可信**（P3 未筛人工、P6 键不匹配）。
- forward（`rows=dims.margin`、`固定=rent`）：形态对称；但由于 `onLoad` 的 forward 分支会把 `dims.rent` 压成**单档**
  （`matrix.js:305`），filter 按 rent 取值仍成立。**forward 我只按"登记 ≠ 主审"处理**（属另一位审计员的范围），此处只登记一句：
  forward 同样不按人工过滤，P3 是两形态共病。
- 两个形态共有的另一个坑：`rows/cols` 直接取 `dims`（含被跳过的空档/非法档），所以可能会渲染出"表里没有对应数据"的行。

**D-3 结论卡**
`insightMaxRent / insightMinMargin / insightLever / insightCushion` 四条文案都在 terms 里有值、都能渲染（未发现 undefined 拼接或空串）。
问题出在**值本身**（P1、P4）。

---

## E. 守卫覆盖缺口（按风险排序）

三个守卫当前状态：`node tools/check_m2_matrix.js` 181/0、`check_m2_reverse_rent.js` 23/0、`check_biz_preset.js` 33/0 —— **全绿**，
而下面的高危区域全部改动后守卫不会红。

| 排序 | reverse 路径里的区域 | 现有守卫覆盖 | 为什么抓不到 |
|---|---|---|---|
| 1 | `buildInsight` 全文（`matrix.js:980-1031`：maxRent / minMargin / lever / cushion / targetAnchor） | **零** | 唯一相关判据是 R332 那句回落正则；可行性的语义没有任何静态/行为腿 |
| 2 | `fixedMonthlyYuan` 算式（`matrix.js:467-488`） | 弱（只查 `best.fixedExAmort` 出现在旧式之前，`check_m2_matrix.js:285-287`） | 不看类型、不看算术 ⇒ P2 的 ×10 / ×10000 完全藏在绿区 |
| 3 | `buildPivot` 的过滤维与 cells 组装（`matrix.js:1035-1067`） | 几乎零 | 同上；没有"多人工档位时 cells 只能有一行含义"的断言，也没有"pivotFix.labor 必须参与 filter" |
| 4 | `utils/openCash.js` 与调用方的接线（decor 不入参） | openCash 自身有 27 条自测（`tools/selftest_opencash.js`，绿），**调用方零守卫** | 没人断言"现金卡的装修 == 老板填的装修" |
| 5 | `t.X` 映射完整性（wxml/js 用了、`data.t` 没有） | 只覆盖 `buildCash` 函数体（`check_m2_matrix.js:307-315`） | P8 落在 `buildSumOf` 里 ⇒ 漏 |
| 6 | 维度空值/字符串归一（`matrix.js:762-829`、`1063`） | 零 | 没有一条样例断言"空档不产行"或"字符串档位命中 cells" |
| 7 | 首屏默认 vs 业态预设一致性（P7） | 只守"切换业态时"要同步（`check_m2_matrix.js:451`） | 首屏命名 exertion 不触发 `onPresetChange` ⇒ 无人验 |
| 8 | `RENT_DIMS` 各档的**数值量级**（只看数量/单调/首档不同，`check_m2_matrix.js:743-760`） | 结构而已 | 9000→改成 90000 也不会红（只有单调性） |
| 9 | compare/list 的 reverse 分支可达性（P12） | `check_m2_matrix.js:116` 只查字符串 `s.reverse && s.reverse.target_monthly_fen` 在场 | 这是"字符串在场"不守"有值/可达"的教科书样例 |
| 10 | 单源/㎡.`noticeHint`: `check_biz_preset.js` G 段把 rentPct ≡ BANDS 比值钉死了 | 强（写得很好） | P10 的量级失真**不是**这三类守卫能覆盖的问题类型：**没有任何守卫做"数值落在人类常识区间"的回归** |

⇒ 一句话：这三个守卫都是**结构 + 字符串 + 少数行为锚点**型，没有一条属于"**常识量级**"或"**结论语义**"型。
本轮的 P1/P2/P3/P4 正好全部落在这两个空档里。

---

## 未确定项（fail-closed，请李老师拍板）

1. **"可承受最高月租"到底该怎么定义？** 我只能证明它现在没有定义。三个候选：
   ① 房租占目标营收 ≤ BANDS.rent 上限（引擎已经会算 level）；
   ② 目标租金率反推（复活 `calcSandboxReverse` 的 `rent_cap = R × target_rent_rate`）；
   ③ 干脆下线这张结论卡改说"你扫过的档位里：房东报价 X 保本要 Y 万/月"。
   **我不自行推荐，因为这是产品口径决策。**
2. **透视表要不要筛人工？** 若产品上认为"人工由上面的总额输入框统一控制"（事实正是如此：`labor_total`），
   那正确修法可能是**删掉 `pivotFix.labor` 输入框**并把 dims.labor 固定成一档；若认为要筛，则按 P3 修。两者都能消除静默，方向相反。
3. **utility / manage 的房租百分比派生是否接受**（P10）。代码注释承认 manage 是连锁口径手工值（保守方向），
   但 derive 出来的"水电=房租的 40%"在房租上路时会失控。**改 BANDS 需要重部署 51 份副本**（`bizPreset.js:67` 已标注），故不敢自作主张。
4. **P12 是"补保存入口"还是"删死 UI"？** 取决于"寻找铺面的方案"是否还要保留「保存 → 对比」这条链路。
5. P13 回本口径：两份口径**有意并存**（index 页并列展示且标了名），但矩阵/对比/列表三处只有 invest 且无标签。是否统一，**请李老师决定**。

---

## 附：取证脚本（仓库根，本次新增，未改动任何业务文件）

| 脚本 | 做什么 | 关键结论 |
|---|---|---|
| `_audit_m2rev_sanity.js` | 5 组老板样例全链路（页面对象 + 真引擎） | B 节全部数字、R331 回落实跑验证、现金卡/固定构成/透视/结论全量输出 |
| `_audit_m2rev_edge.js` | E1 透视多人工覆盖、E2 pivotFix.labor 无效、E3 字符串键、E4 空档=0、E5 结论判别力、E6 现金卡数量级、E7 导出列对齐 | P1/P2/P3/P4/P5/P6 的直接证据 |
| `_audit_m2rev_parity.js` | A1 第二实现扫描、A2 90 组/180 行/900 点对拍、A3 reverse 可达性 | 900 点 0 不一致；单源成立；僵尸分支定位 |
| `_audit_m2rev_probe.js` | 术语映射退化、现金卡装修 vs 老板输入、引擎 `indicators_at_*` 是否被消费 | P8/P9/P1 的直接证据 |
| `_audit_m2_tkeys.py`（已有） | `data.t` 键差集扫描（我在其上补了小写 `t.` 与人工复核） | 唯一缺键 = buildSumText |

**改动核对：** `git status --short` 除 `.workbuddy/memory/*`（非我改动）与本表 4 个 `_audit_m2rev_*.js` 外，
`subpkg/`、`utils/`、`cloudfunctions/`、`tools/`、`specs/`、`miniprogram/` 全部无修改；亦未运行全量门禁
（只单独跑了三个 M2 守卫各一次，确认当前全绿：181/0、23/0、33/0）。
