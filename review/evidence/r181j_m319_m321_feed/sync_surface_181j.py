# -*- coding: utf-8 -*-
"""R181j 批次 E 验收：一次性同步面补丁（两阶段：先全校验、再统一落盘）。

覆盖 4 个文件、共 15 处：
  verify_all.js（3）  · 重启键（4）  · check_suite_assert_counts.js（1）  · 提审材料（7）
套件数 118 → 120（新增 m3-impact=17 / m3-recon=16）。
"""
import io, sys

ROOT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/'
VT = ROOT + 'verify_all.js'
KEY = ROOT + 'specs/dev-specs/★知识存储点_2026-09-10.md'
CASES = ROOT + 'tools/check_suite_assert_counts.js'
MAN = ROOT + 'specs/dev-specs/上线材料_提审材料包_v1.md'


def load(p):
    with io.open(p, 'r', encoding='utf-8', newline='') as f:
        return f.read()


def save(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)


def sub1(files, path, old, new, tag):
    """自适应行尾：锚点先按原样找，找不到再试 CRLF 变体（本仓文件是混合行尾）。"""
    s = files[path]
    for o, n, nl in ((old, new, 'LF'), (old.replace('\n', '\r\n'), new.replace('\n', '\r\n'), 'CRLF')):
        c = s.count(o)
        if c == 1:
            files[path] = s.replace(o, n)
            print(u'  OK %-30s [%s]' % (tag, nl))
            return
    n0 = s.count(old)
    n1 = s.count(old.replace('\n', '\r\n'))
    raise AssertionError(u'%s：锚点命中 LF=%d / CRLF=%d（应为 1）\n>>>>%s<<<<' % (tag, n0, n1, old[:160]))


print(u'== 载入 ==')
files = {p: load(p) for p in (VT, KEY, CASES, MAN)}
for p in files:
    print(u'  %-70s %d 字符' % (p.split('/')[-1], len(files[p])))

# 🔴 本仓文件是**混合行尾**（verify_all.js 实算 CRLF 675 / LF 765）⇒ 锚点与插入内容**一律用 '\n'**，
#    由 sub1() 自适应（匹配到 CRLF 分支时会把 new 的 \n 一并转成 \r\n）。
NL_VT = NL_KEY = NL_CASES = NL_MAN = '\n'
print(u'  行尾策略：锚点统一 LF，由 sub1 自适应')

print(u'== A. verify_all.js ==')
# A1 头注「串联：118 个套件」
sub1(files, VT, u'// 串联：118 个套件 = ', u'// 串联：120 个套件 = ', 'A1 头注串联数 118→120')

# A2 头注注释块追加两条新守卫说明（锚点=上一条守卫说明的末句）
A2_OLD = (u'//         其 A-③/A-④ 已改为**从 ALIASES 派生**断言（写死候选数会逼后人「改断言迎合代码」）。')
A2_NEW = A2_OLD + NL_VT + (
    u'//       + M3.19 原料变动影响面守卫（tools/selftest_m3_impact.js，R181j：**只读 dry-run 预览**）——\n'
    u'//         原料改价 ⇒ 用同一份 rebuildSnapshotLines + calcCostCard 复算「用到该原料的卡」的新成本/新毛利率，\n'
    u'//         并标出是否跌破该业态参考带下限（下限取自 common/indicatorRef.js::BANDS）。\n'
    u'//         判据 = C-a/C-a2 两组锚点（鸡胸肉 15→20/25 元每斤 ⇒ 976…1208…1444 分）+ dry_run 分支**零写库**（静态扫，\n'
    u'//         排除内存 Map.set）+ C-b **未挂牌价必须回 null 且抑制 below_band**（引擎在 priceFen=0 时返 0，裸比较必误标）。\n'
    u'//       + M3.21 M1↔M3 率对率对账守卫（tools/selftest_m3_recon.js，R181j）——\n'
    u'//         新单源 utils/reconDerive.js（纯计算，不落库、不进云函数、无 specs 副本）：菜单毛利率 / 实际菜品毛利率 / 对账。\n'
    u'//         判据 = D 锚点（菜单 64.84% / 实际 54.08% / 差 −9.84pp）+ **覆盖率闸门 fail-closed**（<60% 或缺分母 ⇒ 抑制差值）\n'
    u'//         + 套餐默认排除 + 细项名取 TERMS 单源（防改名静默失效）+ 除零/空账回 null（不许返回 0）。'
)
sub1(files, VT, A2_OLD, A2_NEW, 'A2 头注补两条守卫说明')

