# -*- coding: utf-8 -*-
"""round85 独立复核 round84 守卫 R114（check_waimai_spec_sync.js）的双向变异回灌。
字节级快照还原（坑⑳：不用 git checkout，避免 autocrlf 反向改行尾）。
"""
import subprocess, sys, os

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
NODE = 'node'
SPEC = os.path.join(ROOT, r'specs\dev-specs\core\开发规范v1.0_ModuleA_收入费用核算.md')
TERMS = os.path.join(ROOT, r'miniprogram\i18n\terms.js')
CF = os.path.join(ROOT, r'cloudfunctions\initDb\collections.js')
GUARD = os.path.join(ROOT, r'tools\check_waimai_spec_sync.js')
OUT = os.path.join(ROOT, r'review\evidence\selfdrive_20260922_r85\mutation_r85.txt')

snap = {}
for p in (SPEC, TERMS, CF, GUARD):
    with open(p, 'rb') as f:
        snap[p] = f.read()

def restore_all():
    for p, b in snap.items():
        with open(p, 'wb') as f:
            f.write(b)

def apply(path, old, new, count=1):
    """字节级替换；返回是否命中"""
    b = snap[path] if path not in _cur else _cur[path]
    o = old.encode('utf-8'); n = new.encode('utf-8')
    if b.count(o) < 1:
        return False
    nb = b.replace(o, n, count)
    _cur[path] = nb
    with open(path, 'wb') as f:
        f.write(nb)
    return True

_cur = {}

def run_guard():
    r = subprocess.run([NODE, os.path.join('tools', 'check_waimai_spec_sync.js')],
                       cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='ignore')
    txt = (r.stdout or '') + (r.stderr or '')
    last = [l for l in txt.splitlines() if '通过 /' in l]
    return r.returncode, (last[-1].strip() if last else txt.strip()[-200:])

lines = []
def log(s):
    print(s)
    lines.append(s)

# (id, 描述, 期望, [(path, old, new), ...])
CASES = [
    ('M1', '规范 A.11.2 平台名漂移（美团外卖→美团外送）', 'RED',
     [(SPEC, '| 1 | 美团外卖 |', '| 1 | 美团外送 |')]),
    ('M2', '规范 A.11.3 item_key 漂移（subsidy→subsidy_x）', 'RED',
     [(SPEC, '`exp_mkt_takeaway_subsidy`', '`exp_mkt_takeaway_subsidy_x`')]),
    ('M3', '代码单源 terms.js 平台名漂移（美团外卖→美团外送）', 'RED',
     [(TERMS, "items: ['美团外卖', '淘宝闪购'", "items: ['美团外送', '淘宝闪购'")]),
    ('M4', '代码单源 collections.js item_name 漂移（外卖推广费→外卖推广费用）', 'RED',
     [(CF, "item_name: '外卖推广费'", "item_name: '外卖推广费用'")]),
    ('M5', '规范 A.11.2 删一行表格（4→3）', 'RED',
     [(SPEC, '| 4 | 其他外卖 | 同上（私域自配送等归此，或按 A.1「私域外卖」单列） |\r\n', '')]),
    ('M6', '规范 A.11.3 显示名漂移（外卖平台佣金→外卖佣金）', 'RED',
     [(SPEC, '| 外卖平台佣金 |', '| 外卖佣金 |')]),
    ('M7', '正确实现换写法：规范平台名加粗 **美团外卖**', 'GREEN',
     [(SPEC, '| 1 | 美团外卖 |', '| 1 | **美团外卖** |')]),
    ('M8', '正确实现换写法：collections.js sort_order 改成 1..6（相对顺序不变）', 'GREEN',
     [(CF, 'sort_order: 10', 'sort_order: 1'), (CF, 'sort_order: 20', 'sort_order: 2'),
      (CF, 'sort_order: 30', 'sort_order: 3'), (CF, 'sort_order: 40', 'sort_order: 4'),
      (CF, 'sort_order: 50', 'sort_order: 5'), (CF, 'sort_order: 60', 'sort_order: 6')]),
    ('M9', 'fail-closed：守卫 SPEC_REL 路径写错', 'RED',
     [(GUARD, "开发规范v1.0_ModuleA_收入费用核算.md'", "开发规范v1.0_ModuleA_收入费用核X.md'")]),
]

# 基线
restore_all(); _cur = {}
rc0, t0 = run_guard()
log('BASELINE rc=%d  %s' % (rc0, t0))

abnormal = 0
for cid, desc, expect, edits in CASES:
    restore_all(); _cur = {}
    ok_all = True
    missing = []
    for (p, o, n) in edits:
        if o.encode('utf-8') not in snap[p]:
            missing.append(o[:40]); ok_all = False
        else:
            apply(p, o, n)
    if not ok_all:
        log('%s  MUTATION_NOT_APPLIED  锚点缺失=%s' % (cid, missing))
        abnormal += 1
        continue
    rc, t = run_guard()
    actual = 'GREEN' if rc == 0 else 'RED'
    verdict = 'OK' if actual == expect else 'MISMATCH'
    if verdict != 'OK':
        abnormal += 1
    log('%s  %-6s expect=%-5s actual=%-5s  %s  | rc=%d %s' % (cid, verdict, expect, actual, desc, rc, t))
    restore_all(); _cur = {}

restore_all()
rc_f, t_f = run_guard()
log('RESTORED rc=%d  %s' % (rc_f, t_f))
log('ABNORMAL=%d' % abnormal)

with open(OUT, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines) + '\n')
print('\nWROTE ' + OUT)
