# 店算·盈利分析 — 项目长期记忆（curated，跨会话索引）

## 审计基线
- **2026-11-14 M2/M3 独立交叉审计**（engine-truth-audit）：真实引擎锚点 **59/59** 全过；8 守卫 **391 断言全绿**（m2_semantic_diff14 / biz_preset42 / m3_engine_parity25 / m3_decision23 / m3_margin_bands15 / takeaway_actual44 / m2_reverse_rent23 / m2_matrix191）；变异回灌 2 处转红证非假绿（M2 保本 ÷→×、marginBand HIGH 60→50）。**未发现新真缺口**，生产代码零功能改动。证据 `review/evidence/r195_audit_m2m3_engines.js`；报告 `review/AUDIT_2026-11-14_M2M3_交叉审计.md`。
- **R194-A（加权标量通道口径错配）已修复（2026-11-14）**：免费档加权标量分子原为「仅堂食 ranked」、分母为「全渠道 totals.qty」→ 纯外卖店恒 `no_match`、混合店被 `low_match` 抑制。修复：`cloudfunctions/getDishReview/index.js` 改传「堂食+各平台外卖 ranked 合并」的 `allChannelRanked`（分母仍全渠道）。新增守卫 `check_r729` D-①…D-⑤（真实引擎行为 + 源码锁 + 反恒真）。复现脚本 `review/evidence/r196_repro_r194a.js`。
- **R194-A 同根残项已闭合（2026-11-14）**：免费档 `freeTop`（销量 Top10）与 `free_ranked_total`（已建卡数）原先也是「仅堂食 ranked」→ 纯外卖店空榜/已建卡 0。修复：新增 `service.js buildFreeTop()`，**全渠道按 dish_key 合并跨渠道同菜**（纯堂食逐行等价、跨渠道同菜去重不重复），`index.js` 免费档改用之。守卫 `check_r729` E-①…E-⑥（行为+源码锁）；复现 `review/evidence/r197_repro_r194a_freetop.js` 4/4。
- **R730 门禁基线：`node verify_all.js` 全部套件通过、EXIT=0**（2026-11-14，合 main 前的可用基线）。⚠️ 写记忆时**别用「N/N 全绿」这种斜杠计数**——`check_acceptance_counts` 会把它当成验收计数声明（对比的是 `verify_seed_data` 的实算值）从而判红。套件总数以 verify_all 输出为准。
- **R731 真机三条已修（2026-11-14，提交 `7db350f`）**：① 孤岛页无返回出口（判据 `utils/islandBack.js` + 三落地页「回首页」条）；② 沙盘开店投入输入行（`.row-in-wrap.yr` 110→132rpx + input 右内边距 + unit 间距）；③ 成本卡模板套用无撤销（`tplApplied` 标记 + `onClearTpl`，只清配料行、保留菜名/售价、已填单价先确认、模式复位）。行为验证 `review/evidence/r731_verify_fixes.js` 14 项全过（模拟器真跑读 data）。
- **R732 全站摊销开关演练（提交 `c280124`）**：摊销有**三条互不相干口径**——A 台账分期摊销（`shop_amortize` mode='amort'，受 `shop_switch.amortize_switch` 管）、B 沙盘建店投入折算（手填 fen+years，**测算口径不读开关**）、C 一次性投入（mode='lump'，不受开关控制）。引擎/台账/归档快照全对；**4 处呈现层没把开关生干净**已修：导出「摊销来源」表补差异行、导出「减：当月摊销」备注按四态措辞、摊销页标题条件化、录入页摘要分两版。守卫 `tools/check_amort_switch_matrix.js`（48 条，含变异回灌）。
- **R733 库存开关横向排查（2026-11-14）**：库存开关**健康**（引擎双侧对、`profitLabel.hasStockTake()` 三态 basis 比摊销做得扎实、导出跟 `invOn`、切换入口不双向卡住）。但查出月报页两个**功能入口**被开关 gate（`switches.xxxSwitchOn`）⇒ 开关一关按钮消失，且 R732 的 F-⑨ 只验页内按钮、没验**入口可达性**。已修：月报页两入口去 gate + 库存页补「未启用」说明（17 字 `.muted`，不撞折叠线）；守卫补 F-⑪⑫⑬（变异回灌证非恒真）。
- **R735 摊销「结果位」显示口径（2026-11-15）**：李老师二次反馈「开关关了，最上面本月摊销合计还有数值显示」「设备月摊销也显示数值」。取证结论：**钱没被扣**（`effectiveAmortizeFen=0`，两侧利润差正好一整笔）；页面那个数是**台账应摊额**、与开关无关（开/关页面 `totalYuan` 一模一样）。修：页首大数字改 `shownTotalYuan`（关 ⇒ `0.00`，台账额下移附注 `monthTotalOffNote`）；每笔资产「月摊销」**保留**（台账属性）；区块标题分台账口径版。**连带挖出真缺陷**：`getAmortSchedule` 读实时开关、`getLedger` 走归档快照 ⇒ 归档后改开关会让同月两页互相打脸，已给 `getAmortSchedule` 补 `resolveArchiveSwitches`（与 `getLedger/service.js` **正文逐字同源**）+ 出参 `switch_source`。守卫 `tools/check_amort_display_caliber.js`（20 条：H 页首真跑 10 / I 归档 7 / J 变异 3），套件 316→**317**。
- **同一病根已三次换皮**：R732 呈现层漏开关 → R733 功能入口被开关 gate → R735 **结果位**仍报台账额。判断任何新页面时先问一句：**这个位置的数字代表"本月结果"还是"台账事实"？前者必须跟开关走，后者必须留。**

