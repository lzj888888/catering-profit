# -*- coding: utf-8 -*-
"""R188 仓库卫生整理：把「过程件」以【移动】方式归档到仓外 _archive（零删除、可还原）

原则（技能 repo-hygiene-backup）：
  · 零删除 —— 一律 move 到仓外同级 _archive/r188_hygiene/<原相对路径>，需要时可原样搬回
  · 零误伤 —— 只动「git 未跟踪」的文件；已入库的判据文件逐个打印并跳过
  · 可自证 —— 移动前记录 (路径, size, md5)，移动后逐条比对目标文件

用法：
  python _r188_hygiene.py          # dry-run，只打印计划
  python _r188_hygiene.py --apply  # 真正执行
"""
import os, sys, subprocess, hashlib, shutil

ROOT = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit"
ARCH = r"C:/Users/lzj/WorkBuddy/Claw/_archive/r188_hygiene"
APPLY = "--apply" in sys.argv

def git(args):
    r = subprocess.run(["git", "-c", "core.quotepath=false"] + args, cwd=ROOT,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    return r.stdout

def tracked_set():
    s = set()
    for line in git(["ls-files"]).splitlines():
        if line.strip():
            s.add(os.path.normpath(line.replace("/", os.sep)))
    return s

def md5(p, chunk=1 << 20):
    h = hashlib.md5()
    with open(p, "rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()

def mb(n):
    return round(n / 1048576.0, 2)

TARGETS = [
    ("_m3", "all"),                                   # 116 MB 过程件（已在 .gitignore）
    (os.path.join("review", "evidence", "r86_timeout_20260919"), "png"),   # 86 MB 过程截图
    (os.path.join("review", "evidence", "r181h_m317"), "png"),             # 30 MB 过程截图
]

tracked = tracked_set()
plan_move, plan_skip = [], []

for rel_dir, mode in TARGETS:
    abs_dir = os.path.join(ROOT, rel_dir)
    if not os.path.isdir(abs_dir):
        print("[MISS]", rel_dir)
        continue
    for d, dirs, files in os.walk(abs_dir):
        for f in files:
            ap = os.path.join(d, f)
            rel = os.path.relpath(ap, ROOT)
            if mode == "png" and not f.lower().endswith(".png"):
                continue
            if os.path.normpath(rel) in tracked:
                plan_skip.append((rel, os.path.getsize(ap)))
            else:
                plan_move.append((rel, os.path.getsize(ap)))

tot = sum(s for _, s in plan_move)
print("=== 计划 ===")
print("移出(归档) : %d 个文件 / %.2f MB" % (len(plan_move), mb(tot)))
print("跳过(已入库): %d 个文件 / %.2f MB  ← 必须逐个核对，不能有误伤" % (len(plan_skip), mb(sum(s for _, s in plan_skip))))
for rel, s in plan_skip:
    print("    SKIP %8.2f MB  %s" % (mb(s), rel))

# 按顶层目标分组统计
print()
print("--- 分组 ---")
for rel_dir, mode in TARGETS:
    sub = [(r, s) for r, s in plan_move if r.replace("\\", "/").startswith(rel_dir.replace("\\", "/") + "/")]
    if sub:
        print("  %-46s %5d 个 / %8.2f MB" % (rel_dir, len(sub), mb(sum(s for _, s in sub))))

if not APPLY:
    print()
    print("(dry-run 结束；加 --apply 才真正移动)")
    sys.exit(0)

print()
print("=== 执行移动 ===")
ok, fail = 0, []
manifest = []
for rel, size in plan_move:
    src = os.path.join(ROOT, rel)
    dst = os.path.join(ARCH, rel)
    try:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        h = md5(src)
        shutil.move(src, dst)
        # 自证：目标存在 + size 一致 + md5 一致
        if (not os.path.isfile(dst)) or os.path.getsize(dst) != size or md5(dst) != h:
            fail.append((rel, "自证失败"))
            continue
        manifest.append("%d\t%s\t%s" % (size, h, rel.replace(os.sep, "/")))
        ok += 1
    except Exception as e:
        fail.append((rel, repr(e)))

print("移动成功: %d / %d" % (ok, len(plan_move)))
print("失败: %d" % len(fail))
for rel, why in fail[:20]:
    print("    FAIL", rel, why)

# 清单落盘
os.makedirs(ARCH, exist_ok=True)
head = subprocess.run(["git", "log", "--oneline", "-1"], cwd=ROOT, capture_output=True,
                      text=True, encoding="utf-8", errors="replace").stdout.strip()
with open(os.path.join(ARCH, "_manifest_r188.tsv"), "w", encoding="utf-8", newline="\n") as f:
    f.write("# git_head=%s\n" % head)
    f.write("# 每行: size\\tmd5\\t原相对路径(仓库内)\n")
    f.write("\n".join(manifest) + "\n")
print("清单:", os.path.join(ARCH, "_manifest_r188.tsv"), len(manifest), "行")
