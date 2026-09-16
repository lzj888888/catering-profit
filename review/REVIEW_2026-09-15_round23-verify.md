# REVIEW_2026-09-15 round23 · 批次 7（工作区状态）复核 + 编号对齐 + 3 个新发现（R54–R56）

> 复审方：`miniprogram-code-reviewer`（3080 唯一复审窗口）。轮次：**第 23 轮**。**新开文件**（协议 §2）。
> 上游：`REVIEW_2026-09-15_round22-verify.md`；本轮对象 = `fabac9c`（批次6 复核留证 + 批次7 投喂与审批①留证）+ **工作区里未提交的批次 7 产出**。

---

## §0 结论

**批次 7 的产出在工作区里（未提交），当前树全绿**：门禁 0、套件 **46/46**、三个守卫全过；我抽查的三条批次 7 钢律也过。
新增 3 个发现（**R54–R56**，均不阻塞）；另有一件必须先说：**R 编号要对齐**（§4）。
⚠️ **本轮的结论是对"工作区快照"下的**——批次 7 尚未提交，最终判定以提交 + 回执为准（我 round20 就吃过"写下时对、被消费时过期"的亏）。

| 核实项 | 结果 |
|---|---|
| HEAD | `fabac9c`（批次6 复核留证 + 批次7 投喂与审批①留证）✅ = `origin/dev` |
| 工作区 | ⚠️ **27 项改动**（批次 7 未提交）：新增 `cloudfunctions/deleteAccount`/`exportData`/`getShopList`、`pages/mine/`、`pages/shop/switch.*`、`utils/loading.js`/`shopSwitcher.js`/`selftest_batch7.js`；修改 `app.js`/`app.json`/双副本 `terms.js`/`pages/card/index.js`/`pages/index/*`/`pages/month/result.*`/`verify_all.js` |
| 门禁 | ✅ exit 0 |
| 套件 | ✅ **46/46**（我逐个跑；构成见 §1） |
| 守卫 | ✅ `check_pages`：声明 **14** 页／实到 14 页；`check_compliance`：68 个前端文件无未豁免引用；`check_requires`：**596** 个 .js 全解析（小程序侧 26 / 云函数侧 570） |

---

## §1 一条重要的能力边界变化：**`node` 被执行沙箱阻断**

- 本轮中途起，`node` **彻底跑不了**（连 `node -e "console.log(1)"` 都报 `Program 'node.exe' failed to run: Access is denied`，并被标为 `[sandbox: file access denied under workspace-write mode]`）。
- 处置：我**按纪律申请了一次放行**，并把**全部只读校验压进同一条命令**（门禁 + 46 套件），拿到 `GATE=0` / `SUITES_TOTAL=46 PASS=46 ALL_GREEN`。
- ⇒ **后续每轮我都需要"一次放行 + 一条命令跑完所有 node 校验"**；若你希望我省掉这个来回，可以让 WorkBuddy 在回执里**贴 `verify_all.js` 的完整输出**，我据此复核（但那样就是"读它的输出"，我不会当成独立复跑 —— 我会在结论里标明等级）。

**46 套件的精确构成**（避免"同一事实两个数"）：
```
41（round22 时的基线）+ 3（batch7 三个云函数的 selftest）
+ utils/selftest_batch7.js（batch7-utils）
+ tools/check_admincore.js（"单源派生守卫 R50"）  = 46
```

---

## §2 批次 7 钢律抽查（我 grep 实测）

| 钢律（批次 7 §2.6~2.9 口径） | 实测 | 判定 |
|---|---|---|
| **导出权限只读 `expire_at`、不读 `plan_id`** | `exportData/index.js:3-4` 注释明写 + `:54-57` 只取 `ent.expire_at` | ✅ |
| **账号注销匿名化 PII** | `deleteAccount/index.js:4-8/19-20/44-50`：软删 `user` + **匿名化 `openid`/昵称/`unionid`**（`ANON_OPENID` 占位、不可逆）+ 关联 shop/entitlement 软删 + **历史业务数据不硬删** + 15 工作日承诺 | ✅ |
| **店铺切换列表仅活跃 + `shop_id` 本地持久化** | `utils/shopSwitcher.js:4-5/19/28/33`：列表仅 `is_deleted=false`（后端过滤）+ `wx.setStorageSync('shop_switcher_shop_id')` | ✅ |

---

## §3 三个新发现

### R54 🟡 **6 个已交付云函数没有 `selftest.js`** ⇒ 无机器验证

我按"每个云函数应有自测"的既有范式逐个扫 —— 缺自测的是：
```
batch4：getLedger / getMonthList / getShopContext / getCardVersions / saveAsset / saveShopSetting
（另：smokeTest 是探针，不算；_adminCore 是共享模块，不算）
```
- 对比：batch 7 的三个函数（`deleteAccount`/`exportData`/`getShopList`）**都带 selftest** ✅；admin 族 12 个也都带 ✅。
- 影响：这 6 个只被**结构类**检查覆盖（L 组扁平副本、`check_requires` 静态路径、门禁），**行为无机器断言**。其中 `saveAsset`/`saveShopSetting` 是**写操作**，风险高于纯读。
- **修法（二选一）**：① 补 6 个 selftest（每个照 batch3/4 既有模板，重点断"入参校验 + 单位 + 软删过滤"）；② **明确豁免并留痕**（写进 §1.3：这 6 个为只读/薄封装，以页面级验收替代）。**我建议 ① 里至少补 `saveAsset`/`saveShopSetting` 这两个写操作。**

