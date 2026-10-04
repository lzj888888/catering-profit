# -*- coding: utf-8 -*-
# R210 变异回灌：逐条把实现改回错误写法，验证 check_shop_reset.js 点名到目标断言。
# 铁律：① 每条独立 ② 锚点命中 == 1 ③ 必须点名目标断言 ④ 字节级还原（md5 全等）
import io, os, hashlib, subprocess, sys, re

REPO = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit'
NODE = r'C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe'
GUARD = 'tools/check_shop_reset.js'

def rd(p):
    return io.open(p, 'r', encoding='utf-8', newline='').read()

def wr(p, s):
    io.open(p, 'w', encoding='utf-8', newline='').write(s)

def md5(p):
    return hashlib.md5(io.open(p, 'rb').read()).hexdigest()

def run_guard():
    env = dict(os.environ)
    env['PYTHONIOENCODING'] = 'utf-8'
    r = subprocess.run([NODE, GUARD], cwd=REPO, capture_output=True,
                       text=True, encoding='utf-8', errors='replace', timeout=180, env=env)
    out = (r.stdout or '') + (r.stderr or '')
    reds = set()
    for line in out.splitlines():
        line = line.strip()
        if line.startswith('\u274c'):
            m = re.match(r'\u274c\s+([A-Z]-\S+)', line)
            if m:
                reds.add(m.group(1))
    return r.returncode, reds, out

MUTS = [
    # (编号, 文件, 旧串, 新串, 期望转红的断言集合)
    ('M1', os.path.join(REPO, 'cloudfunctions/manageShop/service.js'),
     "const RESET_COLLECTIONS = ['shop_monthly_account', 'shop_monthly_income', 'shop_monthly_expense'];",
     "const RESET_COLLECTIONS = ['shop_monthly_account', 'shop_monthly_income', 'shop_monthly_expense', 'shop_cost_card'];",
     {'C-①', 'C-②', 'C-⑥'}),

    ('M2', os.path.join(REPO, 'cloudfunctions/manageShop/service.js'),
     "  const tooMany = truncated || rows > RESET_MAX_ROWS;",
     "  const tooMany = rows > RESET_MAX_ROWS;",
     {'A-⑤'}),

    ('M3', os.path.join(REPO, 'cloudfunctions/manageShop/service.js'),
     "    allowed: months > 0 && !tooMany,",
     "    allowed: !tooMany,",
     {'A-②'}),

    # M4a：白名单**方向搞反**（经典 bug）—— `OPS.indexOf(op)` 写成 `o.indexOf(op)`
    #      ⇒ 's' 成了 'stats' 的子串而被放行；'clean' 仍被拒（不是任何合法 op 的子串）
    ('M4a', os.path.join(REPO, 'cloudfunctions/manageShop/validate.js'),
     "  if (OPS.indexOf(op) < 0) return err('op 必须是 create / rename / delete / reset / stats 之一');",
     "  if (typeof op !== 'string' || !OPS.some((o) => String(o).indexOf(op) >= 0)) return err('op 必须是 create / rename / delete / reset / stats 之一');",
     {'B-⑧'}),

    # M4b：白名单**退化成首字母匹配** ⇒ 'clean'（c 开头）也被放行
    ('M4b', os.path.join(REPO, 'cloudfunctions/manageShop/validate.js'),
     "  if (OPS.indexOf(op) < 0) return err('op 必须是 create / rename / delete / reset / stats 之一');",
     "  if (typeof op !== 'string' || !OPS.some((o) => o.charAt(0) === op.charAt(0))) return err('op 必须是 create / rename / delete / reset / stats 之一');",
     {'B-⑤', 'B-⑧'}),

    ('M4c', os.path.join(REPO, 'cloudfunctions/manageShop/validate.js'),
     "  if (OPS.indexOf(op) < 0) return err('op 必须是 create / rename / delete / reset / stats 之一');",
     "  if (typeof op !== 'string' || !OPS.some((o) => o.toLowerCase() === String(op).toLowerCase())) return err('op 必须是 create / rename / delete / reset / stats 之一');",
     {'B-⑤'}),

    ('M5', os.path.join(REPO, 'pages/shop/switch.js'),
     "    const months = await this.fetchImpact(id);\n    if (months < 0) return;\n    if (months === 0) { wx.showToast({ title: this.data.t.resetNoData, icon: 'none' }); return; }",
     "    const months = await this.fetchImpact(id);\n    if (months === 0) { wx.showToast({ title: this.data.t.resetNoData, icon: 'none' }); return; }",
     {'D-⑤'}),

    ('M6', os.path.join(REPO, 'pages/shop/switch.js'),
     "      content: this.data.t.resetAsk(months),",
     "      content: '确定清空这家店的月度账吗？',",
     {'D-⑦'}),

    ('M7', os.path.join(REPO, 'cloudfunctions/manageShop/index.js'),
     "    const all = await da.listAll(coll, { shop_id: target, is_deleted: false });",
     "    const all = await da.list(coll, { shop_id: target, is_deleted: false });",
     {'F-⑤'}),

    ('M8', os.path.join(REPO, 'cloudfunctions/manageShop/index.js'),
     "    if (done !== ids.length) {\n      return fail(ERROR_CODES.SYSTEM_ERROR, '月度账未完全清空（' + coll + '：' + done + '/' + ids.length + '）');\n    }",
     "    if (false) {\n      return fail(ERROR_CODES.SYSTEM_ERROR, '月度账未完全清空（' + coll + '：' + done + '/' + ids.length + '）');\n    }",
     {'F-⑦'}),

    ('M9', os.path.join(REPO, 'cloudfunctions/manageShop/index.js'),
     "  if (v.op === 'stats') return onStats(da, target);\n",
     "",
     {'F-①', 'F-②'}),

    ('M10', os.path.join(REPO, 'miniprogram/i18n/terms.js'),
     "    resetAsk: (months) => '清掉这家店 ' + months + ' 个月的月度账？店铺名、菜品成本卡、原料档案都留着，只是账本归零，可以马上重录。',",
     "    resetAsk: () => '清掉这家店的月度账？此操作不可恢复。',",
     {'E-①', 'E-④'}),
]

