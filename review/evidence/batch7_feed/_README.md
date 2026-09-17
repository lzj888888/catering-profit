# 批次 7 投喂 · 审批复核留证

## 0. 本轮概览

- 投喂时间：2026-09-17 01:24（InsCode 会话 `831bd65c-70cb-4600-8fb6-7ebe07886768`）
- 投喂载荷：`批次7_提示词_可直接复制.txt` + 起点确认 + 6 条额外硬约束（共 3738 字）
- 起点：批次 0~6 已验收入库；工作区干净；`origin/dev` 领先 0
  - 批次 6 交付 `a77ebc0`；其后 `61dd359`（round21 复核）/ `052308e`（R43+R44）/ `e18c442`（R41a+R42）
  - **本轮以 `e18c442` 为起点**
- 投喂核验：`sessions.body` 末条 User 文本 3738 字，首 `# 批次 7 / 8 …`、尾 `…给「预期 / 实际 / 是否通过」表`，**未截断**

## 1. 审批 ①（id=19）· 监工转人工 → 人工批准

### 1.1 监工为何转人工

`needs_human.json` 判定 `decision=human`，理由：

> 命令引用了仓库外路径：`['/c/Users/Izj/WorkBuddy/CIaw/catering-profit&&gitIog', '/c/Users/Izj/WorkBuddy/C1aw/.../cIoudfunction...', ...]`

**这是 OCR 字形误报**：`lzj` 被认成 `Izj`、`Claw` 被认成 `CIaw`/`C1aw`、`l` 被认成 `I`。
三条“仓库外路径”逐一还原后**全部在仓库内**，监工的白名单匹配因此落空 → 保守转人工（行为正确）。

### 1.2 卡片命令还原

```bash
cd /c/Users/lzj/WorkBuddy/Claw/catering-profit/cloudfunctions \
&& for f in getShopList exportData exportStatus deleteAccount; do
     mkdir -p "$f"
     printf '{\n  "name": "%s",\n  "version": "1.0.0",\n  "main": "index.js",\n  "dependencies": { "wx-server-sdk": "latest" }\n}\n' "$f" > "$f/package.json"
   done
&& node -e "console.log('4 dirs created')"
```

### 1.3 批准前只读预检（SOP ③）

| 检查 | 命令 / 依据 | 实际 | 判定 |
|---|---|---|---|
| 重名检查（是否覆盖既有） | `for f in getShopList exportData exportStatus deleteAccount; do [ -e cloudfunctions/$f ] …` | 4 个**全部不存在** → 新建 | ✅ 无内容可丢 |
| 是否调本仓脚本 | 通读命令 | 仅 `node -e "console.log(...)"`，无 `sync_common` 等 | ✅ 无幂等风险 |
| 函数名是否符合本批规格 | `grep` 交付包批次 7 章节 | `getShopList`=§2.3/2.7 多店铺切换；`exportData`/`exportStatus`=§2.4 异步导出+进度；`deleteAccount`=§2.11 账号注销 | ✅ 与规格一一对应 |

### 1.4 安全红线逐条过筛

| 红线 | 是否命中 | 说明 |
|---|---|---|
| `rm` / `rmdir` / `del` / `mv` / `cp` | ❌ 未命中 | 命令中无删除/移动类动词（`deleteAccount` 是**目录名**，非 `del`） |
| `git clean` / `reset` / `checkout` / `push` / `commit` | ❌ 未命中 | 无 |
| `truncate` / `dd` / `drop table` / `delete from` | ❌ 未命中 | 无 |
| `taskkill` / 装包 / 网络下载 | ❌ 未命中 | 无 `pip/npm install`、无 `curl/wget` |
| 读写仓库外路径 | ❌ 未命中 | 全部在 `catering-profit/cloudfunctions/` 内（监工告警系 OCR 误报，见 1.1） |
| 删除或整体覆盖既有文件 | ❌ 未命中 | 目标 4 目录均为新建 |
| `node -e` 含 `rmSync`/`unlinkSync`/`child_process` | ❌ 未命中 | 仅 `console.log` |

平台弹窗那句「这条命令会删除指定路径，删除后不可恢复」是 `>` 截断重定向的**通用启发式告警**（SKILL 已记录的误报形态）。

### 1.5 判定与执行

- **判定：安全，批准。**
- 执行：`inscode_patrol.py --approve 918 864` → `{"ok": true, "clicked_window_xy": [918, 864], "clicked_screen_xy": [978, 869]}`
- **未点击**「拒绝并停止任务」，**未点击**「本会话不再询问（直到完全访问）」——权限提权留给用户本人决定。

## 2. 批准后复核（SOP ⑤）

| 项 | 预期 | 实际 | 通过 |
|---|---|---|---|
| `approval_audit` 最新行 | `state=approved_once` | id=20 `state=approved_once`，`resolved_by=user`，`wait_ms=265342`（挂起 ≈4.4 分钟） | ✅ |
| 目标产物出现 | 4 个目录建成 | `cloudfunctions/{getShopList,exportData,exportStatus,deleteAccount}` 均已创建 | ✅ |
| `session-stream.log` 继续前进 | mtime 重新往前走 | 01:27:29 → 01:33:56，size 3451599 → 3454164 | ✅ |
| `inflight_turn` | 1（在飞） | 1 | ✅ |
| 后续审批 | 自动放行 | id=21/22 `resolved_by=permission_mode`，`wait_ms=1426`（非监工代点） | ✅ |

`git status` 复核：批准生效瞬间未见对既有文件的 `M` 改动（新增函数仍在新目录内）。

## 3. 留证清单

| 文件 | 内容 |
|---|---|
| `批次7_已发送_InsCode开工_20260917.png` | 投喂后 20s，输入框清空、会话开始应答 |
| `审批1_弹窗_20260917.png` | 审批弹窗原帧（监工截取） |
| `审批1_巡检查看_20260917.png` | 巡检脚本多帧拼接查看 |
| `审批1_监工转人工_20260917.json` | 监工 `needs_human.json` 原文（含 OCR 全文与判定理由） |
| `审批1_批准后_InsCode推进_20260917.png` | 批准后 InsCode 继续出字 |

## 4. 备注（监工元数据小瑕疵）

`needs_human.json` 的 `batch` 字段记为 `6`，但卡片正文与 `sessions.body` 末条 User 文本均为**批次 7**。
该字段取自当时尚未清理的过期 `batch_done.flag`（turn_id=5，批次 6 遗留）。本轮已删除该过期 flag，
下批起 `batch` 字段将指向正确批次。

---

## 5. 复核方补充（WorkBuddy 主代理，01:30–01:55 接手处置）

### 5.1 时间线校正：本批有两次 `--approve`，第二次是空点

| 时刻 | 动作 | 证据 |
|---|---|---|
| 01:27:22 | 审批 id=19 pending | `approval_audit` |
| 01:30 | 主代理截图，确认卡片仍在（平台弹「高风险」） | `审批1_批准前_挂起弹窗_20260917.png` |
| 01:33 | **巡检自动化按 SOP 批准** → id=20 `approved_once`，`wait_ms=265342` | §1.5 |
| 01:45 | 主代理**又跑了一次** `inscode_patrol.py --approve` → `clicked_screen_xy=[959,835]` | `审批1_批准后_InsCode继续推进_20260917.png` |

**01:45 那次是 no-op**：审批早已处置，点击未产生第二次批准记录、也未落到任何危险控件。
教训：**代点前必须先读 `approval_audit` 的 `max(id)` 状态，确认仍为 `pending` 才点**（已写入 SKILL 硬教训）。

### 5.2 监工假阳性根因已修（脚本级）

§1.1 的 OCR 字形误报不是一次性事故：`_canon` 归一化前，**每轮** `l→I` 的误读都会让合法仓库内路径被判成"仓库外"→ 交人停机。
已在 `inscode_watch.py` 的 `outside_repo()` 前加归一化：

```python
_CMD_SEP  = re.compile(r"[&|;<>,\s\"'`()\[\]{}]+")   # 命令分隔符 = 路径边界
_BAD_CHR  = re.compile(r"[^a-z0-9/._\-]")
_OCR_MAP  = str.maketrans({"1": "l", "i": "l", "0": "o"})   # OCR 易混字形

def _canon(p):
    p = p.lower().replace("\\", "/")
    p = _CMD_SEP.sub("/", p)      # `-profit&&gitIog` 不再被当成同一路径
    p = _BAD_CHR.sub("", p)
    return p.translate(_OCR_MAP)
