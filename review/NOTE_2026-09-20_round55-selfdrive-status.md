# round55 · 自驱动巡检（自动化轮次 · 2026-09-20 01:27–01:5x）

> 执行方：自驱动自动化（WorkBuddy）。仓库 `C:\Users\lzj\WorkBuddy\Claw\catering-profit`。
> 本轮性质：**与一个活跃的交互式会话并发**。它落了 round54（换肤/改名）与 round55（核算方式迁入录入页）两个代码轮次。
> 本轮定位 = **独立复核 + 抓守卫缺口**，不抢写。

## 1. 探针（唯一入口 `probe_agents.py`）

| 代理 | 判据 | 结论 |
|---|---|---|
| InsCode | SQLite：`inflight_turn` 无行；`message_count=1465`（与 r51/52/53 **四连持平**）；`idle_sec=123735.7`(34.4h)；末条审批 `approved_once` 非 pending | **idle** ⇒ 不投喂（8 批已收官，无批次 8） |
| dsh | hwnd 855322，`rect[0]=-32000` ⇒ 最小化 | **不可用（第 9 轮）** ⇒ 不投递 |

证据：`review/evidence/selfdrive_20260920_r55/probe_agents.json`

### 1.1 dsh 根因（纯只读，未动 GUI）

- `/` 与 `/v1/models` → 200（**SPA 兜底，无效信号**）；`/api/sessions` `/api/health` `/api/config` → **全 404**
- `https://api.deepseek.com` → **401** ⇒ 上游可达且仅缺鉴权 ⇒ **排除「断网 / 额度耗尽」**
- `storages/session_projcache.json` mtime `09-19 09:21:08`，距今 **16.21h** 静止
- 🆕 `.dsh/web.log` mtime `09-17 02:59:56`，距今 **70.56h ≈ 进程 uptime** ⇒ 该实例自启动起**零业务写入**
- ⇒ 结论不变：**长跑进程内部会话加载超时**，方案 **D（允许重启 dsh web）** 证据再加固。无人值守仍未动手。
- 不投递的第二条独立理由：当前会话上下文与餐饮小程序仓库**非同一主题**，投递＝上下文污染。

## 2. 🔴 并发写入方判定：本轮最大教训

**「mtime 静止 92 秒」不足以判停手 —— 我一度误判，随后被事实推翻。**

误判过程（完整留痕，供下轮别重蹈）：

1. 01:34:20 / 01:35:52 两次 `stat` 采样，5 个可疑文件 mtime **完全无变化**（末次写入 01:26:25）
2. 进程级采样（`wmic`）**9 个进程全无常驻噪音外命中** ⇒ 判「已停手」
3. 01:36 跑 `verify_all.js` → **66/67**，A–L 门禁红在 **K3/K10（批次4 派生件落后于 MD 单源）**
4. 回读 mtime 才见真章：
   - `specs/dev-specs/delivery/inscode喂投包_8批_自包含完整版.md` = **01:35:15**（就在我跑门禁期间被改）
   - 01:39:39 两份派生件（`批次4_提示词_可直接复制.txt` / `一键复制.html`）被重生成 ⇒ K3/K10 自愈
5. 01:43:39 对方提交 `c24e0a2`（round55 代码）⇒ **它一直在跑，只是逐轮 Edit，无常驻进程**

**修正后的判据**：AI 类写入方是「逐轮 Edit」，两次采样间隔内恰好落空是常态。
判停手须四连：**① 跨分钟 mtime 无变化 ② 无仓内进程 ③ 门禁跑完后回读 mtime 复核 ④ `git log` 未见新 commit**。

## 3. 独立复核（不采信对方 commit message 自述）

### 3.1 `c24e0a2` round55 · 核算方式从设置页迁入月度录入页

改动面 15 文件 / +278−70：`pages/month/input.{js,wxml}`（新增「这两笔钱怎么算」区）、
`pages/shop/setting.{js,wxml}`（移除两开关）、`cloudfunctions/saveShopSetting/*`（修 name/remark 被清空的**数据丢失缺陷**）、
`miniprogram|specs i18n/terms.js`（新增 `calcMethod` 25 键）、`tools/selftest_ui_fix.js`（新防回归守卫）、
+ 03 份派生件重生成。

