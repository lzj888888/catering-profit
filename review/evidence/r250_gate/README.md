# R250 门禁取证

## 一、为什么不直接 `node verify_all.js`

每轮开工先跑 30 秒探针矩阵（技能 `gate-under-sandbox` §硬判据）：

```
C:/Program Files/Git/bin/git.exe           -> EBUSY
C:/Windows/System32/cmd.exe                -> EBUSY
C:/Windows/System32/where.exe              -> EBUSY
C:/Python314/python.exe                    -> EBUSY
<process.execPath> (node 22.22.2-6)        -> EBUSY
```

⇒ **沙箱禁 node 派生任何子进程**（含 `process.execPath` 自身）⇒ 直跑会因
`spawnSync git/node EBUSY` 集体 fail-closed 判红（**环境限制，不是代码缺陷**）。
⇒ 走技能路径：Python 侧真跑 `verify_all.js` + `NODE_OPTIONS=--require gitcache_preload.js`。

## 二、为什么必须刷缓存（且是**门禁的前置条件**）

本轮改了 `tools/**` 下 **3 个套件**（`selftest_bill_parse` 39→53、
`check_shape_machine_value` 18→27、`check_suite_assert_counts` 声明同步），
且改动面还覆盖 `terms.js`（单源+镜像）、`pages/takeaway/index.{js,wxml}`、
`cloudfunctions/importSalesBill/{index,service}.js`、`utils/billParse.js`
⇒ 牵动面**远超 3 个套件**。
🔴 技能 §〇-bis：**改过 `tools/**` 任一 `.js` 套件 ⇒ 刷缓存是门禁的前置条件**，不是提交后的收尾。
（R238 二次踩：省 1 分钟刷缓存 ⇒ 赔 19 分钟门禁 + 一整轮排查。）

## 三、实跑轨迹

| 步骤 | 脚本 | 结果 |
|---|---|---|
| ① 全量迭代收敛重建 | `rebuild_cache.py` | `FINAL keys = 162 \| rc!=0 = 0`（894s）。iter1 里 `check_suite_assert_counts` 有一次 `rc=1` —— 正是「子套件的新值还没落盘」的已知现象，iter2 即收敛，iter3 `changed=0`。 |
| ② 首跑门禁 | `run_gate_native.py gate_155_r250.txt` | **153/155** —— 红：`picker-platform` / `doc-write-isdeleted`，两条都是 `spawnSync node.exe EBUSY` |
| ③ 定性 | 查缓存键 | 这两条**在缓存里从来没有键**：`tools/check_picker_platform.js`（今日 11:59）、`tools/check_doc_write_isdeleted.js`（今日 13:19）是**本轮之前新增**的套件 ⇒ **缺前置键**（不是代码缺陷） |
| ④ 补键（顺序刷） | `refresh_missing_keys.py` | `162 → 164`，两键 `rc=0`；**先落盘**再刷会 spawn 子套件的 `check_suite_assert_counts` / `check_suite_coverage` |
| ⑤ 终跑门禁 | `run_gate_native.py gate_155_r250b.txt` | ✅ **`===== 总览：155/155 套件通过 =====`** · `RC=0` · 真 `['] ❌ FAIL'` 行数 **0** · 存档 `❌` 计数 **2**（= 仓内**固定字面量**，非失败） · `gitcache_miss.log` **0 行** |

## 四、判据（可机器复核）

```bash
grep -c '总览：155/155 套件通过' review/evidence/r250_gate/gate_155_r250b.txt   # 期望 1
grep -c '] ❌ FAIL'            review/evidence/r250_gate/gate_155_r250b.txt   # 期望 0
grep -c '❌'                   review/evidence/r250_gate/gate_155_r250b.txt   # 期望 2（仓内固定字面量）
wc -l < "$TMP/inscode/gitcache_miss.log"                                     # 期望 0（或文件不存在）
```

## 五、同步面（改断言数后必须跟着改，否则门禁当场红）

