# -*- coding: utf-8 -*-
# _mk_add_key.py —— 给沙箱 preload 缓存补 R209 新套件的 key
# WHY：gitcache_preload.js 对**未命中**一律 fail-closed ⇒ `check_suite_assert_counts.js` 内部
#      spawn 新套件拿不到输出 ⇒ 报「声明 18 ≠ 实跑 undefined」（假红，非代码缺陷）。
#      值必须由 Python 侧**真跑**出来 —— 不许手写常量。
import json, os, subprocess

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
CACHE = r"C:/Users/lzj/AppData/Local/Temp/inscode/gitcache.json"
ABS = os.path.join(REPO, 'tools/check_month_picker.js').replace('\\', '/')

KEYS = [
    'node.exe ' + ABS,
    'node.exe tools/check_month_picker.js',
    'node ' + ABS,
]

cache = json.load(open(CACHE, encoding='utf-8'))
for k in KEYS:
    parts = k.split(' ')
    exe, args = parts[0], parts[1:]
    exe_path = NODE if exe.lower().startswith('node') else exe
    r = subprocess.run([exe_path] + args, cwd=REPO, capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=180)
    cache[k] = {"rc": r.returncode, "out": r.stdout, "err": r.stderr}
    print('+ {0}  rc={1} len(out)={2}'.format(k, r.returncode, len(r.stdout)))
    print('    末行: ' + (r.stdout.strip().splitlines() or [''])[-1][:120])

json.dump(cache, open(CACHE, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('written:', CACHE, 'size =', len(cache))
