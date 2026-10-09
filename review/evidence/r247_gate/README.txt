R247 · 形态 C 平台 picker 一致性守卫 + 清 R245 死代码残骸
============================================================
日期：2026-10-09
触发：李老师「听你的安排」（承 R246「其他的按你的节奏操作」）
基线：dev@dadc889 → 本轮提交见 git log

【本轮做了什么】

A. 新增守卫 tools/check_picker_platform.js（15 断言；SUITES 展示名 picker-platform）

  根因（R246 接京东时发现的**静默链**）：形态 C（外卖商品销量）必须由用户**手选平台**，
  picker 的 value 与「云端 enum」「术语单源」之间有三个**全静默**的失效点：

    ① picker value 越出 SALES_SCHEMA.platform.enum ⇒ 云函数校验直接拒收
       （用户只看到「平台不合法」，不知道是选项本身写错了）
    ② picker value 缺 reviewPlatformNames 键 ⇒ `label: NAMES[v] || v` **回落成机器值**
       ⇒ 界面直接显示 `jd_sku` 这种字样（R246 接京东时实测到的真实坑）
    ③ 云端 enum **新增**平台而 picker 没加 ⇒ 新平台在导入页**根本选不到**，
       而门禁全绿、页面零报错 ⇒ 纯静默缺失

  三条此前均无任何既有套件在守（check_shape_machine_value 只守 DISH_SHAPES 三值）。

  判据（判行为不判字面 —— 提出两侧真实取值做集合关系，而非查源码里有没有某个字符串）：
    S 扫描面：三源文件都读到 + picker>=4 / enum>=6 / 术语键>=4 三道**下界护栏**（防扫空恒绿）
    A 正向：picker ⊆ enum & 每项有术语键（⇒ label 不回落机器值）& label 非空 & label ≠ value
    B 反向：picker 不含 pos；enum 中未进 picker 的成员必须逐一在 **PICKER_EXCLUDED** 内；
            且 PICKER_EXCLUDED ⊆ enum（防写错 key 永不自知）
    C 自检：4 条合成样本（正样本零问题 + 三种退化必判出）—— 证明判定**有分辨力**，不是恒绿

  数据面（实测）：picker = [meituan, eleme, taobao, jd_sku, other]；
    enum = [taobao, meituan, jd_order, jd_sku, eleme, pos, other]；
    术语键 = [taobao, meituan, eleme, jd_order, jd_sku, other]；
    排除名单 = [pos, jd_order]（pos 堂食 / jd_order 是账单走对账路，均有意不进本 picker）。

B. 清 R245（平台档案化 P1~P8）的死代码残骸

  全仓 grep **零引用**、且不在 `module.exports` 的两处映射表（sheet 名与列名 R245 已全部
  收进 `PLATFORM_PROFILE[]`，detectPlatform / pickSheet 直接读档案）：

    cloudfunctions/importSalesBill/service.js::COL / SHEET
    utils/billParse.js::COL / SHEET          ← 同源副本，同步删

  两处均改为一句话注释（说明"为何删、谁在替代"），便于存档追溯。
  ⚠️ importSalesBill/ 本就在 A15 白名单内（R181l 登记）⇒ 该目录内改动不触发 A15。
  ⚠️ 删后复跑：check_js_syntax 1/0 · selftest_bill_parse 39/0 · check_formc_parse 27/0 ·
     check_formc_shape 21/0（全部 rc=0）。

