R238 · 「开权益」能不能由我代做 —— 全套实测取证
================================================================
日期：2026-10-08
环境：dev = cloud1-d4gphpoxy337f2a25（单源 cloudfunctions/initDb/config.json::DEV_ENV_ID；本仓无 prod）

一、最重要的两条【真实事实】
----------------------------------------------------------------
（A）账号权益状态（r238_probe_ent.js 原始输出）

  "shopCtx": { "code": "SUCCESS", "data": {
      "shop_id": "shop_mu6j87v1itrs", "shop_name": "AbC", "no_shop": false } }
  "ent": { "code": "SUCCESS", "data": {
      "shop_id": "shop_mu6j87v1itrs",
      "user_id": "u_mu6j87t1a283",
      "expire_at": 0,
      "is_active": false,
      "source": "auto",
      "days_left": 0 } }

🔴 判读：
  · 权益【未开通】：expire_at=0 / is_active=false。
  · `source:"auto"` ⇒ 该记录是 `common/auth.js::autoProvision` 首次进小程序时**自动建的空档**，
    **不是"开通过"**。⇒ 李老师说的"这台手机开了权限"≠ 权益开通。
  · 目标记录已定位（**代替了李老师要手抄的两步**）：
      user_id   = u_mu6j87t1a283
      shop_id   = shop_mu6j87v1itrs
      shop_name = AbC

⚠️ 前提声明：本探针跑在**开发者工具模拟器**里，OPENID = 开发者工具登录的微信号。
   若李老师手机 A 用的是**另一个微信号**，则本条 ≠ 手机 A —— **以手机 A 实测为准**。

（B）（b）索引与权限边界（见下「三」）—— 唯一索引真生效，客户端改不到已有记录。

二、我穷尽的通道（逐条实测，非推断）
----------------------------------------------------------------
| # | 通道 | 依据（命令 / 源码行） | 结论 |
|---|---|---|---|
| 1 | 微信开发者工具 CLI | `cli cloud --help` → 仅 env / functions | **无数据库命令** ❌ |
| 2 | 同上·调用云函数 | `cli cloud functions --help` → list/info/deploy/inc-deploy/download | **无 invoke** ❌ |
| 3 | smokeTest 探针函数 | index.js:56-57（R215 加固）：有 OPENID 即 FORBIDDEN | 只允控制台/cli，而 cli 不能 invoke ❌ |
| 4 | HTTP 触发 | 仅 payExpireNotify 配 triggers（定时） | **无 HTTP 入口** ❌ |
| 5 | 腾讯云 CloudBase CLI | 本机已装 @cloudbase/cli 3.8.2，`.tcb`/`.cloudbase` 登录态目录不存在 | **无凭据** ❌ |
| 6 | 管理端页面 | `grep admin app.json` 无命中；pages/ 无 admin 页 | 前端**无管理入口** ❌ |
| 7 | adminInit（首超管引导） | index.js:28 需环境变量 `ADMIN_SETUP_TOKEN`（设计上"线下交付、不入代码/不入仓库/不进日志"） | **无 token**，且不应索取/猜测 ❌ |
| 8 | adminLogin | index.js:19-20 需 username + password（scrypt 加盐哈希） | **无账号密码** ❌ |
| 9 | 客户端 SDK 直写 | 见下「三」 | **改不到已有记录** ❌ |
| 10 | 伪造 payNotify 支付回调 | — | 绕过付费墙，**主动否决** ❌ |

⇒ **结论：唯一入口是【云开发控制台】（人的界面）**，或为该环境提供 admin 凭据。

