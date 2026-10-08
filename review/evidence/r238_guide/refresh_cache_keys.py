# -*- coding: utf-8 -*-
"""refresh_cache_keys.py —— R238：**增量刷新** gitcache 里指定的键（不跑全量重建）。

WHY（本轮实测订正，非推测）：
  改过 `tools/**` 下任一**套件**之后，`node tools/check_suite_assert_counts.js` 的「实跑」一步
  会经 `gitcache_preload.js` 拿到**磁盘缓存里那份（过期的）结果** ⇒
  于是出现「我单独跑是 15/0 绿、门禁里却报 rc≠0」的**假红**。
  ⇒ 正解不是改判据、也不是改业务代码，而是**把缓存刷成当前真值**。
  `rebuild_cache.py` 是**全量**重建（本轮实测 18 分钟，其中绝大多数时间花在与本次改动无关的键上）
  ⇒ 本脚本只刷「本轮真正变过的键」，语义与 `rebuild_cache.py::run()` 逐字一致（同 ENV、同 preload、同 cwd）。

绝不伪造：值一律由本机真跑产生（同 rebuild_cache.py 的纪律）。

运行：python review/evidence/r238_guide/refresh_cache_keys.py
"""
import json
import os
import subprocess

REPO = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP = r"C:/Users/lzj/AppData/Local/Temp/inscode"
NODE = r"C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
PRELOAD = os.path.join(TMP, "gitcache_preload.js")
CACHE = os.path.join(TMP, "gitcache.json")
ARCH = os.path.join(REPO, "review/evidence/r238_guide/gitcache_rebuilt.json")

# 本轮真正变过的套件（改动 → 输出必然变）：
#   check_modal_button_len      : 12→15 断言（新增页面局部别名支持 + C-⑥ 防腐化）
#   check_shape_machine_value   : 12→18 断言（新增 E 组）
#   check_suite_assert_counts   : 上面两个的声明同步（它自己的输出也变）
TARGETS = ["check_modal_button_len.js", "check_shape_machine_value.js", "check_suite_assert_counts.js"]

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([r"C:\Program Files\Git\bin", r"C:\Program Files\Git\cmd"]) + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONIOENCODING"] = "utf-8"
ENV["NODE_OPTIONS"] = "--require " + PRELOAD


def run_key(key):
    """与 rebuild_cache.py::run() 对 node.exe 键的处理逐字一致。"""
    parts = key.split(" ")
    argv = [NODE] + parts[1:]
    r = subprocess.run(argv, cwd=REPO, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=ENV, timeout=600)
    return {"rc": r.returncode, "out": r.stdout, "err": r.stderr}


def main():
    cache = json.load(open(CACHE, encoding="utf-8"))
    print("刷新前 keys =", len(cache))

    # 先刷「被 spawn 的」两个，最后刷 check_suite_assert_counts
    #   （它的实跑依赖前者在缓存里的新值 ⇒ 顺序有意义，不是随手排的）
    order = ["check_modal_button_len.js", "check_shape_machine_value.js", "check_suite_assert_counts.js"]
    for name in order:
        keys = [k for k in cache if k.startswith("node.exe") and k.endswith(name)]
        if not keys:
            print(f"  ⚠️ 缓存中无该键：{name}（跳过）")
            continue
        for k in keys:
            old_rc = cache[k].get("rc")
            new = run_key(k)
            cache[k] = new
            print(f"  {name:34s} rc {old_rc} → {new['rc']}"
                  + ("  ✅" if new["rc"] == 0 else "  ❌"))
        json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)

    json.dump(cache, open(ARCH, "w", encoding="utf-8"), ensure_ascii=False)
    bad = sorted(k for k, v in cache.items() if v["rc"] != 0)
    print("刷新后 keys =", len(cache), "| rc!=0 =", len(bad))
    for k in bad:
        print("   ! rc=%s %s" % (cache[k]["rc"], k[:110]))
    print("已写回:", CACHE)


main()
