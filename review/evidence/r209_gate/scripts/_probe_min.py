# -*- coding: utf-8 -*-
# _probe_min.py —— 最小复现：完全复刻 run_gate3.py 的 ENV 构造，先跑几个套件看 spawn 是否可用
#   目的：定位「单独驱动绿 / 串跑红」到底是 ENV 差异，还是跑了一串之后才退化。
import json, os, subprocess, sys

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"

dump_js = r"""
const fs = require('fs');
const src = fs.readFileSync('verify_all.js', 'utf8');
const s = src.indexOf('const SUITES = [');
const e = src.indexOf('\n];', s);
const body = src.slice(s + 'const SUITES = '.length, e + 3);
console.log(JSON.stringify(eval(body)));
"""
open(os.path.join(TMP, "dump_suites.js"), "w", encoding="utf-8").write(dump_js)
p = subprocess.run([NODE, os.path.join(TMP, "dump_suites.js")], cwd=REPO, capture_output=True,
                   text=True, encoding="utf-8")
SUITES = json.loads(p.stdout.strip())

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"
ENV["NODE_OPTIONS"] = "--require " + os.path.join(TMP, "gitcache_preload.js")

SPAWNEY = ['suite-coverage', 'suite-count-claims', 'r85-takeaway', 'doc-suite医科']  # 最后一个故意不存在

def run_one(name, rel):
    fp = os.path.join(REPO, rel)
    r = subprocess.run([NODE, fp], cwd=REPO, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=180, env=ENV)
    out = (r.stdout or '') + (r.stderr or '')
    print('   [{0}] rc={1} EBUSY={2}'.format(name, r.returncode, 'EBUSY' in out))

print('■ 阶段 A：一上来就跑依赖 spawn 的套件')
for name, rel, *rest in SUITES:
    if name in SPAWNEY:
        run_one(name, rel)

print('■ 阶段 B：先跑前 40 个套件（含大量 spawn 消耗），再回头跑 suite-coverage')
cnt = 0
for name, rel, *rest in SUITES:
    if cnt >= 40:
        break
    cnt += 1
    try:
        r = subprocess.run([NODE, os.path.join(REPO, rel)], cwd=REPO, capture_output=True,
                           text=True, encoding="utf-8", errors="replace", timeout=180, env=ENV)
    except subprocess.TimeoutExpired:
        pass
for name, rel, *rest in SUITES:
    if name == 'suite-coverage':
        run_one(name, rel)
        run_one(name, rel)