三、客户端读写权限的真实边界（r238_probe_db / write / update / uniq）
----------------------------------------------------------------
| 探针 | 操作 | 原始结果 | 判读 |
|---|---|---|---|
| db.js | `get()` user / shop_entitlement | `n=0` / `n=0` | 云函数写的记录没有 `_openid` ⇒ 客户端**读不到** |
| write.js | `add()` 假记录 | `{ok:true,_id:66baec6f...}`；cleanup `removed:1` | 客户端**能 add**（新记录 _openid=自己） |
| update.js | `where({假user_id}).update()` | `{ok:true,stats:{updated:0}}`，**不抛权限异常** | 权限层未拒（但也没匹配到） |
| **grant.js** | `where({u_mu6j87t1a283}).update({expire_at:1830268799000})` | `read n=0`；`update {ok:true, stats:{updated:0}}` | 🔴 **改不到**（安全规则按 `_openid` 过滤）⇒ **安全设计成立** |
| uniq.js | `add()` 同 user_id 两次 | 第二条：`E11000 duplicate key error collection: tnt-kff4xv31u.shop_entitlement index: idx_ent_user dup key: {user_id:"zz_probe_uniq_r238"}`；cleanup `removed:1` | ✅ **唯一索引真生效**（机器硬证据，终结仓内悬案 A6"只能控制台手工验"） |

🔴 综合判读：
  1. 客户端对 `shop_entitlement` 的写权限**只作用于自己 new 出来的记录**；
     **改不到** `autoProvision`（云函数）建的那条 ⇒ **无法"在小程序里改 expire_at"**。
  2. `idx_ent_user` unique **真生效** ⇒ 也不能"再 add 一条同 user_id 的高期限记录"。
     ⇒ 两条路都堵死，**且堵死是正确设计**（否则任何用户都能自开权益 ⇒ 付费墙形同虚设）。
  3. 结论：**权益必须经控制台 / admin 通道开通**。

四、附带打通的新通道（对将来自动化有价值）
----------------------------------------------------------------
`cli auto` 在本机**起不来**（实测：日志停在 `√ Using AppID` 后无 `√ auto`，
9420/9421/9422/9430 全 CLOSED；IDE 进程也未被拉起）。
**改用 `cli agent start --trust-project --auto-port 9420` ⇒ 9420 立即 OPEN**，
`miniprogram-automator.connect({wsEndpoint:'ws://127.0.0.1:9420'})` 连接成功，探针全部跑通。
⚠️ 仍需注意 `miniprogram-page-review` §R188 的定式：**逻辑层 `wx.reLaunch` 是唯一可用入口**，
且「写后读必超时」——重试一次即成功（本轮实测第 1 次 FATAL timeout、第 2 次成功）。

五、李老师要做的那一步（ID 已备好，不必再找）
----------------------------------------------------------------
云开发控制台 → 数据库 → `shop_entitlement` → 找 `user_id = u_mu6j87t1a283` 那条 →
**编辑**（不是新增；`idx_ent_user` 是 unique，新增必被拒 —— 本轮已实测）：
    expire_at  → 1830268799000   （= 2027-12-31 23:59:59 GMT+8，已机器验算）
    source     → manual
    updated_at → 当前毫秒时间戳
改完在小程序里重进「配方 → 单品毛利复盘」。

⚠️ 手工改库**不写 audit_log**（只有 adminGrantEntitlement 才留痕）。自测无所谓；
   将来给客户开权益，应走 admin 通道。

六、我这边可提供的闭环
----------------------------------------------------------------
控制台改完后说一声，我用 `r238_probe_ent.js`（只读）复验 `is_active` 是否变 true —— 
免去"改了没生效不知道"的来回。

七、本目录文件清单
----------------------------------------------------------------
  README.txt              本说明
  r238_probe_db.js        客户端直读 user / shop_entitlement（只读）
  r238_probe_ent.js       调 getShopContext + payQueryEntitlement（只读）★核心
  r238_probe_write.js     add 写权限探测（带清理）
  r238_probe_update.js    where+update 权限探测（零污染）
  r238_probe_grant.js     对真实 user_id 发 update，用 updated 计数区分两种解释
  r238_probe_uniq.js      唯一索引是否真生效（零污染）
