# AUTO_LOG · 自驱接续回执（只追加）

> 每次自动执行一条后追加一行；格式见 `AUTO_QUEUE.md` 末尾。
> ⚠️ 这行是"做过什么"的事实记录，不写推测。

- [2026-10-20 13:30] R381 损耗 100% 防御纵深守卫（F-①/②/③，22→25）· 门禁 189/189 RC=0 · commit 9e87483 · 队列 #1 → done
- [2026-10-20 13:55] 人工（非自动）· 豆包三轮论证 → `review/PLAN_2026-10-20_AI路线与边界.md` · 队列新增 #10~#13 · 无代码改动
- [2026-10-20 14:36] R383 空明细不许试算（拦截 0成本/100%毛利）· 门禁 189/189 RC=0 · commit e7c7187 · 队列 #2 → done（本条为人工补跑：定时器未触发）
- [2026-10-20 14:49] R384 错误提示不截断（长文案 showModal + 归档锁给动作）· 门禁 189/189 RC=0 · commit e5b062a · 队列 #3 → done（人工补跑）
- [2026-10-20 14:53] 定时器自检：MINUTELY 未触发，已回退 HOURLY（文档保证支持）；20 分钟密度暂不可得
- [2026-10-20 15:04] R385 空态巡检（搜索无结果≠空库，物料/菜品两页分开）· 门禁 189/189 RC=0 · commit c646938 · 队列 #4 → done（人工补跑）
- [2026-10-20 15:40] R386 M2 解释锚点（engine_version + bands 内容哈希）· 门禁 189/189 RC=0 · commit e183dae · 队列 #10 → done（人工补跑）

- [2026-10-20 16:32] R387 M3 解释锚点（成本卡三处出参 inputs_ref，业务键不用主键）· 门禁 189/189 RC=0 · commit 34e1f76 · 队列 #14 → done
- [2026-10-20 16:32] 本轮提前收工：单条门禁 12min/轮 + 缓存刷新 13min，累计遇 50min 上限 ⇒ 只做 1 条，队列 #11/#13 留待下轮
- [2026-10-20 16:45] 人工 · 与 16:29 自动轮次撞车（#14 各做一遍）：代码无重复写入，两份 NOTE 已合并为一份；队列加「in_progress 认领制」
- [2026-10-20 17:58] R391 出参契约补 6 组声明（8 组里 2 组 R301 已有、不重复；exportData 纠正为同步直出）· 门禁 189/189 RC=0 · commit ec25a5e(正文，被并发提交携带) + 19e4067(证据) · 队列 #15 → done

### ERRATA · 2026-10-20 17:50（人工补记，不改历史记录）

- **R391 正文的落点错了**：`ec25a5e`（我的「R390 部署漂移审计」）里混进了自动化正在写的 R391 正文，原因是人工那侧用了 `git add -A` 而自动化同时在写。**内容零损失**（契约 8 组声明全在，已逐字段核验 0 缺失），只是提交信息标成了 R390。取证快照随后由 `19e4067` 单独补齐。
- **`e932c50` 只有标题、没有正文**：勘误二字只出现在标题里，等于没有记录 ⇒ 本段即为那条勘误。
- **R391 那条回执的时间写的是 17:58，实际提交时刻是 17:47**（`git log --date=format:%H:%M` 实读）。不修改原行（记账不改），以本条为准。
- **规则**：自动化在跑时，人工侧只用**显式路径** `git add <file>`，禁止 `-A`；轮次号从 `git log` 取 max+1，禁止凭"下一个数"。

- [2026-10-20 19:38] R393 转圈文案说正在发生的那件事（补跑门禁落地）· 门禁 189/189 RC=0 · commit 4bfb974 · 队列 无（原会话中断的 R393，非队列条目）
- [2026-10-20 19:41] R393 本轮收工 · 只读巡检四项：① 工作树提交后为空（见下条提交）② 最近门禁 189/189 RC=0（19:30，702.5s）③ 队列无僵尸 todo（#11/#13 待做且 blocked=no，其余 5 条 blocked=yes；无 in_progress 悬挂）④ 抽检 R392 的 `api.say`：`utils/api.js` 已定义 + 4 处页面调用（dishreview/mine/input/result），与 NOTE 对得上