# A3 SUITES 末尾追加两条（必须追加末尾：C3 对第 N 套件序号有硬依赖）
A3_OLD = u"  ['m3-takeaway', 'tools/selftest_m3_takeaway.js']," + NL_VT + u'];'
A3_NEW = (u"  ['m3-takeaway', 'tools/selftest_m3_takeaway.js']," + NL_VT +
          u'  // M3.19（批次 E · 原料变动与影响面）：C-a/C-a2 两组锚点 + dry_run 零写库 + 未挂牌价抑制。' + NL_VT +
          u"  ['m3-impact', 'tools/selftest_m3_impact.js']," + NL_VT +
          u'  // M3.21（批次 E · M1↔M3 率对率对账）：D 锚点 + 覆盖率闸门 + 套餐排除 + 细项名单源。' + NL_VT +
          u"  ['m3-recon', 'tools/selftest_m3_recon.js']," + NL_VT +
          u'];')
sub1(files, VT, A3_OLD, A3_NEW, 'A3 SUITES 追加 m3-impact / m3-recon')

print(u'== B. 重启键 ==')
# B1 §1.1 一键校验入口行
sub1(files, KEY, u'（仓库根；串 **118** 个套件 = ', u'（仓库根；串 **120** 个套件 = ',
     'B1 §1.1 入口行 118→120')

# B2 断言数声明行：追加两键 + 「三十四者」→「三十六者」
B2_OLD = u'/ `selftest_m3_takeaway`=21（**三十四者**均 ≡ 实跑 pass 数'
B2_NEW = (u'/ `selftest_m3_takeaway`=21 / `selftest_m3_impact`=17 / `selftest_m3_recon`=16'
          u'（**三十六者**均 ≡ 实跑 pass 数')
sub1(files, KEY, B2_OLD, B2_NEW, 'B2 断言数声明 +2 键、三十四→三十六')

# B3 「套件数会漂」行
sub1(files, KEY, u'（现 **118**；2026-09-17 由 41 → 45', u'（现 **120**；2026-09-17 由 41 → 45',
     'B3 套件数会漂 118→120')

# B4 演进链尾部追加两条（锚点=链尾 118 那条的末句）
B4_OLD = u'实算 T-a~T-g 锚点）**'
B4_NEW = B4_OLD + (
    u' → **119（round181j：新增 `tools/selftest_m3_impact.js`，M3.19 原料变动影响面守卫 —— dry-run 只读分支零写库'
    u'（静态扫，排除内存 Map.set）+ 未挂牌价回 null 且抑制 below_band（C-b：引擎在 priceFen=0 时返 0，裸比较必误标）+ '
    u'C-a/C-a2 两组锚点，17 条断言）** → **120（round181j：新增 `tools/selftest_m3_recon.js`，M3.21 M1↔M3 率对率对账守卫 —— '
    u'覆盖率闸门 fail-closed（<60% 或缺分母 ⇒ 抑制）+ 套餐默认排除 + 细项名取 TERMS 单源 + 除零/空账回 null，16 条断言）**'
)
sub1(files, KEY, B4_OLD, B4_NEW, 'B4 演进链补 119/120')

print(u'== C. check_suite_assert_counts.js ==')
C1_OLD = u"  { key: 'selftest_m3_takeaway', rel: 'tools/selftest_m3_takeaway.js' }, // 21 条（M3.17：T-a~T-g）" + NL_CASES + u'];'
C1_NEW = (u"  { key: 'selftest_m3_takeaway', rel: 'tools/selftest_m3_takeaway.js' }, // 21 条（M3.17：T-a~T-g）" + NL_CASES +
          u"  { key: 'selftest_m3_impact', rel: 'tools/selftest_m3_impact.js' }, // 17 条（M3.19：C-a/C-a2/C-b/dry-run）" + NL_CASES +
          u"  { key: 'selftest_m3_recon', rel: 'tools/selftest_m3_recon.js' }, // 16 条（M3.21：D 锚点 + 闸门）" + NL_CASES +
          u'];')
