# -*- coding: utf-8 -*-
# 逐个复跑红套件：单独驱动 vs 全序列，判断是"真红"还是"preload 缓存/抖动"
import io, os, subprocess, sys

REPO = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit'
NODE = r'C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe'
TMP = r'C:/Users/lzj/AppData/Local/Temp/inscode'

RED = [
    'specs/dev-specs/prototype/check_error_codes.js',
    'tools/selftest_ui_fix.js',
    'tools/selftest_batch8b.js',
    'tools/selftest_batch8c.js',
    'tools/selftest_ad_gates.js',
    'tools/check_terms_forbidden.js',
    'tools/selftest_r85.js',
    'tools/check_takeaway_paste_cases.js',
    'tools/check_m2_no_cost_rate.js',
]

env = dict(os.environ)
env['PATH'] = os.pathsep.join([r'C:\Program Files\Git\bin', r'C:\Program Files\Git\cmd']) + os.pathsep + env.get('PATH', '')
env['PYTHONIOENCODING'] = 'utf-8'
env['NODE_OPTIONS'] = '--require ' + os.path.join(TMP, 'gitcache_preload.js')

for rel in RED:
    r = subprocess.run([NODE, rel], cwd=REPO, capture_output=True,
                       text=True, encoding='utf-8', errors='replace', timeout=300, env=env)
    out = (r.stdout or '') + (r.stderr or '')
    tail = [l.strip() for l in out.splitlines() if l.strip()][-6:]
    red_lines = [l.strip() for l in out.splitlines() if l.strip().startswith('\u274c')]
    print('=' * 70)
    print(rel, 'rc =', r.returncode)
    if red_lines:
        for l in red_lines[:6]:
            print('   R| ' + l[:180])
    else:
        for l in tail:
            print('   ' + l[:180])