**我方独立变异回灌**（不做它做过的那条，另行设计）：

| 步骤 | 命令 | 结果 |
|---|---|---|
| 变异 | `pages/shop/setting.wxml` 追加 `<!-- MUTANT: inventorySwitch 塞回设置页 -->` | `node tools/selftest_ui_fix.js` → **RC=1**，`❌ 🔴 设置页不再有库存/摊销开关` 转红 ✅ |
| 还原 | `git checkout -- pages/shop/setting.wxml`（**不用 Python 写回**，防 CRLF→LF 漂移） | **RC=0**，28/28 通过；该文件回干净态 ✅ |

⇒ 守卫是真判据，**不是死代码**。对方 commit message 里的自述本次成立。

### 3.2 🟡 该守卫的覆盖缺口（我方独立发现）

```js
check('🔴 设置页不再有库存/摊销开关',
      !/inventorySwitch|amortizeSwitch/.test(read("pages/shop/setting.wxml")));
```

判据**绑死在旧 key 名**上。若将来用**新名**（如 `calcMethod.invMode`、`sw.inventory`）把开关放回设置页，
这条守卫**不会红** ⇒ 防的是「旧 key 回归」，不是「单源被破坏」这个真实意图。
建议改判据为**语义级**：设置页不得出现 `TERMS.calcMethod` 的任一取值 / 不得出现 `saveShopSetting.switches` 写入。
本轮**不代改**（见 §5 未落 ①）。

### 3.3 `594e0f0` round54 · 墨蓝换肤（上上轮，本轮补做独立复核）

| 项 | 我方实跑 | 与 round54 回执 |
|---|---|---|
| 旧色残留 | `grep -iE "#ff6b35\|#fff3ec\|#fff7f1"` → **1 处命中**：`app.wxss:5` **注释**「⚠️ 旧橘黄 #ff6b35 已全量下线」 | 回执写「零命中」⇒ **口径不准**，应为「样式层零命中，仅剩 1 处注释说明」（非缺陷，但按「不采信自述连我方上一轮」纪律需更正） |
| 主色 | `#1e3a5f` 命中 33 处 | 一致 ✅ |
| 双副本 | `diff -q miniprogram/i18n/terms.js specs/dev-specs/i18n/terms.js` → IDENTICAL | 一致 ✅ |
| 模块名 | node 实跑：M1=`月度盈利核算` / M2 display=`开店盈亏平衡点测算` navTitle=`开店盈亏平衡测算` / M3 display=`菜品成本毛利核算` internal=`菜品成本卡` | 一致 ✅ |
| `成本卡` 残留 | 3 处（L11 注释 / L40 `internal` / L276 注释），**均非外显名** | 符合术语双轨，合规 ✅ |

## 4. 🟢 本轮核心发现：`TERMS.forbidden` 是「存在但从未被执行」的权威判据（第 2 例）

证据：`review/evidence/selfdrive_20260920_r55/forbidden_terms_no_guard.txt`

- **存在**：`terms.js` 双副本各 1 份，13 条（14 词条）禁用词 + 替换建议 + 豁免字段
- **执行**：`grep -rln "forbidden" tools/ specs/dev-specs/prototype/` → **零命中**；
  `verify_all.js` 的 SUITES 里**无术语/禁用词套件** ⇒ **没有任何守卫读这张表**
- ⇒ **「门禁 67/67 全绿」这句话不包含禁用词校验**

实扫两面：

| 扫法 | 结果 |
|---|---|
| 粗扫（.js/.wxml 含注释，54 文件） | 26 处命中，**全是代码注释**里的「付费/订阅」⇒ 直接当守卫会**大量误报**（这大概正是它从未被挂上的原因） |
| 精扫（去 `<!-- -->` + 去标签，只留可见文案，15 个 wxml/html） | **1 处**：`admin-h5/index.html` 的 `'付费'`——**内部管理后台，不进小程序审核** |
| ⇒ 小程序 `pages/*.wxml` 可见文案 | **当前零违规** ✅ |

