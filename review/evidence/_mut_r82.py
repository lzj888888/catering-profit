# round82 · R113 限流阈值口径守卫 —— 双向变异回灌
# 定式：① 变异前本轮改动已入 index（坑⑩）② 用字节快照回写还原（round80，比 git checkout 稳、不动行尾）
import subprocess, sys, shutil, os
ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
GUARD = 'tools/check_rate_limit_params.js'
SRC = 'cloudfunctions/common/rateLimit.js'
COPY = 'cloudfunctions/adminLogin/cx_rateLimit.js'
DECL = 'specs/dev-specs/core/09_统一错误码表.md'
REF = 'specs/dev-specs/core/16_后台鉴权规范.md'

FILES = [GUARD, SRC, COPY, DECL, REF]
snap = {}
for f in FILES:
    snap[f] = open(os.path.join(ROOT, f), 'rb').read()

def restore():
    for f, b in snap.items():
        open(os.path.join(ROOT, f), 'wb').write(b)

def run():
    p = subprocess.run(['node', GUARD], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return p.returncode, p.stdout + p.stderr

def rd(rel):
    return open(os.path.join(ROOT, rel), 'rb').read().decode('utf-8')

def wr(rel, txt):
    open(os.path.join(ROOT, rel), 'wb').write(txt.encode('utf-8'))

def rep(rel, old, new, expect=1):
    t = rd(rel)
    n = t.count(old)
    if n != expect:
        return False, f'anchor count={n} (expect {expect})'
    wr(rel, t.replace(old, new, 1))
    return True, f'count={n}'

CASES = [
    # —— ① 能抓错（应转红）——
    ('M1  单源 MAX_WRITES 60→600（限流形同虚设）', 'red', SRC, 'const MAX_WRITES = 60;', 'const MAX_WRITES = 600;'),
    ('M2  单源 WINDOW_MS 改 30s（口径自洽性）', 'red', SRC, 'const WINDOW_MS = 60 * 1000;', 'const WINDOW_MS = 30 * 1000;'),
    ('M3  副本 adminLogin MAX_WRITES 60→6（只改一处副本）', 'red', COPY, 'const MAX_WRITES = 60;', 'const MAX_WRITES = 6;'),
    ('M4  声明次数 60→120（改声明不改代码）', 'red', DECL, '= **60** 次/分钟', '= **120** 次/分钟'),
    ('M5  声明窗口 60000→30000', 'red', DECL, '窗口 **60000** ms', '窗口 **30000** ms'),
    ('M6  引用处 core/16 写 30 次/分钟', 'red', REF, '>60 次/分钟触发', '>30 次/分钟触发'),
    ('M7  删唯一声明处（fail-closed）', 'red', DECL, '> 🔢 限流阈值口径（唯一声明处）', '> 🔢 已删除该条口径声明'),
    ('M8  扫描面路径写错（扫空=零覆盖）', 'red', GUARD, "path.join(ROOT, 'specs', 'dev-specs')", "path.join(ROOT, 'specs', 'dev-specs_typo')"),
    ('M9  副本目录名写错（副本面失效）', 'red', GUARD, "const COPY_NAME = 'cx_rateLimit.js';", "const COPY_NAME = 'cx_rateLimit_typo.js';"),
    # —— ② 不错杀（应仍绿）——
    ('M10 正确实现换措辞（「60 次 / 分钟」加空格）', 'green', DECL, '= **60** 次/分钟', '= **60** 次 / 分钟'),
    ('M11 单源窗口写等价字面量 60000', 'green', SRC, 'const WINDOW_MS = 60 * 1000;', 'const WINDOW_MS = 60000;'),
    ('M12 无关口径：core/16 增补一句 60rpx 字号', 'green', REF, '## 4. 防暴破与限流', '## 4. 防暴破与限流（本页提示文字 60rpx）'),
]

rows = []
for name, want, rel, old, new in CASES:
    restore()
    ok, info = rep(rel, old, new)
    if not ok:
        rows.append((name, want, 'NOT_APPLIED', info))
        continue
    rc, out = run()
    got = 'red' if rc != 0 else 'green'
    # 抓红的具体断言
    detail = ''
    for ln in out.splitlines():
        if '❌' in ln:
            detail = ln.strip()[:100]
            break
    verdict = 'OK' if got == want else 'MISMATCH'
    rows.append((name, want, got, f'{verdict} rc={rc} {detail} {info}'))
restore()

print('===== round82 · R113 双向变异回灌 =====')
for n, w, g, d in rows:
    print(f'  {n}\n      期望={w} 实际={g} · {d}')
bad = [r for r in rows if 'MISMATCH' in r[3] or r[2] == 'NOT_APPLIED']
print(f'\n变异 {len(rows)} 组，异常 {len(bad)} 组')
# 还原后确认工作树 ≡ index
p = subprocess.run(['git', 'status', '--porcelain', '--', *FILES], cwd=ROOT, capture_output=True, text=True)
print('还原后 git status（应为空）:', repr(p.stdout.strip()[:200]))
