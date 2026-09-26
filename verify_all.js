// verify_all.js —— 仓库根一键串联校验器
// 运行：node verify_all.js
// 串联：104 个套件 = 6 个 specs 套件（门禁 A–L + seed/poc1-4）+ 批次0~7 代码自测（batch0/1/2/3/4/5/6/7，
//       含 batch4 六函数补齐 R57）+ 静态路径检查（tools/check_requires.js）+ 页面声明守卫（tools/check_pages.js，R44）
//       + 合规守卫（tools/check_compliance.js，R42）+ 单源派生守卫（tools/check_admincore.js，R50）
//       + 自测形状守卫（tools/check_selftest_shape.js，R66：顶层 IIFE ≤1 / exit 仅在末块）
//       + 幂等覆盖守卫（tools/check_idempotency.js，R73：契约「+幂等」逐函数对照 / 预检早于写的顺序不变量 /
//         登记同源 shopKey / 装饰性 idempotency_key 检出；判据来源 = 契约表本身，不手抄清单）
//       + 建库单源同步守卫（tools/check_schema_sync.js，R74：单源 collections.js ≡ 镜像 init_db.js 的
//         集合与索引清单 / 三份文档里写死的索引计数与逐条对照表 ≡ 单源；字面量解析 fail-closed）
//       + 交接面引用位置守卫（tools/check_handoff_paths.js，R77：协议/手册里的「报告在哪」必须给
//         **可解析绝对路径**且**真实存在**，并显式点名两个同名诱饵；根因=此前从没人验证过那个路径）
//       + 核对单派生守卫（tools/gen_index_checklist.js --check，R79：**整份**派生件重算逐字比对，
//         含剥 BOM + CRLF 归一 + 末尾空白归一；根因=核对单此前不在任何守卫扫描面内，
//         改单源却不重跑 ⇒ 它会静默停在旧计数，而全套 56 个套件全绿）
//       + 已证伪短语守卫（tools/check_stale_claims.js，R85：**已证伪的说法必须带上下文标记**，
//         政策类须带政策标记；按**概念**而非句式命中 ⇒ R84 那种「同一概念换了说法」不会再漏。
//         根因=R60/R77/R82/R84 四次都是审定式断言的时效性没人守、且四次都靠人 grep）
//       + batch7 前端工具套件（tools/selftest_batch7.js，R55 移入 tools/ 以免随小程序包发布）
//       + 状态陈述矛盾守卫（tools/check_stale_status.js，R109：小节标题说「待修/待办」而同节正文
//         已说「已闭环/已修复」⇒ 转红；扫**活文档面** specs/，review/ 为历史档案只作弱面明示。
//         根因=core/13 事项闭环后只改正文、标题/页脚停在旧时态，而同族 16 例全是**数字**漂移、
//         无一是**时态**漂移 ⇒ 用结构判定而非短语表；含 5 组正负样本互证 + 2 道自失效护栏）
//       + 外卖段规范口径守卫（tools/check_waimai_spec_sync.js，R114：规范 ModuleA §A.11 明文声称
//         「严格取自代码单源」的两处**文档抄代码**派生面 —— 平台名与顺序 ≡ terms.js 外卖 items、
//         营销项 key/显示名/顺序 ≡ collections.js 营销项，逐项有序双向比对；
//         根因=round84 新落规范时新增了这两处派生面，而 R110 只守三份代码副本、**根本不看规范正文**）
//       + 金额框同行守卫（tools/check_amount_input_row.js，R119：金额输入框被**同层**的按钮/字段名挤窄 ——
//         李老师真机反馈已三次（09-20 其他收入细项 220rpx / 09-21 堂食分项 240rpx / 09-22 外卖分项 181.7px），
//         前两次只在 wxss 留注释禁令、**零机器判据** ⇒ 新页面照抄旧写法即复发。判据=val-input 不得与 button 同父）
//       + 外卖账单「粘贴形态」用例表守卫（tools/check_takeaway_paste_cases.js，R120：同族病第 24 例 ·
//         **静默算错钱第 3 例** —— extractPaste 的合计护栏写在**行**上，只在「标签与金额同行」时生效；
//         账单常见的「合计」⏎「7140.00」（标签一行、金额下行）护栏完全不触发 ⇒ 合计被当明细加进去，
//         4380+2760+7140 = **14280（翻倍）**且界面照旧提示「已提取并填入」。
//         前两例（R85 firstNumber 截断 / 账期列被当金额）都只改了**一处正则**、所以第三例照旧复发
//         ⇒ 本轮把**账单形态**钉成用例表（tools/paste_cases.js 单源 28 条）并常驻双向校验：
//         有明细 ⇒ 只按明细求和（合计必须排除，两种形态都要排除）；只有合计 ⇒ 兜底填入并换提示）
//       + 费用项清单口径守卫（tools/check_expense_item_seed.js，R121：费用项清单散在**四处副本**
//         —— 云函数种子 `SEED_EXPENSE_ITEMS` / 原型副本 `prototype/init_db.js` / 前端单源
//         `terms.js::ledger.expense` / 术语副本（后者已由 batch8b K11 守逐字一致），另有规范 §A.2
//         人读面。收入侧 2026-09 已被 R110 守上，**费用侧此前零守卫**（R110 的扫描面只解析
//         SEED_INCOME_ITEMS）⇒ round97 按规范 A.2 给营销段补 3 项时才暴露该洞：任一处副本被单独
//         改动都不会有套件转红。判据＝云函数种子 ≡ 原型副本（key|名|类|sort 逐项保序）+
//         前端 terms.expense ≡ 种子（逐 category、项名、保序）+ 规范 §A.2 营销表 ≡ 代码 marketing
//         （集合双向）+ 下界护栏（总项数 ≥ 20 / 每 category ≥ 2））
//       + 全仓 .js 语法编译守卫（tools/check_js_syntax.js，R122：**每个受管 .js 至少能被引擎编译一次**，
//         用 `vm.Script` 同进程编译 675 个文件、不执行不 spawn）。
//         根因=round97 T1 把 `pages/month/input.js` 的 require 解构**拆成两条**（第 13 行已 `}` 收尾、
//         第 14 行又接一段）⇒ 微信出码 `Unexpected token (14:32)`、**小程序根本起不来**，
//         而门禁当时报 **94/94 全绿**：check_requires 只查「require 路径**存在**」（存在 ≠ 可编译），
//         全部 selftest/check_* 都是**文本级 grep**，而前端 `pages/`+`miniprogram/` **无任何套件 require**
//         ⇒ **前端语法是零覆盖区**，事故正落在那里。
//         首发即抓到 `tools/apply_indexes.js`：块注释里写下 glob 形态的「通配符星号紧跟斜杠」，
//         **提前闭合了块注释** ⇒ 该建索引工具自 2026-09-17 起**一直编译不过、根本跑不起来**而无人知。
//         扫描面＝仓根 + miniprogram/pages/utils/cloudfunctions/tools/specs；
//         排除面**显式声明**（node_modules/.git/.workbuddy/review —— review 是历史归档面，
//         存有变异期故意写坏的脚本快照）；两条下界护栏（文件数 ≥ 400 + 六个锚点文件必须命中）
//         防扫描面被悄悄写窄）
//       + WXML 结构完整性守卫（tools/check_wxml_structure.js，R123：**WXML 不得把属性暴露成文本**）。
//         根因=round97 T1 的**同一支插入脚本**在把 input.js 的 require 拆成两条（R122 记）之后，
//         **同一轮**又把 pages/month/input.wxml 的金额 <input> 从**属性集合中间**用 `/>` 收掉
//         ⇒ 其后的属性行失去归属、成了文本节点；而 WXML 的文本节点**仍会插值 {{}}**
//         ⇒ 真机屏上是**求值后**的 `data-gidx="0"` / `disabled="false"`（所以像"英文报错"
//         却看不到双花括号）。缺口：95 个套件里**没有任何一条读 .wxml** —— R122 只覆盖 .js，
//         前端页面结构此前零机器判据（真机页面只在模拟器里跑）。
//         判据 A＝裸属性行（该行形如 attr="…" 而**上一非空行以 > 或 /> 结尾** ⇒ 属性无归属）；
//         判据 B＝标签配平（骨架化抹 `{{…}}` / `<!--…-->` 后单趟 tag 栈：未闭合 / 错配 / 缺 > 均判红）。
//         骨架化时**保留换行**⇒ 报出的行号与源文件一致、不漂移；
//         下界护栏＝文件数 ≥ 10 + 四个锚点页面（含事故现场 pages/month/input.wxml）必须命中）
//       + 页面术语键「引用即存在」守卫（tools/check_page_terms.js，R124：**WXML 拿不到的术语键
//         会静默渲染成空** —— 空白按钮/空白文案/空白 placeholder，而门禁全绿）。
//         根因=round108 李老师真机反馈「再投一笔下面的按钮是纯蓝色、上面没有文字」：
//         `pages/month/amortize.js` 写 `TERMS.amortizePage.amortAdd`，而该键**在 terms.js 里不存在**
//         （本体是 `amortizePage.add`）⇒ undefined ⇒ 主按钮只剩底色。顺着这一处全仓扫出**同族 7 处**
//         （空按钮 1 + 空文案 4 + 空 placeholder 2），全部漏在「术语本体是好的、只是没搬进页面的 t」。
//         缺口：R122 只验 .js 能不能编译、R123 只验 WXML 属性有没有错成文本，
//         **没有任何套件检查「页面引用的术语键是否真的存在」** ⇒ 与 R122/R123 同型，都是前端页面这层无覆盖。
//         判据＝① 反查 terms：`TERMS.<组>.<键>` 字面引用必须解析得出（剥注释后扫，防被自己的注释绊红）；
//         ② 反查页面：wxml 里的 `t.<键>` 必须在同页 `t: { … }` 键集合里（锚定行首 `t: {`，防误命中
//         `saveAsset({ asset: {` 里的伪 `t: {`）；两条腿方向相反、对应两种漏法（术语写错 vs 忘映射）。
//         自失效护栏＝S1 扫描面 ≥20 个 .js / S2 `TERMS.` 命中 ≥400 次 / S3 `t.` 用法 ≥300 次且带 t 块页面 ≥8 /
//         S4 四个锚点文件（含事故现场）必须命中）
//       + 流程出口与折叠守卫（tools/check_flow_entry_and_fold.js，R125：**用户能不能走通这条路**）。
//         根因＝round109 李老师真机一次报四件事，全是「代码里明明有路、用户却走不通」，而
//         97 个套件**没有一条读这四处** —— R122 验 .js 能否编译 / R123 验 WXML 属性有没有错成文本 /
//         R124 验术语键引用得出来，**三条都是"能不能跑起来"级别，无一条守"走得通"**：
//           ① 摊销资产删不掉 —— 前端 assetEdit.wxml 把删除键条件写死 `kind === 'lump'`
//              （后端 saveAsset 早就支持删任意资产）⇒ 摊销只能走「提前报废」；
//           ② 摊销页（全流程最后一步）底部只有「+ 新增摊销资产」，**零出口** ⇒ 填完只能按手机顶部返回键退；
//           ③ 外卖「假折叠」—— 标题行一直有 ▾/▸ 而内容块**压根不读 g.expanded**（wx:elif 里没这变量）
//              ⇒ 点了只翻符号、内容纹丝不动；接上真折叠后还要保证折叠态摘要在**分项模式**下不显示旧值
//              （两种模式的钱不在同一处：快速=groups.rows / 分项=takeoutDetailRows）⇒ 必须 js 预计算；
//           ④ 板块无区隔 —— 一级标题 .sec 30rpx/700 与二级 .g-label 30rpx/600 **同字号只差 100 字重**。
//         判据＝A 删除入口（条件解析 + 文案分流 + 后端跨月归档锁）/ B 出口（两个 bindtap + 处理函数 +
//         跳转目标在 app.json 注册）/ C 真折叠（内容块读 expanded + 两态顺序 + 摘要取预计算字段 +
//         定义与调用链 + 默认折叠）/ D 层级（字号数值 **语义级**比较一级 > 二级）+ 渐变竖条 + 禁圈码编号；
//         四条判据全部走**结构解析**（取属性值 / 取函数体 / 解析字号）而非裸字面 grep（注释里大量引用旧写法）；
//         自失效护栏＝S1 十一个锚点可读 / S2 正负样本互证 ×4（旧写法必判红、新写法必判绿）+
//         S2-⑤ bodyOf 锚定义不锚调用（本轮真实误报的钉死样本）/ S3 cssBlock 解析有效 / S4 elifConds 有效 /
//         S5 断言数 ≥20）
//       + 餐饮指标参考库口径守卫（tools/check_indicator_ref.js，R126：M2 v2 新落的「分业态 × 分城市层级」
//         参考带 + 城市系数 + 红线副本**一个事实两处副本** —— 机器面 `cloudfunctions/common/indicatorRef.js`
//         与 M2 规范 §M2.4b 的权威 JSON；改任一侧另一侧静默过期而门禁全绿，与 round61/round64/R111 同族
//         （第 29 例：人工陈述面 ≡ 实然，零机器校验）。本守卫比前 28 例多做两件事：
//         ① **三方对齐** —— `REDLINE` 段是 M1.6 唯一声明处的引用副本 ⇒ code ≡ M2 JSON ≡ M1.6 声明行（含浮点）；
//         ② **行为级口径** —— M2.4b 正文写死的四条语义（食材/能耗/管理/推广**不随城市变**、
//            房租/人工乘城市系数、level 边界「cost 超上限 25% 内 = warn / gain 低于下限 15% 内 = warn」、
//            **未填 ≠ 0 元**）用 JSON 数字比不出来，只能调函数断言行为；
//         另把 round110 E3 的浮点坑钉成固定样本（`25 × 1.15 = 28.749999999999996` ⇒ 必须 28.8 而非 28.7）。
//         自失效护栏 = 比较器正负样本互证 5 组 + 真实数据变异互证 + 逐项比较对 ≥34 + 断言数下界 +
//         两份目标文档须在扫描面内；弱面（其它 .md 提及本库）只 ⚠️ 明示不判红（坑⑭ 裸扫必误杀））
//       + 对外文案面「零食材成本率」守卫（tools/check_m2_no_cost_rate.js，R127：round111 李老师拍板
//         「指标统一到**毛利率**、避免**食材成本率**，客户看不懂」—— 这是**产品口径要求**：改错了
//         **不会让任何数字出错**，只是文案退回老说法 ⇒ 全部数字类判据（selftest / indicator-ref 的
//         A/B/C 段）一个都抓不到。round111 当时只在 check_indicator_ref 的 E 段做了 **4 个文件**的
//         面，**全页面层零覆盖**。判据 = A 三面（pages 60 个 + miniprogram/utils + 术语镜像）剥注释后
//         零「食材成本率 / 食材成本占… / 食材成本比… / 食材占比」+ 双副本逐字节一致
//         + B **反向护栏**（引擎内部中间量 foodCostPct **必须仍在**且仍作综合变动成本率的加数、
//         在前端**必须零出现**、「100 −」那层桥不得回到指标层）
//         + C **正向要求**（术语必须正面叫「菜品毛利率」+ 成本/gain 两张方向表）
//         + D 自失效护栏（**按扩展名派发正确注释语法**的剥注释器 5 例正负互证 —— 含 `"http://…"`
//         不得被切坏、wxml 属性值不得被误剥；词族 5 例；扫描面/锚点/断言数三道下界）。
//         ⚠️ 与 check_indicator_ref 的 E 段是**不重复的两层**：E 段只守与指标库直接相关的 4 个文件，
//         本守卫守**全前端文案面**；两者在 terms.js / sandbox 上重叠是刻意的（E 段就近、R127 兜底）。
//       + M2「参考值不预填」守卫（tools/check_m2_ref_not_prefill.js，R128：round114 新落「预计月营业额
//         锚点」时暴露的**护栏缺口** —— 该功能把参考金额显示成输入框的**灰字起点**，它的边界是
//         「参考值只作提示、**绝不替你填**」（M2 是前瞻沙盘，参考值=行业平均；一旦自动填值，
//         用户不核对就得到「全绿、保本点健康」的**自证合理**，比不给还坏）。
//         而这条边界在 round114 落地时**零守卫**：变异回灌 A10（把参考金额写进 `yuan`）与
//         A11（wxml 输入框 `value` 绑成 `{{item.ph}}`）**跑遍全部相关套件 0 条转红**
//         ⇒ 同族病「文档里写了『绝不』却没有机器判据」（与 round111 的 A9「判据面写窄」同类）。
//         判据 = P 前置（函数体可解析 / input 数下界）+ A `applyRefAmount` 函数体剥注释后**零 `yuan`**
//         + B wxml 每个 `<input>` 的 `value` 必须在**用户值白名单**内
//         + C 正向（确实写 `ph` / 参考值仍有出口）+ D 四组正负样本互证（剥注释器 / 判别器 /
//         `bodyOf` 锚定义不锚调用 / value 提取器）+ E 断言数下界）
//       + M1「台账细项 → 指标归属」守卫（tools/check_m1_indicator_view.js，R129：round115 M1 结果页加「行业对照」时曝露的**静默失效面** —— M1 台账把库存里的**支出细项名字符串**（`sub_item`）当作机器匹配键去汇总 `rent`/`energy`/`labor`/`mkt`；
//       + 写库主键守卫（tools/check_doc_id_write.js，R130：round116 真云暴露的**静默失败** —— `dataAdapter.get()` 在 2026-09-19 只修了**读**（业务主键兜底查），
//         **写仍用业务键**；而真云 `doc(<不存在的 _id>).update()` **静默 0 行不报错** ⇒ 接口回 SUCCESS、库里没改、两端都看不见错）
//         若哪天把 terms 里「房租」改成「租金」，归属表就**匹配不上、指标静默少一项且不报错**（用户可自定义细项名 ⇒ 名字本就不是稳定键）。
//         且 `Number(null) === 0` ⇒ 没填的月会被算成「0%」而判 `bad`/`good`（缺项 ≠ 0，与 round114 的「参考值不预填」同族）。
//         判据 = P 前置 / A 归属表名字**必须真实存在于 terms 支出细项**（改名即转红 —— 本守卫存在理由）+ 不含 `manage` + `energy` 恰三项
//         + B 结果页零硬编码阈值（引号感知剥注释）
//         + C 出参契约（`indicators` / `indicator_scope` 十项）+ D 工具自证（8 组正负样本互证）+ E 断言数下界）
//       + M3 计算引擎多副本行为等价守卫（tools/check_m3_engine_parity.js，R131：round129 全量梳理 M3 时暴露的**零覆盖区** ——
//         M3 的计算内核在 calcBom / saveCostCard / syncCostCard 三处**各有一份副本**，本机一直默认「它们应当一致」，
//         但**没有任何套件真跑三份做比对**；且三份**文本并不逐字等价**（calcBom 抽了 `purchasePerGramYuan` /
//         `lineNetCostYuan` 两个辅助函数、另两份是内联的等价式）⇒「逐字节相等」类判据会误伤，只能判**行为等价**。
//         判据 = A 三副本均可加载（另两份纯映射层已登记）/ B 确定性随机 3000 组 × 三副本 ⇒ 6000 次比对零不一致
//         + C 锚点回归（宫保鸡丁 / 红油底料两组锚点值在三副本上同时成立）
//         + D 反恒真四条（输入敏感 ×2 / 变体引擎偏移 1 分必须判为不等 / mode 非法三副本均抛错）+ E 断言数下界）
//       🔒 另：本文件对**每个套件的 stdout**做「段标题下零断言即判红」审计（R66 主体，见 auditAssertions）。
// 🔒 上面这句数量由本文件内的 guardSuiteCount() **自动校验**（R59）；改这句以外的任何套件增删都会立刻转红。
// ⚠️ 另有两处在重启键 specs/dev-specs/★知识存储点_2026-09-10.md（§1.1 一键校验入口行 + 「套件数会漂」行），
//    那两处仍是**人工面**，改 SUITES 后须手动跟（A–L 无一组能发现重启键自相矛盾）。
// 用同一个 node（process.execPath）跑子进程，避免多解释器/环境问题。
// ⚠️ 不在 CI 之外假定任何 secrets；纯本地静态 + 单测。

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const NODE = process.execPath; // 当前执行的 node，子进程复用