BASE = {}
for tag, p, old, new, exp in MUTS:
    BASE.setdefault(p, rd(p))
    if BASE[p].count(old) != 1:
        print('ANCHOR FAIL', tag, 'count=', BASE[p].count(old), 'file=', os.path.basename(p))
        sys.exit(2)
print('锚点自校验通过：%d 条全部命中 == 1' % len(MUTS))

HASH0 = {p: md5(p) for p in BASE}
results = []
for tag, p, old, new, exp in MUTS:
    src = BASE[p]
    wr(p, src.replace(old, new, 1))
    try:
        rc, reds, out = run_guard()
    finally:
        wr(p, src)                       # 无条件还原
    hit = exp & reds
    ok = rc == 1 and len(hit) == len(exp)
    results.append((tag, ok, rc, sorted(reds), sorted(exp)))
    print('%s rc=%s 期望=%s 实红=%s %s' % (tag, rc, sorted(exp), sorted(reds), 'OK' if ok else 'FAIL'))
    if md5(p) != HASH0[p]:
        print('  !! 还原不成立', tag, os.path.basename(p))
        sys.exit(3)

print('\n--- 还原校验 ---')
for p in BASE:
    same = md5(p) == HASH0[p]
    print('  %-42s %s' % (os.path.relpath(p, REPO), 'md5 一致' if same else 'MD5 不一致'))
    if not same:
        sys.exit(4)

bad = [t for t, ok, *_ in results if not ok]
print('\n变异回灌：%d/%d 全部点名目标断言' % (len(results) - len(bad), len(results)))
if bad:
    print('未达标：', bad)
    sys.exit(5)
