# round104 回执 —— 子页返回后摘要行必须重读

- **批次**：round104（2026-09-23）
- **触发**：李老师真机反馈 —— 点「去填库存盘点」录入并保存后返回，**按钮下面那行摘要不变**；再进去改数，那行仍不变。
- **性质**：**真缺陷**（不是设计选择）。父页被 `navigateBack` 唤回时只触发 `onShow`，而摘要只在 `onLoad` 里算过一次。
- **改动面**：**纯前端 2 个文件**（`pages/month/input.js`、`pages/month/inventory.js`）+ 1 个守卫文件。**不涉及云函数 ⇒ 无需部署，出码即生效。**

---

## 1. 现象与链路

```
录入页 input ──(navigateTo)──▶ 库存页 inventory ──(保存)──▶ wx.navigateBack()
   ▲                                                            │
   └────────────── 回到的是**已有实例** ⇒ 只触发 onShow ◀────────┘
```

用户看到的那行字：`pages/month/input.wxml:319-320`

```html
<button class="btn ghost" bindtap="goInventory">{{t.cmConsumeInvGo}}</button>
<view class="cm-state">{{invSummary || t.cmConsumeInvEmpty}}</view>
```

同构的还有摊销段（`input.wxml:345-346`：`goAmortize` + `assetSummary`）。

## 2. 根因

| 事实 | 位置 |
|---|---|
| `invSummary` 只在 `load()` 里算 | `pages/month/input.js:337-342` |
| `load()` 只被 `onLoad()` 调用 | `input.js:184` |
| `onShow()` **只回填本地草稿**，不拉数据 | `input.js:186-206` |
| 库存页保存后是 `navigateBack()`（回已有实例） | `pages/month/inventory.js:172` |

⇒ 本页是**被唤回的已有实例**，`onLoad` 不会重跑，`onShow` 又不重拉 ⇒ **摘要恒显旧值**。

## 3. 全量扫查（先查同类，再动手）

`grep onShow()` 覆盖 `pages/` 全部页面：

| 页面 | onShow 行为 | 判定 |
|---|---|---|
| `shop/switch` `pay/orders` `shop/setting` `card/index` `month/index` `index/index` | `onShow() { this.load(); }` | 正常（重拉） |
| **`month/input.js`** | 只回填草稿 | **本缺陷** |
| **`month/inventory.js`** | 只回填草稿 | **同族缺陷（本轮一并修）** |

### 3.1 同族缺陷 B（我顺链挖出，李老师未提）

库存页的「期初自动结转」来自上月期末（round103 落地）。用户点**「去改上月期末」**（`inventory.js:125-128`）→ 改上月 → 返回本月库存页：`onShow` 不重拉 ⇒ 只读期初仍是旧数，**此时一点保存就把旧期初落库**，与上月期末打架。

## 4. 修法（最小且安全）

### 4.1 `pages/month/input.js`

```js
onShow() {
  /* …原草稿回填不变… */
  if (this._shown) this.refreshCalcSummaries();   // 首次 onShow 紧跟 onLoad，load 已拉过 ⇒ 跳过，省一次云调用
  this._shown = true;
},
```

新增两个方法：

- `invSummaryOf(d)` —— **摘要算法的唯一实现**，`load()` 与刷新共用（把原先内联在 `load()` 里的那段抽出来，**避免两处各写一份而漂移**）。
- `refreshCalcSummaries()` —— 重读 `getLedger`，**只** `setData` `inventoryOn / amortizeOn / invSummary`，并按需 `loadAssetCount()`。

### 4.2 `pages/month/inventory.js`

- `onShow()` 同样加 `_shown` 门闩 + `refreshOpeningCarry()`。
- `refreshOpeningCarry()` —— **只**刷新「期初自动结转」相关的只读态（`openingAuto / prevMonth / openingYuan / openingNote`），**只在自动结转态**下才动金额。

## 5. 两条硬护栏（防「修 A 引入 B」）