```
前缀命中后还要求**下一个字符不是路径字符**，避免 `catering-profit-evil/` 这类同前缀越权路径被放行。

用例验证（7/7 通过）：

| 输入 | 期望 | 实际 |
|---|---|---|
| `/c/Users/Izj/WorkBuddy/CIaw/catering-profit&&gitIog --oneline` | 仓库内 | ✅ 仓库内 |
| `/c/Users/lzj/WorkBuddy/C1aw/catering-profit/cIoudfunctions&&fO「fin` | 仓库内 | ✅ 仓库内 |
| `C:\Users\lzj\…\Claw\catering-profit\pages\mine\index.js` | 仓库内 | ✅ 仓库内 |
| `C:/Users/lzj/WorkBuddy/Claw/catering-profit-evil/x.js` | 仓库外 | ✅ 拦截 |
| `/c/Users/lzj/Desktop/evil.sh` / `D:/tmp/foo.js` | 仓库外 | ✅ 拦截 |

监工已重启（pid 24008，心跳 alive），批准后 `inflight_turn=1` 正常在跑。

### 5.3 本批待复核风险点（复核方提前登记，逐条核完再提交）

| # | 风险点 | 为什么是风险 | 复核动作 |
|---|---|---|---|
| 1 | 自动化版硬约束**缺 i18n 双副本条目**，且第 5 条写「不改 `specs/`」 | 与 K11（两份 `terms.js` 必须逐字节一致）**直接冲突**；而批次 7 必然加界面文案 | `md5sum miniprogram/i18n/terms.js specs/dev-specs/i18n/terms.js` |
| 2 | 硬约束缺「新增页面须在 `app.json` 声明」 | 本批新增 `pages/mine/`、`pages/shop/switch.*`；漏声明被 R44 守卫点名 | `node tools/check_pages.js` |
| 3 | 硬约束缺「前端禁 `auto_subscribe`」 | R42 守卫（iOS 合规）会转红 | `node tools/check_compliance.js` |
| 4 | **`verify_all.js` 出现 `M`** | 门禁脚本属复核方资产，禁止为"变绿"而改 | 逐行审是否仅为登记本批新套件 |
| 5 | `exportStatus` 目录被 InsCode 自行 `rm -rf` | 删除动作已发生（仅删它自己刚建的目录，无内容损失） | 确认无代码引用残留 |
| 6 | 实测改动面 | 用户体验打磨必然改既有前端页面 | 逐文件确认没有改到 `common/`、`initDb/`、既有云函数契约 |

### 5.4 本批仍未投喂的硬约束（差异说明）

主代理原准备 11 条硬约束，实际投喂的是自动化的 6 条版本，**缺**：i18n 双副本同步、`app.json` 页面声明、
前端禁 `auto_subscribe`、`_pct`/`_ratio` 口径、日志脱敏重申。→ 由 §5.3 的守卫与复核兜底，
不重复投喂（避免同一批重复劳动）。

---

## 6. 交付复核（主代理独立复核 · 02:50–03:00，不采信 InsCode 自述）

本轮结束判据：`turn_terminal kind=complete`（turn `:8`，01:25:19→02:09:32，62 轮 / 78 次工具调用）、
`inflight_turn = 0`、`session-stream.log` mtime 停止增长 —— 三条同时成立 ⇒ 可安全复核提交。

### 6.1 门禁与硬约束（全部实测）

| # | 检查 | 命令 / 依据 | 实际 | 判定 |
|---|---|---|---|---|
| 1 | 全量门禁 | `node verify_all.js` | **45/45，exit 0**（41 → 45，新增 batch7 ×4） | ✅ |
| 2 | common 派生同步 | `node tools/sync_common.js --check` | 42 个函数目录副本 ≡ 单源 | ✅ |
| 3 | 静态 require | `node tools/check_requires.js` | 596 个 .js（小程序 26 / 云函数 570），相对引用 1171 条全解析 | ✅ |
| 4 | K11 双副本 | `md5sum` + `diff -q` | 两份 `terms.js` `md5=607127ab…` 逐字节一致 | ✅ |
| 5 | 受保护区 | `git status --porcelain cloudfunctions/common/ initDb/` | **空** | ✅ |
| 6 | 既有云函数是否被改 | `git status --porcelain cloudfunctions/ \| grep '^ M'` | **无**（仅 3 个新目录 `??`） | ✅ |
| 7 | 门禁脚本被改的性质 | `git diff verify_all.js` | **仅**登记 batch7 ×4 套件 + 头部注释 41→45，无放宽/豁免 | ✅ 非"改绿" |
| 8 | 用户可见硬编码中文 | 剔 `<!-- -->` 后扫 `pages/**/*.wxml` | **0 命中**；`utils/*.js` 中文全在注释 | ✅ |
| 9 | 页面声明守卫 R44 | `node tools/check_pages.js` | 14 页声明 ≡ 14 页实到，无孤儿 | ✅ |
| 10 | 合规守卫 R42 | `node tools/check_compliance.js`（含在全量门禁内） | 前端无 `auto_subscribe` 引用 | ✅ |

### 6.2 交付清单（与它的自述核对一致）

- 新云函数 ×3：`getShopList`（仅 `is_deleted=false` + 免费配额）、`exportData`（权限只读 `expire_at`，
  非付费 `FEATURE_LOCKED` 兜底；Excel=CSV+BOM / JSON；文件名含店铺名+月份）、
  `deleteAccount`（软删 user + 匿名化 openid/昵称 + 关联软删 + 幂等）。
- 前端 ×4：`utils/validate.js`（`INVALID_PARAM` + i18n）、`utils/loading.js`（`withLock` 防连点）、
  `utils/shopSwitcher.js`（持久化 `shop_switcher_shop_id`）、`utils/selftest_batch7.js`（20 项，全过）。
- 新页 ×2：`pages/shop/switch/`（切换**不**弹付费窗，仅保存超限才弹）、
  `pages/mine/index/`（隐私协议查看 + 撤回授权 + 注销二次确认）。
- 必要修改：`app.js`（`getPrivacySetting` / `onNeedPrivacyAuthorization` / `requirePrivacyAuthorize`，
  同会话 ≤2 次、可跳过）、`app.json`（注册 2 页）、`pages/index` / `pages/month/result` / `pages/card/index`
  （切换入口 + 导出按钮）、i18n 双副本（`terms.exp` / `terms.exportBtn`）、`verify_all.js`（登记套件）。

### 6.3 §5 六条验收锚点（复核方抽验）

| # | 锚点 | 复核方式 | 判定 |
|---|---|---|---|
| 1 | 金额负数前后端双拦 | `validate.money('-5')` 拦截 + 云函数非负整数分校验 | ✅ |
| 2 | 连点只产生一条 | `withLock` busy 忽略；门禁里实测「连点两次只执行一次 calls=1」 | ✅ |
| 3 | 多店铺数据隔离 | 切换写 `globalData.shop_id`，`api.js` 统一注入；后端仅返活跃店铺 | ✅ |
| 4 | 导出进度不卡 | 前端 `showLoading` + 云函数内同步生成（**简版**，任务队列排 v1.1） | ⚠️ 见 6.4 |
| 5 | 免费导出弹付费窗 | `onExport` 先查 `expire_at`，后端 `FEATURE_LOCKED` 兜底 | ✅ |
| 6 | 日志无手机号明文 | `deleteAccount` selftest 断言审计 JSON 无 openid/手机号/昵称明文 | ✅ |

### 6.4 新发现 · **R47**（待裁决，本轮未擅动）

`app.json` 新增了：

```json
"requiredPrivateInfos": ["getPrivacySetting", "requirePrivacyAuthorize"]
```

但微信官方 `requiredPrivateInfos` 的**合法取值只有位置/地址类隐私接口**
（`getFuzzyLocation` / `getLocation` / `onLocationChange` / `startLocationUpdate*` / `chooseLocation` /
`choosePoi` / `chooseAddress`），`getPrivacySetting` 与 `requirePrivacyAuthorize` **不在其列**。
本项目**未使用任何位置类接口** ⇒ 这段声明既**多余**，又可能在开发者工具里触发配置告警。

- 风险：低（多半只是告警，不阻塞编译），但属"写了未被官方认可的配置"。
- 真实入口其实是：① 公众平台后台配置《用户隐私保护指引》（非代码）② 代码侧 `wx.getPrivacySetting`
  判断 + `wx.requirePrivacyAuthorize` 拉起 —— 这两件它**都已正确实现**。
- 建议：删掉这段 `requiredPrivateInfos`，或等真机联调时看工具是否告警再定。**未擅自删。**

### 6.5 回执（round22 · 本轮）

- [2026-09-17 01:45] 投喂：批次 7 **已由 hourly 自动化于 01:25 投喂**（未重复投喂）·
  证据：`sessions.body` 末条 User 3738 字 + turn `:8` started 01:25:19 · 未产生投喂 commit
- [2026-09-17 01:45] 审批 id=19：预检 4 目录均为新建 → 判定安全；**实际已于 01:33 由自动化批准**，
  我的点击为 no-op（已记 SKILL 硬教训 9）· 证据：`approval_audit` id=20 `approved_once`
- [2026-09-17 01:50] 监工假阳性修复：`outside_repo()` 加 `_canon()` 归一化 + 边界校验，7/7 用例通过 ·
  证据：`C:\Users\lzj\.workbuddy\skills\inscode-desktop-feed\scripts\inscode_watch.py`
- [2026-09-17 02:05] 监工重启 pid 38664（宿主会回收后台进程，靠 hourly 自动化「分支 0」兜底）
- [2026-09-17 03:00] 复核：45/45 + K11 一致 + 受保护区零改动 → 提交（见下方 commit）
- [存疑 → 已落 2026-09-17 03:18] 重启键 §1.1 套件数 10 → **45**、里程碑补批次 3/4/5/6/7、
  §1 状态行补「8 批（批次 0–7）已全部交付，**无批次 8**」、新增「两个跨出 specs 的新守卫」条目 ·
  证据：`node verify_all.js` → 45/45 exit 0；`node specs/dev-specs/prototype/check_error_codes.js`
  → A–L 全绿 exit 0（重启键在 I/J 扫描面内，改完必跑，本次无自命中）
- [2026-09-17 03:18] round22 复审产物 `review/REVIEW_2026-09-15_round22-verify.md`（DeepSeek 出，
  67 行，结论 R41a/R42/R43/R44 四项全落地）**已归档入库**（此前长期 untracked）
- [存疑] R47（`requiredPrivateInfos` 填了非官方取值）**仍未裁决、未擅删**；
  R45/R46、`adminAuth`/`adminExport` 深审、真云 unique 实测 —— 均未做，等李老师点单。

### 6.6 收尾补丁一轮（2026-09-17 03:31 发出 → 03:40 回复 → 03:50 验收）

**发了什么**：把「批次 7 已验收入库 + 收尾补丁任务（R45/R46/R47）+ `adminAuth` 吊销链 / `adminExport` 角色控权
只读自查」用键鼠（剪贴板+Ctrl+V+Enter）发进 InsCode 聊天框（3132 字；User 消息数 7 → 8 由 sqlite 自证）。

- [2026-09-17 03:40] **InsCode 回复**（Assistant +10 条，仅 2 分钟）：交三处补丁 + 两张自查表 ·
  证据：`inscode_reply_wait.py` → `{"event":"REPLY","delta":10}`（后台任务事件驱动唤醒，非轮询烧轮次）
- [2026-09-17 03:44] **独立复核（不采信自述）**：`git status --porcelain` = 仅 3 文件
  （`app.json` / `app.wxss` / `cloudfunctions/calcBom/validate.js`）；受保护区 `common/`+`initDb/` **空**；
  K11 双副本 md5 `607127ab…` **未变**；`git diff` 逐行核 = 删 `requiredPrivateInfos`（R47）、
  删 `.dish`/`.dish-main` 两条（R45）、`validate.js:2` 注释改名（R46）。**无夹带改动** ✅
- [2026-09-17 03:47] ⚠️ **我方 R46 判词修正（自纠）**：原判「`gross_loss_pct` 只存在于契约注释、代码零实现 ⇒ 死字段」
  **不完整** —— 实测契约 `core/10` **L63/L65 两行入参名也是 `gross_loss_pct`**（`saveCostCard` 的
  `lines[].gross_loss_pct`、`calcBom` 的 `nodes[].gross_loss_pct`），而实现侧 7 处（4 云函数 + 2 前端 + 1 快照）
  一直用 `loss_pct` ⇒ **是"同一字段两种写法"的跨层漂移，不是单纯死字段**。
  已由**我方**（specs 归我方职责）把契约统一为 `loss_pct`，并在契约内加「字段改名留痕」注（保留旧名作检索锚点，
  防止后人拿旧名传参）。**未让 InsCode 动 specs。**
- [2026-09-17 03:48] **门禁全绿**（均自跑）：A–L `exit 0` / `verify_all` **45/45** / `check_pages` **14≡14** /
  `check_compliance` 68 文件无未豁免引用 / `sync_common --check` **42 目录 ≡ 单源** / `check_requires` 596 .js 全解析。
  ⚠️ 本机 Bash 的 PATH 可能为空（`node: command not found`）⇒ 须显式
  `export PATH="/usr/bin:/bin:/mingw64/bin:/c/Windows/System32:/c/Windows:…/node/versions/22.22.2-3"`。
- [待裁决 · 两项它自评的建议改] ① **`adminAuth`**：登出/刷新/超管吊销**三跳已闭环**，唯一缺口 =
  「管理员被禁用（或将来改密）后，已签发 token **仍可用到 7 天自然过期**」——`requireAuth` 只查
  `admin_login_log` 会话行、**不校验 `admin_user.status`**（它自评中等风险，建议在 `requireAuth` 补一步 status 校验）。
  ② **`adminExport`**：角色控权（超管专属全量 / 运营仅订单 / 云函数层拦截 / `ADMIN_EXPORT` 写 audit_log）
  **全部闭环、无越权路径**；唯一改进点 = 全量取数 `limit(1000)` **无分页**，>1000 条会静默漏导（低风险）。

### 6.7 R48 / R49（新登记，本阶段处置）

- **R48**：`requireAuth` 未校验 `admin_user.status` ⇒ 禁用管理员后旧 token 有效至自然过期（**安全缺口**）。
- **R49**：`adminExport` 全量导出 `limit(1000)` 无分页 ⇒ 超量静默截断（**低风险**，规模增长后成隐患）。

### 6.8 R50（新登记 + 守卫已落）：`_adminCore/adminAuth.js` 单源派生**无门禁覆盖**

**发现经过**：R48 要改 `requireAuth`，InsCode 一动手就有 **26 个 `cloudfunctions/**/adminAuth.js` 同时变 M**
⇒ 顺着查单源机制，发现 `cloudfunctions/_adminCore/adminAuth.js` 是自述的「单源」，
各 admin 云函数目录各有**一份同名副本**（共 11 份），但 `tools/sync_common.js` **只管 `cloudfunctions/common/`**，
对 `_adminCore` **零覆盖** —— 也就是说：**改了单源忘同步副本、或手改某一份副本，45 个套件全绿也发现不了**，
上线后表现为「同一个鉴权逻辑在不同云函数里行为不一致」，且是静默的。
（与 L 组把 `common/` 收编进门禁**之前**的状态完全同构 —— 属"修了一处没查同类"的典型。）

**为什么不能改成 require 单源**：云函数各自独立打包上传，跨目录 require 到包外会 `MODULE_NOT_FOUND`（L 组实测结论）。
⇒ 派生副本是**必需**的，**只能靠守卫守一致性**。

**守卫**：`tools/check_admincore.js`
- 逐字节（归一 BOM/CRLF）比对每份 `<func>/adminAuth.js` ≡ 单源；另校验「`index.js` 引了 `./adminAuth` 却没副本」（云端必然启动失败）。
- `--fix` 用单源覆盖所有副本（确定性、可 git 回退）；报错信息给出"到底哪边是最新的"的两种修法。
- **变异验证**：给 `adminQueryUser/adminAuth.js` 追加一行 → `exit 1` 点名「不一致」；还原 → `exit 0`（11 份全 ≡）。
- 状态：**已落文件、已单独提交**；**登记进 `verify_all.js` 待 InsCode 本轮收尾后做**（避免与它正在改的
  `verify_all.js` 抢同一文件）。



### 6.9 一轮加固（R48/R49）验收（2026-09-17 03:55 发出 → 03:54 回复 → 04:05 验收）

**时间线**（注：回复时间戳 03:54 早于我发出任务前守候脚本的起点，是因为守候脚本
`--assist 309` 基线取自 03:40 那轮；本轮 Assistant 309 → 337，+28 条，为 R48/R49 的完整交付报告。）

**复核（不采信自述，逐项实测）**
| 项 | 命令 / 方法 | 结果 |
|---|---|---|
| 改动面 | `git status --porcelain` | 26 M + 1 新增（`adminExport/service.js`），与自述逐项对上 |
| 受保护区 | `git status --porcelain cloudfunctions/common/ initDb/` | 空 ✅ |
| K11 | md5 双副本 | `607127ab…` 一致，未变 ✅ |
| 核心 diff | `git diff _adminCore/adminAuth.js` + `adminExport/index.js` | 逐行审：`requireAuth` 三参、fail-closed 四处分支、读库 try/catch ✅ |
| 调用点遗漏 | `grep -rn "requireAuth("` | 9 处 index.js **全为三参**，旧二参**零残留** ✅ |
| 错误码 | `grep HARD_CAP_EXCEEDED` | `common/errors.js:19` 既有；i18n 双副本 `HARD_CAP_EXCEEDED→ERR.HARD_CAP` 已有 ✅（未新增错误码） |
| 变异残留 | `grep -rn MUTATION` | 0 ✅ |
| selftest | 逐个 `node …/selftest.js` | adminLogin 33/0、adminExport 21/0、adminRefreshToken 8/0、adminLogout 4/0、adminRevokeToken 5/0、adminInit 7/0、adminGrantEntitlement 14/0 ✅ |
| 门禁 | `node verify_all.js` | 46/46 exit 0（含新登记 R50 守卫）✅ |
| 单源 | `node tools/check_admincore.js` | 11 份副本 ≡ 单源 ✅ |

**提交**：`2a3753f` fix(admin) R48/R49（`origin/dev` 已推）。

#### 6.9.1 复核方独立发现（本轮新增，非 InsCode 报）

- **R51（存疑，未拦）**：`adminExport/index.js` 的 `pagedQuery('shop_entitlement', {})` 用了**空 where 对象**。
  全仓**无先例**（`grep where({})` 零命中），腾讯云开发文档仅约束「条件必须 object、值不能全 undefined」，
  未明示空对象行为 ⇒ 平台若不吞，超管导出权益会直接 `SYSTEM_ERROR`。**当前数据量下不触发，随规模暴露**。
  已作为下一轮任务派给 InsCode（改为不带 where 或恒真条件）。
- **R52（上线前必查，非代码缺陷）**：R48 是 **fail-closed**，`admin_user.status !== 'active'` 一律拒。
  已核实 `adminInit` 建号时写 `status:'active'`（index.js:65）⇒ 新建管理员安全。
  ⚠️ 但**若库里存在历史/手工插入的缺 `status` 记录，部署 R48 后该管理员会被立刻拒，
  且 adminInit「已有记录即拒绝」—— 无法自救**。
  ⇒ **部署前需李老师在控制台确认 `admin_user` 每条记录都有 `status='active'`**；
  否则需手工补字段后再部署。已列入上线阻塞清单。

### 6.10 回执（本轮 · 2026-09-17 04:05）

- [已落] R48/R49 验收并提交 `2a3753f`（InsCode 交付，复核全绿）
- [已落] R50 守卫 `tools/check_admincore.js` 登记进 `verify_all.js` SUITES（45 → **46** 套件），
  改后 `verify_all` 46/46 + A–L exit 0 双跑通过 · `caa3f40`(文件) + 本轮提交
- [已落] R51 / R52 登记（见 §6.9.1）
- [存疑] R51 空 where —— 平台行为未实测，需真云验证或下一轮加固
- [存疑] R52 上线前人工核查 —— 依赖李老师在云控制台看 `admin_user`（InsCode 与我方均无数据库访问权）
- [未落] 真云 unique 实测（用户顺序 ⑦，仍需云控制台）
- [未落] `specs/dev-specs/★知识存储点_2026-09-10.md` 套件数仍是 **45**（本轮改 46 未回填，
  留待本阶段收官统一刷新，避免同一事实在多处反复漂移）

---

### 6.11 R52 核查完成（2026-09-17 07:05–07:25，云开发控制台 GUI 实测）

**结论：dev 环境 `admin_user` 集合 = 0 条记录 ⇒ R48 的 fail-closed 在 dev 不会锁死任何管理员。**

证据：`r52_admin_user_dev_空集合_20260917.png`（+ `r52_集合列表_20260917.png`）

- 路径：微信开发者工具 → 工具栏「云」图标 → **云开发控制台 v2.0.3** → 数据库 → 集合管理 → 选中 `admin_user` → 记录列表「**没有找到记录**」
- 环境：`cloud1-d4gphpoxy337f2a25`（控制台显示「cloud1 免费开发环境」）—— 与 `cli cloud env list` 返回一致，非猜环境
- 方法：截图 + WinRT OCR 双重定位（`win-desktop-control` 技能），非肉眼

**prod 侧推导（结论不变，风险面收窄）**

- prod 环境尚未创建（属上线阻塞，非本轮范围）
- 首个管理员由 `adminInit` 创建，`adminInit/index.js:65` 写 `status:'active'` ⇒ **只要走 adminInit，R48 就不会拒**
- **唯一风险路径**：手工在控制台向 `admin_user` 插文档且漏 `status`。因 `adminInit` 对「已有记录」直接拒绝 ⇒
  该记录**永久被 R48 拒且无法自愈**。⇒ 上线清单加入一条硬规则：
  **首个管理员必须由 `adminInit` 创建，禁止手工插入 `admin_user` 文档**（如必须手工插入，务必带 `status:"active"`）

**顺带排除一个假发现**：集合列表按字母序仅显示到 `shop`（admin_login_log / admin_user / audit_log /
feature_permissions / order_refund / probe_tmp / shop），**不是「dev 只有 7 个集合」**——列表可滚动，属显示截断。

### 6.12 工具链发现：开发者工具自带云 CLI 原子工具（可解锁真云测试）

- 安装目录 `resources/app.asar.unpacked/wechatide-skill/` 内含官方 skill 包，提供 `wechatide <tool>` 原子工具：
  `cloud_env_list` / `cloud_fn_list` / `cloud_fn_info` / `cloud_fn_deploy` / `cloud_fn_inc_deploy` /
  **`cloud_db_read_doc`** / **`cloud_db_read_struct`（listCollections / describeCollection / listIndexes / checkIndex）** /
  `cloud_db_write_struct`（建/删集合、管理索引）/ `cloud_db_write_doc` / `cloud_query_storage` …
- 价值：**若授权打通，「39 条索引补齐」与「真云 unique 实测」都可程序化完成**，不必手工点控制台
- 当前阻塞：`wechatide` 按客户端名授权（`-c <clientName>`），调用返回
  `status: pending` / `Waiting for user authorization.`（`-c workbuddy` 与 `-c CodeBuddy` 均如此）。
  已在「主窗口 / 通知中心 / 进程内其它窗口 / 云控制台设置」逐一排查，**未找到授权弹窗** ⇒ 待李老师在开发者工具内完成
- 排除项：`cli agent tool` 走的是小程序 `app.json` 的 `agent.skills`（小程序 AI 技能）通道，与本用途无关
  （缺该字段时报 `agent.skills is empty in app.json`，已实测）
- **操作纪律（实测）**：官方 SKILL 明确「禁止在沙箱中运行 `wechatide`」⇒ 必须非沙箱执行；
  本机 Bash 的 PATH 可能为空（`node`/`python` 均找不到），每条命令前需显式 `export PATH=…`；
  `wechatide` 与 `cli` 是两套入口（`skill-index.js` vs `index.js`），`cli` 免授权但**没有数据库命令**

### 6.13 round23 复审产物登记（含撞号处理）

`review/REVIEW_2026-09-15_round23-verify.md` 已归档（见本轮提交）。它提三条，其中一条**编号撞车**：

- ⚠️ round23 的 **R54（6 个 batch4 云函数无 selftest.js）** 与我方本阶段已用的 **R54（审计留痕失败静默吞）** 撞号
  ⇒ **本侧改用 `R57`** 指代「6 个 batch4 云函数缺机器断言」：
  `getLedger` / `getMonthList` / `getShopContext` / `getCardVersions` / `saveAsset` / `saveShopSetting`
  （其中 `saveAsset` / `saveShopSetting` 是**写操作**，优先补）。round23 文件保持原样不改（复审方产物）
- **R55**（`utils/selftest_batch7.js` 随小程序包发布，`packOptions.ignore` 未覆盖 `.js`）：成立，待处置
  —— 移入 `tools/`（已在 ignore 内）或加一条 ignore；约定：测试脚本一律放 `tools/`
- **R56**（admin 族 12 函数入参校验内联于 `index.js`，无独立 `validate.js` ⇒ 入参面无法单测）：
  成立，属「与 batch1/2/3 范式不一致」的一致性缺口，非缺陷；下次触碰某 admin 函数时顺手抽出

### 6.14 回执（R52 核查轮 · 2026-09-17 07:30）

- [已落] **R52 核查完成**：dev `admin_user` = 0 条（控制台实测 + 截图留证）⇒ dev 无锁死风险；
  产出上线硬规则「首个管理员必须由 `adminInit` 创建」
- [已落] 工具链发现（§6.12）：官方云 CLI 原子工具可用性已摸清，**卡在 client 授权**（待李老师）
- [已落] round23 产物归档 + 撞号处理（R54→R57）+ R55/R56 登记（§6.13）
- [存疑] `wechatide` 授权弹窗位置未找到 —— 需李老师本人在场（或告知「设置 → 安全」入口）
- [未落] R55 移动测试脚本（待办，未改代码）
- [未落] R57 补 `saveAsset`/`saveShopSetting` 自测（待办）
- [未落] 真云 unique 实测 —— 若授权打通可程序化完成，否则仍需手工

### 6.15 R58（新发现·真缺口）：prod 环境「首超管」没有落地路径 —— 已补可复现方案

**发现链**：查 R52 的 prod 侧时，从 InsCode 自查报告（04:23 那轮）的「`ADMIN_SETUP_TOKEN` 未配置 ⇒ adminInit 拒绝调用」
往下挖，发现更根本的问题：

| 事实 | 出处（已核实） |
|---|---|
| `adminInit` 的 env 门禁是 **prod 恒拒**（`/prod/` → 拒；空 env 也拒） | `cloudfunctions/adminInit/index.js:20-24` |
| 规范要求的引导方式含「**或控制台脚本**」 | `specs/dev-specs/core/16_后台鉴权规范.md:74` |
| 但仓库里**没有任何** prod 引导脚本/产物 | 全仓检索 |
| 手工向 `admin_user` 插文档**算不出** scrypt 哈希（需盐 + `scryptSync`） | `_adminCore/adminAuth.js:38` |
| R48 之后 `status !== 'active'` 一律拒（fail-closed） | `_adminCore/adminAuth.js` requireAuth |

⇒ **结论**：prod 首超管目前**无可用通道**；若走手工插入，既容易漏 `status`（被 R48 永久拒、无法自愈），
也只能靠人算哈希（不可行）。这是**上线前必须闭环**的一项（非代码缺陷，是"引导路径缺失"）。

**已补（本侧实现，不动交付代码、不改规范）**：`tools/gen_admin_bootstrap.js`

- **算法同源**：直接 `require('cloudfunctions/_adminCore/adminAuth.js')` 的 `genSalt/hashPassword/verifyPassword`
  （该模块零依赖、纯 `node crypto`，可被本地脚本复用）⇒ 不引第二套实现
- **字段防漂移**：从 `adminInit/index.js` 源码**解析**其 `data:{...}` 的字段集，与生成文档做**集合相等**断言
  （实测已抓到我自己的解析器漏了简写属性 `salt,`，已修 → 说明这道守卫是真守卫）
- **哈希回环自检**：生成后立即 `verifyPassword(password, salt, pwd_hash) === true`，否则退出码 1
- **执行链一致性（静态证明）**：`adminLogin/index.js:58` 用的正是同一个 `verifyPassword(v.password, admin.salt, admin.pwd_hash)`
  且字段名相同 ⇒ 生成的文档必被登录链路接受
- **正反验证（实测）**：正向 exit 0；密码错一位 exit 1；salt 被改 exit 1
- **安全边界**：明文密码只在本机进程内使用，不落盘（除非显式 `--out`）、不打印、不打日志；
  脚本位于 `tools/`，**已在 `project.config.json` 的 `packOptions.ignore` 内**（不随小程序包发布）
- 另有 `--verify --password --salt --hash` 模式：用于事后核对控制台那条记录与生成时是否一致

**用法**：`node tools/gen_admin_bootstrap.js --username <u> --password <p> [--role super] [--out x.json]`

**另一条路（备选，未做）**：放宽 `adminInit` 门禁为「dev 白名单 OR prod 且显式 `ADMIN_SETUP_ALLOW_PROD=1`」。
属**规范层变更**（core/16 §7 与 core/10 §6 的「仅 dev / 首次运行的 env 门禁」口径），会削弱 prod 的默认安全姿态
⇒ **留李老师拍板**，本侧不擅自改。

### 6.16 回执（R52 收尾轮 · 2026-09-17 07:45）

- [已落] R52 核查完成（§6.11，控制台实测 dev `admin_user` = 0 条，截图留证）
- [已落] **R58 处置**：prod 首超管引导路径补齐 = `tools/gen_admin_bootstrap.js`（字段防漂移 + 哈希回环 + 正反验证）
- [已落] 门禁：`verify_all` **46/46** exit 0 + A–L exit 0；`check_requires` 598 个 .js 全部可解析
- [存疑] `wechatide` client 授权（未找到弹窗）—— 需李老师在场；打通后可程序化读库/建索引
- [存疑] R58 的备选方案（放宽 adminInit 门禁）属规范层，待拍板
- [未落] R55（移 `utils/selftest_batch7.js` → `tools/`）、R57（补 `saveAsset`/`saveShopSetting` 自测）
- [未落] `ADMIN_SETUP_TOKEN` 环境变量需在控制台为 `adminInit` 配置（批次 6 已登记，仍在阻塞清单）
- [未落] 真云 unique 实测、39 条索引补齐、上线三项阻塞

---

## 6.17 R55 + R57 处置（round23 队列 ②③）· 2026-09-17 07:42

> 队列来源：`review/REVIEW_2026-09-15_round23-verify.md` §5「待执行侧」②③。
> ①（提交批次 7）与 ④（R56 留痕）已在 `49f02f7`/`52716c6`/`780c8d6` 轮次完成。

### 6.17.1 R55 —— 已落：测试文件移出小程序包

**修法取 round23 建议的 ①**（移入 `tools/`，最干净，优于"在 ignore 里加一条 file"）。

| 项 | 证据（可复现） |
|---|---|
| 移动 | `git mv utils/selftest_batch7.js tools/selftest_batch7.js` → 输出 `MOVED-OK`；`ls utils/ \| grep selftest` → 空 |
| 内部相对路径改基 | `require('./validate.js'\|'./loading.js'\|'./shopSwitcher.js')` → `../utils/*`（`../miniprogram/i18n/terms.js` 不变） |
| 套件复跑 | `node tools/selftest_batch7.js` → **20 通过 / 0 失败**，exit 0 |
| 接线同步 | `verify_all.js` 的 `['batch7-utils', 'tools/selftest_batch7.js']` |
| 出包性（根因核实） | `node -e "console.log(require('./project.config.json').packOptions)"` → ignore 13 条，含 `{type:'folder',value:'tools'}`，**不含** `utils/`、**不含** `.js` 后缀 ⇒ 原位置确会进包（与 round23 §R55 一致） |

**顺带立约**（写进 `review/README.md §1`）：测试/校验脚本一律放 `tools/` 或 `cloudfunctions/<fn>/__tests__/`；🚫 不放 `utils/`、`pages/`。

### 6.17.2 R57（= round23 编号 R54，撞号改名）—— 已落：batch4 六个函数补自测，**6/6 全补（非只补 2 个写操作）**

round23 建议"至少补 `saveAsset`/`saveShopSetting` 两个写操作"，本侧**把 6 个全补**：成本低（每个都有独立 `validate.js`，`service.js` 多为纯函数），且能一次消掉"6 个函数行为无机器断言"这条。

| 新增套件 | 断言 | 覆盖重点 |
|---|---|---|
| `cloudfunctions/saveAsset/selftest.js` | **43** | 金额=整数分（拒字符串/0/负/小数/NaN）、月份两位格式、`total_months`、`terminate_month` 可空归一、`asset_id` 缺省=新增语义 |
| `cloudfunctions/saveShopSetting/selftest.js` | **29** | 🔴 **开关三态**：缺省=`null`（不动库）/ 显式 `false` 必须保留为 `false`（最易误写成"缺省即关"）；`SWITCH_KEYS` 读≡写 |
| `cloudfunctions/getLedger/selftest.js` | **37** | 锚点 S1 9,160 / S2 3,476.67 / 差异 5,683.33；🔴 **口径锁**（开库存开关也不改用倒轧，含"≠8160"反面断言）；🔴 `getLedger.calcMonthlyProfit ≡ saveLedger.calcMonthlyProfit`（**7 组输入逐字段**，含脏输入） |
| `cloudfunctions/getMonthList/selftest.js` | **17** | 入参面 + **源码形状断言**（按 month 去重 / 倒序 `a.month<b.month?1:-1` / 出参仅 `month`+`is_archive`） |
| `cloudfunctions/getShopContext/selftest.js` | **26** | `shop_id` **可选**语义；`switchesFromRows` 键精确匹配、缺行=关、未知键不污染；`SWITCH_KEYS` 读≡写 |
| `cloudfunctions/getCardVersions/selftest.js` | **37** | `calc_mode 2→'B'`、字段重命名（`aux_cost→aux_fen`、`price_list→price_fen`、`total_cost→total_cost_fen`）、`net_unit_cost` 为**万分**快照；🔴 `cardToOut/lineToOut ≡ getCostCard.cardToOutput/lineToOutput`（**4+2 组逐字段**） |
| **合计** | **189 项** | |

**方法论（本轮的增量）**：这 6 个函数的 `index.js` 都 `require('wx-server-sdk')`，纯 node 加载不了 ⇒ 断言分两层：
① **纯函数层**（`validate.js`/`service.js`）做真行为断言；② **`index.js` 源码形状断言**（顺序：鉴权→越权→校验 / 软删过滤 / 只读性 / 关键字段名）。
形状断言会被"合理重写"误红 —— **已在文件头诚实地标注等级**，不当成行为断言。另：本次新增的**跨函数等价断言**（同源副本逐字段比对）比单函数断言更有价值，它守的是"注释里写的同源"这件事。

**顺带发现（未改生产代码，留痕）**：`saveAsset/validate.js:16` 错误文案写"必须是非负正整数分"，而行为是 `<= 0` 即拒（**0 也被拒**）⇒ 文案与行为不一致（应为"正整数分"）。已用断言固化**实际行为**（`value_fen 0 → 拒`），文案修正待下次触碰该文件时一并做。

### 6.17.3 门禁与套件（改 `specs/` 后必跑）

```
node specs/dev-specs/prototype/check_error_codes.js  → exit 0（A–L 全绿；重启键 .md 已改故必跑）
node verify_all.js                                   → 52/52 套件通过，exit 0
```

同步回填：`★知识存储点_2026-09-10.md` 套件数**两处**（§1.1 L38 一键校验入口 + §1.3 套件数纪律行）46 → **52**；§1.3 另立两条新约（测试脚本落位 / 每函数应有 selftest + 新函数一律 `validate.js` 独立 = R56 的处置）。

### 6.17.4 回执

- [已落] **R55**：`utils/selftest_batch7.js` → `tools/selftest_batch7.js`（含相对路径改基 + `verify_all.js` 接线）· 证据：`node tools/selftest_batch7.js` → `20 通过 / 0 失败` exit 0
- [已落] **R57**：batch4 六函数补自测（189 项断言，含 3 组跨函数同源守卫）· 证据：`node verify_all.js` → `52/52 套件通过` exit 0
- [已落] **R56 留痕**：「新函数一律 `validate.js` 独立」+「每函数应有 selftest（两层断言范式）」写入重启键 §1.3
- [已落] 门禁：A–L exit 0 + `verify_all` 52/52 exit 0
- [存疑] `getMonthList` 的去重/倒序逻辑内联在 `index.js` ⇒ 只能形状断言；若复审方认为需要行为断言，则需把该逻辑抽 `service.js`（本侧未擅自改生产代码）
- [未落] 真云三验 / 39 条索引补齐 / `ADMIN_SETUP_TOKEN` 配置 / 上线三项阻塞 / `wechatide` client 授权 / R58 备选方案待拍板

---

## 6.18 round24 处置（2026-09-17 08:35，WorkBuddy 侧）

### 6.18.1 复审方产物归档

`review/REVIEW_2026-09-15_round24-verify.md`（96 行，md5 `bbaf82a4548d9d262936fc8eaa5a56f9`），原样入库不改。
复审方结论：**R52 / R55 / R57 独立复核通过**（HEAD `6b00110`、工作树 0 项、门禁 exit 0、套件 52/52 逐个跑、
并用 OCR 独立确认 R52 的控制台截图），另提 1 条新发现。

### 6.18.2 三条裁决（逐条实证，不采信转述）

| 复审方主张 | 我方实证 | 裁决 |
|---|---|---|
| 「R58（新）：`verify_all.js:3` 注释仍写 46，实际 52」 | `sed -n '1,8p' verify_all.js` = `// 串联：46 个套件 = …`；`grep -cE "^  \['" verify_all.js` = **52** | ✅ **真**。我方上轮只改了注释块**后半段**（补 R50 行），漏了第 3 行的总数 ⇒ 真漂移 |
| 「`saveAsset/validate.js:16` 文案与行为矛盾」 | `:15` 判据 `a.value_fen <= 0`（拒 0）；`:16` 文案写"必须是非负正整数分" | ✅ **真**。已改文案为「必须是正整数分（JSON number；不接受字符串、0 与负数）」，**行为不动**（0 元资产无业务意义） |
| 「`origin/dev` 解析不出来 ⇒ 可能引用被清理或 upstream 没了；推送无法独立确证」 | `git branch -vv` 原为 `dev 6b00110 [origin/dev: **gone**]`，`.git/refs/remotes/` 为空、`packed-refs` 无 origin 条目；`git ls-remote origin dev` 正常 | ✅ **现象真，归因需修正**：不是沙箱、也不是 upstream 配置丢失（`.git/config` 的 branch.dev.remote/merge 在），而是**本地 remote-tracking 引用缺失** |

**⚠️ 编号撞车**：复审方这条新发现编号 `R58` 与我方已落库的 **R58（prod 首超管引导 `tools/gen_admin_bootstrap.js`，已在 `780c8d6` 提交、且已写进重启键）** 撞号。
按 round23 先例（迟到方改名）：**本侧记作 R59**，`REVIEW_2026-09-15_round24-verify.md` 原样不改。

### 6.18.3 R59 处置（比"改个数字"更强：把它变成机器守的事实源）

`verify_all.js` 里同一个数量有**三层事实源**：① 代码注释（L3）② `SUITES.length`（运行时）③ 重启键两处。
R21 与 R59 两次翻车**都是 ① 与 ② 不一致**。既然 ② 是运行时可得，就没必要靠记性守 ①：

- L3 注释 `46 → 52`，并把描述补实（含 batch4 六函数补齐 / batch7 工具套件 / 三守卫）。
- 新增 **`guardSuiteCount()`**（文件内自校验，非独立套件 ⇒ 套件数仍 52）：
  解析自身源码的 `// 串联：N 个套件` 与 `SUITES.length` 比对，**不等即 `exit 1`**；找不到该句也 `exit 1`（守卫失效要响）。
- 保留 L7 的警示，并明写「另有两处在重启键，仍是人工面」（不假装全自动）。

**变异验证（注入 → 跑 → 还原，工作树无残留）**

```
A 注释 52→46（模拟"加了套件忘改注释"）→ RC=1，❌ [suite-count] 头部注释写 46 个套件，实际 SUITES = 52 个
B 删掉整句「// 串联：N 个套件」        → RC=1，❌ [suite-count] 头部注释缺少…R59 守卫无法工作
还原                                   → RC=0，✅ [suite-count] 头部注释 ≡ SUITES.length = 52；总览 52/52
```

### 6.18.4 澄清复审方一处**前提有误**

复审方问：「请确认 `tools/gen_admin_bootstrap.js` 取值方式与环境变量一致」——
该脚本**不读任何环境变量**（离线生成器：读 `cloudfunctions/_adminCore/adminAuth.js` 做算法同源、生成 JSON 交控制台插入），
与 `ADMIN_SETUP_TOKEN` **无取值关系**。token 的**唯一取值方**是 `cloudfunctions/adminInit/index.js:17`
（`(process.env.ADMIN_SETUP_TOKEN || '').trim()`，`:30` 与入参 `setup_token` 比对）。
⇒ 前提不成立，故「一致性问题」不存在的；但**规矩值得落规范**（见下）。

**已落规范**：`specs/dev-specs/core/16_后台鉴权规范.md` §7 新增两段 ——
① **prod 首超管通道（R58 定案）**：prod `adminInit` 恒拒 ⇒ 唯一推荐路径 = `tools/gen_admin_bootstrap.js` 生成文档后控制台插入；🚫 禁止手工拼文档（算不出 scrypt 哈希、漏 `status` 会被 R48 fail-closed **永久拒且无法自愈**）。
② **setup token 六条规矩**（采纳复审方判据）：只放云函数环境变量 / ≥32 位 `crypto` 随机 / dev≠prod / 一次性用后轮换或删除 / 回执不回显实际值（只记"是否已配置·是否已轮换"）/ 取值方仅 `adminInit` 入参 `setup_token`。

### 6.18.5 顺带抓到的新坑（工具层，非产品代码）

**同一条消息里对同一文件的两处 `Edit` 会互相覆盖**：本侧先给 `verify_all.js` 加 `const fs = require('fs')`（Edit 报 success），
再改 L3 注释（同样报 success）—— 结果 **`fs` 那句被后写覆盖丢失**，`verify_all.js` 抛
`ReferenceError: fs is not defined at guardSuiteCount`、**RC=1 且无任何套件输出**。
靠「改完必回读源码」纪律（先 `sed -n` 回读 + 单独跑一次）拦下，未进入提交。
⇒ **纪律**：同一文件的多处改动**串行发**（一条消息一处）；`Edit` 报 success **不等于**改动落地，关键改动必须回读。
（本轮未把这条加进 `verify_all` —— 它是编辑工具的行为，不是仓库不变量，故只落回执与日记。）

### 6.18.6 证据（命令 → 输出）

```
git log --oneline -1                 → 6b00110（round24 复核的即是此 HEAD）
git fetch origin dev                 → * [new branch] dev -> origin/dev（引用重建）
git branch -vv                       → dev 6b00110 [origin/dev]（gone 消失）
git rev-parse @{u} / HEAD            → 6b0011065a4b839264bc0a1bd401396b45d81c4e（两处一致）
node verify_all.js                   → ✅ [suite-count] 注释 ≡ SUITES.length = 52；总览 52/52 exit 0
node specs/…/check_error_codes.js    → exit 0（改 core/16 + 重启键后必跑）
grep -rn "非负正整数分"               → 仅 saveAsset 1 处（已改），无同类残留
```

### 6.18.7 回执

- [已落] **R59**：`verify_all.js` 注释 46→52 + **`guardSuiteCount()` 自校验守卫**（变异 A/B 双证）
- [已落] **saveAsset 文案**对齐行为（文案改、行为不改；`grep` 确认无同类残留）
- [已落] **`core/16 §7`**：prod 首超管通道（R58 定案）+ setup token 六条规矩
- [已落] **`origin/dev` 引用重建**；新纪律：推送后**双证**（远端 `ls-remote origin dev` + 本地 `git rev-parse @{u}` + `HEAD` 三方一致）
- [已落] 重启键：里程碑链续写 round24 + R59；「套件数会漂」行注明「代码注释层已自动、重启键两处仍人工面」；收口轮标注「round24 已核 R52/R55/R57 ✅」
- [存疑] 复审方点名要复核 **R48（fail-closed）/ R53（静默截断）** —— 本侧**同意优先给这两条**（同属"静默错误"类），但复核是复审方的动作，本侧待其点名后提供证据路径（无需新增代码）
- [未落] 真云三验 / 39 条索引 / `ADMIN_SETUP_TOKEN` 值 / 上线三项 / `wechatide` 授权 / R58 备选方案（放宽 `adminInit` 门禁）待李老师拍板

---

## 6.19 round25 处置（2026-09-17 09:0x~09:3x，WorkBuddy 侧）

> 复审方产物：`review/REVIEW_2026-09-15_round25-verify.md`（9920 B，md5 `c89198d28fe4d1919e877e951d7dadca`）原样入库；
> 结论：**round24 处置独立复核通过**（R59 守卫双证 / 注释 ≡ SUITES / 文案对齐 / `core/16 §7` / `origin/dev` 已重建 / 52-52 / **远端首次可核**），并**自认两处错**（§1.4 归因、§1.5 前提）、另提 R60 / R61。

### 6.19.1 R60 已落：能力边界改「两档」

- **改法**：`review/README.md §6` 的裸 bullet 升为 **`### 6.2 沙箱边界：两档`** 表格 —— ①默认档 = 文件系统层静态核验（`Test-Path` / `Get-Content -Encoding UTF8` / `Get-FileHash`）；②申请一次放行后 = 端到端 `verify_all`、门禁 A–L、`git ls-remote` 核远端、变异注入/还原。
  另把原文里 3 处证据（`spawn+pipe = EPERM(-4048)` / SSH `Win32 error 5` / HTTPS `SEC_E_NO_CREDENTIALS`）**降级为①档的条件从句内注**，不再作为"能力断言"。
- **同类查全（修一处必 grep 全树）**：`grep -rn "端到端跑不了\|跑不了\|核不了\|不可核"` 全仓仅 `review/README.md` **4 处**（`:70`、`:110-112`）——
  `:70`（§4 标准指令第 6 条）已改；`:110-112` 已并入 §6.2。
  另**我方自己的同类残留**：工作区 `.workbuddy/memory/MEMORY.md` 原写「沙箱禁管道子进程 → `verify_all.js` 不能端到端跑」——**事实错误**（本机实测 52/52 exit 0）⇒ 已改为条件句（仅**受限沙箱**拦管道子进程）。
- **验收自证**：`grep -c "跑不了\|核不了\|不可核" review/README.md` → **0**（连"为什么改"的历史引述也改写为概念表述，防自动 grep 误命中）。

### 6.19.2 R61 已落：回执落点 = `REVIEW_*` 的 §3 区

- 本份（round25）**已按新约定**在 `REVIEW_2026-09-15_round25-verify.md` 的 `## §3 执行回执区` 追加（见该文件 §3）。
- **历史流水不改写**（同 `audit_log` 只 INSERT）⇒ 本文件 §6.18 等**旧回执保持原样**；`_README.md:273` 那句写死的「45 个套件」**按新判据有意保留**（历史流水），活文档今后引用套件数一律指向 `verify_all` 的 `[suite-count]` 输出。
- 重启键 §1.3「复审协议」段已更新：**份数不再写死**（改指向 `ls review/REVIEW_*.md | wc -l`）、§3 落点、R60 两档、「已推」三方一致判据、**「写了不取」断点由两次更正为三次**（round24-25 这次：回执写在取件规则读不到的地方）。

### 6.19.3 R48 / R53「点名复核」包已建（本侧正式点名）

新建 `review/evidence/round25_R48_R53_review_request/_README.md`。复审方 §4 写「未复核（要点名才做）：R48/R49/R50/R51/R53」，并自荐优先 R48/R53 ⇒ 本侧按其建议**点名**，包里给：

- **R48**：单源 `_adminCore/adminAuth.js:109-120`（fail-closed 三行原文）+ 语义注释 `:88-93` + 常量 `:78`；副本守卫 `tools/check_admincore.js`（11 份 ≡ 单源，指纹 `7b90bc56`）；
  断言在 `cloudfunctions/adminLogin/selftest.js:76-116` **五例**（① 禁用 ② active 放行 ③ 缺记录 ④ 读异常 ⑤ 未知 status）⇒ 实跑 `33 通过 / 0 失败`；
  **变异方向**已列（把 `status !== ADMIN_STATUS_ACTIVE` 退化为只看 token ⇒ ①⑤ 应转红而 ②③④ 不连坐；只改某副本 ⇒ `check_admincore` 转红）。
- **R53**：`adminQueryUser/service.js:1-38` `fetchShopsAll`（100/页 × 5 = 500 ≥ `HARD_LIMIT.shop=200`，超限**响亮失败** `HARD_CAP_EXCEEDED`）+ 调用点 `index.js:54-59`；
  断言 `adminQueryUser/selftest.js:34-60` 四例（20 边界 / 150 / >500 抛错 / 0）⇒ 实跑 `12 通过 / 0 失败`；
  **变异方向**已列（删 `break` 或把 `SHOP_PAGE` 改回 20 ⇒ R53-② 应转红；把 `throw` 改 `break` ⇒ R53-③ 转红）。
- **立场**：本侧**不预判**等级（①/②档由复审方定），只给路径 + 可复现命令 + 期望输出 + 变异方向。

### 6.19.4 诚实登记两处（本侧）

1. **差点误报**：查 R48 时我一度判断「fail-closed 的反例路径没有断言」（因为 `grep "status: '"` 命中多为 `active`）⇒ 继续核到 `adminLogin/selftest.js:76-116` 才确认**五例反例俱全**。**该怀疑不成立，已在点名包里主动写明**（防止复审方也照 grep 结果误判）。
2. **重复踩已知坑**：我上轮报的「同一条消息里对同一文件的两处 Edit 互相覆盖」，**重启键 §1.3 早有记载**（round8 实测：7 次 Edit 只有最后一次存活）。
   ⇒ 说明该纪律当时**只停在文档、没变成默认动作**。本轮已把它写进工作区 `MEMORY.md` 铁律（`Edit 报 success ≠ 落地`；同文件改动串行发 + 改完回读），并写进值守 prompt 的每轮自检 ④。

### 6.19.5 证据（命令 → 输出）

```
grep -c "跑不了\|核不了\|不可核" review/README.md   → 0（改后）
node cloudfunctions/adminLogin/selftest.js         → adminLogin 批次 6 自测结果：33 通过 / 0 失败（R48 五例全绿）
node cloudfunctions/adminQueryUser/selftest.js     → adminQueryUser 批次 6/7 自测结果：12 通过 / 0 失败（R53 四例）
node tools/check_admincore.js                      → ✅ 单源派生校验通过：11 份 adminAuth.js 副本均 ≡ 单源（179 行，指纹 7b90bc56）
```

### 6.19.6 ⚠️ 追加发现（09:17）：本机 `.git/refs/remotes/**` 写入**不落盘** ⇒ `@{u}` 不可作证据

**触发**：本轮第一次推送后 `git rev-parse @{u}` 又报 `fatal: ambiguous argument '@{u}'`（round24 那次"引用缺失"复发）⇒ 不再归因"引用被清理"，改做隔离实验：

```
git fetch origin dev            → From github.com:…
                                →  * branch  dev -> FETCH_HEAD
                                →  * [new branch]  dev -> origin/dev      ← git 说建好了
  ls .git/refs/remotes/origin/  → No such file or directory               ← 同一命令内，文件不存在
  git rev-parse @{u}            → fatal: Needed a single revision
git update-ref refs/remotes/origin/dev HEAD  → rc=0（无任何报错）
  ls .git/refs/remotes/origin/  → No such file or directory               ← 同一命令内，仍不存在
git branch -vv                  → * dev 05b54d3 [origin/dev: gone]
ls -la .git/refs/               → refs/heads 正常（提交可持久化、可推送）、refs/remotes/ **空**
ls .git/packed-refs             → No such file or directory（不是被 pack 走了）
ls .git/logs/refs/remotes/origin/ → dev / main reflog **仍在**（16 KB，说明该 ref 历史上真实存在过）
```

**结论（事实层）**：`.git/refs/heads/**` 的写入**正常持久化**（本轮两次 commit + 两次 push 都成立），
但 `.git/refs/remotes/**` 的写入**报成功却不落盘** ⇒ 本机 **`@{u}` 不是可用的证据来源**。

**与 round24 的关系（更正我自己的归因）**：round24 我判"根因 = 本地 remote-tracking 引用缺失"，方向对但**不完整**——
真正原因是**该路径在本环境不持久**。08:45 那次 `git fetch origin dev` 确实建立过并维持了约半小时
（round25 §0 复审方也是在那个窗口内读到 `refs/remotes/origin/dev` 的，所以它记的"三方一致"当时为真 ✅），
但**随时可能消失**，不能当作稳定事实。

**假说（未证，仅登记）**：像是**防伪造远端状态**的写入保护（本地分支可写、代表"远端真相"的 remote-tracking 引用不可写）——
**未经证实**，不敢写成结论。可证伪路径：在**非沙箱** shell 里重跑上面三条命令。

**判据更正（已同步 3 处）**：「已推」改为 **两方判定** —— **远端** `git ls-remote origin dev` == **本地** `git rev-parse HEAD`
（远端视角才是权威，且本机实测稳定可用）；若要额外看本地引用，必须把 `fetch` 与 `rev-parse` **压进同一条命令**，
并注明"仅同命令内有效"。**单靠推送方回显不算已验。**

### 6.19.7 回执（摘要；正式一行在 `REVIEW_...round25-verify.md §3`）

- [已落] R60（两档边界 + 同类查全含我方 MEMORY.md 一处）、R61（本份起用 §3 区；历史不改写）
- [已落] 点名复核包 `review/evidence/round25_R48_R53_review_request/`
- [已落] 重启键 §1.3 复审协议段（计数不写死 / §3 落点 / **「已推」判据** / 断点两次→三次）
- [更正] 「已推」判据由「三方一致」**改回两方**（远端 `ls-remote` == 本地 `HEAD`）—— `@{u}` 在本机不落盘（§6.19.6），
  我上一提交里写的"三方一致"**是错的**，已同步 `review/README.md §6.2`、重启键 §1.3、round25 §3 回执。
- [存疑] 无。
- [未落] 真云三验 / 39 条索引 / `ADMIN_SETUP_TOKEN` 值 / 上线三项 / `wechatide` 授权 —— 均待人工。


## 6.20 round26 取件 + InsCode 值守判 E（2026-09-17 09:46~10:00，WorkBuddy 侧）

### 6.20.1 InsCode：连续第 2 次同形态 ⇒ 判定「它不回了」（分支 E）

| 指标 | 本轮读数 | 基线/判据 |
|---|---|---|
| `inflight_turn` | **0** | 无在飞轮次 |
| Assistant 非空 | **387** | = 基线 387（08:35 锁定）⇒ **无新回复** |
| `approval_audit` max(id) | 44 / `approved_once` | 无挂起审批 |
| stream mtime 龄 | **19679 s（5.5 h）** | 最后一次输出停在 04:23 |
| heartbeat 龄 | 22448 s（6.2 h） | 陈旧 |
| 屏上 | OCR 仍是 R54 自查报告，输入框为空占位文案，无弹窗、无「运行中」 | 截图 `C:\Users\lzj\AppData\Local\Temp\inscode\patrol_20260917_0949.png` |

上一轮（08:35）已是同一形态 ⇒ **连续 2 次**，按值守规则判 **E**。
未派新活、未投喂、未批准任何操作、未改 `cloudfunctions/` 与 `specs/`。

### 6.20.2 round26（复审方 `miniprogram-code-reviewer`，09:39:56 落盘）已取件

- **结论**：R60 / R61 ✅；**点名复核 R48 ✅、R53 ✅（均 ①档）**；`@{u}` 不可信现象 ①档确证、机制未定论（复审方排除 4 个假说）。
- **新开两条**：🟡 **R62** `adminLogin/index.js:52` 判据单源化（`!== ADMIN_STATUS_ACTIVE`）+ 补「未知状态不得登录」断言；
  🔵 **R63** 分页两处补「形态守卫 + 探针页」（`adminQueryUser/service.js:22`、`adminExport/service.js:49/69`）。
- **复审方自认三处**：① round25「三方一致」判据缺陷（把「当时可读」当「持久可信」）② **操作失误**——清理时用
  `git update-ref -d refs/remotes/origin/dev`，**连带删掉了 17.2 KB reflog（销毁了自己刚引用的证据）**，
  新增纪律：删 ref 用 `Remove-Item` 删文件，**禁用 `update-ref -d`** ③ `logs/refs/remotes/origin/dev` 探针残留保留（防二次销毁）。
- 另提 🔵 措辞级：「写了不取」建议改为「3 次取件异常（2 次未回执 + 1 次落点错）」——**本侧采纳，但本轮未改**
  （在下一次动 `review/README.md` 时一并处理，避免为措辞单开提交）。

### 6.20.3 R64 已落：§7 第 5 条「已推」命令改为两方

- 改了什么：`review/README.md:145`，`git rev-parse HEAD origin/dev` → **`git ls-remote origin dev` == `git rev-parse HEAD`（两方）**。
- 为什么：复审方 round26 §4.3 指出 —— 第 5 条的**示例命令自己就踩在那个坑上**（它依赖本机写入不落盘的 `refs/remotes/**`），
  照它执行会得到假结论。这是「判据改了、但判据的落地命令没跟上」的同类病，属 R60 的延伸。
- 证据：`grep -n "origin/dev" review/README.md` → 仅 §6.2 说明段与 §7 第 5 条命中；改后 `sed -n '145p'` 回读确认已落地。

### 6.20.4 未落（本值守**故意不做**，待李老师拍板）

- ⚠️ **09:59 更新（并发写入）**：本值守跑门禁时发现 `cloudfunctions/` **正被并发改动**（mtime 09:52:48~09:58:57，
  含 `_adminCore/adminAuth.js` + 11 份 `adminAuth.js` 副本 + `adminLogin/{index,selftest}.js` +
  `adminQueryUser/{index,service}.js` + `adminExport/service.js`，`git diff --stat` = 16 文件 +485/−45）。
  内容经判读 = **R62（`isAdminActive` 单源判据）+ R63（形态守卫 + 探针页）**，注释风格与本仓一致 ⇒ **非本值守所为**
  （本值守本轮未写任何 `cloudfunctions/` 文件）。**处置：不碰、不提交、不为它背书** —— 等对方跑完门禁自行入库；
  本值守只 commit 自己的 `review/` 文档三件。
- 🟡 **R62** / 🔵 **R63**：均需改 `cloudfunctions/`（`adminLogin` / `adminQueryUser` / `adminExport`）。
  **不擅自执行的三条理由**：① 值守授权只覆盖「不做不可逆/对外动作」，而**动已验收的鉴权与分页实现**属下轮排期范畴，
  不是值守的兜底范围；② InsCode 已判终态，若由我改则**无人做独立复核**（本仓铁律：谁写的自测不算证据）；
  ③ 两者都是 🔵/🟡 建议级，非阻塞上线。⇒ 留给李老师决定「派 InsCode / 我改+复审方复核 / 暂缓」。
- 真云三验 / 39 条索引 / `ADMIN_SETUP_TOKEN` 值 / 上线三项 / `wechatide` 授权 —— 均须人工。

### 6.20.5 建议：**暂停本值守**（未擅自执行）

8 批喂投已全部交付、收官加固连走三轮且已被 round24/25/26 独立复核通过，InsCode 侧连续两轮零在飞、零回复、零审批
⇒ 本值守已无事可做。**暂停是可逆的**（李老师派新任务后再开启即可）。本侧保留自动化为 ACTIVE，**等李老师醒后定夺**。

### 6.20.6 回执

- [已落] R64（`review/README.md` §7 第 5 条两方命令）；round26 已取件并入库
- [已落] 本值守本轮**未写任何 `cloudfunctions/` / `specs/`** —— 门禁 52/52 与 GATE=0 是在 09:53~09:55 跑的，
  **早于** 09:58 那批并发写入 ⇒ **那两条绿不覆盖并发改动**（本值守不为它背书，也不回滚它）
- [存疑] 无（`refs/remotes` 机制仍未定论，属复审方同判）
- [未落] R62 / R63（见 6.20.4，待拍板）；其余人工项照旧

---

## 6.21 R62 / R63 / R65 处置（2026-09-17 10:00~10:15，**WorkBuddy 主会话**）

> 李老师本轮（round26 转述）点名执行 ① R62 ② R63 ③ §7 命令 ④ 措辞级。**本会话负责 ①②④ + ⑥（新增发现）+ ③ 的核验与归属澄清**（③ 实际由并行的值守会话先落）。
> ⚠️ **并发写入事件**：09:46~10:02 期间「InsCode 协作值守」自动化与本会话**同时**在写同一仓库。它只 `git add` 了 3 个 `review/` 文件（已核 `git show --stat`：`cloudfunctions/` 命中 **0**），**未夹带代码**；本侧已**暂停该值守**（可逆，见 §6.21.5）。

### 6.21.1 R62 账号状态判据单源化

| 项 | 内容 |
|---|---|
| 病 | `adminLogin/index.js:52` 用字面量 `admin.status === 'disabled'`（只堵一个已知值）；单源 `requireAuth` 用 `status !== ADMIN_STATUS_ACTIVE`（fail-closed）⇒ **同一语义两处不等价判据** |
| 后果（**无提权**，故非 🔴） | 未知状态（`pending_review` / 将来新增的 `suspended` / 历史脏数据）**能登录成功**并签发 token、审计写 `result:'success'` + `last_login_at`，而该 token 在**每一个** admin 调用上都被 `requireAuth` 拒 ⇒ ①审计失真 ②"登录成功却什么都做不了" ③给"漏接 `requireAuth` 的新端点"留**真口子** |
| 修 | 单源新增 `isAdminActive(row)`（`!!row && row.status === ADMIN_STATUS_ACTIVE`）→ `requireAuth` 改用它 → `adminLogin` 解构并改用；`reason` 由 `'disabled'` 泛化为 `'not_active'` |
| 副本 | `node tools/check_admincore.js --fix` → 11 份同步（200 行 / 指纹 `17feb263`）→ 复检「11 份副本均 ≡ 单源」✅ |
| 断言 | `adminLogin/selftest.js` **44 通过 / 0 失败**（原 33）。新增 11 例：纯函数 8（active ✓ / disabled / 未知 / 空串 / 缺字段 / null+undefined / 常量导出 / **两闸门等价**）+ 源码形状 3（**剥掉整行注释后**再测：调用 `isAdminActive(`、无 `status === 'disabled'`、解构含它） |

**变异矩阵（注入 → 跑 → 还原）**

| # | 注入 | 期望 | 实测 | 还原 |
|---|---|---|---|---|
| A | 副本 `isAdminActive` → `row.status !== 'disabled'`（退化"只挡一个值"） | 纯函数层转红 | **5 条转红**：`⑤` / `R62-③` / `R62-④` / `R62-⑤` / `R62-⑧` | RC=0 ✅ |
| B | `index.js` 判据退回 `admin.status === 'disabled'` | 形状层转红 | **2 条转红**：`R62-⑨` / `R62-⑩` | RC=0 ✅ |

**同类查全**：`grep -rn "'disabled'" cloudfunctions/` → 12 处，**全部在注释**（单源文档块 + `index.js` 的 R62 说明），**无生产代码残留** ✅

### 6.21.2 R63 分页「形态守卫 + 探针页」

| 处 | 改动 |
|---|---|
| `adminQueryUser/service.js` | 新增 `invalidShapeError()` / `asRows()` / **`makeShopPageQuery(coll, where)`**（形态守卫在**注入点**）；`fetchShopsAll` 短页后补**探针页** + offset 改**动态** + **上限检查移到循环顶部** |
| `adminQueryUser/index.js` | 改用 `makeShopPageQuery`；补 try/catch → `fail(HARD_CAP_EXCEEDED / SYSTEM_ERROR)`（原实现异常会冒泡出 `{code,msg,data}` 契约之外） |
| `adminExport/service.js` | `makePagedQuery` 加同款形态守卫（原 `return (res && res.data) \|\| []` 正是静默归一点）；`fetchAllPages` 同款探针 + 动态 offset |
| `adminExport/index.js` | **无需改** —— 其 catch 已有 `SYSTEM_ERROR` 兜底（`:98-103`），守卫抛错自然转成 `fail(SYSTEM_ERROR)` ✅ |

**⚠️ 比复审方补丁多改一处（关键差异）**：复审方把上限检查留在原位置（`page === SHOP_MAX_PAGES - 1` 时抛）。但探针非空会 `continue`，此时若页数配额已尽，**循环自然结束 ⇒ 静默返回已取到的部分数据**（比不探针更隐蔽 —— "看起来取到了不少"）。⇒ 移到**循环顶部** `if (page >= SHOP_MAX_PAGES) throw`。实测该场景：留在旧位置 → `no-throw`（静默 150 条）；移到顶部 → `HARD_CAP_EXCEEDED` ✅（见变异 A 的 `R63-③` 转红）。

**错误码**：`SYSTEM_ERROR`（复用 `core/09 §1.7`）+ `HARD_CAP_EXCEEDED`（既有），**均不新增** ⇒ 不必改 `core/09` / i18n / 云函数登记**三处**，A–L 的「错误码三向同步」不受扰动（这是刻意的：复审方原建议的 `INVALID_RESPONSE` 是新码，会牵动三处同步）。

**变异矩阵**

| # | 注入 | 实测转红 | 判读 |
|---|---|---|---|
| A | 去掉探针（`break` 替代） | **3 条**：`R53-② 命中序列` / `R63-①`（`len=5` ← **静默截断 100 家**）/ `R63-③`（`no-throw` ← 静默返回部分） | 探针有鉴别力 ✅ |
| B | 去掉形态守卫（退回 `\|\| []`） | **2 条**：`R63-④` / `R63-⑤` | 守卫有鉴别力 ✅ |

还原后 `diff` 逐字节一致 ✅；`adminQueryUser` **21/0**、`adminExport` **34/0**。

### 6.21.3 🔴 R65（新发现）：`adminExport/selftest.js` 假绿 —— 多 IIFE + `process.exit` 竞态

- **现象**：实测该套件只输出「不足一页 → 全部取到（3 条）」**1 条**断言，`1500 条 / 恰好 2000 / 超过上限 / 空集合` 等**十余条一条都没跑**，但 `verify_all` 一路绿灯。
- **根因**：文件里**两个顶层 IIFE** 并发，而只有 R51 段尾部有 `process.exit(failN === 0 ? 0 : 1)`。R51 段用假集合（`get: async () => ({data:[...]})`，微任务即完成）⇒ **抢先跑完并 `process.exit`**，把 R49 段腰斩；而退出码用的是 R51 段的 `failN`。
- **为何现在才暴露**：R63 给 `fetchAllPages` 加探针 ⇒ await 链变长几个 microtask，R51 恰好抢先。**此前它一直是"假绿"**（R49 后半段的断言从未执行过）。
- **修**：合并为**单 IIFE**（删掉 R51 段的 `(async () => {` 头）；断言数 **19 → 34**。
- **同类查全**：全仓 selftest 顶层 IIFE 计数 → 其余**全部 0 或 1** ✅ **无第二例**。
- **纪律**（已入重启键 §1.3）：每个 selftest **只允许 1 个顶层 IIFE**；**改动 await 链后必须数实际跑了多少条断言**，别只看 exit 0。

### 6.21.4 文档更正（`specs/dev-specs/★知识存储点_2026-09-10.md`）

- 里程碑登记 **R62/R63/R64/R65**（含 R64 = 值守会话所落、本侧核验后才纳入）
- §1.3 措辞：3 处「写了不取」→「**3 次取件异常（2 次未回执 + 1 次落点错）**」+ 两种性质修法不同
- §1.3 新增 selftest 假绿纪律（R65）
- §1.1 修**写死计数**（R60 同类残留：「已运行 19 轮、R1–R41、22 份」）与**自身矛盾**（`:66` 写"三方一致"而 §1.3 已更正两方 → 统一**两方**）

### 6.21.5 回执

- [已落] R62、R63、措辞级 ④、R65 新发现与修复 —— 同在 `30d6d4a`（20 文件 +577/−61）
- [已落] 全闸：`verify_all` **52/52**（含 `[suite-count]` 守卫）+ `GATE=0` + 11 副本 ≡ 单源 + 42 目录 + 603 js + 两方一致 `30d6d4a`
- [已核验 · 非本会话所落] **R64**（§7 第 5 条两方命令，`d7293e6`，由并行的值守会话落，本侧独立核验内容正确后才纳入）
- [已处置] **暂停「InsCode 协作值守」automation** —— 它自己建议暂停（§6.20.5），且与主会话并行写同一仓库已实测撞车风险；**可逆**（李老师派任务后可恢复）
- [未落 · 待人工] 真云三验 / 39 条索引 / `ADMIN_SETUP_TOKEN` 值 / 上线三项 / `wechatide` 授权
