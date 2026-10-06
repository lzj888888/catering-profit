# CHECKLIST · 正式版发布前必做

> **活文档**（可反复照着做，不是快照）。位置 `review/` —— 已在 `project.config.json::packOptions.ignore` 内，
> **不进小程序包、不占 2MB 主包体积**。
> 建立：2026-09-24（round115），因李老师问「现在的数据不影响以后正式版本发布吧」。

---

## 一句话结论

**不影响。** 账号下目前**只有 1 个云环境（dev）**，正式版要**新建独立环境**；微信云开发的数据库按环境**物理隔离** ——
dev 库里的任何账套 / 台账 / 测试数据**不会**流到正式版。

但「不影响」有一个前提：**发布前必须把 prod 环境建好、并让前端切过去**。不做这一步，正式版会**继续读写 dev 库**，
那时才是真混（正式用户的数据和您的测试数据躺在同一个库里）。

---

## 0. 现状实测（2026-09-24 现场取证，非推断）

| 项 | 实测值 | 取证方式 |
|---|---|---|
| 账号下云环境数 | **1 个** | `cli cloud env list --project <repo>` → 只返回 `cloud1-d4gphpoxy337f2a25` |
| prod 环境 | **不存在** | 同上，列表里没有第二个环境 |
| 前端 prod 槽 | 仍是占位符 `catering-prod-xxxxxxxx` | `miniprogram/config/env.js` `ENV_MAP.prod` |
| 前端当前激活环境 | `ACTIVE_ENV: 'dev'` | 同上（写死，不会自动切） |
| 云函数 | **43 个**（45 个目录 − `common` / `_adminCore` 两个库目录） | `ls -d cloudfunctions/*/`（R181m 复核；与云端 `list` 零差异） |
| 库结构 | **27 集合 / 45 索引**（12 unique） | `cloudfunctions/initDb/collections.js` |
| 已建成索引 | dev 侧 **45/45 已追平** | `tools/apply_indexes.js` |

---

## 1. 为什么现在「不影响」——机制

1. **环境物理隔离**：`wx.cloud.init({ env })` 指向哪个环境，读写就落在哪个环境的数据库。环境之间**没有跨库可见性**。
2. **现在所有数据都在 dev**：因为账号下压根只有 dev 一个环境 —— 不是"选对了"，是"只有一个可写"。
3. **代码与数据分离**：`cloudfunctions/` + `pages/` 是**代码**，靠 git 管理；`env.js` 只决定"代码连到哪个库"。
   ⇒ 换环境**不需要改一行业务代码**，只改环境 ID。
4. **真实的回归风险是反向的**（`env.js` 里已写明告警文案）：
   > 上线前必须在控制台建 prod 环境并把 `ENV_MAP.prod` 换成真实环境 ID，**否则生产数据会写入开发库**。

---

## 2. 发布前必做清单

### A. 建 prod 环境（需李老师在云开发控制台操作）

| # | 动作 | 判据 | 谁做 |
|---|---|---|---|
| A1 | 云开发控制台 → 新建环境（命名含 `prod` 字样，如 `catering-prod`） | 控制台环境列表出现第 2 个环境 | 李老师 |
| A2 | 记下新环境的**真实环境 ID**（形如 `cloud1-xxxx` 或 `catering-prod-xxxxxx`，**不是**短名） | ID 逐字符抄准（历史教训：手抄错一整天） | 李老师 |
| A3 | 若提示配额不足 ⇒ 按提示升级套餐 | —— | 李老师 |
| A4 | 把 ID 交给我（或自行填入，见 E1） | —— | 李老师 |

> ⚠️ **别把 dev 改名成 prod 当正式环境**。那样 dev 里的测试数据就原地"转正"了 —— 这是唯一会踩中您担心的那件事的做法。

### B. prod 库结构（27 集合 + 45 索引）

