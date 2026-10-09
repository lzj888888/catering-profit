# R249 · 「导入淘宝闪购后单品毛利复盘外卖区不变」+「京东导入报错」根因修复

> 触发（李老师原话）：
> 「我导入淘宝闪购的单子，落盘后到 单品毛利复盘，外卖这里完全没有变化，见上图。
>   如果导入京东的提示 会提示填写错误，无法导入。」

---

## 一、结论（一句话）

| 报障 | 性质 | 根因 | 处置 |
|---|---|---|---|
| A 淘宝闪购导入后外卖区不变 | **真缺陷**（假绿型：写成功、读不出、两端零报错） | 三处裸写 `.doc(_id).set()` **未写 `is_deleted`**；而读侧 `dataAdapter` 的 `list/listAll/countActive` 强制 `is_deleted:false`（**严格等值**）⇒ 文档被静默过滤 | 三处补 `is_deleted:false` **+** 落根因守卫 `tools/check_doc_write_isdeleted.js` |
| B 京东导入提示「填写错误」 | **部署落后**（非代码缺陷） | 本地源（R245/R246）已支持京东，但 `importSalesBill` **自 2026-10-05 R215d 后未再部署** ⇒ 云端跑的是老 `validate.js`（无 `jd_order/jd_sku`）与老 `service.js`（无 `PLATFORM_PROFILE`） | 部署 `importSalesBill`（含 R245/R246/R249 全部改动） |
| C 外卖未匹配菜品不可见 | **附带发现 · 真缺陷**（同轮修） | `getDishReview` 回**两层**未匹配；页面只读顶层那份（= 仅堂食），外卖的 `by_platform[p].unmatched` **从不读** ⇒ 「红线 17 不静默归零」在外卖路径未落地 | `pages/m3/dishreview/index.js` 按名合并两层（零新增文案）**+** 守卫 ⑤ 组 4 条 |

---

## 二、A 的根因链（真云实证，非推理）

```
写侧  importSalesBill/index.js  `.doc(_id).set({data:{…}})`
        ⇒ set = upsert + 整文档替换 ⇒ 文档建出来了，但**没有** is_deleted 字段
接口  返回 {code:'SUCCESS', written:354}   ← written 数的是**循环次数**，不是库里的行数
读侧  dataAdapter.listAll: Object.assign({}, extra, where, {is_deleted:false})
        ⇒ 微信云 where 是**严格等值**，undefined !== false ⇒ **不命中**
表现  getDishReview ⇒ takeaway: null ⇒ 页面走空态文案
```

实测四步（`r249_a_reimport.js` / `r249_b_read.js`）：

| 步骤 | 修复前 | 修复后 |
|---|---|---|
| 落库回执 | `code=SUCCESS, written=354` | `code=SUCCESS, written=354` |
| 生产读路径 `getDishReview` | `takeaway = null`（空态） | `by_platform=['taobao']`，`totals={qty:118, amountFen:182308}` |
| 独立复算（openpyxl 直读真文件，`r249_recalc.py`） | — | Σqty=**118** / ΣamtFen=**182308** / 聚合后 zeroAmtQty=**1** ⇒ **ALIGNED** |

受害面（全仓交叉扫描）：**4 处** —— `importSalesBill/index.js` 三处 set（外卖账单 L106 / 形态A L186 / 形态C L302）
+ `saveShopSetting/index.js` 的 catch 分支 add。

⚠️ **已写入的旧 354 行仍需「重导一次」才会显示** —— 修复只对新写入生效，
而 `.set()` 是整文档替换 ⇒ 重导同一份文件即把同一批 `_id` 覆盖成新文档（幂等，不会翻倍）。

---

## 三、B 的证据（**离线跑生产引擎**，`_probe_tmp/*.xlsx` 为真文件副本）

| 文件 | 平台 | `pickSheet` | 解析结果 | `checkGradeA` |
|---|---|---|---|---|
| `商品下载_…xlsx`（淘宝闪购） | taobao | hit | 形态 C / 354 行 / Σqty 118 / ΣamtFen 182308 | pass |
| `208386489_对账单下载_…xlsx`（京东**订单级**） | jd_order | hit | **按 `bizDate` 聚合 15 行**（无 `_id` 撞键）/ `totals={amountFen:55596, qty:23}` / 剔除 92 行「非正向订单」 | **pass** ✅ |
| `208386489_sku对账单下载_…xlsx`（京东 **SKU 级**） | jd_sku | hit | **0 数据行**（该表本身只有表头，3830 B / 1 行 × 27 列）⇒ `CHANNEL_EMPTY` | **fail** ⚠️ 表本身为空，非代码问题 |

⇒ **问题 B = 云端落后**：部署本地代码后 jd_order 即可导入；jd_sku 需**有数据行**的导出文件。

---

## 四、落地清单

