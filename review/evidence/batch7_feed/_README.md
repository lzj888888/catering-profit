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