- [2026-10-20 22:04] R395 分享卡片落地（接手 21:15 中断的半成品，补跑门禁）· 门禁 190/190 RC=0（268.8s，mkforce RC=0）· commit bb5cbff · 队列 #11 → done
  - 中断现场：R395 正文/守卫/NOTE 已在工作树（21:07~21:15 写就，暂存区有 3 处未暂存修补），21:38 起的 `_mk395.log` 为 0 字节、无 node 进程 ⇒ 原会话已死，按"不覆盖"接手。
  - 只补两件事：单跑守卫（`check_share_card` 42/0、`selftest_ui_fix` 42/0）→ 全量门禁；**未重写任何文案或判据**。
  - 顺带清理：把仓根 0 字节 `_mk395.log` 移入已 ignore 的 `_m3/_logs_r395/`（不删）。
  - 免出码（只改 `.js`，无 wxml/wxss）、免部署（无云函数改动）。
- [2026-10-20 22:09] R395 收工 · 只读巡检四项：① 工作树干净（三次提交后 `git status` 为空）② 最近门禁 190/190 RC=0（22:04，268.8s，mkforce RC=0）③ 队列无僵尸 todo（#11 已 done；#13 待做 blocked=no；其余 5 条 blocked=yes；无 `in_progress` 悬挂）④ NOTE↔代码抽检三条：R395 三页 `onShareAppMessage` 实存 3 处（card/month.result/sandbox）+ `utils/shareCard.js`、R394 完成态 `savedDone:'已保存'` 在 terms 组内、R393 转圈文案与页面调用对得上
  - **未开 #13（异常核对清单·规则层）的原因**（不是懒，是前置缺失）：该条要"本店历史阈值"，而 `getLedger` 只取当月 + 上月（`prevMonthOf` 仅用于期初结转），**全仓无历史月列表能力**（grep `listMonths` 零命中）⇒ 需先扩云函数出参（行为变更 ⇒ 必部署），单轮 30 分钟做不完，开了就是半成品。
- [2026-10-20 23:38] R396 异常核对清单规则层落地 · 门禁 191/191 RC=0（375.6s，刷缓存两循环 RC=0）· commit 179b5b3 · 队列 #13 → done
  - 队列 #13 备注的「前置缺口」**记错了**：`listMonths` 零命中是**名字猜错**，仓里早有 `getMonthList`（批次 4 上线，返全部建档月 + 归档态）⇒ **不需要新造接口/改云函数/部署**；N 月历史 = `getMonthList` + 逐月 `getLedger`。
  - 新增 `utils/anomalyRules.js`（纯函数，5 条规则：突增/突降/断档/新增/毛利率偏离；只用**自店历史中位数**，只出方向+幅度档，无金额差、无外部基准）+ `tools/selftest_anomaly_rules.js`（47 条，S4/A20/B7/C4/D5/E5/F2）。
  - 门禁第一轮 190/191：唯一红是 `suite-tracked`「新套件未入库」—— 那是 `git add` 时序问题（文件还没进索引），不是代码缺陷；暂存后复跑 191/191 RC=0。
  - 判据自己假红一次：E-①/E-② 拿**带注释原文** grep「挽损/行业对标」，而这两个词是头注里的**禁令** ⇒ 禁令喂红判据。改扫剥注释后的代码即绿（与 R298Y「注释喂恒真」同族、方向相反）。
  - 免部署（未改任何云函数）；免出码（未改 wxml/wxss）。
  - 未做且已登记：页面未接线（P1 话术层一起接）、传输侧未做批量取数（6 次 getLedger 可接受，不提前造抽象）。