sub1(files, CASES, C1_OLD, C1_NEW, 'C1 CASES 追加两条')

print(u'== D. 提审材料 ==')
sub1(files, MAN, u'| 功能页面清单 | 🟢 已整理 | — | 19 个页面，见 §4',
     u'| 功能页面清单 | 🟢 已整理 | — | 21 个页面，见 §4', 'D1 §0 总表 19→21')
sub1(files, MAN, u'（19 个页面里无 login/register）', u'（21 个页面里无 login/register）',
     'D2 §3 页面数陈述 19→21')
sub1(files, MAN, u'## 四、功能页面清单（19 页，', u'## 四、功能页面清单（21 页，', 'D3 §4 标题 19→21')
sub1(files, MAN, u'本节表格共登记 **19** 个页面', u'本节表格共登记 **21** 个页面',
     'D4 §4 单源声明 19→21')

# D5 表格插两行 + 原 17/18/19 重编号为 19/20/21
D5_OLD = (u'| 16 | `pages/takeaway/index` | 外卖单均测算（M3：选菜品/套餐 + 包材 + 平台参数 ⇒ 到手/总额双口径结果 + 挂牌价反算；试算不落库） | 可选 |' + NL_MAN +
          u'| 17 | `pages/pay/orders` | 订单记录（付费相关，见 §6） | 可选 |' + NL_MAN +
          u'| 18 | `pages/shop/switch` | 店铺切换 | 可选 |' + NL_MAN +
          u'| 19 | `pages/mine/index` | 我的（版本/反馈/免责声明/注销） | 可选 |')
D5_NEW = (u'| 16 | `pages/takeaway/index` | 外卖单均测算（M3：选菜品/套餐 + 包材 + 平台参数 ⇒ 到手/总额双口径结果 + 挂牌价反算；试算不落库） | 可选 |' + NL_MAN +
          u'| 17 | `pages/metrics/impact` | 涨价影响面（M3：原料改价 ⇒ 用到的成本卡新成本 / 新毛利率 + 是否跌破业态参考带下限；**只读预览，绝不自动改卡**） | 可选 |' + NL_MAN +
          u'| 18 | `pages/recon/index` | M1↔M3 对率对账（M3 标准菜单毛利率 vs M1 实际菜品毛利率 + 覆盖率闸门 + 归因清单；只读对照） | 可选 |' + NL_MAN +
          u'| 19 | `pages/pay/orders` | 订单记录（付费相关，见 §6） | 可选 |' + NL_MAN +
          u'| 20 | `pages/shop/switch` | 店铺切换 | 可选 |' + NL_MAN +
          u'| 21 | `pages/mine/index` | 我的（版本/反馈/免责声明/注销） | 可选 |')
sub1(files, MAN, D5_OLD, D5_NEW, 'D5 §4 表格插两行 + 重编号')

sub1(files, MAN, u'）：19 页的 `.js/.wxml/.json/.wxss` **零缺失**',
     u'）：21 页的 `.js/.wxml/.json/.wxss` **零缺失**', 'D6 §4 自检 19 页→21 页')
sub1(files, MAN, u'`pages/*.js` 内 35 处 `/pages/...` 引用 ⇒ 唯一 19 个目标',
     u'`pages/**` 内 37 处 `/pages/...` 引用 ⇒ 唯一 21 个目标', 'D7 §4 跳转统计 35/19→37/21')

print(u'\n== 落盘 ==')
for p, s in files.items():
    save(p, s)
    print(u'  写入 %-70s %d 字符' % (p.split('/')[-1], len(s)))
print(u'\nDONE —— 全部 15 处锚点校验通过并已落盘')