| # | 动作 | 说明 | 谁做 |
|---|---|---|---|
| B1 | 建 25 张集合 | 🔴 **政策（非能力限制）**：`initDb` 有环境门禁 `gate()`，含 `prod` 子串一律拒绝 ⇒ **prod 集合由控制台手工创建**，`initDb` **绝不部署到 prod** | 李老师 / 我 |
| B2 | 建 **45 条索引**（R215c 更正：原文写「40 条」是 R174 把 40→45 后的**漏改**，与本节标题/单源 `collections.js` 的 45 冲突） | **已可脚本化，零改造**：`node tools/apply_indexes.js --env <prod_id> --apply --secret-file <文件>`。该脚本走官方 HTTP API（幂等、可回读校验），`--env` 参数**已支持**（`tools/apply_indexes.js:60`：`valOf('--env') \|\| initDb/config.json::DEV_ENV_ID`，无 `--env` 时仍从单源现读、不手抄）。⚠️ 默认 dry-run，必须显式 `--apply`；AppSecret **用后即轮换**（账号级凭证）。🔴 **线上 dev 现仅 40/45**（R174 那 5 条一直没建）⇒ 脚本幂等，跑一次即补齐；其中含 R202 兜底所需的 `shop.id` 索引（已登记于 `review/NOTE_2026-10-03_round203_impact-name-decode.md` 待办 #2，**不宜单加**，随本次批量一起做） | 我 |

### C. prod 种子数据 —— ✅ **落地路径已补**（见 `review/PLAN_2026-10-01_prod环境播种方案.md`）

> **补法**：不走 `initDb`（门禁拒绝 prod，且是刻意政策），改走
> **「dev 控制台导出种子 JSON → prod 控制台导入」** —— 零代码、零凭证、可审计。详见该方案 §四 S5。

| 数据 | dev 里谁插的 | prod 怎么办 |
|---|---|---|
| `subscription_plan`（套餐） | `initDb/index.js` 第 3 步 | ❌ **initDb 不许在 prod 跑** ⇒ **没有方案**，需手工录或另写一次性脚本 |
| `feature_permissions`（功能权限） | 同上 | ❌ 同上 |
| `shop_income_item` / `shop_expense_item`（收支分类） | **无人插**（种子已定义但无云函数写入） | ✅ 无影响 —— 前端清单是**代码常量驱动**，空库照常显示默认分类 |

⇒ **A4/B2 之后必须先解决 C**，否则正式版里**付费套餐/权限是空的**，付费链路点不通。

### D. 云函数部署到 prod

| # | 动作 | 判据 |
|---|---|---|
| D1 | 全量部署 **42 个函数**（43 − `initDb`） | `cli cloud functions deploy --names <fn> -r`，**一次一个、必带 `-r`**（漏 `-r` = 覆盖云端 `wx-server-sdk` ⇒ 前端「网络不可用」） |
| D2 | 🔴 **先在控制台定 all 函数 timeout 值，再全量部署** | 实测：`config.json` 的 `timeout` **不被采纳**（重启键 §该条），值只存在于控制台。**dev 定过 ≠ prod 生效**，必须重走「定值 → 部署 → `cli cloud functions info` 逐个回读」 |
| D3 | `ADMIN_SETUP_TOKEN` 等凭证重配 | 凭证**不随环境走** |
| D2-bis ✅ | **dev 存量缺口（R215c 发现 → R215d 已闭环）**：`importSalesBill` / `manageShop` 的 `timeout` 曾为 **3**，**2026-10-05 已抬到 20**；全量 44 函数回读 `timeout==3` = **0** | 判据 = `cli cloud functions info --names …`（**空格分隔**）的 `timeout` 列。**现状：`{15:1, 20:40, 30:1, 60:2}`、`status` 44/44 `Active`**（`review/evidence/r215d_timeout/cli_info_all_44fn_after.txt`）。⚠️ **可复用纪律**：**新部署的函数 timeout 一律是平台默认 3** ⇒「部署完」≠「可用」，**每次部署新函数后必须回读 `timeout` 并手工抬到 20** | ✅ 已闭环（R215d · 键鼠代操控制台，见 `review/NOTE_2026-10-05_round215d_控制台抬timeout.md`） |

### D+ 开真实支付 🔴（R215 补录 · R214 发现的清单缺口）

> **为什么单列**：R214 通跑发现 `ENABLE_REAL_PAYMENT` 是**代码常量**（`false`），不是"控制台开关"。
> 老注释 `utils/paywall.js:11-12` 说「执照下来改后端配置即接真实支付」——**那句话是误导**：实际要**改代码 + 重新部署 2 个函数**。
> 不补这一步，正式版会「能点付费墙、点了却让联系客服」，**一分钱收不到**。