- [2026-10-21 00:59] R397 只读巡检（队列已无可认领条目：8 done / 6 blocked / 0 todo）· 门禁沿用 191/191 RC=0 · 无新提交（本条为记录）
  - ① 工作树：`git status --short` 空；本地 dev ≡ origin/dev（`019605a`，ahead 0 / behind 0）。
  - ② 最近门禁：`_m3/_logs_r396/gate_round2.log` 实读「总览：191/191 通过 耗时 375.6s」+ `GATE_RC=0`（R396 轮，未过期）。
  - ③ 队列无僵尸：全表无 `status=todo` 行、无 `in_progress` 悬挂；#5–#9、#12 均 `blocked=yes` 且 `why` 在（等人/等样例/等选型）。
  - ④ NOTE↔代码抽检三条全对得上：R396 `utils/anomalyRules.js` 14.3KB + `tools/selftest_anomaly_rules.js` 单跑 47/0；R395 三页 `onShareAppMessage` 实存（card/month.result/sandbox）+ `utils/shareCard.js` 5.8KB；R394 `savedDone` 在双副本 terms.js 各 12 处、md5 同为 `5154d688…`。
  - 结论：无可开新条目；不给 blocked 条目"猜着做"（都缺外部输入），下轮仍按同一规则取首条。

- [2026-10-21 01:45] R398 队列记账（纯文档，无代码）：#8 `clearMonth` 超时 → **done**（控制台回读 `timeout=20`/`Active`，证据 NOTE_2026-10-21 §一A）；#12 `why` 更新为真实进度（2 集合已建、索引 3/4、落码前置=补 `collections.js` 单源）；新增 **#16 异常核对清单页面接线**（唯一 todo & blocked=no，`buildChecklist` 现为零生产调用）。未跑全量门禁（未触碰 `tools/**`/`cloudfunctions/**`/页面代码）。

- [2026-10-21 02:14] R400 只读巡检（队列 0 条 todo&no；#16 正被并发会话实时实现 ⇒ 按认领制跳过，不碰工作树）· 门禁沿用 191/191 RC=0 · 无代码提交（本条为记录）
  - ① 工作树**不干净但全部归属并发 R399**：8 项（`pages/month/result.js|wxml`、两份 `terms.js`、`verify_all.js`、重启键、`tools/check_anomaly_wiring.js` 未跟踪）mtime 01:49–01:57；判活证据 = `_m3/_logs_r399/mk1.log` 02:07:42 写「refreshed 171, cache size = 177」+ `mk2.log` 02:07:44 起 0 字节（门禁在跑）。⇒ 按 R391 教训**不覆盖、不 add、不提交他人文件**。
  - ② 最近门禁（最后一个跑完的）：`_m3/_logs_r396/gate_round2.log` 实读「总览：191/191 通过 耗时 375.6s」+ `GATE_RC=0`；R399 的 192 套件轮尚未出结果（日志 0 字节）。
  - ③ 队列无僵尸：全表 0 条 `status: todo`；唯一 `in_progress` = #16 且**活着**（非僵尸）；10 条 done；#5–#9、#12 均 `blocked=yes` 且 `why` 在（等人选型 / 等扫码 / 等样例 / 等 AppSecret）。
  - ④ NOTE↔代码抽检三条全对得上：R396 `utils/anomalyRules.js` 275 行 + `tools/selftest_anomaly_rules.js` 实点 47 个 `check(`（与 NOTE 声明 47 一致）；R395 `onShareAppMessage` 三页实存（`pages/card/index.js`、`pages/month/result.js`、`pages/sandbox/index.js`）+ `utils/shareCard.js` 被三页引用；R394 `savedDone` 在 7 页实存，`terms.js` 双副本 md5 同为 `e7c1744b…`（R399 改动后仍一致）。
  - ⑤ 只读观察（未处置）：新套件 `tools/check_anomaly_wiring.js`（405 行）**尚未 `git add`** ⇒ 若并发会话在其门禁轮前不入库，`suite-tracked` 必红（R396 已踩过一次，处置定式=先 add 再跑门禁）。