// [展示名, 相对根的路径]
const SUITES = [
  ['门禁 A-L',            'specs/dev-specs/prototype/check_error_codes.js'],
  ['verify_seed_data',    'specs/dev-specs/prototype/verify_seed_data.js'],
  ['test_poc1',           'specs/dev-specs/prototype/test_poc1.js'],
  ['test_poc2',           'specs/dev-specs/prototype/test_poc2.js'],
  ['test_poc3',           'specs/dev-specs/prototype/test_poc3.js'],
  ['test_poc4',           'specs/dev-specs/prototype/test_poc4.js'],
  ['batch0 代码自测',     'cloudfunctions/common/__tests__/batch0_selfcheck.js'],
  ['batch1 代码自测',     'cloudfunctions/calcMonthlyProfit/selftest.js'],
  ['batch2 代码自测',     'cloudfunctions/calcAmortize/selftest.js'],
  ['静态路径检查',        'tools/check_requires.js'],
  ['页面声明守卫 R44',    'tools/check_pages.js'],
  ['合规守卫 R42',        'tools/check_compliance.js'],
  ['单源派生守卫 R50',    'tools/check_admincore.js'],
  ['自测形状守卫 R66/67/68', 'tools/check_selftest_shape.js'],
  ['幂等覆盖守卫 R73',    'tools/check_idempotency.js'],
  ['建库单源同步守卫 R74', 'tools/check_schema_sync.js'],
  ['交接面引用位置守卫 R77', 'tools/check_handoff_paths.js'],
  // ===== 核对单派生守卫（R79 · 复审方 round33 裁定「方案②」）=====
  // 用**整份重算逐字比对**覆盖派生件 —— S4 那种"抽数字比对"覆盖不了 §3 那 40 行正文，
  // 而那才是人真正照着操作的部分。硬要求：剥 BOM + CRLF 归一（不归一 ⇒ 入库后首次拉取假红）。
  ['核对单派生守卫 R79', 'tools/gen_index_checklist.js', ['--check']],
  // ===== 已证伪短语守卫（R85 · 复审方 round36 提议，本轮提前做）=====
  // 目的：R60/R77/R82/R84 四次都是「否定式断言的时效性没人守」，且四次都靠人 grep。
  // 判据不是"句子长什么样"，而是"概念 + 上下文标记" —— 已证伪说法必须带豁免标记，
  // 政策类必须带政策标记 ⇒ 引述天然放行，不必要求写作者改写措辞去躲关键词。
  ['已证伪短语守卫 R85', 'tools/check_stale_claims.js'],
  // ===== 批次 3 · POC2 BOM 两层 / 循环拦截 / 快照（7 个云函数各自单测）=====
  ['batch3-calcBom',      'cloudfunctions/calcBom/selftest.js'],
  ['batch3-detectCycle',  'cloudfunctions/detectCycle/selftest.js'],
  ['batch3-saveMaterial', 'cloudfunctions/saveMaterial/selftest.js'],
  ['batch3-saveCostCard', 'cloudfunctions/saveCostCard/selftest.js'],
  ['batch3-syncCostCard', 'cloudfunctions/syncCostCard/selftest.js'],
  ['batch3-getMaterial',  'cloudfunctions/getMaterial/selftest.js'],
  ['batch3-getCostCard',  'cloudfunctions/getCostCard/selftest.js'],
  // ===== 批次 4 · M1 结账归档 + M2 沙盘 + 摊销 + 账保存（各自单测）=====
  ['batch4-archiveMonth', 'cloudfunctions/archiveMonth/selftest.js'],
  ['batch4-calcSandbox',  'cloudfunctions/calcSandbox/selftest.js'],
  ['batch4-getAmortSchedule', 'cloudfunctions/getAmortSchedule/selftest.js'],
  ['batch4-saveLedger',   'cloudfunctions/saveLedger/selftest.js'],
  // ===== batch4 补齐（R57）：此前只有结构类检查覆盖、行为无机器断言 =====
  ['batch4-getLedger',      'cloudfunctions/getLedger/selftest.js'],
  ['batch4-getMonthList',   'cloudfunctions/getMonthList/selftest.js'],
  ['batch4-getShopContext', 'cloudfunctions/getShopContext/selftest.js'],
  ['batch4-getCardVersions', 'cloudfunctions/getCardVersions/selftest.js'],
  ['batch4-saveAsset',      'cloudfunctions/saveAsset/selftest.js'],
  ['batch4-saveShopSetting', 'cloudfunctions/saveShopSetting/selftest.js'],
  // ===== 批次 5 · 付费全流程（配额 + 订单 + 回调 + 权益 + 提醒 + 订单记录）=====
  ['batch5-checkQuota',        'cloudfunctions/checkQuota/selftest.js'],
  ['batch5-payCreateOrder',    'cloudfunctions/payCreateOrder/selftest.js'],
  ['batch5-payCallback',       'cloudfunctions/payCallback/selftest.js'],
  ['batch5-payQueryEntitlement', 'cloudfunctions/payQueryEntitlement/selftest.js'],
  ['batch5-payRenew',          'cloudfunctions/payRenew/selftest.js'],
  ['batch5-payExpireNotify',   'cloudfunctions/payExpireNotify/selftest.js'],
  ['batch5-payOrderList',      'cloudfunctions/payOrderList/selftest.js'],
  // ===== 批次 6 · 管理后台（鉴权 / 调权 / 录单 / 退款 / 导出）=====
  ['batch6-adminInit',          'cloudfunctions/adminInit/selftest.js'],
  ['batch6-adminLogin',         'cloudfunctions/adminLogin/selftest.js'],
  ['batch6-adminRefreshToken',  'cloudfunctions/adminRefreshToken/selftest.js'],
  ['batch6-adminLogout',        'cloudfunctions/adminLogout/selftest.js'],
  ['batch6-adminRevokeToken',   'cloudfunctions/adminRevokeToken/selftest.js'],
  ['batch6-adminQueryUser',     'cloudfunctions/adminQueryUser/selftest.js'],
  ['batch6-adminGrantEntitlement', 'cloudfunctions/adminGrantEntitlement/selftest.js'],
  ['batch6-adminManualOrder',   'cloudfunctions/adminManualOrder/selftest.js'],
  ['batch6-adminOrderList',     'cloudfunctions/adminOrderList/selftest.js'],
  ['batch6-adminRefundMark',    'cloudfunctions/adminRefundMark/selftest.js'],
  ['batch6-adminExport',        'cloudfunctions/adminExport/selftest.js'],
  // ===== 批次 7 · 体验打磨（表单校验 / 防重复 / 多店铺 / 导出 / 注销）=====
  ['batch7-getShopList',     'cloudfunctions/getShopList/selftest.js'],
  ['batch7-exportData',      'cloudfunctions/exportData/selftest.js'],
  ['batch7-deleteAccount',   'cloudfunctions/deleteAccount/selftest.js'],
  ['batch7-utils',           'tools/selftest_batch7.js'],
  // ===== 批次 8 · UI 走查修复（result 三态 / amortize 初值 / 月份占位 / 两 key 拆分 / tab 不满宽 / 按钮抽类）=====
  ['batch8-ui-fix',          'tools/selftest_ui_fix.js'],
  // ===== 批次 8b · 功能补齐（A1 费用四大类 / A2 二级细项 / A3 分类种子 / B1 年月 picker / C1 mine 三 cell / D1 结果下钻 / E1 引导文案 / F1 术语统一）=====
  ['batch8b-features',       'tools/selftest_batch8b.js'],
  // ===== 批次 8c · 用户两大诉求（H1 摊销资产多次采购「二次摊销」/ H2 填表引导：每类口径 + 填写口径折叠块）=====
  ['batch8c-amort-batches',  'tools/selftest_batch8c.js'],
  // ===== 上线前 AD 缺口补齐（G1 字号 / G2 触控 / G3 adjust-position / G4 热更新 / G5 头像昵称 / G6 触觉反馈 / G7 场景值 / G8 断网提示 + debounce 清理）=====
  ['ad-gates',               'tools/selftest_ad_gates.js'],
  // ===== R95 证据文件留证元信息（纯读声明 vs 写入痕迹须自洽 / 前置时刻 ≤ 采集时刻）=====
  ['evidence-meta',          'tools/check_evidence_meta.js'],
  // ===== R97 跨函数数据契约（da.get 的 _id vs 业务主键兜底 / 同义字段在 DB 读取点必须兼容）=====
  ['data-contract',          'tools/check_data_contract.js'],
  // ===== R45 iOS 虚拟支付入口（付费入口必须做 iOS 过滤，防 iOS 端可下单被审核拒）=====
  ['ios-pay-guard',          'tools/check_ios_pay.js'],
  // ===== 环境 ID 就绪（env.js 占位符静默回落缺口：ACTIVE_ENV 切 prod 而 ID 未填 ⇒ 全站云调用瘫痪且无告警）=====
  ['env-ready',              'tools/check_env_ready.js'],
  // ===== 派生件 .docx 内容守卫（round53 补：verify_docx.py 是权威判据却从未挂 SUITES，
  //       导致「66/66 全绿」并不包含 docx 校验；本项把它变成每次门禁必跑。fail-closed：python/docx 缺失即红）=====
  ['docx-derive',            'tools/check_docx_derive.js'],
  // ===== 禁用词表守卫（round56 补：TERMS.forbidden 13 个关键词全仓零守卫引用、SUITES 无术语套件
  //       ⇒ 写进文案也没人知道。扫描面=文案源 TERMS/ERROR_MESSAGES + pages/**/*.wxml 可见文案；
  //       豁免 EXEMPT 与待裁决 DEFERRED 均须带 by/date/reason，且双向防腐（僵尸豁免也判红）。
  //       根因与 R86「索引已建≠生效」、round53「verify_docx.py 未挂 SUITES」同族：判据存在 ≠ 被自动执行）=====
  ['terms-forbidden',        'tools/check_terms_forbidden.js'],
  // SUITES 覆盖守卫 R93（round60）：本仓两次踩「新判据忘了挂 SUITES 且无人报警」——
  //       round53 的 tools/verify_docx.py（权威判据却从未登记）、round55 的 TERMS.forbidden（零守卫引用）。
  //       与 R86「索引已建≠生效」同族：判据存在 ≠ 判据被自动执行。此套件把「覆盖率」本身变成被校验对象
  //       ⇒ 第三次同类疏漏会在门禁当场转红，不再依赖某轮巡检恰好扫到。
  ['suite-coverage',         'tools/check_suite_coverage.js'],
  // 套件数口径守卫（round61）：R59 只守本文件头注 ≡ SUITES.length，而重启键
  //       specs/dev-specs/★知识存储点_2026-09-10.md 的两处「套件数」是**人工维护面**（该文件自己就写着
  //       「改 SUITES 后两处都要跟，否则重启键自相矛盾而 A–L 无一组能发现」）。
  //       round60 新增第 69 个套件后确实漏跟 ⇒ round61 实扫：重启键两处仍写 68、实算 69（漂移已发生且无人报警）。
  //       与 R86「索引已建≠生效」、round53「判据存在≠被执行」同族：权威入口写的数 ≠ 机器实算的数。
  //       此套件把「口径 ≡ 实算」变成常驻断言；历史陈述（review/ 下的旧计数）按只增不改放行，
  //       并用前提守卫证明排除面没打错。
  ['suite-count-claims',     'tools/check_suite_count_claims.js'],
  // 云函数清单守卫 R98（round62）：core/10「云函数清单与接口契约」自称「单一文档列出全部云函数」，
  //       实测双向漂移 —— 8 个已部署函数零出现、4 个表内名字从未落地为目录 ⇒ 写码 AI 拿它当基线会漏 8 个、
  //       并按 4 个不存在的名字造代码。与 R59「套件数」/ R74「索引计数」/ round61「重启键套件数」
  //       同族第 6 例：同一事实两处写、无机器校验。此套件做「契约文档 ≡ 实际目录」双向比对，
  //       并把「全集计数」做成单源声明（裸扫「N 个函数」会误杀 5 处子集/历史口径，已改语义级）。
  ['fn-inventory',           'tools/check_fn_inventory.js'],
  // 隐私政策占位符口径守卫 R99（round63）：上线唯一硬阻塞里唯一要李老师动手的一项，处数在仓里
  //       先后被记成 4 → 7 → 6，round51 修了 4 处陈述却漏跟重启键（round63 实扫发现仍写「7 处未填」）。
  //       与 round61「重启键套件数」/ R98「云函数清单」同族第 7 例：人工陈述面零机器校验。
  //       此套件做「文档口径声明 ≡ 剥反引号后实扫」双向比对，口径以语义标记编码进文本
  //       （裸扫「N 处」会误杀 4 处：19 处跳转计数 + 两处否定式引用「非 4 处」）。
  ['privacy-placeholders',   'tools/check_privacy_placeholders.js'],
  // 红线复核条数口径守卫 R100（round64）：core/04 §C「红线复核表（一票否决）」实算 12 行，
  //       2026-09-12 的校订（04 明写「原写 11 条红线…漏计 1 条」）**只更正了一处** —— round64 回源实扫发现
  //       05 审计单 / 06 工程治理（就在 **v1.0.0 提审发布**那一行）/ 写码阶段启动手册 三处仍写 11 条，零守卫。
  //       与 R59「套件数」/ round61「重启键套件数」/ R98「云函数清单」/ R99「隐私占位符」同族第 8 例。
  //       此套件做「单源声明 ≡ §C 实算行数 ≡ 全仓引用」三方比对；裸扫「N 条红线」会误杀校订说明行，
  //       故口径以语义标记编码进文本 + 历史行靠上下文标记放行，并用前提守卫证明排除面生效。
  ['redline-inventory',      'tools/check_redline_inventory.js'],
  // 功能页面清单口径守卫 R101（round65）：提审材料 §4「功能页面清单」是递交给微信审核的材料，
  //       而 R44（tools/check_pages.js）只守 app.json ↔ pages/ 文件，**不看提审材料一个字**
  //       ⇒ 加/删页面时材料清单静默过期，零守卫。同族第 9 例（人工陈述面 ≡ 实然）。
  //       此套件做「单源声明 ≡ app.json::pages 实算 ≡ §4 表格逐条双向」比对；
  //       裸扫「N 页」会误杀导出分页页数与子集页数，故判据用「全集语义锚点就近」两条腿。
  ['page-manifest',          'tools/check_page_manifest.js'],
  // 第 75 套件（round66 新增，R102）：商业化额度口径守卫 tools/check_quota_limits.js
  //       同族病第 10 例：免费/硬上限额度是**收钱口径**，单源 = initDb/collections.js 的
  //       SEED_FEATURES 中 plan_id='plan_free' 行 limits{shop:1,cost_card:5,hard_shop:200,hard_card:2000}（round121 起**配置化**），
  //       却被抄进 6 份 .md。实扫发现 core/04_核对清单.md:70 仍写「M3 成本卡免费上限 8」（v1.1 旧值，
  //       v1.3 改 3、2026-09-24 M3 v1.1 · D12 再调 5），而**同文件** :55/:64/:117 三处已同步 5 ⇒ 上线前核对清单与配置不一致即红。
  //       裸扫「N 张」必误杀（OBSOLETE 历史版、演进链「8→3→5」、「第 6 张触发」序号、core/12 的云资源「硬上限」）
  //       ⇒ 判据用「类别锚点就近 + 额度语义 + 版本号/单位数排除」三条腿。
  ['quota-limits',           'tools/check_quota_limits.js'],
  // 第 76 套件（round67 新增，R103）：集合权限矩阵口径守卫 tools/check_collection_perms.js
  //       同族病第 11 例：集合权限是**安全边界**口径（AD-9 客户端不直连 DB，默认安全态
  //       = 仅管理端可读写），单源 = collections.js::COLLECTIONS（25 张），人工面 = core/15 §2 表格；
  //       实扫 tools/ 与 prototype/ 零引用 core/15 ⇒ 与单源**零守卫**（R74 的 S1~S5 不看它一个字）。
  //       加/删集合时 R74 会要求同步镜像与文档计数（绿），但 core/15 静默过期 ⇒ 新集合留在默认
  //       「仅创建者可读写」⇒ 客户端可直连越权。判据＝声明 ≡ 表格行数 ≡ 单源三方 + 逐条双向 +
  //       权限模式白名单 + 序号连续 + 三道前提守卫（防列错位零命中假绿）。
  ['collection-perms',       'tools/check_collection_perms.js'],
  ['privacy-collection',     'tools/check_privacy_collection.js'],
  // 第 78 套件（round69 新增，R105）：验收自检通过数口径守卫 tools/check_acceptance_counts.js
  //   根因＝《02_模拟测试数据集》是验收唯一标准，其机器落点 verify_seed_data.js 的**通过数**
  //   被 5 处文档记成 41、实跑已是 48（同一份重启键里 §1.1 行写 48/48、另一处却仍写 41/41；
  //   verify_all.js 收尾注释也早写着 48）⇒ 与 round61 套件数同族第 13 例。
  //   后果＝「期望通过数」被写低即**下界保护失效**：断言从 48 掉回 41 时文档仍说 41 符合预期
  //   ⇒ 7 条断言静默丢失而验收照旧判绿。判据＝**真跑脚本**取实算（不抄字面量，fail-closed）
  //   ≡ 唯一声明处（core/14 语义标记）≡ 全仓锚点就近的当前态引用（N/N 全绿 与 N 通过/M 失败
  //   两种句式分别归一）+ HIST 排除面前提守卫。
  ['acceptance-counts',      'tools/check_acceptance_counts.js'],
  // 第 79 套件（round70 挂入，R106 由并发方 round71 起草、我方独立复核后代为集成）：
  //   后台鉴权安全参数口径守卫 tools/check_admin_auth_params.js
  //   根因＝`_adminCore/adminAuth.js` 的 LOCK_AFTER_FAILS / LOCK_DURATION_MS / TOKEN_TTL_MS 三个
  //   **安全边界常量**被抄进 6 份 .md，而 R50 `check_admincore.js` 只守「11 份副本 ≡ 单源逐字节一致」、
  //   **不看常量取值** ⇒ 把锁阈值放松成 10 次 / token 放宽成 30 天后，文档仍写 5 / 7，
  //   李老师按文档验收与对外承诺的安全强度**与实际运行值不符**。与 round61 套件数同族第 14 例。
  //   ⚠️ 本条由 round60 立的元守卫 `check_suite_coverage.js` **当场抓出**（首报「未挂 SUITES」），
  //   是第 4 例「判据存在 ≠ 被自动执行」的第三次复发、也是元守卫第二次自证价值。
  ['admin-auth-params',      'tools/check_admin_auth_params.js'],

  // 第 80 套件（round73 新增，R107）：套件断言数口径守卫 tools/check_suite_assert_counts.js
  ['suite-assert-counts',    'tools/check_suite_assert_counts.js'],
  // 第 81 套件（round74 新增，R108）：云函数 selftest 通过数口径守卫 tools/check_fn_selftest_counts.js
  //   —— 根因＝POC2 七函数 selftest 实跑 108 项而重启键仍写 83 项，
  //   通过数是**下界**，写低了 ⇒ 25 条断言静默丢失仍判绿（与第 13/15 例同族，向云函数层推广）
  ['fn-selftest-counts',     'tools/check_fn_selftest_counts.js'],
  // 第 82 套件（round76 新增，R109）：状态陈述矛盾守卫 tools/check_stale_status.js
  //   —— 根因＝core/13「决策与待办总览」§6 标题仍写「下一批待修…本轮正式排进"下一批"」，
  //   而同节正文早已写「2026-09-19 round39 已修复」+ 27 行落地明细；页脚两段带日期的警告
  //   也仍称 §5「未决策、未处置」、§6/§7「均为待修」（三者均已于 09-19 闭环）。
  //   即「事项闭环后只改正文、标题/页脚停在旧时态」，同族病第 17 例（前 16 例多为数字漂移，
  //   本例是时态漂移），A–L 无一组可测。判据见该文件头注释。
  ['stale-status-guard',     'tools/check_stale_status.js'],
  // 第 83 套件（round78 新增，R110）：收入渠道字典口径守卫 tools/check_income_channel_seed.js
  //   —— 根因＝前端 terms 堂食 7 项 / 后端种子 SEED_INCOME_ITEMS 堂食 5 项，**已分叉且零守卫**
  //   （selftest_batch8b 只守前端侧；check_schema_sync 只看集合与索引）。分叉自 round69 起挂 5 轮靠人记。
  //   本守卫**不裁定**哪侧为准：只硬判「原型副本 ≡ 云函数副本」「其他业务收入前后端一致」，
  //   堂食分歧走**冻结 + 防扩散**（差异集合 ≡ core/13 在册集合，双向含僵尸防腐）。
  ['channel-seed-guard',     'tools/check_income_channel_seed.js'],
  // 第 84 套件（round80 新增，R111）：经营红线阈值口径守卫 tools/check_redline_thresholds.js
  //   —— 根因＝M1 开发规范 M1.6「四红线」（房租≤15% / 人工≤20% / 毛利率≥55% / 损耗≤5%）
  //   是模块写码基线里的经营预警口径，当前态只在 M1 规范（表 4 行）与 M3 规范（引用行）两处，
  //   而 tools/ + prototype/ 对这两份**零引用**（round80 引用次数扫描实测 0/0）⇒ 改任一侧无人报警。
  //   裸扫「房租|人工|毛利|损耗 + 数字%」当场误杀 49 处合法口径（S3 测试数据 / 用例损耗 /
  //   PRODUCT_PLAN 另一套警戒线）⇒ 走语义标记单源 + 弱面只明示（坑⑭ 第八次印证）。
  ['redline-thresholds',     'tools/check_redline_thresholds.js'],
  // 第 85 套件（round81 新增，R112）：微信审核硬红线口径守卫 tools/check_audit_redlines.js
  //   —— 根因＝`core/11_微信审核自查清单.md` §2「审核硬红线清单」自称「权威计数」且是**提审前逐条勾的面**，
  //   实扫 6 条；而 `tools/`+`prototype/` 对 core/11 **零引用**，既有的 R100 `check_redline_inventory.js`
  //   把 LIST_REL 写死为 `core/04`，**不看 core/11 一个字** ⇒ 该口径长期零守卫（同族病第 19 例）。
  //   ⚠️ 当前实扫**零漂移**（全仓仅清单标题一处提及）⇒ 本守卫是**防复发**，不是修缺陷。
  //   裸扫「N 条红线」会误杀重启键演进链里的历史值（12/11）⇒ 走语义标记 + 锚点就近 ±30（坑⑭/⑯）。
  ['audit-redlines',         'tools/check_audit_redlines.js'],
  // 第 86 套件（round82 新增，R113）：限流阈值口径守卫 tools/check_rate_limit_params.js
  //   —— 根因＝`RATE_LIMITED` 的「写操作 > 60 次/分钟（openid 维度）」是批次 0 投喂基线 §2.2.5 明写的口径、
  //   且落在这份统一错误码表（对外契约）里；代码单源 `common/rateLimit.js` 的 `MAX_WRITES=60`/`WINDOW_MS=60000`
  //   连同 42 份扁平副本 `cx_rateLimit.js` 实扫零漂移，但 `tools/`+`prototype/`+verify_all 对 `MAX_WRITES` **零引用**
  //   ⇒ 把阈值改成 600（限流形同虚设）或 6（正常用户被拒），文档仍写 60、门禁全绿（同族病第 20 例，防护性边界口径）。
  //   ⚠️ 当前实扫**零漂移**（43 处同值）⇒ 本守卫是**防复发**，不是修缺陷。
  //   裸扫「60」会误杀 `60 * 1000` / 60rpx / 7 天 24h 等合法口径 ⇒ 走语义标记 + 锚点就近 ±40（坑⑭/⑯）。
  ['rate-limit-params',      'tools/check_rate_limit_params.js'],
  ['waimai-spec-sync',       'tools/check_waimai_spec_sync.js'],
  // ===== R85 · 月度录入页「外卖段」取数与录入（规范 §A.11：快速/分项模式互斥 · 粘贴提取求和 · 配平软提示 · 活动补贴自动带出）=====
  // ⚠️ 追加在 SUITES 末尾：R92/C3 守卫对既有「第 N 套件」序号声明有硬依赖，中间插入会打乱序号。
  ['r85-takeaway',           'tools/selftest_r85.js'],
  // 后续批次的套件在此追加即可（如 batch2_selfcheck ...）；追加后记得同步头部注释里的套件数量。
  // ===== R115 主题色单源守卫：app.wxss 头部声明「旧橘黄已全量下线」但 tools/ 零引用 ⇒ 长期零守卫；
  //   round86 R85 当场复发（input.wxss 新引入旧橘黄且门禁 88/88 全绿）⇒ 去注释后扫全仓生效样式。
  ['theme-color', 'tools/check_theme_color.js'],
  // ===== R117 免费店铺数口径穿透守卫（同族病第 21 例，round88）：「M1 免费 1 个账套」在代码侧有
  //   两个互不引用的硬编码点（checkQuota::FREE_LIMIT.shop 与 getShopList::FREE_SHOP_LIMIT）；批次 A1 配置化后两者都读 feature_permissions.plan_free.limits ⇒ 旧判据退化为恒真，
  //   故 R117 改为「三处消费者必须引用同一配置键」+ 反向断言「不得再现额度字面量」（M3.22#9）。
  ['free-shop-limit', 'tools/check_free_shop_limit.js'],
  // ===== R118 归档补录宽限期口径穿透守卫（同族病第 22 例，round89）：「归档后 7 天内可补录、超过 7 天硬锁」
  //       是 core/13 §3 已锁死决策 + 用户可见承诺 + 写操作拦截边界，实扫却有四类互不引用的落点
  //       （计算常量 GRACE_DAYS_MS / 服务端错误文案 / 前端 i18n 四条 / 决策声明），
  //       `tools/` 对该常量零引用 ⇒ 改任一侧门禁全绿无人报警（承诺与拦截分叉）。
  ['archive-grace',        'tools/check_archive_grace.js'],
  // ===== R119 金额框同行守卫（同族病第 23 例，round92）：见头部注释同名条目。
  //   判据只认 val-input，不得扩大到所有 <input> —— 「细项名 + 删除键」同层是合法设计（A4-④ 有样本钉住）。
  ['amount-input-row', 'tools/check_amount_input_row.js'],
  // ===== R120 外卖账单「粘贴形态」用例表守卫（同族病第 24 例 · 静默算错钱第 3 例，round93）：见头部注释同名条目。
  //   用例表单源 = tools/paste_cases.js（28 条 / A~E 五组）；守卫与 selftest_r85 A24 段跑同一张表。
  //   含 A6 前提证明：B/C 组用例对**旧实现**必须转红 ⇒ 证明本表不是恒真（变异 9 组零异常，见 review/evidence）。
  ['takeaway-paste-cases', 'tools/check_takeaway_paste_cases.js'],
  // ===== R121 费用项清单口径守卫（同族病第 25 例，round97）：见头部注释同名条目。
  //   背景：费用项清单四处副本此前**零守卫**（收入侧 R110 守的是 SEED_INCOME_ITEMS，不看费用侧）。
  ['expense-item-seed', 'tools/check_expense_item_seed.js'],
  // ===== R122 全仓 .js 语法编译守卫（round99）：见头部注释同名条目。
  //   背景：round97 T1 的插入脚本把 pages/month/input.js 的 require 解构**拆成两条** ⇒
  //   微信开发者工具出码时编译失败、小程序根本起不来，而门禁报 94/94 全绿 ——
  //   因为**全仓没有任何套件编译过 .js**（check_requires 只查「require 路径存在」，
  //   前端 pages/ 与 miniprogram/ 又无任何套件 require，只在真机/模拟器里跑）。
  //   判据 = 每个受管 .js 至少能被引擎编译一次（vm.Script 同进程编译，不执行、不 spawn）。
  ['js-syntax', 'tools/check_js_syntax.js'],
  // ===== R123 WXML 结构完整性守卫（同族病第 26 例，round100）：见头部注释同名条目。
  //   背景：round97 T1 的**同一支插入脚本**（为 R85 补互斥 disabled）在把 input.js 的 require
  //   拆成两条（R122 记）之后，**同一轮**又把 pages/month/input.wxml 的金额 <input> 从
  //   **属性集合中间**用 `/>` 收掉 ⇒ 其后属性行成了文本节点，真机渲染出整片英文
  //   （WXML 文本节点仍会插值 {{}} ⇒ 屏上是**求值后**的值，故像"英文报错"）。
  //   判据 A＝裸属性行（上一非空行已闭合）；判据 B＝标签配平（未闭合 / 错配 / 缺 >）。
  ['wxml-struct', 'tools/check_wxml_structure.js'],
  // ===== R124 页面术语键「引用即存在」守卫（同族病第 27 例，round108）：见头部注释同名条目。
  //   根因：WXML 对 `{{undefined}}` **不报错**，静默渲染成空 ⇒「少映射一个术语键」在真机上
  //   表现为**空白按钮 / 空白文案 / 空白 placeholder**。R122 只验 .js 能否编译、R123 只验
  //   属性有没有错成文本，而**没有任何套件检查页面引用的术语键是否真的存在**。
  //   判据 = ① 反查 terms（`TERMS.<组>.<键>` 必须解析得出）+ ② 反查页面 t（wxml 的 `t.<键>`
  //   必须在同页 `t:{}` 里）；配 S1~S4 自失效护栏防扫描面被写窄。
  ['page-terms', 'tools/check_page_terms.js'],
  // ===== R125 流程出口与折叠守卫（同族病第 28 例，round109）：见头部注释同名条目。
  //   根因：李老师一次报四件事（摊销删不掉 / 摊销页零出口 / 外卖假折叠 / 板块无区隔），
  //   全是「代码里明明有路、用户却走不通」。既有前端三守卫（R122 编译 / R123 属性 / R124 术语键）
  //   都只判「能不能跑起来」，**无一条判「走得通」** ⇒ 这四类回归此前是零机器覆盖区。
  //   判据 = A 删除入口（含后端跨月归档锁）/ B 出口（含跳转目标在 app.json 注册）/
  //   C 真折叠（两态顺序 + 摘要按模式分流 + 默认折叠）/ D 一级/二级字号 **语义级**比较；
  //   配 S1~S5 自失效护栏（含 4 组正负样本 + bodyOf 锚定义不锚调用）。
  ['flow-entry-and-fold', 'tools/check_flow_entry_and_fold.js'],
  // ===== R126 餐饮指标参考库口径守卫（同族病第 29 例，round110）：见头部注释同名条目。
  //   背景：M2 v2 新增「分业态 × 分城市层级」参考带 + 城市系数 + 红线副本，落在**两处副本** ——
  //   机器面 cloudfunctions/common/indicatorRef.js 与人读面 M2 规范 §M2.4b 的权威 JSON；
  //   改任一侧另一侧静默过期而门禁全绿（与 round61 套件数 / round64 红线条数 / R111 同族）。
  //   判据 = A 双向逐项（系数 3 档 / 参考带 4×6 / 红线 4，含 key 集合双向）
  //        + B 红线**三方**对齐（code ≡ M2 JSON ≡ M1.6 声明）
  //        + C 行为级（城市敏感性 / 浮点容差钉死样本 / level 边界 / redlineOf / 未填 ≠ 0）
  //        + D 自失效护栏（比较器 5 组正负样本互证 + 真实数据变异 + 对数下界 + 断言数下界）。
  ['indicator-ref', 'tools/check_indicator_ref.js'],
  // ===== R127 对外文案面「零食材成本率」守卫（round111）：见头部注释同名条目。
  //   背景：李老师拍板「指标统一到毛利率、避免食材成本率，客户看不懂」—— 这是**产品口径要求**，
  //   改错了不会让任何数字出错，只是文案退回老说法 ⇒ 数字类判据全抓不到；round111 只在
  //   check_indicator_ref 的 E 段做了 4 个文件的面，全页面层零覆盖。
  //   判据 = A 三面剥注释零命中（pages/miniprogram/utils + 术语镜像）+ 双副本一致
  //        + B 反向护栏（引擎中间量 foodCostPct 必须留 / 前端必须无 / 100− 桥不得回指标层）
  //        + C 正向要求（术语正面叫「菜品毛利率」+ 两张方向表）
  //        + D 自失效护栏（剥注释器 5 例 + 词族 5 例 + 扫描面 ≥70 / 锚点 / 断言数下界）。
  ['no-cost-rate', 'tools/check_m2_no_cost_rate.js'],
  // R128（round114）：M2「参考值只作提示·绝不自动填值」—— round114 的锚点功能把参考金额
  //   显示成输入框灰字起点，而「不自动填值」这条边界当时**零守卫**（回灌 A10/A11 实证）。
  ['ref-not-prefill', 'tools/check_m2_ref_not_prefill.js'],
  // R129（round115）：M1 结果页「行业对照」—— 台账细项 → 指标归属的**静默失效面**。
  //   M1 只有 4 个支出大类（operation/labor/marketing/other），M2 要 5 个成本项 ⇒ 错位；归属靠
  //   `common/indicatorRef.js::ITEM_TAGS` 把**细项名字符串**映射到指标键。
  //   而名字既是可见文案、也是用户可自定义值 ⇒ **用可见文案当机器键 = 改名即静默失效**。
  //   判据 A = 归属表每个名字**必须真实存在于 terms 支出细项**（改名即红）；
  //   另守 `manage` 不进 M1 + `energy` 恰三项 + 结果页零硬编码阈值 + 出参契约。
  ['m1-indicator-view', 'tools/check_m1_indicator_view.js'],
  // R130（round116）：**写库必须用权威主键 `_id`** —— round116 真云实测抠出的**静默失败**。
  //   起因：用户报「M1 行业对照里行业选了没变化」。查下去发现 `saveShopSetting` 的
  //   `doc(shopDoc.id || shopId).update()` 打到了**不存在的 `_id`**：真云 `update()` 对不存在文档
  //   **静默返回 0 行、不抛异常** ⇒ 接口回 SUCCESS、库里一个字没改。
  //   判据：扫全部云函数的 `.doc(<arg>).update|set|remove(`，要求 arg 含 `_id`
  //   或在**所在函数体内**回溯到含 `_id` 的赋值；例外必须白名单且写理由。
  //   同时守：解析器自带钉死样本（含“跨函数同名不串”）+ 白名单无死条目 + 断言数下界。
  ['doc-id-write', 'tools/check_doc_id_write.js'],
  // R131 扩面（round129）：M3 计算引擎多副本行为等价守卫 —— 详见头注 R131 段。
  ['m3-engine-parity', 'tools/check_m3_engine_parity.js'],
];

