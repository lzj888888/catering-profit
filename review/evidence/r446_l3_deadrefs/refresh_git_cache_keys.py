# -*- coding: utf-8 -*-
"""刷新 gitcache.json 里两条 `git ls-files` 键（真跑 git，原样落 rc/out/err）。

为什么需要这一步：`mk_force.py` 只重跑 `node.exe` / `python.exe` 开头的键（见其 docstring），
`git ...` 键永远保留最初快照 ⇒ 之后新入库的跟踪文件不在缓存清单里
⇒ `check_suite_coverage` 的 S7 把已登记 EXEMPT 的取证脚本误判成「僵尸条目」（假红）。
本轮实测：缓存 9118 行 / 实时 9314 行，缺 review/evidence/r444_runway/ 两个文件。
"""
import json, subprocess

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
P = TMP + "/gitcache.json"

TARGETS = {
    "git ls-files": ["ls-files"],
    "git -c core.quotepath=false ls-files": ["-c", "core.quotepath=false", "ls-files"],
}

cache = json.load(open(P, encoding="utf-8"))
for k, args in TARGETS.items():
    r = subprocess.run(["git"] + args, cwd=REPO, capture_output=True)
    out = r.stdout.decode("utf-8", "replace")
    err = r.stderr.decode("utf-8", "replace")
    old = cache.get(k, {}).get("out", "")
    cache[k] = {"rc": r.returncode, "out": out, "err": err}
    print("%-42s rc=%d  旧 %d 行 → 新 %d 行  含 r444_runway=%s" % (
        k, r.returncode, old.count("\n"), out.count("\n"),
        "r444_runway/verify_judge_enc" in out))
json.dump(cache, open(P, "w", encoding="utf-8"), ensure_ascii=False)
print("written:", P)