### R55 🔵 **`utils/selftest_batch7.js` 会随小程序包发布**

- 依据：`packOptions.ignore` 现为 13 条（folder：`specs`/`review`/`cloudfunctions`/`tools`/`web-preview`/`.inscode`/`.atomcode`/`node_modules`；suffix：`.pdf`/`.docx`/`.md`/`.txt`；file：`verify_all.js`）—— **`utils/` 不在其中，`.js` 也不是被忽略的后缀** ⇒ 该测试文件**进包**（约 4KB）。
- 它不是 bug，但**测试代码进生产包**是坏味道（也会让"包体内出现自测脚本"变成先例）。
- **修法（择一）**：① 把该套件移到 `tools/`（已在 ignore 内，最干净）；② 或在 ignore 里加 `{type:'file',value:'utils/selftest_batch7.js'}`。
- **顺带立一条约定（建议写进 `review/README.md` 或 `§1.3`）**：**测试/校验脚本一律放 `tools/` 或 `cloudfunctions/<fn>/__tests__/`（`__` 前缀目录 devtools 会自动忽略）**，不放 `utils`/`pages`。

### R56 🔵 **admin 族 12 个函数没有独立 `validate.js`**（范式不一致）

- 事实：`adminExport`/`adminGrantEntitlement`/`adminInit`/`adminLogin`/`adminLogout`/`adminManualOrder`/`adminOrderList`/`adminQueryUser`/`adminRefreshToken`/`adminRefundMark`/`adminRevokeToken` + batch7 的 `deleteAccount`/`exportData`/`getShopList`/`getShopList` 均**无 `validate.js`**（入参校验内联在 `index.js`）。
- 而 batch1/2/3 的范式是"**校验抽成纯函数**，`index.js` 只委托"（这样才可纯 Node 单测 —— R27 当初抽 `validate.js` 正是为此）。
- ⇒ 后果：这些函数的**入参校验无法被单测覆盖**（因为它们含 `require('wx-server-sdk')` 的 index.js 加载不了）。**不是缺陷**，但要知道：admin 族的 selftest 只能测 service，**入参面是裸的**。
- **修法**：不必全部返工；建议**在下一次触碰某个 admin 函数时顺手抽出 `validate.js`**，并把这条写进口径（"新函数一律 validate.js 独立"）。

---

## §4 编号对齐（重要，防撞号）

- 我这边用到 **R45**（round22 登记的 iOS 过滤缺口）。
- **你们的编号已走到 `R53`**（重启键 `:54-57`）：R48 `requireAuth` 补 `admin_user.status` fail-closed ／ R49 `adminExport` 分页累取 ／ **R50 `_adminCore` 单源派生守卫**（`tools/check_admincore.js`）／ R51 空 `where` 改不带 `where` ／ R53 店铺列表 `limit(20)` 静默截断。
- ⇒ **本轮起我的新发现从 `R54` 续**（上面三条即 R54/R55/R56）。**请勿复用 R46–R53**（那些是你们的收官加固项，我没参与评审 —— 若要我对 R48–R53 逐条复核，点名即可）。
- 另：重启键 `:130` 的套件数已同步为 **46** 并写了演进（41→45→46）✅ —— 这条"套件数漂移"纪律执行得对。

---

## §5 队列现状

| 类别 | 内容 |
|---|---|
| **待执行侧** | ① **提交批次 7**（并附回执）② R55 移走 `utils/selftest_batch7.js` ③（建议）R54 补 `saveAsset`/`saveShopSetting` 自测 ④ R56 留痕或渐进抽 `validate.js` |
| **待人工** | ① 真云多版本写入实测 ② 真云两月 `calcAmortize` ③ 真云 `smokeTest` ④ 上线前补齐 **39 条索引** ⑤ **R45**：做套餐选择 UI 前必须实现 iOS 过滤 ⑥ 上传留提审前 |
| **下一步** | 批次 7 提交 → （8 批全部交付后）进入**上线前收口**：索引补齐 / 真云三验 / 隐私与注销的真机走查 / 提审 |

## §6 能力边界

- **`node` 被执行沙箱阻断**（§1）⇒ 我的套件复跑需每次申请放行；本轮已用一次放行拿到 `GATE=0 / 46-46`。
- **批次 7 未提交** ⇒ 本轮结论以"工作区快照"为准，**提交后如有改动请以新状态为准**。
- 云端/控制台/开发者工具/远端 push/`verify_all` 端到端 一如既往核不了；**R48–R53 我没有复核**（那是你们的收官加固轮）。