## 🔴 红线 / 易错点（防复发）
- ❌ **`calcSandboxReverse` 不是死路径**：被 `cloudfunctions/savePlan/index.js:92`（保存 `mode='reverse'` 方案写 `snapshot.reverse`）与守卫 `tools/check_m2_reverse_rent.js`（B-⓪…B-⑤）**真实消费**。**绝不可删**——删之打挂守卫 + 生产快照。唯一不可达的是 `cloudfunctions/calcSandbox/index.js:83-85` 前端→calcSandbox 反向入口（前端反向改走矩阵页）；仅可加注释澄清（已加，2026-11-14）。
- ❌ **台账 status 只许 `fixed` / `deferred`**（R730）：`review/evidence/r721_findings.json` 里写成 `open` 等第三种值会**从 L-⑤/L-⑥ 全部完整性规则里静默漏过**（R729b 实际踩过：R3-9 被写成 open，只有 `check_r714_decisions` 的 STATUS_RULE 撞红才暴露）。现已加 `STATUS_VOCAB` 白名单 + 反恒真腿（L-②/L-⑭）。**待办但未修 ⇒ `deferred` + `priority` + `next_action`，不要用 `open`。**
- **轮次编号必须进位**：本轮用掉 `review/ROUND_INDEX.md` 的 `NEXT` 号后，**同一提交**里把 NEXT +1；注释里写 `RNNN` 会触发 `check_auto_queue` N-③/N-④ 撞号判红（R730 实际踩过一次）。
- ❌ **开关的语义是「计不计入利润」，不是「能不能管理台账」**（R732/R733）：`amortize_switch` / `inventory_switch` **绝不可**当成功能闸门或台账闸门——① 不可写成 `<button wx:if="{{switches.xxxSwitchOn}}">` 挡入口（R733 修：月报页两入口开关一关按钮凭空消失，且与录入页不一致）；② 不可挡住「新增资产/填盘点数」（R732 F-⑨：老板想先登记后开就没门）。**正确形态 = 入口常开 + 进去当场说明「未启用，这笔没在算」**。守卫 `check_amort_switch_matrix` F-⑪⑫⑬ 钉住，改回 gate 立即红。
- 🔴 **断言必须覆盖「入口可达性」，不能只验页内**（R733 教训）：R732 的 F-⑨ 断言「开关关闭仍能登记资产」只测了摊销页内部按钮，而**到达该页的门被开关封住**——页内成立、入口不通，等于只验了一半。新增交互断言时先问「用户怎么走到这里」，再问「到了这里能不能操作」。
- **沙盘 vs 月报的口径定位（李老师 2026-11-14 定案）**：**月报必须分毫不差**（正儿八经算月度账、涉及报税对账）；**沙盘是推演性质，只要数据对就行，不做精细**。⇒ 不在沙盘页加「与月报口径不同」之类的会计解释，那会用复杂度换解释、反而让老板不敢用。两处摊销数值**可以不一样且都正确**（沙盘按手填年限折算、月报按台账逐笔摊）。
- **审计纪律**："不采信任何自述、含我方上轮"——动手前用 grep/源码二次核验接线与死路径断言。曾误判线索 B 为死路径，已更正（见报告 §五）。
- **精度纪律**：金额全分整数、中间高精度、净料单位成本 round 到万分、防浮点 `Math.round(x.toFixed(10))`；算不出给 `null`/`red_alert`（fail-closed，不编造）。
- ❌ **`check_text_contrast` 是「黑名单」不是「算比值」**：它只拦 34 个历史坏色（拼字符串写，避免自命中），**新增的低对比色一律漏过**。`#a16207` 在页面真实底色 `#F6F3EC` 上仅 **4.44:1**（AA 门槛 4.5）就是这样过门的。⇒ **改任何 `color:` 前必须自己按真实底色算 WCAG 比值**：页面底 `#F6F3EC`、卡片底 `#FFFDF8`、正文 28rpx≈14px 门槛 4.5:1。R730 已把外卖页 `base-note` 改为 `#9a5c06`（页面底 4.85 / 卡片底 5.29，双过）。
- ❌ **微信系统「←」箭头只在页面栈深度 > 1 时渲染**（R731 实测）：从**分享卡片 / 最近使用 / 微信后台回收后恢复**进入子页面时栈深 = 1 ⇒ 没有箭头，微信只给一个不直观的房子图标；页面自身若无出口 ⇒ 老板被困（李老师原话「好多人不知道怎么返回」）。判据单源 `utils/islandBack.js::need()`（栈深 ≤1，fail-closed），三个**分享落地页**（`utils/shareCard.js::PATH` 全部：m1 `month/result`、m2 `sandbox/index`、m3 `card/index`）都接了「回首页」条，正常路径不渲染。守卫 `tools/check_island_back.js`（25 条，含 E 覆盖面：将来加 m4 漏接会红）。**新加分享落地页必须同步接入，否则 E-① 判红。**
- ❌ **`miniprogram/i18n/terms.js` 有双副本**：`miniprogram/i18n/terms.js` 与 `specs/dev-specs/i18n/terms.js` **必须逐字节一致**（改一份必红：`check_terms_forbidden` T1b + `check_hint_fold` D1）。改完立即 `cp miniprogram/i18n/terms.js specs/dev-specs/i18n/terms.js`。
- **新套件三处一起动**：① 加进 `verify_all.js::SUITES` ② 头注「串联：N 个套件」+1 ③ `specs/dev-specs/★知识存储点_2026-09-10.md` 的 §1.1 一键校验入口 与 「套件数会漂」两行 +1。**且必须 `git add` 新守卫文件**，否则 `[suite-tracked]`（R92）判红「登记了没提交 ⇒ 远端复现不出」。
- **变异回灌**：改坏核心公式/阈值后对应守卫必须转红；回测后 `git checkout` 精确还原，保持 tracked 文件干净。**只验「函数被调用」不够，要钉「赋值来源」**——R735 实测：把出参改回 `swGet('amortize_switch')`（函数照旧被调用、结果被覆盖）时，I-⑤ 仍绿，直到补 I-⑦ 钉住赋值来源才抓住。
- 🔴 **注释里别写「开关键名带引号」的示例**（R735 踩过）：`getShopContext/selftest.js` 的 R298X-J3c 用正则 `switch_key\s*(?:===|:)\s*'([^']+)'` 扫字面，**注释里的示例也会被当成真字面**，判「未登记键」。要在注释里举例就写「开关名字面」不带引号。
- 🔴 **Python 改文本文件必须防行尾翻写**（Windows）：`io.open(p,'w')` 会把 `\n` 转成 `\r\n` ⇒ 整文件 CRLF ⇒ `check_line_endings` 判红（R735 实测 `check_suite_assert_counts.js` 被翻成 464 行 CRLF）。**优先用 Edit 工具**；非用 Python 不可时写 `io.open(p,'w',encoding='utf-8',newline='')`。踩了就跑 `node tools/check_line_endings.js --fix`。

## 模块要点（速查）
- M2 引擎 `cloudfunctions/calcSandbox/service.js`（`ENGINE_VERSION='m2-1.2.0'`）：保本/目标利润/回本周期；红警（综合变动成本率≥100%）保本返回 null。前端 `subpkg/tools/sandbox/index.js` 用 `mode:'forward'|'reverse'` 分治。
- M3 引擎：`cloudfunctions/calcBom/service.js`（宫保锚点净料 0.0333 元）、`utils/takeawayDerive.js`（双口径恒等式 + 反算回带）、`utils/breakeven.js`、`utils/marginBand.js`（HIGH=60/MID=40 全局单源）、`utils/m3Decision.js`。
- 毛利率色阶阈值只在 `utils/marginBand.js` 出现一次，页面一律引用本模块（守卫 `check_m3_margin_bands` 扫 68 文件确认无游离字面量）。