// 🔒 R59 守卫（自校验）：头部注释「// 串联：N 个套件」必须 ≡ SUITES.length。
// 背景：R21 与 R59 两次都是「增删了套件、忘改注释」⇒ 注释成了不可信的第二个事实源。
// 这里把注释变成被机器校验的对象，从此不再依赖人工记性（同 R50「单源派生」思路）。
(function guardSuiteCount() {
  const src = fs.readFileSync(__filename, 'utf8');
  const m = /^\/\/ 串联：(\d+)\s*个套件/m.exec(src);
  if (!m) {
    process.stdout.write('\n❌ [suite-count] 头部注释缺少「// 串联：N 个套件」一句或格式已变，R59 守卫无法工作\n');
    process.exit(1);
  }
  if (Number(m[1]) !== SUITES.length) {
    process.stdout.write(`\n❌ [suite-count] 头部注释写 ${m[1]} 个套件，实际 SUITES = ${SUITES.length} 个`
      + '（R21/R59：增删套件必须同步该注释）\n');
    process.exit(1);
  }
  process.stdout.write(`\n✅ [suite-count] 头部注释 ≡ SUITES.length = ${SUITES.length}（R59 守卫）\n`);
})();

// 🔒 R92 守卫（自校验）：SUITES 里登记的**每个套件文件都必须已纳入 git 索引**（`git ls-files` 命中）。
// 背景（R92，复审方发现）：AD 缺口 G1~G8 在工作树里全修好了、`verify_all` 也跑出「62/62」，
//   但**代码一个都没提交** ⇒ ① 远端那份是 61 套件且没有 AD 守卫，② 更糟的是它**不会红**：
//   R59 的 guardSuiteCount 比的是「同一份文件内注释数 ≡ SUITES 长度」，未提交时照样 62 ≡ 62。
//   这是 R67 的镜像：那次是「接线了没文件」，这次是「登记了没提交」。
// ⇒ 判据必须是**仓库事实**（git 索引），不能是文件系统事实（存在即算）。
// fail-closed：git 不可用 / 不在仓库内 ⇒ 直接判红（宁可挡住，不放过"证据与被证物分离"）。
(function guardSuiteTracked() {
  let tracked;
  try {
    tracked = new Set(
      execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
        .split('\n').map((s) => s.trim()).filter(Boolean)
    );
  } catch (e) {
    process.stdout.write('\n❌ [suite-tracked] `git ls-files` 执行失败（不在 git 仓库 / git 不可用）'
      + ' —— 无法确认套件文件是否已入库，按 fail-closed 判红。\n');
    process.exit(1);
  }
  const missing = SUITES
    .map((s) => s[1])
    .filter((rel) => rel && !tracked.has(rel.replace(/\\/g, '/')));
  if (missing.length) {
    process.stdout.write(`\n❌ [suite-tracked] 以下 ${missing.length} 个已登记套件**未纳入 git 索引**（R92：登记了没提交 ⇒ `
      + '远端复现不出这些成绩，且 R59 不会红）：\n');
    missing.forEach((rel) => process.stdout.write('   ' + rel + '\n'));
    process.stdout.write('   处置：先 `git add` 并提交这些文件，再跑本校验器。\n');
    process.exit(1);
  }
  process.stdout.write(`✅ [suite-tracked] ${SUITES.length} 个套件文件全部已入库（R92 守卫）\n`);
})();

