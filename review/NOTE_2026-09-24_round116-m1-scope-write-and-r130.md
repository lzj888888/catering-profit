# NOTE · round116 —— M1「行业选择没变化」真云根因 + R130 写库主键守卫

- 日期：2026-09-24
- 触发：李老师真机反馈两条（原话）
  ① 「模块一 行业对比 里面 行业选择，没有变化。」
  ② 「点击 导出月度报表，提示错误，是现在不能验证这个功能还是这块还没有写好？」
- 分支：`dev`；commit：`待回填`

## 一句话结论

| 问 | 答 |
|---|---|
| ① 行业选择没变化 | **是真 bug**（写库打到不存在的 `_id`，真云**静默 0 行不报错**）⇒ **已修 + 真云双向验证通过** |
| ② 导出提示错误 | **不是没写好**。导出是**付费功能**，免费档点它必然弹「导出需开通」⇒ 设计如此；**当前免费档 ⇒ 导出产物本身无法验证** |

---

## 一、确诊过程（真云探针，不靠推断）

工具：`_gui/_probe_r116.js`（**拆项跑**：一次连接只调 1~2 个云函数，否则 automator 必超时 —— 本轮踩过一次）。

| 步骤 | 命令 | 关键输出 |
|---|---|---|
| 基线 | `_probe_r116.js ro` | `indicator_scope: {biz_type:'', city_tier:'', is_default_scope:true}`；参考带 = dining 兜底（labor 17-22 / energy 3-5） |
| 权益 | `_probe_r116.js ent` | `is_active: false, expire_at: 0` ⇒ **免费档**（`payQueryEntitlement` 必须带 `shop_id`，否则 INVALID_PARAM） |
| 导出 | `_probe_r116.js exp` | `code: FEATURE_LOCKED, msg: '导出需开通真实利润'` |
| 写业态 | `_probe_r116.js wr hotpot` | `saveShopSetting` → **SUCCESS**，`data.biz_type: 'hotpot'` |
| 读回 | `_probe_r116.js rd` | `indicator_scope.biz_type` **仍是 `''`**、参考带**仍是 dining** ⇒ **断链** |

### 决定性实验（`proof`）：区分「写入没落库」vs「读取侧旧版」

`saveShopSetting` 的 `name` 是**唯一从库里回读**的字段（`remark` 只是入参回显）⇒ 拿它当探针：

```
step1 读库      name_from_db = '默认店铺'
step2 写         name='R116PROBE' + biz_type='cafe'  →  接口返回 SUCCESS
step3 再读库    name_from_db = '默认店铺'  /  biz_type_from_db = ''
```

⇒ **写入没落库，接口却报成功** —— 静默失败坐实。

---

## 二、根因

`cloudfunctions/saveShopSetting/index.js:49`（修前）：

```js
await db.collection('shop').doc(shopDoc.id || shopId).update({ data: patch });
```

链条：

1. `dataAdapter.get()` 在 **2026-09-19** 修过「业务主键 ≠ `_id`」——**但只修了「读」**（加了按
   `id/material_id/asset_id/shop_id/account_id` 逐个兜底查）；
2. **「写」仍用业务键** ⇒ 调用方拿文档里的 `id` 字段（或入参业务 id）去 `doc(...).update()`；
3. 该文档 `_id ≠ 业务 id` 时，`doc()` 指向**不存在的文档**；
4. 微信云开发 `update()` 对不存在文档 **静默返回 0 行、不抛异常**；
5. ⇒ 接口回 `SUCCESS`、库里一个字没改、**前端与复审双方都看不见任何错**。

用户可见症状 = M1 结果页「选完行业没变化」（且**没有任何报错**）。

> ⚠️ 这条与 2026-09-19 那批（读侧 6 处）是**同族但不同层**：那批修了读，这批是写。**读写不对称**才让它在门禁全绿的情况下活了下来。

### 同族排查（全量 22 处 `.doc().update/remove`）

| 位置 | 修前写法 | 判定 |
|---|---|---|
| `saveShopSetting:49` | `doc(shopDoc.id \|\| shopId)` | 🔴 已修 |
| `saveMaterial:62` | `doc(m.id)`（入参业务 id） | 🔴 已修 |
| `saveCostCard:228` | `doc(vm.id \|\| vm.material_id)` | 🔴 已修 |
| `syncCostCard:153` | 同上 | 🔴 已修 |
| `archiveMonth:62` / `saveLedger:154` / `saveAsset:87,102` | `doc(x._id \|\| 业务id)` | ✅ 本就 `_id` 优先（说明是**漏改**不是设计） |
| `adminRefundMark:50,53` | `doc(docId)`（管理端注入依赖） | ⚠️ 白名单 + 待办（见 §六） |
| `smokeTest:120,142` | 探针函数（显式 `_id`） | ✅ 白名单 |

---

## 三、修复

`saveShopSetting/index.js`：

- 写库改用**权威主键**：`const shopRid = shopDoc._id || shopDoc.id || shopId;`
- **对 `stats.updated === 0` fail-loud**（把"静默失败"永久消灭）：
  ```js
  const upRes = await db.collection('shop').doc(shopRid).update({ data: patch });
  const updated = (upRes && upRes.stats && upRes.stats.updated) || 0;
  if (!updated) return fail(ERROR_CODES.SYSTEM_ERROR, '店铺设置未写入（target=' + shopRid + '）');
  ```