| 护栏 | 为什么 |
|---|---|
| `refreshCalcSummaries` **不得**碰 `incomeGroups / expenseGroups` | 重建 groups 会用后端值**覆盖本页还没保存的草稿**（与 `onShow` 的草稿回填直接打架） |
| `refreshOpeningCarry` **不得**碰 `purchaseYuan / closingYuan` | 采购 / 期末是用户手填项，覆盖即丢草稿 |

两条都写成了断言（见 §6 的 A8-⑤ / A8-⑧），并由变异回灌证明**真能抓到**。

## 6. 守卫与变异回灌

在 `tools/selftest_batch8b.js` 新增 **A8 组（8 条）**，套件断言数 **153 → 161**：

| 断言 | 内容 |
|---|---|
| A8-① | 录入页 onShow 触发摘要重读 |
| A8-② | 重读**真去后端取数**（不是本地重算 / 读缓存） |
| A8-③ | 首次 onShow 不重复取数（`_shown` 门闩） |
| A8-④ | 摘要算法单源（load 与刷新共用一份） |
| A8-⑤ | 刷新**不得**重建 groups（护栏） |
| A8-⑥ | 库存页 onShow 也触发期初刷新 |
| A8-⑦ | 期初刷新真去后端取数 + 会更新只读态金额 |
| A8-⑧ | 期初刷新**绝不**覆盖采购 / 期末两格（护栏） |

**变异回灌 5/5 全部被抓到**（逐条独立、跑完立即还原，还原后 161/0）：

| 变异 | 被抓红条 |
|---|---|
| M1 录入页 onShow 不再触发摘要重读 | A8-① A8-③ |
| M2 摘要重读不再去后端取数（改成空对象） | A8-② |
| M3 摘要重读顺手重建 groups（会覆盖草稿） | A8-⑤ |
| M4 库存页 onShow 不再刷新期初 | A8-⑥ |
| M5 期初刷新顺手覆盖采购格（会丢草稿） | A8-⑧ |

## 7. 自我纠正（首版判据是假绿）

**A8-⑧ 首版判据**只认对象字面量键：`!/purchaseYuan\s*:/`。
变异 M5 用的是**属性赋值** `patch.purchaseYuan = '0'` ⇒ **首跑「未抓到」**（161/0 全绿，假绿）。

改判据为 `[:=]` 两种写法都覆盖后，M5 被正确抓红。
（这与 round103「判据绑死写法 ⇒ 假红/假绿」是同族病，**换个形式又犯了一次** ⇒ 判据必须同时覆盖「字面量键」与「属性赋值」两种形态。）

附带一处笔误：用编辑器直接写 `\s` 时多写了一层转义（`\\s`），JS 正则会失效 ⇒ 已按字面修正并复核字节。

## 8. 证据

| 项 | 结果 |
|---|---|
| 锚点前置校验 | 5/5 唯一命中（input.js CRLF、inventory.js LF **各自自适应**） |
| `node --check` | input.js / inventory.js / selftest_batch8b.js **全 OK** |
| 单套件 | `selftest_batch8b` **161 通过 / 0 失败** |
| 变异回灌 | **5/5 抓到**，还原后 161/0 |
| 全量门禁 | **96/96 套件通过，RC=0**（证据 `review/evidence/gate_96_r104.txt`） |
| 断言数口径守卫 | 21 通过 / 0 失败（声明 161 ≡ 实跑） |
| 改动规模 | input.js 59086 → 60686 B；inventory.js 7410 → 8753 B |

## 9. 遗留

1. **真机未验**：仍需李老师扫码实测「改库存 → 返回 → 摘要跟着变」。
2. **`_shown` 门闩的边界**：若页面被 `navigateTo` 复用来做别的用途（当前无此用法），首次进入不会刷新 —— 记录备查。
3. **D6 链式重算**（round103 遗留）：改上月期末后自动重算该月及之后所有月 + 弹确认 + 留痕，仍单列下批。
4. 仓根 + `review/evidence/` 下历轮未跟踪临时脚本，等李老师点头再清理。