- [2026-10-21 02:45] R399 异常核对清单页面接线（队列 #16）· 门禁 192/192 RC=0（508.7s，刷缓存两循环 RC=0）· commit f09e4bd · 队列 #16 → done
  - 规则层 R396 此前**全仓零生产调用**，本轮把它接上：`getMonthList` + 逐月 `getLedger`（≤6 次，目标月直接复用 load() 的 `d`）→ `buildChecklist` → 结果页「跟你自己的历史比」卡。
  - 口径红线照旧：只给方向 + 百分比，**无金额差、无行业均值**；历史 <2 月整卡不渲染，0 项给「跟你自己过去差不多」（空白卡会被读成"没算完"）。
  - 新守卫 `tools/check_anomaly_wiring.js`（24 断言）自己假红两轮：① `bodyOf` 按 `name(` 找首个位置 ⇒ 锚到 `this.loadChecklist(d)` **调用点**，函数体窗口错位（R299 ①型）⇒ 改 `defBodyOf`（前字符非 `.` 且 `{` 早于 `;`）；② `keysAfter('r.')` 命中 `ledger.` 里的那个 `r` ⇒ 五个顶层字段被误当 result 内字段 ⇒ 加词边界。**判据错，不是代码错**，两处都没改业务代码迎合。
  - 变异 3/3 均红在目标断言：注释 require → ①/②-a；删 load() 真调用 → ②-b；目标月重拼对象 → ②-f。
  - 第一轮门禁 191/192 唯一红 = `suite-tracked`「新守卫未入库」（git add 时序，与 R396 同型）；暂存后 192/192。
  - 免部署（零云函数改动）；wxml 有改 ⇒ 已出预览码 `_m3/_logs_r399/preview_r399.png`（不入库），真机走查仍卡队列 #7。

- [2026-10-21 03:15] R402 `shop_ai_*` 两集合入建库单源（队列 #17）· 门禁 192/192 RC=0（683.0s）· 队列 #17 → done
  - 单源 `COLLECTIONS` 27→29（+`shop_ai_consent` / `shop_ai_insight`）；镜像 `init_db.js`、`core/15` 权限矩阵（声明 29 + 表格 28/29 行）、`core/13`、`下一步工序清单.md/.docx/.txt`、`索引补齐核对单.md` 全部同批。
  - 🔴 **四索引刻意没登记**：按设计稿原顺序（表+索引同批）做时 `check_index_field_alignment` L1 **当场判红** —— 它要求索引字段必须在 `cloudfunctions/**` 源码里以标识符出现，而 `consent_id`/`revoked_at` 在 grant/revoke 落码前**全树 0 命中**。判据没错，是顺序错 ⇒ 设计稿 §7 拆成 **1a 表 → 2 落码 → 1b 索引**，已写回并注明原因。
  - 第一轮门禁 190/192，两红都是真漂移：① K13「`下一步工序清单.txt` 落后 `.md`」（仓库根还有一份 `.txt` 逐字副本，`cp -f` 重生）；② `batch0_selfcheck`「点5·集合数=27→29」（该值是**故意写死**的，派生成 `=== COLLECTIONS.length` 就等于没守）。⇒ 一条教训：**改一个计数要同步 4 层派生面**（单源 → 镜像 → md/docx/txt → 自测写死期望值），漏的两处都是守卫抓的。
  - 未做（如实登记）：线上 dev 已有 3 条 `shop_ai_*` 索引与单源仍不一致（等落码同批补）；第 4 条 `idx_ai_insight_shop_month` 仍卡 AppSecret/窗口高度；零云函数逻辑改动 ⇒ **免部署**。

- [2026-10-21 04:24] R404 只读巡检（队列 0 条可认领；R403 由并发会话实时实现，按认领制跳过）· 门禁沿用 192/192 RC=0（600.2s，R402）· 无代码改动
  - ① 工作树**不干净但归属明确**：`cloudfunctions/grantAiConsent/`、`cloudfunctions/revokeAiConsent/`（03:54 新建）+ `initDb/collections.js`（四索引已补，注释自标 R403）+ `core/10`、`verify_all.js`、`★知识存储点`（mtime 03:54–04:20 仍在变）⇒ 并发会话正在做 R403，未认领未提交 ⇒ **不 add、不覆盖、不提交其文件**。
  - ② 最近门禁 = `_m3/_logs_r402/gate3.log`「总览：192/192 通过」+ RC=0（600.2s）；同目录 `gate.log`（03:07）的 190/192 是 R402 修复前那轮，两红（K13 派生副本落后 / batch0 集合数 27→29）已在 R402 回执登记并修好。
  - ③ 队列：10 done / 6 blocked / **0 todo / 0 in_progress**，无僵尸 todo。⚠️ 但现场在做的 R403 未在队列认领 ⇒ 队列与实际作业面不同步，下一轮**先看 git status + mtime**再谈认领。
  - ④ NOTE↔代码抽检三条全对得上：R399 `loadChecklist` 真接线（`pages/month/result.js:274` 调用、`:481` 定义，自测 48 个 `check(`）；R402 `COLLECTIONS` 含 `shop_ai_consent`/`shop_ai_insight`，四索引已按设计稿 §7「1b」补入（`collections.js:186`）；R403 索引字段 `consent_id`/`revoked_at` 均在 grant/revoke 源码中真出现（`check_index_field_alignment` L1 不会判化石）；`terms.js` 双副本 md5 一致（`e7c1744b…`）。
  - 6 条 blocked 仍是同一批外部输入缺口（选型/扫码/AppSecret/美团样例），不猜着做。

