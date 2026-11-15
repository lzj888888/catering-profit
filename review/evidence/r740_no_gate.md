# R740 · 拆掉摊销时间闸门（未上线窗口期的边界处理）

> 李老师 2026-11-15：「小程序还没正式上线，所以目前这种情况，关于边界问题，尤其是你提到的 10 月 11 月数据，你觉得如何处理更好呢？」
> 拍板：**拆掉闸门**。

## 一、结论

摊销「时间闸门」（`month >= '2026-11'` 才计入利润）**拆除**。
从此：**未归档月一律按台账计入；归档月读落库快照冻结**。冻结职责只由「归档」承担。

## 二、为什么（三条，按权重）

1. **闸门保护的对象不存在，且它保护的是个错的数**
   闸门唯一目的是「不改老板已经看过的历史数字」。但小程序尚未上线，不存在第三方老板；
   而 dev 环境里 10 月那个数字**本身就是少扣摊销的错数**。保护错数 ≠ 保守，是保留 bug。

2. **按月冻结该由「归档」管，不该由「日期」管**
   归档是用户主动动作、语义明确、可撤销；日期闸门是代码里写死的常量，用户看不见也动不了。
   而开关（R736）已经删了 —— 用户**没有任何界面**能为历史月表达「这笔我要摊」。
   两套冻结机制并存必然打架，R737 的 P0 就是这套机制自己长出来的。

3. **现在是唯一零成本窗口**
   上线后再改 = 改用户已看过、可能已给会计的数字，那才是真事故。

## 三、实测代价（`review/evidence/r740_gate_cost_probe.js`，真跑 `amortizeForMonth`）

| 情形 | 闸门挡掉 | 性质 |
|---|---|---|
| 8 月起摊（装修 36,000 / 36 期） | 8/9/10 月各 1,000，**共 3,000** | 永久蒸发 |
| 10 月起摊（装修 + 设备） | 10 月一期 **2,000** | 永久蒸发 |
| 11 月起摊 | **0** | 无影响 |
| 全周期对照 | 带闸门 36 期求和 **33,000**；按台账 **36,000**（≡ 原值） | 闭包差 3,000 |

> 关键：被挡住的月份不是「延后扣」，是**以后补不回来**。36 期摊完之后账上永远少那 3,000。

探针附带钉住一个误用面（G-⑧/G-⑨）：引擎 `amortizeForMonth` **自己不看 `mode`**，
过滤 `mode !== 'lump'` 是调用方责任；漏写一句 filter，一次性投入会被当成 1 期摊销计入。

## 四、改动清单（8 个云函数文件）

| 文件 | 改动 |
|---|---|
| `cloudfunctions/calcMonthlyProfit/service.js` | 删常量/函数；`effectiveAmortizeFen = fenRoundN(amortizeFen)` 无条件；`switchUsed.amortizeSwitchOn` 恒 true；头注释重写（含拆闸门理由） |
| `cloudfunctions/getLedger/service.js` | 同上（`Math.round`）；`amortRuleV2` 出参删除；exports 去掉常量 |
| `cloudfunctions/saveLedger/service.js` | 同上 |
| `cloudfunctions/saveLedger/index.js` | `amortizeFen` 无条件从台账求和（无 if 分支）；不再读 `amortize_switch` |
| `cloudfunctions/getLedger/index.js` | `isArchiveNow ? 落库 : 台账`（删掉 `amortV2Now`）；`switch_on`/`switches` 恒 true |
| `cloudfunctions/getAmortSchedule/service.js` | 删常量/函数/exports |
| `cloudfunctions/getAmortSchedule/index.js` | `amortize_switch_on: true` 字面量；删 `amort_rule_v2` 出参 |
| `cloudfunctions/exportData/index.js` | 归档优先三元；备注改「台账无应摊资产」三态；口径说明去日期；差异行判据改「实际计入 ≠ 台账应收」 |

## 五、守卫变更（这是本轮真正的产出）