- 原 `if (shopDoc) {…}`（取不到文档就**整段静默跳过**）改为 **fail-loud**。

同族 3 处：`saveMaterial` → `doc(exist._id || m.id)`；`saveCostCard`/`syncCostCard` → `doc(vm._id || vm.id || vm.material_id)`。

### 真云验证（修复后）

```
_probe_r116.js proof → step3 读回 name='R116PROBE', biz_type='cafe'   ⇒ 写入真落库 ✅
_probe_r116.js rd    → scope.biz_type='cafe'；参考带整体切换：
                        grossMargin 62-72 / rent 5-12 / labor 14-18（评级 ok→warn）/ energy 1-3 / mkt 3-8
                        （对比 dining 的 55-65 / 8-15 / 17-22 / 3-5 / 5-10）⇒ 读侧也通 ✅
_probe_r116.js restore '默认店铺' ''  → 回读确认已还原 ✅
```

---

## 四、守卫 R130 `tools/check_doc_id_write.js`（36 条）

判据：扫全部云函数（跳过 `common/` 单源与 `cx_*` 派生副本）的 `.doc(<arg>).update|set|remove(`：
- ✅ arg 直接含 `_id`；
- ✅ arg 是简单标识符，且**在所在函数体内**回溯到含 `_id` 的赋值；
- ⭕ 显式白名单（**必须写理由**，且带 B 组约束：无死条目 / ≤3 条 / 有 todo 必须标注）；
- ❌ 其余 ⇒ 违规。

**四个"反恒真"设计**：① 解析器自带 16 条钉死样本（含注释/字符串误扫、跨行、`set`/`remove`）；
② 正负样本互证；③ 真扫单源（≥40 目录 / ≥80 文件 / ≥15 写点）；④ 下界取实测 36 的保守下沿 33。

> 🔴 立守卫过程中**守卫自己被抓出 3 个错**（正是钉死样本起作用）：
> ① 字符串里的 `.doc(...)` 被误扫 ⇒ `stripJs` 改为**清空字符串内容**；
> ② 变量回溯漏了**裸赋值**（`saveLedger` 的 `accountId = existing._id || …`，只有 151 行 `let` 声明、153 行才是赋值）⇒ 补上；
> ③ **跨函数同名串味**：`smokeTest` 的形参 `id` 被同文件 78 行另一个 `id = addRes._id` 隔着几十行**误判为安全**（假绿！）⇒ 加 **`fnBoundary` 函数体边界**，把回溯限制在写点真正看得见的作用域。

### 变异回灌（证明非假绿）

`_mut_r130.py`：逐条把 4 处修复**改回旧写法** → 跑守卫 → 立刻还原。

**结果：4/4 如期转红**，且每次红的正是 **A-④（违规数==0）** 与 **A-⑥（修复点仍是安全写法）**；还原后**逐字节 md5 全等**、守卫复绿。

---

## 五、门禁与部署

| 项 | 结果 |
|---|---|
| 门禁 | **103/103 · RC=0**（套件 102→103；证据 `review/evidence/gate_103_r116.txt`） |
| 挂门禁 8 处 | 头注套件数 / 头注 R130 条 / SUITES 尾 / 重启键入口行 / 重启键「会漂」行+演进链 / 断言数声明行（十九者→二十者，`check_doc_id_write`=36）/ `check_suite_assert_counts` CASE / `selftest_r85::A15_EXEMPT`（登记 3 个云函数） |
| 部署 | `saveShopSetting`（已真云验证）、`saveMaterial`、`saveCostCard`、`syncCostCard` —— 均 `success=true` / filesCount=16 / **带 `-r`** / 一次一个 |
| 证据 | `review/evidence/deploy_r116.txt`、`review/evidence/mut_r130_r116.txt` |

---

## 六、待办（**如实标注未做的部分**）

1. 🔴 **同族 3 处只做到「已修 + 已部署」**：`saveMaterial` / `saveCostCard` / `syncCostCard` 的
   真云"编辑物料 / 同步成本卡"链路**尚未逐条真云探针验证**（需构造真实物料与成本卡，本轮未做）。
   门禁与守卫已覆盖；**真云行为验证记入下一轮**。
2. ⚠️ **`adminRefundMark`** 的 `doc(docId)`（管理端退款标记）：调用方传的是否为 `_id` **未核**，
   已列入 R130 白名单并带 `todo`。管理端退款链路单开一轮收口。
3. **前端需「上传体验版」**才能真机看到修复效果（部署云函数不覆盖前端）；出码不自动，李老师要时说。
4. `round111` 遗留 4 条（易耗品 / 净利率分档 / 水电燃气拆格 / 三项刚性）与 `PLAN §5` 五条口径 —— 均**未动**（一改就变用户可见数字，按纪律不代选）。

## 七、执行回执

- [2026-09-24 16:20] round116 **已落** · 证据：`_probe_r116.js proof/rd/restore` → 写入真落库 + 参考带随业态切换 + 已还原；`verify_all.js` → `103/103 RC=0`；`_mut_r130.py` → 4/4 转红且还原 md5 全等 · commit `待回填`
- [2026-09-24 16:30] **提交前一刻复跑门禁**（不采信上一轮自述）：`verify_all.js` → `103/103 套件通过` · RC=0，原始输出 3602 行落盘
  `review/evidence/gate_103_r116_recheck.txt`（含 `[doc-id-write] ✅ PASS (✅ 36 条 / 段 6)` 与段 A-⑥ 三处修复点回归）。
