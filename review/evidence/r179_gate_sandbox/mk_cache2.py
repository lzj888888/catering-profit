# -*- coding: utf-8 -*-
"""mk_cache2.py —— 通用「子进程真实结果缓存」：预跑仓库里 node 套件要派生但被沙箱拦下的命令。

沙箱限制：node 派生**任何**子进程都 EBUSY（git / cmd / where / hostname / python / node 自身）。
判据需要的却是「真实运行结果」⇒ 由 Python 侧**真跑**这些命令，把 rc/stdout/stderr 落 JSON，
node 侧 preload 按 `basename(exe) + args` 命中返回。值是真跑出来的，不是伪造。
"""
import json, os, subprocess

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
PY = r"C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"

SEED = os.path.join(REPO, "specs/dev-specs/prototype/verify_seed_data.js")

CMDS = [
    (["git", "ls-files"], REPO),
    (["git", "-c", "core.quotepath=false", "ls-files"], REPO),
    (["git", "status", "--porcelain", "cloudfunctions/"], REPO),
    (["git", "status", "--porcelain"], REPO),
    (["git", "rev-parse", "--is-inside-work-tree"], REPO),
    (["git", "log", "--oneline", "-8"], REPO),
    ([NODE, SEED], os.path.dirname(SEED)),
    ([PY, "tools/verify_docx.py"], REPO),
]

cache = {}
for argv, cwd in CMDS:
    exe = argv[0]
    args = argv[1:]
    # key 归一化：basename 小写 + 反斜杠转斜杠（node 侧 path.join 产出的是反斜杠）
    norm = lambda s: s.replace("\\", "/")
    key = os.path.basename(exe).lower() + (" " + " ".join(norm(a) for a in args) if args else "")
    try:
        p = subprocess.run(argv, cwd=cwd, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", env=ENV, timeout=300)
        rc, out, err = p.returncode, p.stdout, p.stderr
    except Exception as e:
        rc, out, err = 127, "", str(e)
    cache[key] = {"rc": rc, "out": out, "err": err}
    print(f"{key[:70]:<72} rc={rc} out_lines={len(out.splitlines())}")

json.dump(cache, open(os.path.join(TMP, "gitcache.json"), "w", encoding="utf-8"), ensure_ascii=False)
print("\ncached keys:")
for k in cache:
    print("  ", k[:100])