| 守卫 | 变化 |
|---|---|
| **`tools/check_amort_no_gate.js`（新，30 条）** | **取代** `check_amort_rule_v2.js`（31 条）。A 结构（八份文件零闸门残留）/ B 行为（任何月份任何开关一律计入、三副本同参同结果）/ C 闭包（36 期求和 ≡ 原值，闸门在时只有 33,000）/ D 接线（四调用点都传 month、都按台账取数、mode 过滤）/ E 变异回灌（塞回判据 ⇒ B-② 红）/ F 自失效护栏 |
| `tools/check_amort_rule_v2.js` | **删除**（整份前提是闸门） |
| `tools/check_amort_switch_matrix.js`（48 条） | A 段 9 条反转（开关对金额**零影响**，两侧必须相等）；D 段 3 条改向（导出件按台账口径、不再说"不计入"）；G-①/G-③ 变异方向反转（**塞回**判据而不是摘掉） |
| `tools/check_amort_display_caliber.js`（19 条） | H 段整段重写（页首恒 === 台账应摊额，不分月份不看开关）；K 段并入 H（所有月份都满足原 K 判据）；桩改为恒 `amortize_switch_on: true`；J-① 变异方向反转 |
| `tools/check_amort_rollforward.js`（34 条） | E-④ 反转：2026-10 两页都给全额（不再有"未计入"的历史月） |
| `tools/check_export_delivery.js`（50 条） | E18：口径说明要求「摊销开关 = 不适用」 |
| `tools/check_m1_extra_fields.js`（33 条） | A-⑤：`switch_on` 恒字面 true |
| `verify_all.js` | 注册项一换一（`amort-rule-v2` → `amort-no-gate`），套件数仍 **320** |

## 六、踩坑记录

1. **`);` 被我误删**：替换注释块时把 `_amortizeTotalForMonth(...)` 的收尾括号一起替换掉了 ⇒ `node --check` 抓到。教训：改注释块时别把紧邻的语句收尾卷进 old_string。
2. **变异回灌引用已删变量**：`check_amort_switch_matrix` 的 G-③ 变异体写了 `amortizeSwitchOn`，而引擎里那个变量已被删 ⇒ ReferenceError，看起来像"断言失败"，实际是"变异没编过"。改为 `clean.amortizeSwitchOn`。
3. **守卫调 `require(exportData)` 会崩**：它 `require('wx-server-sdk')`，本地没有。`check_amort_no_gate` 的 E-② 改为纯文本变异。
4. **`calcMonthlyProfit(clean)` 是变量形态**：`callSites` 只匹配 `calcMonthlyProfit({` 时漏掉它，D-① 误报"只有 2 个调用点"。改为同时认变量形态 + 检查 `clean` 构造处的 `month:` 字段。

## 七、边界与遗留

- **归档月仍冻结**：`is_archive=true` 读落库 `amortize_fen`，台账后来的改动不会倒灌。若归档月落库是 0 而台账现在算得出应摊，导出件会补一行「台账应收摊销（与本月计入额不一致）」并说明原因。
- **SOP**：以后要冻结某月，用「结账归档」，不要再想加日期常量。`check_amort_no_gate.js` A-①/A-② 会当场抓住。
- **待李老师确认**：是否需要把 10 月之前**已归档**的月份也解冻重算（默认不动：归档即封账）。
- **真机验收**：11 月结果页「摊销还有多久」卡 + 摊销页页首合计；另外请顺手看一眼 **10 月**的结果页摊销是否已从 ¥0.00 变成实际金额。

## 八、门禁与上云记录（2026-11-15）

- **门禁**：`node verify_all.js` ⇒ **320/320 套件通过**（`_gate_r740b.log`）。
- **提交**：`c86fa23` → 已推 `origin/dev`。
- **部署**（`_deploy_fns.py`，一次一个、带 `-r`，判据走 `_judge_deploy.js` 表格行命中）：

| 函数 | 结果 | 用时 | filesCount | packSize |
|---|---|---|---|---|
| calcMonthlyProfit | OK | 18s | 26 | 99.7 KB |
| getLedger | OK | 19s | 26 | 103.8 KB |
| saveLedger | OK | 18s | 26 | 100.0 KB |
| getAmortSchedule | OK | 17s | 26 | 90.3 KB |
| exportData | OK | 20s | 24 | 99.9 KB |

- **部署后回读**（`cli cloud functions info`）：5/5 `Active`，`runtime Nodejs16.13`；
  timeout 分别 20/20/20/20/60 —— **与部署前一致，未被冲回默认 3**。
- **真机码**：`R740_20261115_095239` · 出码 09:53:25 · 失效≈10:18:25 · HEAD `c86fa23` · 机器验码解出真实链接。