**同族病第 2 例**（第 1 例 = round53 的 `tools/verify_docx.py`）：**「判据存在 ≠ 判据被自动执行」**。
风险不在当下（无实际违规），在将来：谁在 wxml 硬编码「赚钱 / 躺赚 / 收益率」，67/67 全绿照样放行，直到提审被金融类目红线打回。

## 5. 未落 / 存疑（明示）

- ① **补挂禁用词守卫 未落** · 理由：检出并发写入方活跃；改 `verify_all.js` SUITES(67→68) 会 ①与对方抢写、②触发 R92/R66 自校验让对方在中间态看到非自身原因的门红，污染其归因。⇒ **下轮待办**：先设计只扫「用户可见文案」的判据（避开 §4 的注释误报），再挂 SUITES + 变异回灌（wxml 注入「躺赚」须转红）
- ② **`c24e0a2` 守卫语义级加固 未落** · 理由同上（对方刚提交该轮，改判据＝抢写）
- ③ **dsh 方案 D（重启）未落** · 理由：无人值守擅自动手会杀掉李老师的窗口，须李老师批准
- ④ **1033 个并发方过程 PNG 未落（不代提交、不代删）** · 归属待李老师裁决，与前几轮一致
- ⑤ **存疑** · dsh 进程 uptime 未取到（`wmic` 过滤未命中含 `dsh` 的命令行）⇒ 改以 `web.log` mtime 70.56h 作等价强证据

## 6. 门禁（本轮终值）

| 项 | 结果 |
|---|---|
| `node verify_all.js` | **总览 67/67，RC=0** ✅（证据 `verify_all_final.txt`） |
| `node specs/dev-specs/prototype/check_error_codes.js` | **RC=0** ✅（`check_error_codes_final.txt`） |
| `node tools/selftest_ad_gates.js` | **24/24** ✅ |
| `node tools/selftest_ui_fix.js` | **28/28** ✅（变异前后各跑一次） |
| 轮中瞬时值 | 01:36 曾 **66/67**（A–L K3/K10），01:40 复跑 **RC=0** ⇒ 归因并发方派生件再生的中间态 |

## 7. 回执

- [2026-09-20 01:33] 探针 **已落** · `probe_agents.py` → InsCode idle(34.4h/msg1465 四连持平/无 pending) + dsh minimized · commit 见 §8
- [2026-09-20 01:40] dsh 根因只读侧证 **已落** · `/api/*` 全 404 + `api.deepseek.com` 401 + `web.log` mtime 70.56h≈uptime ⇒ 方案 D 证据加固 · 未投递
- [2026-09-20 01:45] 并发写入方判定 **已落（含自我更正）** · 92s mtime 静止曾误判停手，被 01:35:15 MD 改动 + 01:39:39 派生件重生 + 01:43:39 commit 推翻
- [2026-09-20 01:47] `c24e0a2` 独立变异回灌 **已落** · setting.wxml 塞回 `inventorySwitch` → RC=1 该断言红；`git checkout` 还原 → 28/28 RC=0
- [2026-09-20 01:48] `594e0f0` 换肤独立复核 **已落** · 旧色实为 **1 处注释命中**（非样式），round54 回执「零命中」口径不准已更正；模块名/双副本/成本卡残留三项一致
- [2026-09-20 01:49] 🟢 **forbidden 词表零守卫 已落（发现）** · 全仓零引用 + SUITES 无术语套件；可见文案当前零违规；**补挂未落**（理由 §5①）
- [2026-09-20 01:53] 门禁 **已落** · 67/67 RC=0 + A–L RC=0 + AD 24/24 + UI 28/28
- [2026-09-20] 队列五项（A6b/R91/AD G1–G8/R86/14 页走查）**维持已闭环**，本轮无新增批次

## 8. 提交

本轮只路径级提交 `review/` 下我方产出（`review/` 只由我提交），未动任何源码与他人文件。
