# -*- coding: utf-8 -*-
# R210 六处同步（+CASES）：两阶段写入 —— 先全量校验每个锚点命中 == 1，再统一落盘。
import io, os, sys

REPO = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit'
VA = os.path.join(REPO, 'verify_all.js')
KEY = os.path.join(REPO, 'specs', 'dev-specs', '★知识存储点_2026-09-10.md')
CNT = os.path.join(REPO, 'tools', 'check_suite_assert_counts.js')

def rd(p):
    return io.open(p, 'r', encoding='utf-8', newline='').read()

# ---------- 锚点定义 ----------
SUITE_OLD = "  ['month-picker',          'tools/check_month_picker.js'],\n];"
SUITE_NEW = ("  ['month-picker',          'tools/check_month_picker.js'],\n"
             "  ['shop-reset',           'tools/check_shop_reset.js'],\n];")

HEAD_OLD = '// 串联：134 个套件 = 6 个 specs 套件'
HEAD_NEW = '// 串联：135 个套件 = 6 个 specs 套件'

# 说明段：在 R209 那条末尾追加 R210 条目
DESC_OLD = 'D 组管 wxml 用 monthIndex 变量取选中项；18 条断言，变异回灌 3/3 全部点名目标断言）'
DESC_NEW = ('M3 高亮不跟随→A-⑤）**\n'
            '//       + 清空月度账守卫（tools/check_shop_reset.js，R210：**给"删除店铺"配一条轻得多的第二条出口** ——\n'
            '//         起因＝李老师「对于有一个店的餐饮老板，删除店铺是删除不了的」。R208 虽然已把末店放开，\n'
            '//         但老板点删除九成想要的是「把账重做一遍」，不该被迫把整家店删掉 ⇒ 新增 op=reset / op=stats：\n'
            '//         **店铺 / 菜品成本卡 / 原料档案全部保留**，只软删月度账三张表。\n'
            '//         🔴 本守卫最硬的一条：清空的刀必须落在月度账三表上，**绝不能碰到成本卡与原料** ——\n'
            '//           那是老板一条条录进去的资产，而「顺手再多塞两个集合名」在实现上零痛感、却永久丢数据。\n'
            '//         判据 = S 自失效护栏 + A 实跑 decideReset（边界成对 / truncated 必拦 / 脏值 fail-closed）\n'
            '//              + B 实跑 validateInput（🔴负样本必须带合法 name，否则被下一道 name 校验兜住 ⇒ 判据恒真）\n'
            '//              + C 范围恰三表且不含资产表 + D 前端三按钮与「先查量级再确认」的数据流\n'
            '//              + E 文案报的是量级不是空话 + F 后端路由与写库纪律（listAll / _id / stats.updated）；\n'
            '//         51 条断言，变异回灌 12/12 全部点名目标断言）')

KEY1_OLD = '（仓库根；串 **134** 个套件'
KEY1_NEW = '（仓库根；串 **135** 个套件'

KEY_DESC_OLD = 'S 扫描面非退化 + A 结构 + B 跳转方式 + C 自反锚点，16 断言）。'
KEY_DESC_NEW = ('18 条；变异回灌 3/3 全部点名目标断言：M1 改回裸传→A-①②③④⑤+C-② / M2 去掉 early return→A-③A-④ / M3 高亮不跟随→A-⑤）**'
                '。 ⚠️ R210 再增第 135 个套件 `shop-reset`（`tools/check_shop_reset.js`，清空月度账守卫 —— 起因＝李老师「有一个店的餐饮老板删除店铺是删除不了的」；给「删除店铺」补一条轻得多的第二条出口 op=reset（保留店铺/成本卡/原料，只软删月度账三表），并把删除确认框改成**真查量级再确认**。判据＝S 自失效护栏 + A 实跑 decideReset + B 实跑 validateInput + C 范围绝不含资产表 + D 前端三按钮与 fail-closed 数据流 + E 文案含量级 + F 写库纪律；51 断言，变异回灌 12/12）**')

CASE_OLD = '`check_month_picker`=18（**四十七者**均 ≡ 实跑 pass 数'
CASE_NEW = '`check_month_picker`=18 / `check_shop_reset`=51（**四十八者**均 ≡ 实跑 pass 数'

DRIFT_OLD = '（现 **134**；'
DRIFT_NEW = '（现 **135**；'

CHAIN_OLD = 'M3 高亮不跟随→A-⑤）**'
CHAIN_NEW = ('M3 高亮不跟随→A-⑤）** → **135（R210：新增 `tools/check_shop_reset.js`，清空月度账守卫 —— '
             '起因＝李老师「对于有一个店的餐饮老板，删除店铺是删除不了的」；R208 虽已放开末店可删，但老板点删除九成是要「重做一遍账」'
             '⇒ 补第二条出口 op=reset / op=stats（保留店铺与成本卡、原料，只软删月度账三表 + 确认框真报月数量级）。'
             '判据六组 51 条：S 自失效护栏 / A 实跑 decideReset（含 truncated 与边界成对）/ B 实跑 validateInput'
             '（🔴负样本必须带合法 name，否则「非法 op」与「缺 name」撞同一个错误码 ⇒ 判据恒真，本次回灌实测三条变异全绿才发现）/ '
             'C 清空范围恰三表且**绝不含** shop_cost_card / shop_material / D 前端三按钮与 months<0 的 fail-closed / '
             'E 文案真的把月数插值输出 / F 写库纪律（listAll + row._id + 逐行核 stats.updated + 零物理删除）；'
             '变异回灌 12/12 全部点名目标断言，md5 全等还原）**')

CNT_OLD = "  { key: 'check_month_picker', rel: 'tools/check_month_picker.js' },"
CNT_NEW = ("  { key: 'check_month_picker', rel: 'tools/check_month_picker.js' },\n"
           "  { key: 'check_shop_reset', rel: 'tools/check_shop_reset.js' },")

PLAN = [
    (VA,   SUITE_OLD, SUITE_NEW, 'SUITES 末尾'),
    (VA,   HEAD_OLD,  HEAD_NEW,  '头注串联数'),
    (VA,   DESC_OLD,  DESC_NEW,  '头注说明段'),
    (KEY,  KEY1_OLD,  KEY1_NEW,  '重启键入口行套件数'),
    (KEY,  KEY_DESC_OLD, KEY_DESC_NEW, '重启键入口行说明'),
    (KEY,  CASE_OLD,  CASE_NEW,  '重启键断言数声明行'),
    (KEY,  DRIFT_OLD, DRIFT_NEW, '重启键套件数会漂行'),
    (KEY,  CHAIN_OLD, CHAIN_NEW, '重启键演进链尾'),
    (CNT,  CNT_OLD,   CNT_NEW,   'CASES 登记'),
]

# ---------- 阶段一：全量校验 ----------
texts = {}
bad = []
for p, old, new, tag in PLAN:
    if p not in texts:
        texts[p] = rd(p)
    n = texts[p].count(old)
    print('%-24s 锚点命中 = %d  %s' % (tag, n, 'OK' if n == 1 else 'FAIL'))
    if n != 1:
        bad.append(tag)
if bad:
    print('\n锚点不唯一，一个文件都不写：', bad)
    sys.exit(2)

# ---------- 阶段二：在内存中改完再统一落盘 ----------
out = dict(texts)
for p, old, new, tag in PLAN:
    out[p] = out[p].replace(old, new, 1)

for p in out:
    io.open(p, 'w', encoding='utf-8', newline='').write(out[p])
print('\n已落盘：')
for p in out:
    print('  ' + os.path.relpath(p, REPO))