| 位置 | 改动 |
|---|---|
| `tools/check_suite_assert_counts.js:134` | `selftest_bill_parse` 注释 `39 条` → **`53 条`**（+ R250 平台自动判定 14） |
| `tools/check_suite_assert_counts.js:187` | `check_shape_machine_value` 注释 `18 条` → **`27 条`**（+ F-R250 门禁原因 9） |
| `specs/dev-specs/★知识存储点_2026-09-10.md:44` | 唯一声明处：`selftest_bill_parse`=39 → **53** / `check_shape_machine_value`=18 → **27** |

## 六、真云 A/B（**零写入**，`cloud_ab_r250.txt`）

🔴 **为什么零写入**：`cloudfunctions/importSalesBill/index.js` 的
`if (!v.confirm) return ok({ ...preview })` —— 预览分支在**任何 db 写之前**返回
⇒ 不置 `confirm` 就不会写 `external_sales_daily`。
这恰好等价于用户在页面上「选完文件 → 看到预览」那一步：**最贴近现场、且零副作用**。

通道：`miniprogram-automator` 连开发者工具模拟器（R188 定式）。
⚠️ 单次 `evaluate` 有内部超时，而 `wx.cloud.callFunction` **冷启**（首次 `getShopContext` 7.2s）会超
⇒ 必须「发出去不 await + 挂 `globalThis` + 分次新连接轮询」。

| 侧 | 样本 | 真云回包 | 判据 |
|---|---|---|---|
| **A** | 真·京东**订单级**（117 行 × 82 列，两级表头） | `platform='jd_order'` · `grade={pass:true, level:'A', failures:[]}` · `preview.headerRow=1` · 15 天 / `totals={amountFen:55596, qty:23}` · `excluded={92,'非正向订单（推广费/保险单）'}` | ✅ **修复点在生产云上成立**（旧写法会回「无法识别账单平台…」） |
| **B** | 真·京东 **SKU 级**（1 行 × 27 列 = 只有表头） | `platform='jd_sku'` · `grade={pass:false, failures:[{code:'CHANNEL_EMPTY', field:'rows', msg:'未解析到任何数据行'}]}` | ✅ **缺陷 ② 的根因坐实**：门禁判得对，此前是界面把原因吞了 |

- `shop_id = shop_mu6j87v1itrs`（从真云 `getShopContext` 取，非硬编码）
- 探针上传的两个文件（`sales_bills/r250_*.xlsx`）已用 `_r250_cloud_cleanup.js` **删除**（`status:0 ok`），环境无残留。

## 七、文件清单

| 文件 | 说明 |
|---|---|
| `rebuild_cache.py` | 全量迭代收敛重建（源自 `r231b_gate2/rebuild_cache.py`；仅改 node 路径 `-3`→`-6`、ARCH 落本目录） |
| `refresh_missing_keys.py` | 补缺键 + **顺序**刷会 spawn 子套件的键（严格「先落盘」） |
| `run_gate_native.py` | 沙箱下驱动**原生** `node verify_all.js` |
| `deploy_r250.py` | 部署 `importSalesBill`（`-r` / 一次一个 / 判据不认 `rc`、不按 `│` 匹配） |
| `info_r250.py` | 部署后回读云端 `info`（判 timeout 是否长回 3） |
| `_r250_cloud_ab.js` | **真云零写入 A/B** 探针（预览分支 = 写库之前返回） |
| `cloud_ab_r250.txt` | 上表的**实跑回包** |
| `_r250_cloud_cleanup.js` | 删掉探针上传的 `sales_bills/r250_*.xlsx`（白名单前缀校验） |
| `refresh_git_keys.py` | `git add` 后刷 **git 类**缓存键（`git ls-files` 等也是键，不刷会读到旧列表） |
| `gitcache_rebuilt.json` | 重建后的缓存（164 键，`rc!=0 == 0`） |
| `gate_155_r250.txt` | 首跑（153/155，两红为缺键） |
| `gate_155_r250b.txt` | **终跑（155/155）** ← 判据以此为准 |

> `review/evidence/**` 下文件名不含 `check_`/`verify_`/`selftest_`/`test_` **前缀**
> （面 B 正则 `(^|/)(check_|verify_|selftest_|test_)[^/]*\.(js|py)$` 未登记即判红）。