| # | 动作 | 判据 | 谁做 |
|---|---|---|---|
| D+1 | **拿营业执照 + 申请微信支付商户号**（前置，周期最长，尽早启动） | 拿到 `mchid` + API 密钥 | 李老师 |
| D+2 | 把 `cloudfunctions/payCreateOrder/service.js::ENABLE_REAL_PAYMENT` 与该常量在 `payRenew/service.js` 的同名常量改为 **`true`**（或改读环境变量/配置，避免再改代码） | 两处常量不再为 `false` | 我 |
| D+3 | **重新部署** `payCreateOrder` + `payRenew` 两个函数（`-r`，一次一个） | 部署日志完成行 | 我 |
| D+4 | 走一次真实下单（1 分钱档）→ 确认回调 `payCallback` 落库、权益生效 | `pay_order` 有记录且状态=已支付 | 李老师 + 我 |

> ⚠️ **反向验证**：D+2 改完若**忘了 D+3 重新部署**，前端仍是旧逻辑（`ENABLE_REAL_PAYMENT=false`）⇒ 支付链路静默不通。
> 判据 = 部署后 `cli … info --names payCreateOrder` 的**最后更新时间**为本次。

### E. 前端切换

| # | 动作 | 判据 |
|---|---|---|
| E1 | `miniprogram/config/env.js::ENV_MAP.prod` 填 A2 的真实 ID | 不再是 `xxxxxxxx` 占位符 |
| E2 | 同文件 `ACTIVE_ENV` 改为 `'prod'` | 守卫 `tools/check_env_ready.js`（第 66 套件）转绿且无 `ENV_FALLBACK` 告警 |
| E3 | 提交并推 dev 分支 | `HEAD ≡ 远端 dev` |

> 哨兵：`env.js` 有占位符保护 —— 若 prod 槽没填就切 `ACTIVE_ENV`，会 **回落 dev + `console.error` 告警**（不静默、不白屏）。所以"忘了填"不会酿成事故，但会**悄悄继续用 dev 库** —— 所以 E1/E2 必须成对完成。

### F. 提审前

| # | 动作 | 说明 |
|---|---|---|
| F1 | 微信开发者工具「上传」 | **已裁决（round11 R37）：留到提审前做**，理由是上传不可逆而当前收益不成比例。到这一步就该做了 |
| F2 | 小程序后台「版本管理 → 设为体验版」 | 生成**长期有效**的体验版二维码（预览码只有 25 分钟） |
| F3 | 提交审核 / 发布 | 类目、资质、隐私协议等平台侧事项 |

### G. 订阅消息「到期提醒」（**条件性**必做 —— R215 已决策暂不启用）

> **现状（R215 逐环实测）**：到期提醒**两条渠道全缺**，且当前**无付费用户** ⇒ 配了定时触发器也只是每天扫出空列表（窗口 `expire_at ∈ (now, now+7d]`，而免费档建档一律 `expire_at = 0`）。
> R215 决策 = **暂不启用**（保留 `cloudfunctions/payExpireNotify` 待命，**不上传触发器**）。理由链见 `review/NOTE_2026-10-04_round215_未授权云函数与无店铺态.md §八-quater`。
> 🔴 **触发条件 = 上面 §D+ 开真实支付完成之后**（那时才可能存在 `expire_at > 0` 的真实付费用户）。
>
> 🔧 **2026-10-06 R232 勘误**：上段「两条渠道全缺」是 **R215 时点值**，**已过期** —— 实测 **G2 已落地**、**G3 已接线**：
> · **G2 ✅**：`pages/month/index.wxml`（`card2 banner warn`）与 `pages/month/result.wxml`（`expire-banner`，样式在 `pages/month/result.wxss:2-4`）
>   均在 `expireSoonDays > 0` 时常驻渲染，值来自 `utils/entitlement.js::expireSoonDays`（== `payQueryEntitlement.days_left ∈ (0,7]`）⇒ `miniprogram/` 已非「零消费」。
> · **G3 ⚠️ 已接线未生效**：`pages/month/result.js::onAskSubscribe` 已调 `wx.requestSubscribeMessage`，但 **`tmplIds: []` 为空**（注释明写「模板 ID 由后端配置下发；当前阶段未配置 → 直接回落兜底」）
>   ⇒ **仍卡 G1**（mp 后台模板 ID 未申请）；空 `tmplIds` 下用户授权拿不到可推模板。
> · **G1 / G4 仍待做**（G1 李老师；G4 需补 `openapi.subscribeMessage.send` 真推送 + 控制台 GUI 上传触发器）。
> ⇒ **本表原来把 G2/G3 记为「我 待做」是过期陈述**，照它去做会造出重复实现。


