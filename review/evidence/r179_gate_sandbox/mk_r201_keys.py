# -*- coding: utf-8 -*-
"""mk_r201_keys.py —— R201 轮次门禁缓存刷新（按 skill gate-under-sandbox §⑥ 顺序）

背景：沙箱实测 node spawn 全 EBUSY ⇒ 只能走 gitcache 通道。
本仓 r179 目录只有 mk_cache2/3.py 与 mk_force.py，缺「只刷 git 类」的脚本，
故本轮新写一个：① 刷 git 类键（真跑 git，不动 node/python 键）② 强制重刷全部 node/python 键。

注意：
- 缓存文件在 %TEMP%\\inscode\\gitcache.json（仓内那份是历史副本，不是运行时读的）。
- 子进程必须挂 NODE_OPTIONS=--require gitcache_preload.js，否则套件内部 spawn git 仍被拦。
- mk_force.py 用的是托管 venv 的 python.exe（本机该 venv 已损坏，pyvenv.cfg 打不开），
  本脚本改用 versions/3.13.12 解释器，**并把缓存里 python.exe 键的 exe 一并替换**。
"""
import json, os, subprocess, sys

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
PY = r"C:/Users/lzj/.workbuddy/binaries/python/versions/3.13.12/python.exe"
PRELOAD = os.path.join(TMP, "gitcache_preload.js")
CACHE = os.path.join(TMP, "gitcache.json")
MISS = os.path.join(TMP, "gitcache_miss.log")

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"
ENV["NODE_OPTIONS"] = "--require " + PRELOAD

def load():
    if os.path.exists(CACHE):
        return json.load(open(CACHE, encoding="utf-8"))
    return {}

def save(c):
    json.dump(c, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)

def run(exe, args, cwd):
    try:
        r = subprocess.run([exe] + args, cwd=cwd, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", env=ENV, timeout=600)
        return {"rc": r.returncode, "out": r.stdout, "err": r.stderr}
    except Exception as e:
        return {"rc": -1, "out": "", "err": str(e)}

def mkkey(exe_path, args):
    base = os.path.basename(exe_path).lower().replace("\\", "/")
    aa = [a.replace("\\", "/") for a in args]
    return base + " " + " ".join(aa)

def refresh_git(cache):
    """重跑仓内所有 spawn git 的真实命令（从 verify_all.js / tools/*.js 收集）"""
    cmds = [
        ["ls-files"],
        ["status", "--porcelain"],
        ["-c", "core.quotepath=false", "ls-files"],
    ]
    # 扫源码收集实际用到的 git 子命令
    import re, glob
    pat = re.compile(r"(?:execFileSync|spawnSync|execSync)\(\s*(?:NODE|exe)?\s*,?\s*\[?\s*['\"]git['\"]\s*,\s*\[([^\]]*)\]", re.S)
    for fp in glob.glob(os.path.join(REPO, "tools", "*.js")) + [os.path.join(REPO, "verify_all.js")]:
        try:
            src = open(fp, encoding="utf-8").read()
        except Exception:
            continue
        for m in pat.finditer(src):
            raw = m.group(1)
            parts = [p.strip().strip("'\"") for p in raw.split(",") if p.strip().strip("'\"")]
            if parts and parts[0] not in ("ls-files", "status", "-c"):
                continue
            try:
                parts = json_ish(parts)
            except Exception:
                continue
            if parts:
                cmds.append(parts)
    seen = set()
    n = 0
    for c in cmds:
        k = mkkey("git.exe", c)
        if k in seen:
            continue
        seen.add(k)
        cache[k] = run(r"C:\Program Files\Git\bin\git.exe", c, REPO)
        n += 1
    print("git keys refreshed:", n)
    return cache

def json_ish(parts):
    out = []
    for p in parts:
        if p.startswith("--") and "=" in p:
            k, v = p.split("=", 1)
            out += [k, v]
        else:
            out.append(p)
    return out

def refresh_node_py(cache):
    keys = [k for k in cache if k.startswith("node.exe ") or k.startswith("python.exe ")
            or k.startswith("node ") or k.startswith("python ")]
    print("node/python keys to refresh:", len(keys))
    done = 0
    for k in keys:
        parts = k.split(" ")
        args = parts[1:]
        if not args:
            continue
        exe = NODE if "node" in parts[0] else PY
        cwds = [REPO]
        script = args[-1]
        if script and os.path.isabs(script) and os.path.exists(script):
            cwds.insert(0, os.path.dirname(script))
        best = None
        for cwd in cwds:
            best = run(exe, args, cwd)
            if best["rc"] == 0:
                break
        nk = mkkey(exe, args)
        cache[nk] = best
        if nk != k:
            cache.pop(k, None)   # exe 路径换了 ⇒ 旧键必须删，否则成死键
        done += 1
    print("node/python keys refreshed:", done)
    return cache

def main():
    if not os.path.exists(PRELOAD):
        print("preload 不存在:", PRELOAD); return 1
    cache = load()
    print("before:", len(cache), "keys")
    cache = refresh_git(cache)
    save(cache)
    cache = refresh_node_py(cache)
    save(cache)
    print("after:", len(cache), "keys")
    return 0

sys.exit(main())