【变异回灌】review/evidence/r247_gate/mut_r247.py —— 9 条，逐条独立、锚点命中==1、还原用字节

  组 A（期望红，判据 = 点名到**目标断言号**）7/7 全部点名：
    M1 picker 加 enum 外的值 ghost            → A-①
    M2 picker 混入堂食平台 pos                → B-①
    M3 术语单源删掉 eleme 键                  → A-②（label 回落机器值的形态）
    M4 云端 enum 新增 douyin（守护面不动）      → B-②
    M5 守卫排除名单删掉 jd_order（造无归属）    → B-②
    M6 守卫排除名单塞进 enum 外的 ghost         → B-③
    M7 守卫 S-② 下界改大 4→99                 → S-②（证明下界断言非恒真）
  组 B（期望绿，防假红）2/2 如期保持绿：
    B1 picker 顺序调换（等价改写）
    B2 术语**显示名**改写（只改值不改键）
  还原后 ❌=0 / 崩溃=False；git status 无变异残留。

【六处同步面】（挂新套件的固定动作，缺一处必红）
  1. verify_all.js::SUITES 末尾追加 ['picker-platform', 'tools/check_picker_platform.js']
  2. verify_all.js 头注「// 串联：N 个套件」153 → 154
  3. verify_all.js 头注注释块补 R247 条目（人读面）
  4. 重启键 §1.1「一键校验入口」行：串 **153** → **154** + 追加该守卫一句话说明
  5. 重启键「套件数会漂」行：现 **153** → **154**；演进链尾补
     **153（R234/M2v1.4 此前漏记）** + **154（R247 本轮）**
  6. 重启键 §1.1 断言数声明行：追加 `check_picker_platform`=15，「六十四者」→「六十五者」
  （另：tools/check_suite_assert_counts.js::CASES 追加同名项 —— 与第 6 处必须同批改）

【门禁】见 gate_full.txt（本轮**原生** node verify_all.js —— 探针矩阵
  git.exe / cmd.exe / where.exe / node.exe 全部 ok ⇒ 沙箱禁派生限制本轮未生效，
  走原生路径判据最硬、零缓存风险）。

  🔴 **判据：`===== 总览：154/154 套件通过 =====` + `RC=0` + 失败清单为空**（三条全中）。
  耗时 3m50s（原生 / 无缓存回放）。
  新套件在门禁中的三处留痕（可核）：
    · 第 2738 行  `· tools/check_picker_platform.js → 15 通过`
    · 第 2810 行  `✅ A2-check_picker_platform 声明 15 ≡ 实跑 15`（第 6 处同步被机器验证）
    · 第 5770 行  `===== [picker-platform] tools/check_picker_platform.js =====`
    · 第 5796 行  `[picker-platform] ✅ PASS  (✅ 15 条 / 段 4)`
  逐套件明细全部落在 gate_full.txt 内（原生 verify_all 不另生成 per_suite 目录）。
  提交前元守卫快检：check_suite_coverage 10/0 · check_suite_count_claims 11/0 ·
  check_suite_assert_counts 73/0。

  🔁 **提交后复跑（第二次 —— 工作树干净 + 证据文件已入库，扫描面变了）**：
  同样 **154/154 · RC=0 · 失败清单为空**（3m56s）。
  两次输出**逐字比对**的唯一差异是测试里**随机生成**的 user_id / 时间戳（非确定性样本），
  其余全等 ⇒ 证据文件入库**未引入任何回归**。复跑原文见 `gate_recheck.txt`。
  （依据：门的 §18.1 时序陷阱 —— 门禁跑完后新写的文档/证据必须**再跑一次**才算数。）

【文件清单】
  README.txt               本文件
  gate_full.txt            原生门禁完整 stdout + RC（5799 行，含逐套件段）
  gate_recheck.txt         提交后复跑的门禁 stdout + RC（同上，154/154）
  mut_r247.py              变异回灌脚本（可复现）
  patch_verify_all.py      verify_all.js 四处同步的两阶段断言式补丁
  patch_restart_key.py     重启键三处同步的两阶段断言式补丁

【未做 / 待办】
  - 真样例回归：京东秒送账单 + 美团商品销量表（**待李老师发原始文件**）——
    R245 已写好京东两形态解析器，但只有空表，无真样例验不了。
  - R246 残留的「picker 一致性守卫」待办由本轮消化完毕（该条关闭）。
