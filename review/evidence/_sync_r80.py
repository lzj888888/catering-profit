# -*- coding: utf-8 -*-
def load(p):
    d = open(p,'rb').read()
    return d, (b'\r\n' if d.count(b'\r\n') == d.count(b'\n') and d.count(b'\n') > 0 else b'\n')

def save(p, d, nl):
    open(p,'wb').write(d)
    d2 = open(p,'rb').read()
    print(p, '写后 CRLF=', d2.count(b'\r\n'), 'LF=', d2.count(b'\n'))

def rep(d, old, new, label):
    o, n = old.encode('utf-8'), new.encode('utf-8')
    if o not in d:
        print('  !! 锚点缺失:', label); return d, False
    print('  ok:', label); return d.replace(o, n, 1), True

# 1) 守卫自述：第 17 例 → 第 18 例（round76 的 R109 已占用第 17 例）
p = 'tools/check_redline_thresholds.js'
d, nl = load(p)
d, _ = rep(d, '同族病第 17 例', '同族病第 18 例', 'R111 自述改第 18 例')
save(p, d, nl)

# 2) verify_all.js：头注计数 + SUITES 追加
p = 'verify_all.js'
d, nl = load(p)
d, _ = rep(d, '串联：83 个套件', '串联：84 个套件', 'verify_all 头注 83→84')
entry = (
"  ['channel-seed-guard',     'tools/check_income_channel_seed.js'],\r\n"
"  // 第 84 套件（round80 新增，R111）：经营红线阈值口径守卫 tools/check_redline_thresholds.js\r\n"
"  //   —— 根因＝M1 开发规范 M1.6「四红线」（房租≤15% / 人工≤20% / 毛利率≥55% / 损耗≤5%）\r\n"
"  //   是模块写码基线里的经营预警口径，当前态只在 M1 规范（表 4 行）与 M3 规范（引用行）两处，\r\n"
"  //   而 tools/ + prototype/ 对这两份**零引用**（round80 引用次数扫描实测 0/0）⇒ 改任一侧无人报警。\r\n"
"  //   裸扫「房租|人工|毛利|损耗 + 数字%」当场误杀 49 处合法口径（S3 测试数据 / 用例损耗 /\r\n"
"  //   PRODUCT_PLAN 另一套警戒线）⇒ 走语义标记单源 + 弱面只明示（坑⑭ 第八次印证）。\r\n"
"  ['redline-thresholds',     'tools/check_redline_thresholds.js'],\r\n"
)
anchor = "  ['channel-seed-guard',     'tools/check_income_channel_seed.js'],\r\n"
if anchor.encode('utf-8') in d:
    d = d.replace(anchor.encode('utf-8'), entry.encode('utf-8'), 1)
    print('  ok: SUITES 追加第 84 套件')
else:
    print('  !! SUITES 锚点缺失')
save(p, d, nl)

# 3) 重启键两处套件数 + 演进链
p = 'specs/dev-specs/★知识存储点_2026-09-10.md'
d, nl = load(p)
d, _ = rep(d, '串 **83** 个套件', '串 **84** 个套件', '重启键 §1.1 83→84')
d, _ = rep(d, '（现 **83**；', '（现 **84**；', '重启键「套件数会漂」83→84')
chain_old = '堂食分歧走冻结 + 防扩散）**'
chain_new = ('堂食分歧走冻结 + 防扩散）** → **84（round80：新增 `tools/check_redline_thresholds.js`，'
             '经营红线阈值口径守卫，R111 —— M1.6 四红线 15/20/55/5 只在 M1 表与 M3 引用行两处、tools/ 零引用；'
             '裸扫必误杀 49 处合法口径 ⇒ 走语义标记单源）**')
d, _ = rep(d, chain_old, chain_new, '重启键演进链补第 84 套件')
save(p, d, nl)