| 文件 | 改动 |
|---|---|
| `cloudfunctions/importSalesBill/index.js` | 三处 `.set()` 补 `is_deleted: false`（含根因注释） |
| `cloudfunctions/saveShopSetting/index.js` | catch 分支 `.add()` 补 `is_deleted: false` |
| `pages/m3/dishreview/index.js` | 外卖 `by_platform[p].unmatched` 按名并入「未匹配菜品」表（零新增文案） |
| `tools/check_doc_write_isdeleted.js` | **新增**根因守卫（P16 + S8 + A5 + B5 + C4 + E1 = **39 断言**） |
| `tools/check_dishreview_engine.js` | 加 ⑤ 组 4 条「页面消费契约」（32 → **36**） |
| `tools/check_suite_assert_counts.js` · `verify_all.js` · `★知识存储点` | 同步面：新增套件 154 → **155**、断言数声明 `check_doc_write_isdeleted`=39 / `check_dishreview_engine`=36 |
| `review/evidence/_deploy_fns.py` | 修过期硬编码 node 路径（`22.22.2-3` 已不存在 ⇒ judge 假 MISS） |
| `.gitignore` | 补 `_probe_tmp/`（真实业务账单副本，含隐私 ⇒ 过程件不入库；目录留在仓内，`r249_recalc.py` 硬引用其路径） |

### 新守卫判据（**交叉判据**，不是「见裸写就红」）

```
写侧集合 W = { (coll, op) | `.doc().set({data:…})` 或 `.add({data:…})` 且 data 内无 is_deleted }
读侧集合 R = { coll | 被软删过滤读过 }
                (a) adapter 调用 `.list('X'` / `.listAll('X'` / `.countActive('X'`
                (b) 裸查 `.collection('X').where(` 的实参含 is_deleted
❌ 危险点 = W ∩ R 非空即红
```

为什么必须交叉：全仓 20+ 处裸写落在 `admin_login_log / audit_log / feature_permissions /
shop_entitlement / subscription_plan` 这类**不被软删过滤读**的集合上 —— 缺字段**无害**，
一刀切会恒红（判据反向伤害第二型：把合法写法当缺陷）。首跑即抓到这个坑（A-② 由「占比 ≥50%」改判「受守集合上 100%」）。

⚠️ `.update()`（字段级部分更新，不移除已有字段）与 `da.get()`（判据是 `doc.is_deleted` 真值，undefined 为 falsy ⇒ 本缺陷免疫）**均不在判据内**。

---

## 五、验收证据

| 项 | 结果 | 文件 |
|---|---|---|
| 全量门禁 | **155/155 通过**（三跑，均 RC=0、`❌` 计数 2 = 仓内固定字面量） | `gate_155_r249a.txt`（R249-A 后）/ `gate_155_r249b.txt`（R249-B 后复跑）/ `gate_155_r249c.txt`（**最终**：覆盖 `.gitignore` + README 两处非码改动） |
| 新守卫单跑 | 39 通过 / 0 失败 | `gate_155_r249a.txt` 尾段 |
| 变异回灌（⑤-③） | base 绿 → M1 删「按平台读 unmatched」**红在 5-③** → 还原 md5 全等且复绿 | 终端记录（脚本 `mutation_r249b.py`，临时件） |
| 部署 | `importSalesBill` 19 文件 / 57.8 KB · `saveShopSetting` 20 文件 / 49.8 KB，**2/2 OK 首轮命中**；`filesCount` ≡ 磁盘；`timeout` 20/20 未被冲回默认；`status=Active` | `_m3/deploy_logs/deploy_*.log` |
| 真云 A/B | 见 §二 | `r249_a_reimport.js` / `r249_b_read.js` |

### 本轮未取得 / 已知限制（不许当"已验证"）

- 🔴 **页面级渲染未取得模拟器证据**：`cli agent start` 报 `openedProjectWindow: false`，
  之后 `getCurrentPages()` 为空、`currentPage()` 抛 `getPageMetaByWebviewId(...) is null`
  ⇒ 截图是一张**空壳**（仅 navbar + tabbar）。**前端改动的真机验证待做**（见 `r249_d_pagedata.js` / `r249_e_pageprobe.js`）。
  已做的替代取证：⑤ 组静态契约断言 + 变异回灌 + 真云回执（`ranked:[]`、`unmatched:51`）。
- ⚠️ 京东 **SKU 级**表本身无数据行 ⇒ `CHANNEL_EMPTY`；需李老师确认是否拿了个空表试。
- ⚠️ 外卖榜单仍为 `ranked: []`（51 个商品名都没匹配到成本卡）—— 这是 **R232 已登记的 D-1 待拍板项**
  （外卖菜品名 ↔ 成本卡 的匹配/映射规则），本轮不改口径。

---

## 六、复现步骤

```bash
# 仓库根
node verify_all.js                                  # 期望 总览：155/155 套件通过
node tools/check_doc_write_isdeleted.js             # 期望 39 通过 / 0 失败
node tools/check_dishreview_engine.js               # 期望 36 通过 / 0 失败

# 离线复算锚点（需 openpyxl；真文件副本在 _probe_tmp/，未入库）
python review/evidence/r249_import/r249_recalc.py   # 期望 ALIGNED

# 真云（需先：cli.bat agent start --project <仓根> --auto-port 9420 --trust-project）
NODE_PATH=<mpauto>/node_modules node review/evidence/r249_import/r249_a_reimport.js
NODE_PATH=<mpauto>/node_modules node review/evidence/r249_import/r249_b_read.js
```

⚠️ 脚本命名**避开** `check_/verify_/selftest_/test_` 四前缀（`review/evidence/**` 下面 B 正则未登记即判红）。
⚠️ `taobao_goods.b64` 是探针用的文件副本（base64）；原始 xlsx 留在**仓内** `_probe_tmp/`
（`r249_recalc.py` 硬引用该路径 ⇒ 不能外移），已入 `.gitignore` ⇒ **不入库**。
