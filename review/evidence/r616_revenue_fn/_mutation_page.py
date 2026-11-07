# -*- coding: utf-8 -*-
# R616 页面守卫变异复核（Python 版，避免 shell heredoc 吃反斜杠）
import io, os, subprocess, hashlib

R = os.getcwd()
G = 'tools/check_revenue_page.js'
PAGE = 'subpkg/biz/revenue/index.js'
WXML = 'subpkg/biz/revenue/index.wxml'
FN = 'cloudfunctions/importSalesBill/index.js'
HUBJS = 'pages/m3/hub.js'
FILES = [PAGE, WXML, FN, HUBJS]

O = {p: io.open(p, 'rb').read() for p in FILES}
H = {p: hashlib.md5(v).hexdigest() for p, v in O.items()}


def run():
    r = subprocess.run(['node', G], cwd=R, stdout=subprocess.PIPE,
                       stderr=subprocess.STDOUT, timeout=180)
    return r.returncode, r.stdout.decode('utf-8', 'replace')


def restore():
    for p in FILES:
        io.open(p, 'wb').write(O[p])
    for p in FILES:
        assert hashlib.md5(io.open(p, 'rb').read()).hexdigest() == H[p], '还原失败 ' + p


MAIN_LINE = "  mainText: money(m1.totalYuan),"
SEG_COMMENT = "  // ===== 5. 分流：营收日报表（R616）→ 堂食菜品表（批次 G）→ 外卖账单（批次 F）====="

MUT = [
    ('① 主数摆成「现金流入」（把含充值的数当营收）', PAGE,
     MAIN_LINE, "  mainText: money(ci.totalYuan),", 'B-①'),
    ('② 删掉差额展示（只给两个数让老板自己猜）', WXML,
     '<text class="rev-cmp-v {{r.diffUp ? \'up\' : \'down\'}}">{{r.diffText}}</text>',
     '<text class="rev-cmp-v"></text>', 'A-⑤'),
    ('③ 删掉口径提醒（「充值不算收入」这句话没了）', WXML,
     '<view class="rev-tip">{{t.caliberTip}}</view>',
     '<view class="rev-tip"></view>', 'A-⑦'),
    ('④ 营收分支前插一次菜品识别（会被先截走）', FN,
     SEG_COMMENT,
     '  const _earlyDish = detectDishMatrix(matrix);\n' + SEG_COMMENT, 'C-②'),
    ('⑤ 页面写死金额（图省事硬编码真数据）', PAGE,
     MAIN_LINE, "  mainText: '64,547.08', // 硬编码", 'A-⑩'),
    ('⑥ 差额桥去掉零值过滤（满屏「＋0.00」）', PAGE,
     'const m1Over = (br.m1Over || []).filter((x) => Number(x.yuan) > 0)',
     'const m1Over = (br.m1Over || []).filter(() => true)', 'B-⑥'),
    ('⑦ hub 里写死卡名（不经术语单源）', HUBJS,
     '      revenueTitle: TERMS.hub.revenueTitle,',
     "      revenueTitle: '营收看板',", 'D-③'),
    ('⑧ 云函数把整表 shifts 外发', FN,
     '        shiftCount: (revOut.shifts || []).length,',
     '        shifts: revOut.shifts,\n        shiftCount: (revOut.shifts || []).length,', 'C-④'),
]

rc0, _ = run()
print('守卫基线 RC=%d（应 0）' % rc0)
assert rc0 == 0

hits = 0
try:
    for name, tgt, old, new, want in MUT:
        s = O[tgt]
        ob = old.encode('utf-8')
        nb = new.encode('utf-8')
        n = s.count(ob)
        assert n == 1, '锚点 %d 次: %s' % (n, name)
        io.open(tgt, 'wb').write(s.replace(ob, nb, 1))
        rc, out = run()
        red = [l.strip() for l in out.splitlines() if '❌' in l]
        named = any(want in l for l in red)
        print('\n  %s' % name)
        print('    期望 %s 红 => %s | 实际红项 %d 条'
              % (want, '命中 OK' if named else '未命中 FAIL', len(red)))
        for l in red[:2]:
            print('      ' + l[:112])
        if named:
            hits += 1
        restore()
finally:
    restore()

rc1, _ = run()
print('\n还原后 RC=%d（应 0）' % rc1)
print('页面变异复核：%d/%d 精确命中' % (hits, len(MUT)))
assert hits == len(MUT) and rc1 == 0
print('PASS 四份源码逐字节还原')
