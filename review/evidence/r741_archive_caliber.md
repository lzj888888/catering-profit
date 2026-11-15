# R741 · 已归档月的口径变更处理 —— 三司会诊后的落地

> 日期：2026-11-15
> 会诊底稿：`r741_consult_brief.md`　裁决：`r741_consult_verdict.md`
> 原始回复：`Claw/_r741_ark.md`（豆包）· `Claw/_r741_ds.md`（DeepSeek）

---

## 一、李老师的问题

> 「小程序还没正式上线，所以，目前这种情况，关于边界问题，尤其是你提到的 10 月 11 月数据，你觉得如何处理更好呢？」
> 追加：「这个问题你三司会诊一下，因为现在的数据都是模拟数据，没有给用户造成困扰，所以，你看怎么处理，或者按照你的想法处理即可。」

---

## 二、结论先行

| 问 | 答 |
|---|---|
| 已归档月要不要解冻重算？ | **不重算**。三司一致：自动改已封账的数比留旧数更危险。 |
| 那旧数就这么埋着？ | **不埋**。改成「可见 + 可比 + 可操作」：说清差多少、并指路怎么重算。 |
| 要不要口径版本号框架？ | **不做**。三司一致判为过度设计。 |
| 模拟数据要不要清一遍？ | **不做**。没有云端数据库读取通道，任何批量都是盲写。 |

> **历史不追、错数不改、但把「这个月是按旧规则封的」说出来，并且让用户自己决定要不要重算。**

---

## 三、会诊过程（四轮质证，两次推翻）

### 采纳：两司一致的「不自动重算」

- **DeepSeek**：「自动重算会让归档这个动作失去语义……用户对封账的信任一次性透支。」
- **豆包**：「后台私改封账数值会直接击穿产品信任，后续封账功能没人敢用。」

判据不是合规，是**归档=「这个数从此不再动」**。系统能悄悄改它，归档就退化成缓存标记。

### 采纳：两司一致的「不做版本号」

- **DeepSeek**：「变更频率 × 单次成本……这是为不存在的场景写框架。」
- **豆包**：「开发量至少是本次需求的 3 倍……投入产出比为负。」

⚠️ 我方底稿里本来倾向做版本号，被两司同时否掉 —— **这跟 R736 犯的是同一个错**（为不存在的场景写代码）。记录在案，避免下次再犯。

### 否决：豆包提的「只撤 6.5 小时窗口内的归档月」

豆包建议按窗口筛，范围最小。**我方否决**：本仓 `cli` 没有数据库查询子命令，我们连「哪些月是归档月」都读不到 —— 任何批量操作都是盲写。为一个概率极低的模拟期错数去盲写生产库，风险收益倒挂。

### 核实后不成立：豆包提的「趋势图可能偷偷用现算值」

豆包原话：「利润趋势图、累计汇总默认必须用封账原值，否则老板会把规则差异当成经营波动。」

**核实结论：担心是对的，但本仓已消除。** `result.js::loadChecklist` 逐月调 `getLedger` 取历史，而 `getLedger` 是**唯一出口**、归档判决在它内部（`isArchiveNow ? 落库 : 台账`）。⇒ 冻结实现在**数据源出口**而不是某个页面 ⇒ 趋势图/异常核对/导出/月报全部自动继承，结构上不可能「某页用现算」。这是值得保留的架构性状。

---

## 四、我方独立发现（两司都没看到，且比原议题更急）

### 🔴 P0-1 · R740 拆闸门时把「同月两页打脸」重新长出来了

| 出口 | 归档月摊销额取哪个 |
|---|---|
| `getLedger`（结果页 / 趋势图 / 月报） | `acct.amortize_fen`（**落库快照**） |
| `getAmortSchedule`（摊销页页首大数字） | `sched.total_amount_fen`（**台账现算，无归档分支**） |

同一个函数上面明明读了 `isArchive`，却只用它决定「页面是否只读」，**金额那一行没跟上**。

⇒ 归档月一旦漂移，摊销页显示 A、结果页显示 B。这正是 **R735 修过的病**，R740 把它重新长了出来。

**为什么守卫没抓到**：`check_amort_display_caliber` 的 I 段测的是 `amortize_switch_on`（开关参数），桩里 `is_archive: false` 是**硬编码**的 —— 一个断言都没碰过「归档月页首到底显示多少钱」。**守参数不守金额**，是这条回归能活下来的原因。

### 🔴 P0-2 · `archiveMonth` 给「从没录过的月」造全 0 假账

原实现：找不到该月账 ⇒ `da.insert('shop_monthly_account', { amortize_fen: 0, gross_profit_fen: 0, ..., is_archive: true })`。

用户对准一个空月份点「归档」⇒ 系统凭空生成一处「利润 0」的封账记录，且此后被 `ARCHIVED_LOCKED` 永久锁死。**会计上这是替用户造了一笔零申报。**

---

## 五、改动清单

### 云函数（2 个）

**`cloudfunctions/getAmortSchedule/index.js`**
```js
const recomputedTotalFen = sched.total_amount_fen;
const snapshotFen = (acc && acc.amortize_fen != null)
  ? Math.round(acc.amortize_fen) : recomputedTotalFen;
const totalAmountFen = isArchive ? snapshotFen : recomputedTotalFen;
const caliberDriftFen = isArchive ? (recomputedTotalFen - snapshotFen) : 0;
```
出参：`total_amount_fen: totalAmountFen`（页首唯一来源）+ `recomputed_total_fen` + `caliber_drift_fen`（对照，未归档恒 0）。