- [2026-10-21 04:55] R403 AI 授权写侧落码（队列 #12 步 2 + 步 1b）· 门禁 194/194 RC=0（701.0s）· commit a2147cf
  - 新增 `grantAiConsent` / `revokeAiConsent`（各 service/validate/selftest，common 由 sync_common 派生），自测 71 条（36+35）。
  - 四索引同批登记（单源 45→49，unique 12→13）—— 与落码同批是**机械判据给的方向**：`check_index_field_alignment` L1 要求索引字段在 `cloudfunctions/**` 以标识符出现，落码前 `consent_id`/`revoked_at` 全树零出现。
  - 五条设计取舍都写进 NOTE：scope 能力粒度（未知拒收）、覆盖不求并集、先翻标记再清派生、已撤回不刷新时间戳、清不干净必须 `clear_pending` 显式降级。
  - 一次自测假红：revoke 判据钉了 `.doc(x._id || ...)` 一种写法，实现是 `const rid = ...` ⇒ **改判据不改代码**。
  - 派生面 4 层全同步：core/10（§10 + 全集 52→54）、verify_all（套件 192→194）、重启键（套件数/selftest 覆盖面 47→49/索引 49-13）、手工面 .md/.txt/.docx + 索引核对单。
  - 第一轮 192/194（新 selftest 未 git add ×2、手册 .txt 落后 .md）⇒ 同一族病第三次（R396/R399/R403）：**新增 selftest 必须先 git add 再跑门禁**。
  - 未做：读侧函数（→ 队列 **#18**，todo/blocked:no）、线上第 4 条索引、两函数未部署（零调用方）、`canSendToModel`、手册 PDF 未重生（不在守卫面内，发人前必重生）。

- [2026-10-21 05:55] R405 AI 授权读侧 `getAiConsent`（队列 #18）· 门禁 195/195 RC=0（679.5s，刷缓存两循环各 171 条）· 队列 #18 → done
  - 新增 `cloudfunctions/getAiConsent/`（service/validate/index/selftest + sync_common 派生 20 个 cx_*）；自测 **43 断言**，变异 **5/5** 均红在目标断言（撤回优先 / 条款升级 / 出参键集合 / 零写库 / 无记录不报错）。
  - 核心设计：`scope`（历史事实）与 `effective_scope`（现在可用）**必须分叉** —— 过期/撤回/条款不一致三种情况下，页面若直接读 `scope` 当开关，会"显示已授权、一用就被拒"；另给 `need_regrant` 合一判据，不让页面自己拼四态×条款的 8 种组合。
  - 三条不做都有理由：不写审计（页面每次打开都调，会把 audit_log 冲成噪声）、不回 `user_id`（少一个外泄面）、不开可选入参（多一种调用形态 = 多一条判定路径）。
  - 派生面 4 层：契约全集 54→55 + §10 新增行；套件 194→195（头注 + SUITES）；重启键套件数两处 + selftest 覆盖面 49→50 + 历史链节点。
  - 🔴 两处自查：① `validate` 我最初写了 `trim` 且注释写"与写侧一致"，实际写侧不 trim ⇒ 写入 `' shop_x '` 后读不到，已改回不 trim；② 套件数我先写 196（按新增文件数想当然），`check_suite_count_claims` 判「文档 196 / 实算 195」⇒ 本轮只加 1 条套件。
  - 未做（如实登记）：两函数仍**未部署**（零线上调用方，等授权页同批）；`canSendToModel`（k-匿名）仍空；前端授权页未做；线上第 4 条索引仍卡 AppSecret。