// 🔒 R66 主体（运行期）：对**每个套件的 stdout** 做「段标题下零断言」审计。
// 背景（R65）：adminExport/selftest.js 曾因「两个顶层 IIFE + 抢先 process.exit」把 R49 段十余条断言腰斩，
//   而该套件 **exit 0、总览全绿** ⇒ 光看退出码/总览**发现不了「断言静默不跑」**。
// 规则：段标题下 ✅ == 0 → 该套件判红并点名标题。
//   ⚠️ 必须豁免「末段汇总行」：每个自测末尾都有 `===== xxx 自测结果：N 通过 / 0 失败 =====`，
//      它本身就是段标题形态、其下天然无 ✅。**按字面规则直接实现会误报 44/52**（本仓实测）。
//   ⚠️ 同理不可写成「任何标题下都必须有 ✅」。豁免条件收紧为：**末段** 且标题含 `N 通过 / M 失败`。
//   兜底：整个套件 ✅ == 0 → 判红（"一条断言都没跑"的终态）。
// 段标题形态仓内并存三种（实测）：`===== x =====` / `========== x ==========` / `--- x ---`（外加门禁用的 ══）。
//   ⚠️ 分隔符与标题之间的空格**可有可无**（仓内两种写法并存：`===== CSV 转义 =====` 与
//      `===== §2.9 角色控权（…）=====`）。首版要求必须有空格 ⇒ 紧贴写法的段**整段识别不到**，
//      故障段恰好落在这一类里 ⇒ 变异回灌仍报绿（实测）。别把 `[ \t]*` 改回 `[ \t]+`。
// 🔒 约定（R66 配套，**已成文**）：套件断言一律以 **✅** 标记。本判据与该符号绑定 ——
//      改用其它符号会被判成「零断言段」= **假红**（方向保守：宁可红，不可漏跑）；
//      写新套件/新段时请沿用 ✅，否则须同时改这里。
const SECTION_HEAD = /^(={3,}|-{3,}|─{3,}|═{3,})[ \t]*(.*?)[ \t]*(={3,}|-{3,}|─{3,}|═{3,})[ \t]*$/;
const SUMMARY_TAIL = /通过\s*\/\s*\d+\s*失败/;
// 🔒 R69（运行期，可选补强）：套件输出必须「走完收尾」—— 末尾 3 个非空行须含 `N 通过`。
//   背景：末块内提前 `process.exit` 时输出被**腰斩在汇总行之前**；若被截断的区间恰好每段都留下过断言，
//   R66 的「段内 ✅==0」就抓不到 ⇒ 需要"收尾行"这个**独立**信号（与 R66 互补）。
//   ⚠️ 实测（2026-09-17，逐套件直采各自 stdout）：**6 个套件不以 `N 通过` 收尾** —— 4 个守卫类各以
//   `✅ …校验通过` 收尾、batch1 用 `✅ 12/12 锚点…全数通过`、门禁 A–L 的 `✅ 全部断言通过` 打在**第 17 行**
//   （明细之前，不在末尾）。⇒ **字面实现会误报 6 个**。
//   处理 = 显式豁免清单 `NO_SUMMARY_TAIL`（逐个写理由），并让**新增套件若既无汇总行又不在清单内 → 判红**
//   （fail-closed：不许"静默不合规"，要么补一条 `N 通过 / M 失败` 收尾行、要么在此显式登记）。
const TAIL_SUMMARY = /\d+\s*通过/;
// ⚠️ 本清单**按路径**登记：移动/改名套件时，若它在此清单内**必须同步改这里的路径**，
//   否则豁免静默失效、该套件转红（方向保守 = 响亮失败而非漏检，但会白折腾一轮）。
//   前例：R55 把 `utils/selftest_batch7.js` 移到了 `tools/`。
//   （复审方 round30 §2 观察；不建议改成按 basename 匹配——那会放松判据。）
const NO_SUMMARY_TAIL = new Set([
  'specs/dev-specs/prototype/check_error_codes.js', // 门禁 A–L：`✅ 全部断言通过` 在第 17 行，其后才是 A–L 逐组明细
  'cloudfunctions/calcMonthlyProfit/selftest.js',   // 收尾 = `✅ 12/12 锚点 + … 全数通过`（写作 12/12，非 "N 通过"）
  'tools/check_requires.js',                        // 收尾 = `✅ 相对 require 全部可解析（扫描 603 个…）`
  'tools/check_pages.js',                           // 收尾 = `✅ 页面声明校验通过（…）`
  'tools/check_compliance.js',                      // 收尾 = `✅ 合规校验通过（…）`
  'tools/check_admincore.js',                       // 收尾 = `✅ 单源派生校验通过：11 份…`
]);
const isDelimOnly = (s) => s === '' || /^[=\-─═]+$/.test(s);
function auditAssertions(out, rel) {
  const text = String(out);
  const secs = [];
  let cur = null;
  for (const ln of text.split(/\r?\n/)) {
    const h = SECTION_HEAD.exec(ln);
    if (h && !isDelimOnly(h[2].trim())) {
      if (cur) secs.push(cur);
      cur = { title: h[2].trim(), marks: (ln.match(/✅/g) || []).length }; // 标题行自身的 ✅ 计入本段
    } else if (cur) { cur.marks += (ln.match(/✅/g) || []).length; }
  }
  if (cur) secs.push(cur);
  const total = (text.match(/✅/g) || []).length;
  const zero = secs.filter((s, i) => s.marks === 0
    && !(i === secs.length - 1 && SUMMARY_TAIL.test(s.title)));
  // R69：末尾 3 个非空行须含 `N 通过`；不在 NO_SUMMARY_TAIL 里又不满足 ⇒ 判"未走完收尾"
  // R70（复审方 round30 提出）：「末尾 3 行」窗口过宽 —— 若某套件**中途**打印过形如 `N 通过` 的行，
  //   且提前退出落在该行之后 3 行以内，窗口仍能命中 ⇒ R69 放行。本仓确有这种中途行：
  //   adminExport 的 `==== adminExport R49 子测：30 通过 / 0 失败 ====` 出现在最终汇总行**之前**。
  //   ⇒ 收紧为「**忽略纯分隔线后的最后 1 行**」，窗口 3 → 1。
  //   零豁免成本（复审方逐套件实测，本侧复核）：剔除纯分隔线后取末行，不满足项恰好仍是原 6 项 ——
  //   verify_seed_data 的末行是纯分隔线 `====…====`，其 `48 通过 / 0 失败` 在上方 2 行，剔掉即自然通过。
  const isDelimRow = (s) => /^[=\-─═\s]{3,}$/.test(s);
  const tail1 = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '' && !isDelimRow(l)).slice(-1);
  const tail = tail1.some((l) => TAIL_SUMMARY.test(l)) || NO_SUMMARY_TAIL.has(rel);
  return { total, zero, sections: secs.length, tail };
}

