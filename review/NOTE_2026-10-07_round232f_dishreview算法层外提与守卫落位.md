# NOTE · R232f — getDishReview 算法层外提（service.js）与专属守卫落位

- **日期**：2026-10-07
- **基线**：`dev@72797f0`（R232e 收尾）→ 本轮产出 `getDishReview` 重构
- **套件数**：148 → **149**
- **授权**：李老师「听你的，你现在是全局统帅，知道我们小程序要表达的东西，要实现的目标。你操作吧。」

---

## 一、为什么做这一轮（缺口定位）

R232b/c/d 三轮修了 C-9 / C-10 / C-11 三条形态类缺陷，但**审计面**暴露出一个更大的空洞：

> `cloudfunctions/getDishReview/` 的全部算法 —— 聚合、取最新版本、名称匹配、毛利率、排序、totals、未匹配单列 —— **全部内联在 `exports.main` 里**。

后果有三层：

1. **不可 require** ⇒ 无法独立复算 ⇒ 我们**唯一能验证它的方式就是把这个函数整体部署上云再真机跑**。这是本项目最贵的验证路径。
2. **零专属守卫** —— 仓内 148 个套件里，没有任何一个盯它。C-10（`getDishReview::monthOf` 本地时区）当初就是在这个区域被发现的，而发现方式是**人肉读码**，不是门禁。
3. 它恰好是 **付费墙钩子**（`m3_dishreview`）**且是用户最终看到的东西** —— 算错了用户直接看到错的毛利率。

对照同期交付的兄弟函数 `importSalesBill`：它一开始就是 `index.js`（鉴权+取数）+ `service.js`（纯算法）+ `validate.js` 三段式。**`getDishReview` 缺的正是这一层**。

---

## 二、做了什么

### 2.1 算法层外提为纯函数

**新增** `cloudfunctions/getDishReview/service.js`（100 行）

```js
function buildDishReview(sales, cards, deps) {
  const normalizeDishName = deps.normalizeDishName;
  const toMonth = deps.toMonth;
  // ① 取各 card_code 最新版本（version 大者胜）
  // ② 归一名称 → card_code（走注入的 normalizeDishName，零副本）
  // ③ 按 dish_key 聚合销量
  // ④ 匹配 + 计算（未匹配单列，绝不归零）
  // ⑤ totals（qty/amount 含未匹配；cost/gross 只算已匹配）
  return { dine_in: ranked, unmatched, totals };
}
```

**关键设计**：签名里 `deps` 注入 `normalizeDishName` / `toMonth` —— 因为云函数**不能跨函数 require**，只能从 `common/` 派生。注入而非重写副本，是为了不产生**第三份名称归一副本**（C-9 就是两副本分叉病）。

**改造** `cloudfunctions/getDishReview/index.js`（127 → 80 行）：现在只做 鉴权 → 付费墙 → 取数 → 调 service → 返回。

### 2.2 新增专属守卫

**新增** `tools/check_dishreview_engine.js` —— **32 条断言**，五段：

| 段 | 条数 | 内容 |
|---|---|---|
| ⓪ | 4 | 模块在场（service.js 存在、导出 `buildDishReview`、index 已 require） |
| ① | 16 | **真调生产 `buildDishReview`** 实跑 7 组场景（非字面扫描） |
| ② | 5 | 架构防回归（无内联 `new Map()` 聚合块 / 无手写毛利率公式 / 无本地时区月份拼装） |
| ③ | 3 | 单源不扩散（名称归一未产生第三副本） |
| ④ | 4 | **自失效护栏**（扫描面非退化 + 关键锚点在场） |

🔴 **顶部横幅刻意不用 `===` 装饰** —— R66 会判「段标题下零断言」，只有末段且形如 `N 通过 / M 失败` 才豁免。这是 R232 学到的坑，本轮直接规避。

### 2.3 独立复算锚点

**新增** `review/evidence/r232f_dishreview/recalc_anchors_dishreview.js`

**22/22 通过 · RC=0** —— `require` 的是**生产 service.js**（不是副本），7 组场景：

- S1 基础档 · S2 未匹配不归零 · S3 同 dish_key 聚合 · S4 零收入 · S5 空 key · **S6 C-10 UTC 回归** · S7 反恒真

🔴 **踩坑记录**：首跑报 `TypeError: d.getUTCFullYear is not a function`。根因是我给 `toMonth` 喂了 **ISO 字符串**，而 `utilTime` 的契约是 **Unix 毫秒 BIGINT**（`created_at` 来自 `nowUtc()`）。修法 = 样本转毫秒（`Date.UTC(2026,8,30,17,30,0)` = `1790789400000`）。
**教训**：先验样本路径与数据契约，再动判据 —— 与「变异打不红 ⇒ 先怀疑样本没走到被测代码」同族。

### 2.4 变异回灌

**新增** `review/evidence/r232f_dishreview/mut_dishreview.py`

**6/6 全部有效红**，且**必须红在目标断言名上**（崩溃红不算）。基线 blob 断言 + 还原后 blob **逐字节相同**。

| # | 变异 | 目标断言 |
|---|---|---|
| M1 | 版本选择反向（取旧版） | ①-最新版本 |
| M2 | 未匹配归零 | ①-未匹配不归零 |
| M3 | 除零不设防 | ①-毛利率除零 |
| M4 | totals qty 漏未匹配 | ①-totals 口径 |
| M5 | 月份拼装回本地时区 | ②-③ C-10 防复发 |
| M6 | 聚合被覆盖写 | ①-dish_key 聚合 |

---

## 三、同步面（六处）

| # | 位置 | 状态 |
|---|---|---|
| ① | `verify_all.js::SUITES` 追加 `['dishreview-engine', 'tools/check_dishreview_engine.js']` | ✅ |
| ② | 同文件头注「串联：N 个套件」→ 149 | ✅ |
| ③ | 头注守卫说明段 | ✅ |
| ④ | `★知识存储点` §1.1 入口行 → 149 | ✅ |
| ⑤ | 同文件「套件数会漂」行 → 149 **＋演进链尾部追加 149** | ✅ |
| ⑥ | **断言数声明行**（重启键内带语义标记的那一行）追加 `check_dishreview_engine`=32 ＋ 「五十九者」→「六十者」 | ✅ |

🔴 **第 ⑥ 处是「六处同步」里最容易漏的** —— 它和 `check_suite_assert_counts.js::CASES` 是**同一处的两半**：CASES 登记了 key，声明行漏写 ⇒ 守卫 A2 判红（本轮实测抓到）：

```
❌ A2-check_dishreview_engine 声明行缺少 `check_dishreview_engine` 的断言数
```

补上后：

```
· tools/check_dishreview_engine.js → 32 通过
✅ A2-check_dishreview_engine 声明 32 ≡ 实跑 32
```

---

## 四、门禁结果

（见 §五 实测记录）

## 五、遗留 / 待用户处置

1. 🔴 **`getDishReview` 需重新部署** —— 本轮重构了 `index.js` 并新增 `service.js`，**云端版本已陈旧**。按纪律必须重部署（一次一个 + `-r`）。
2. 🔴 **`getDishReview` 云端 `timeout` = 3** —— 平台默认值，首次部署即重生（R215d 的「全 44 个无 3」已被本会话实测**证伪**）。必须在 **云开发控制台 → 版本与配置 → 高级配置 → 执行超时** 抬到 20，否则真机会超时。李老师已选「先放着」，但真机测试前必须做。
3. 真机点一次（模拟器 ≠ 真机）。
4. C-8 拍板（批次 H 范围重估 —— C-9/10/11 均已修，建议 H-1 独立成批）。