要做到期提醒，**四件缺一不可**（按建议优先级 —— G2 不依赖用户授权，应先做）：

| # | 动作 | 说明 | 谁 |
|---|---|---|---|
| G1 | mp 后台申请**订阅消息模板 ID** | 类目「工具 > 计算器」下选服务到期提醒类模板 | 李老师 |
| G2 ✅ | ~~前端补**兜底提示条**（`days_left ≤ 7` 常驻渲染）~~ **已落地（R232 实测）** | 服务端 `payQueryEntitlement` 已返回 `days_left`；前端已在 `pages/month/index.wxml`（`card2 banner warn`）+ `pages/month/result.wxml`（`expire-banner`）常驻渲染，取值 `utils/entitlement.js::expireSoonDays`，样式 `pages/month/result.wxss:2-4` | ✅ 已做 |
| G3 ⚠️ | 前端 `wx.requestSubscribeMessage` 收**用户授权** —— **已接线，但 `tmplIds: []` 为空 ⇒ 实际推不了** | `pages/month/result.js::onAskSubscribe` 已在位（注释明写「模板 ID 由后端配置下发」）；微信订阅消息是**一次性授权**，未授权**不可推** ⇒ **须先完成 G1** | 待 G1 |
| G4 | `payExpireNotify` 内补 `openapi.subscribeMessage.send` 真推送 + **上传触发器** | 现函数只 `return`、不推送；补发送后走 IDE 云开发控制台 GUI 上传触发器（`cli` **无**触发器子命令） | 我（GUI） |

> ⚠️ G2/G3/G4 会引入**新可见文案** ⇒ 按仓规「新可见文案三处」（`miniprogram/i18n/terms.js` ≡ `specs/dev-specs/*/i18n/terms.js`，页面零硬编码）；G2 若新增页面还须过 `check_page_manifest` / 必须有入口 / 金额框不与 `<button>` 同父三关。

---

## 3. 数据处置：dev 库里的东西怎么办

现状：dev 库里的数据 = 我的功能测试数据 + 您真机试填的内容。**默认什么都不用做** —— prod 是干净的空库。

若要给正式版"预置"某些数据，三选一：

| 方案 | 适用 | 代价 |
|---|---|---|
| **① 不迁，正式版从空开始**（推荐） | 正式版就该是干净的 | 0 |
| ② 手工在正式版重录一次 | 只有一两家店/少量数据 | 几分钟 |
| ③ 我写一次性导出/导入脚本 | 数据量大、要精确复制 | 写脚本 + 双库跑 + 校验 |

---

## 4. 明确**不需要**做的

- ❌ 不需要动 dev 环境的任何数据（它是您的试验田，保留着更好 —— 出问题能对照）
- ❌ 不需要改任何业务代码（换环境只改环境 ID）
- ❌ 不需要把 dev 的 40 条索引"复制"到 prod 的**数据**里（索引是结构，不是数据）
- ❌ 不需要删除 dev 里的测试数据

---

## 5. 怎么验「真的切过去了」

1. `miniprogram/config/env.js::getEnv()` 返回的是 A2 的真实 ID，且**无** `[ENV_FALLBACK]` 告警
2. 正式版录一条测试数据 → 在云开发控制台**切到 prod 环境**能看到它、**切到 dev 环境**看不到它
3. `cli cloud functions info -e <prod_id> --names <fn>` 逐个回读：`最后更新时间` 是本次部署时间

---

*维护纪律：本文件是**活文档**，环境/凭证类条款会漂。任何一条落地后，把该行改为 ✅ 并追加实测证据路径（`review/evidence/`）。*