let failed = 0;
// 第三元素 = 传给该套件的额外 argv（目前只有核对单派生守卫需要 `--check`）。
//   为什么必须显式传：那份文件是**同一份、两种模式** —— 默认模式是"渲染并写出核对单"，
//   若不加 `--check` 就挂进来，每跑一次 verify_all 都会把核对单**覆写一遍**（还顺带
//   改掉时间戳，让"有人偷偷改过"这件事永远无法被发现）。
for (const [name, rel, extra] of SUITES) {
  const fp = path.join(ROOT, rel);
  const argStr = extra && extra.length ? ' ' + extra.join(' ') : '';
  process.stdout.write(`\n===== [${name}] ${rel}${argStr} =====\n`);
  try {
    const out = execFileSync(NODE, [fp].concat(extra || []), { cwd: ROOT, encoding: 'utf8' });
    const audit = auditAssertions(out, rel);   // 🔒 R66/R69：即使 exit 0 也要审「断言是否真跑了 / 是否走完收尾」
    process.stdout.write(out);
    if (audit.zero.length) {
      failed++;
      process.stdout.write(`  [${name}] ❌ FAIL (R66 段标题下零断言：`
        + audit.zero.map((z) => `「${z.title}」`).join('、') + ')  ← 断言疑似静默未跑\n');
    } else if (!audit.tail) {
      failed++;
      process.stdout.write(`  [${name}] ❌ FAIL (R69 输出未走完收尾：末尾 3 行无「N 通过」且不在 NO_SUMMARY_TAIL 内`
        + '  ← 疑似提前退出；要么补一条 `N 通过 / M 失败` 收尾行，要么在 NO_SUMMARY_TAIL 显式登记)\n');
    } else if (audit.total === 0) {
      failed++;
      process.stdout.write(`  [${name}] ❌ FAIL (R66 整段 0 条 ✅ 断言 —— 疑似全程未执行)\n`);
    } else {
      process.stdout.write(`  [${name}] ✅ PASS  (✅ ${audit.total} 条`
        + (audit.sections ? ` / 段 ${audit.sections}` : '') + ')\n');
    }
  } catch (e) {
    failed++;
    const why = e.code ? e.code : ('exit=' + e.status);
    process.stdout.write(`  [${name}] ❌ FAIL (${why})\n`);
    if (!e.stdout && !e.stderr) {
      process.stdout.write(`      ↳ 子进程未产出输出：${String(e.message).split('\n')[0]}\n`);
    }
    if (e.stdout) process.stdout.write(e.stdout.toString());
    if (e.stderr) process.stderr.write(e.stderr.toString());
  }
}

process.stdout.write(`\n===== 总览：${SUITES.length - failed}/${SUITES.length} 套件通过 =====\n`);
process.exit(failed === 0 ? 0 : 1);