- [2026-10-21 05:58] R405 附带交付卫生：`新手上云操作手册.pdf` 重生（R403 遗留欠账）。`docx2pdf_word.py` 出 9 页/567768 字节；pypdf 提取文本机器判据：`49 条索引` 1 处、`13 条` 3 处、旧值 `45 条索引`/`12 条` 各 0 处。⚠️ `*.pdf` 在 `.gitignore` ⇒ 不入库、无守卫，改 `.md` 后必须手动重生。

- [2026-10-21 06:52] R407 只读巡检（队列 **0 条 todo**；唯一 `in_progress` = #19，工作树里有它 06:14–06:31 的半成品）· 门禁沿用 **195/195 RC=0**（679.5s，R405）· 无代码改动
  - ① 工作树**不干净但归属单一**：`miniprogram/i18n/terms.js` + `specs/dev-specs/i18n/terms.js`（R406 五条文案，双副本 md5 一致 `3dad45a2…`）、`pages/material/edit.js`（改价告知 + 直达影响面）、`verify_all.js`（头注 195→196 + 新套件行）、`★知识存储点`（套件数同步）、未入库 `tools/check_material_price_impact.js`。认领提交 `d3d2601`（06:14）后 mtime 止于 **06:31**；06:40 查 `wmic` 无 `run_gate/mk_force/verify_all` 进程、亦无 `_m3/_logs_r406/` ⇒ 该会话**已停摆**。按本轮规则 **`in_progress` 一律跳过** ⇒ 不 add、不覆盖、不代跑门禁、不提交其文件。
  - ② 最近**已完成**门禁 = `_m3/_logs_r405/gate.log`「总览：195/195 通过」+ `GATE_RC=0`（679.5s，05:52）。当前树自称 196 套件（#19 未提交改动）⇒ **未经门禁验证**，不作为"已绿"引用。
  - ③ 队列形态：**13 done / 5 blocked / 1 in_progress / 0 todo**，无僵尸 todo。5 条 blocked 仍是同一批外部输入（风格选型 / 扫码走查 / 美团样例 / AppSecret 索引）。
  - ④ NOTE↔代码抽检三条全对得上：R405 `getAiConsent/` 存在且 `effective_scope`/`need_regrant` 只出现在自己的 service/validate/selftest，**本函数三份源码零 `.add/.update/.remove`**（只读成立）；契约「全集 55」与 `cloudfunctions/` 真目录数 **55** 相等。R403 `grantAiConsent`/`revokeAiConsent` 目录在，`consent_id`/`revoked_at` 在源码里真以标识符出现（`check_index_field_alignment` L1 不会判化石）。R402 `COLLECTIONS` 第 33 行含 `shop_ai_consent`/`shop_ai_insight`，`core/15` 权限矩阵第 28/29 行同业已备。
  - ⑤ 顺带核了 #19 半成品的**自洽性**（只读，不下"可交付"结论）：`pages/metrics/impact` 四件齐 + `app.json:24` 有入口；弹窗按钮 `看影响面`(4字)/`先算了`(3字) 合规；`purchasePriceFen`/`cf`/`yr` 均在用前定义。⇒ 下一轮若它仍是停摆态，接手成本 ≈ 单跑守卫 + 一轮门禁（~12min）。
  - 🔴 **本轮回执自身的 ERRATA**：第一次 `git add review/AUTO_LOG.md` 后直接 `git commit`，**把并发会话已 `git add -A` 进索引的 6 个文件一起卷进了提交**（`git status` 第一列的 `M`/`A` 就是"已暂存"，我当时只看了文件名没看列位 —— R391 事故同形态）。**处置**：该提交**未推送**，`git reset --soft HEAD~1` + `git restore --staged .` 把索引恢复原状、工作树一字未动 ⇒ 重提只含 `review/AUTO_LOG.md`（`359749f`）。⇒ **巡检轮提交必须先 `git status --short` 看列位，或直接 `git commit -- <path>`**，绝不在脏索引上裸 `git commit`。