**`cloudfunctions/archiveMonth/index.js`**
```js
if (!acct) {
  return fail(ERROR_CODES.RESOURCE_NOT_FOUND, v.archive
    ? '该月还没有任何账目记录，请先录入再归档'
    : '该月还没有任何账目记录，无需取消归档');
}
```
连带退役：`genId` 解构（建账专用依赖，路径没了就不该留着）。错误码用**既有** `RESOURCE_NOT_FOUND` —— 在 `common/` 新增码会触发 42 个函数全量部署，不值。

### 前端（3 个文件）

- `subpkg/biz/month/amortize.js`：读 `caliber_drift_fen`，出 `archiveDriftNote` / `hasArchiveDrift`；**不改金额**。
- `subpkg/biz/month/amortize.wxml`：页首数字下加一行说明（`wx:if="{{hasArchiveDrift}}"`）。顺带把注释里已退役的 `AMORT_RULE_V2_FROM` 说法改掉。
- `subpkg/biz/month/amortize.wxss`：`.archive-drift`（28rpx 守住 AD-G1，灰字无底色 —— 它是解释不是警告）。
- `miniprogram/i18n/terms.js` + `specs/dev-specs/i18n/terms.js`（双副本逐字一致）：`archiveDriftNote(snapshotAmt, recomputedAmt, diffAmt)`。

**实际文案**（三条纪律：不提「口径」、必须给差额、必须指路）：
> 本月已封账，按封账时的算法计入 ¥0.00；现按资产台账重算为 ¥4333.33（相差 ¥4333.33）。如需按现在的算法，取消归档后重新保存即可。

---

## 六、守卫变更

| 守卫 | 变更 |
|---|---|
| `tools/check_amort_display_caliber.js`（19 → **25**） | 新增 **L 段 6 条「归档月金额维度」**：L-① 服务端三元取快照 / L-② 两个对照字段 / L-③ 页首 = 封账值 0.00 / L-④ 说明含三个金额 + 指路 / L-⑤ 未归档不出说明 / L-⑥ 变异回灌（页首改用重算值 ⇒ L-③ 转红）。桩新增 `scheduleArchive`，`is_archive` 不再硬编码 false。 |
| `tools/check_archive_no_fake.js`（**新增，12 断言**） | S 扫描面 2 + A 归档不许造账 6（无 insert / 无 add 绕行 / fail-closed / 先判后写 / genId 退役 / 注释声明）+ B 反恒真 4（变异注入 / 变异后 A-① 与 A-③ 会红 / 断言数下界）。 |
| `verify_all.js` | 追加 `['archive-no-fake', ...]`，套件 **320 → 321**，头部注释同步（R59 守卫会校验）。 |
| `tools/check_suite_assert_counts.js` + `★知识存储点` | 声明 `check_amort_display_caliber`=25、新增 `check_archive_no_fake`=12。 |
| `tools/selftest_r85.js` | A15 豁免追加 `/^cloudfunctions\/archiveMonth\//`（第 8 次触发该「时机关卡」，按纪律记 by/date/reason）。 |

---

## 七、踩坑记录

1. **变异锚点被同一 setData 的后续字段覆盖**：L-⑥ 第一版把变异插在 `totalFen:` 处，被紧随其后的 `shownTotalYuan:` 覆盖 ⇒ 变异体跑出来还是 0.00，看着像「断言不灵」，实际是「变异没生效」。同 R740 G-③ 的坑（变异没编进生效路径）。
2. **`const` 跨段引用撞 TDZ**：L 段在 J 段之前，共用锚点 `H_ANCHOR` 声明在 J 段 ⇒ `Cannot access 'H_ANCHOR' before initialization`。上移到 L 段开头。
3. **i18n 双副本漏同步**：只改了 `miniprogram/i18n/terms.js`，`specs/dev-specs/i18n/terms.js` 没改 ⇒ `selftest_ad_gates` 的 K11 判红。
4. **断言数声明不在本文件里**：`tools/check_suite_assert_counts.js` 的注释只是给人看的，真声明在 `★知识存储点_2026-09-10.md` 的唯一标记行（`key=N` 形式）。改注释不改那行 ⇒ 仍然判红。
5. **A15 时机关卡第 8 次触发**：`git status` 里 `cloudfunctions/archiveMonth/` 有改动即判红。按既有纪律加白名单条目 + 记 reason，绝不放宽成 `cloudfunctions/` 全豁免。

---

## 八、诚实边界（没做的、做不到的）

- **不知道云端有没有归档月**。`cli cloud functions` 子命令集只有 `list / info / deploy / inc-deploy / download`，**没有数据库查询** ⇒ 我们读不到 `shop_monthly_account.is_archive` 的真实分布。本次改动是「让漂移可见」，**不是**「确认没有漂移」。
- **没有迁移脚本**。若真机上看到某归档月带差异说明，处置办法是用户手动「取消归档 → 重新保存 → 再归档」—— 三步都是既有能力，零新增代码。
- **`check_archive_no_fake` 的 A 段是源码形态判定**（改措辞会转红），B 段是变异回灌互补。与 R256 同一手法。

---

## 九、真机验收

1. **摊销页**：任一月份页首大数字正常；若该月已封账且与现算不等，数字下面应出现灰字说明（含三个金额 + 「取消归档」指路）。
2. **归档一个空月份**：应报「该月还没有任何账目记录，请先录入再归档」，**不应**凭空出现一个利润 0 的月份。
3. **同月两页对账**：归档月的摊销页页首金额应 = 结果页该月摊销额（R740 后这是第一次真正对齐）。
