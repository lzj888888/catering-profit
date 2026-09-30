# -*- coding: utf-8 -*-
"""mk_fix_py_keys.py —— 修补 mk_force.py 无法正确重跑的两条 python 缓存键：
  · `python.exe tools/verify_docx.py`              （重跑后 rc 已变化）
  · `python.exe -c import docx`                    （mk_force 按空格拆参 ⇒ 变成 `-c import` 语法错）
真跑、真录，不伪造。
"""
import json, os, subprocess

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
CACHE = r"C:/Users/lzj/AppData/Local/Temp/inscode/gitcache.json"
PY = r"C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe"

ENV = dict(os.environ)
ENV["PYTHONIOENCODING"] = "utf-8"

runs = {
    "python.exe tools/verify_docx.py": [PY, "tools/verify_docx.py"],
    "python.exe -c import docx": [PY, "-c", "import docx"],
}

cache = json.load(open(CACHE, encoding="utf-8"))
for key, argv in runs.items():
    r = subprocess.run(argv, cwd=REPO, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=ENV, timeout=300)
    cache[key] = {"rc": r.returncode, "out": r.stdout, "err": r.stderr}
    print(f"{key}  ->  rc={r.returncode}  len(out)={len(r.stdout)}")

json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("written:", CACHE)
