# -*- coding: utf-8 -*-
# _mk_add_docxkey.py —— 补/刷新 docx 守卫所需的 python 类 key（值一律 Python 侧**真跑**出来）
import json, os, subprocess

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
PY = r"C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
CACHE = r"C:/Users/lzj/AppData/Local/Temp/inscode/gitcache.json"

JOBS = [
    # (cache key, argv)  —— key 的形态必须与 preload 的 keyOf 一致：basename(exe) + ' ' + args.join(' ')
    ('python.exe -c import docx', [PY, '-c', 'import docx']),
    ('python.exe tools/verify_docx.py', [PY, 'tools/verify_docx.py']),
    ('python.exe C:/Users/lzj/WorkBuddy/Claw/catering-profit/tools/verify_docx.py',
     [PY, os.path.join(REPO, 'tools/verify_docx.py').replace('\\', '/')]),
]

cache = json.load(open(CACHE, encoding='utf-8'))
for key, argv in JOBS:
    try:
        r = subprocess.run(argv, cwd=REPO, capture_output=True, text=True,
                           encoding='utf-8', errors='replace', timeout=180)
        rc, out, err = r.returncode, r.stdout, r.stderr
    except Exception as e:
        rc, out, err = 127, '', str(e)
    cache[key] = {"rc": rc, "out": out, "err": err}
    print('+ {0}  rc={1} len(out)={2}'.format(key, rc, len(out)))
    tail = [l for l in (out or '').splitlines() if l.strip()][-2:]
    for t in tail:
        print('     ' + t.strip()[:150])

json.dump(cache, open(CACHE, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('written, size =', len(cache))
