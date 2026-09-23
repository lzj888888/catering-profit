# -*- coding: utf-8 -*-
"""round89 · R118 双向变异回灌（12 组）。
定式：①错误实现换写法（须仍红，防绑字面）②正确实现换写法（须仍绿，防误杀）③切断/删除（须红，fail-closed）。
还原 = 内存字节快照回写（round80 配方，优于 git checkout：不动行尾、不依赖 index）。"""
import os, subprocess, sys

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
NODE = r'C:\Users\lzj\.workbuddy\binaries\node\versions\22.22.2-3\node.exe'
GUARD = 'tools/check_archive_grace.js'

SRC = 'cloudfunctions/saveLedger/index.js'
I18N = 'miniprogram/i18n/terms.js'
I18N_M = 'specs/dev-specs/i18n/terms.js'
DECL = os.path.join('specs', 'dev-specs', 'core', '13_上线前查缺补漏_决策与待办总览.md')
DECL2 = os.path.join('specs', 'dev-specs', 'core', '09_统一错误码表.md')

MARK = '归档宽限口径（唯一声明处）'

snap = {}
def load(rel):
    p = os.path.join(ROOT, rel)
    snap[rel] = open(p, 'rb').read()
    return snap[rel].decode('utf-8')

def restore(rel):
    open(os.path.join(ROOT, rel), 'wb').write(snap[rel])

def write(rel, text):
    open(os.path.join(ROOT, rel), 'wb').write(text.encode('utf-8'))

def run_guard():
    r = subprocess.run([NODE, GUARD], cwd=ROOT, capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=120)
    out = (r.stdout or '') + (r.stderr or '')
    green = (r.returncode == 0) and ('0 失败' in out)
    # 抓首条失败断言名
    first_red = ''
    for l in out.splitlines():
        if '❌' in l:
            first_red = l.strip()[:70]; break
    return ('GREEN' if green else 'RED'), r.returncode, first_red

results = []
def mutate(mid, desc, expect, fn):
    touched = fn()
    state, rc, red = run_guard()
    for rel in touched:
        restore(rel)
    after, _, _ = run_guard()
    ok = (state == expect) and (after == 'GREEN')
    results.append((mid, desc, expect, state, after, red, ok))
    print('%-5s %-6s expect=%-5s got=%-5s restore=%-5s %s | %s'
          % (mid, 'OK' if ok else 'MISMATCH', expect, state, after, desc, red))

# ---------- M1 单源 7→14 天（应红）----------
def m1():
    t = load(SRC)
    assert '7 * 24 * 3600 * 1000' in t
    write(SRC, t.replace('7 * 24 * 3600 * 1000', '14 * 24 * 3600 * 1000', 1))
    return [SRC]
mutate('M1', '单源 GRACE_DAYS_MS 7→14 天（核心穿透）', 'RED', m1)

# ---------- M2 单源换等价字面量 604800000（应仍绿：算术求值）----------
def m2():
    t = load(SRC)
    write(SRC, t.replace('7 * 24 * 3600 * 1000', '604800000', 1))
    return [SRC]
mutate('M2', '单源换等价字面量 604800000（不错杀）', 'GREEN', m2)

# ---------- M3 只改服务端文案 7→14（应红）----------
def m3():
    t = load(SRC)
    assert '仅归档后 7 天内可补录' in t
    write(SRC, t.replace('仅归档后 7 天内可补录', '仅归档后 14 天内可补录', 1))
    return [SRC]
mutate('M3', '只改服务端文案 7→14（用户看到的天数分叉）', 'RED', m3)

# ---------- M4 声明行去掉加粗（应仍绿：排版不错杀）----------
def m4():
    t = load(DECL)
    assert '归档后 **7** 天内可补录' in t
    write(DECL, t.replace('归档后 **7** 天内可补录', '归档后 7 天内可补录', 1)
                .replace('超过 **7** 天硬锁', '超过 7 天硬锁', 1))
    return [DECL]
mutate('M4', '声明行去掉加粗（正确实现换排版，不错杀）', 'GREEN', m4)

# ---------- M5 只改前端 i18n 一条（双副本同改，应红）----------
def m5():
    a = load(I18N); b = load(I18N_M)
    assert "graceArchive: '归档后 7 天内可补录（需确认）'" in a
    write(I18N, a.replace('归档后 7 天内可补录（需确认）', '归档后 3 天内可补录（需确认）', 1))
    write(I18N_M, b.replace('归档后 7 天内可补录（需确认）', '归档后 3 天内可补录（需确认）', 1))
    return [I18N, I18N_M]
mutate('M5', '只改前端 i18n graceArchive 7→3（双副本同改）', 'RED', m5)

# ---------- M5b 只改主副本、派生副本不动（应红：B5-⑥ 双副本一致）----------
def m5b():
    a = load(I18N)
    write(I18N, a.replace('归档后 7 天内可补录（需确认）', '归档后 3 天内可补录（需确认）', 1))
    return [I18N]
mutate('M5b', 'i18n 只改主副本、派生副本不同步', 'RED', m5b)

# ---------- M6 i18n 措辞变化但天数不变（应仍绿）----------
def m6():
    a = load(I18N); b = load(I18N_M)
    write(I18N, a.replace('归档后 7 天内可补录（需确认）', '归档后 7 天之内均可补录（需确认）', 1))
    write(I18N_M, b.replace('归档后 7 天内可补录（需确认）', '归档后 7 天之内均可补录（需确认）', 1))
    return [I18N, I18N_M]
mutate('M6', 'i18n 换措辞「7 天之内均可补录」（不错杀）', 'GREEN', m6)

# ---------- M7 删掉声明行（应红：fail-closed）----------
def m7():
    t = load(DECL)
    lines = t.split('\n')
    out = [l for l in lines if MARK not in l]
    assert len(out) == len(lines) - 1, 'decl line not removed'
    write(DECL, '\n'.join(out))
    return [DECL]
mutate('M7', '删掉唯一声明行（fail-closed）', 'RED', m7)

# ---------- M8 标记词扩散到第二份 md（应红：单源不扩散）----------
def m8():
    t = load(DECL2)
    write(DECL2, t + '\n- 🔢 ' + MARK + '：归档后 7 天内可补录。\n')
    return [DECL2]
mutate('M8', '标记词扩散到第二份 md（单源不扩散）', 'RED', m8)

# ---------- M9 扫描面根路径写错（应红：B1-⑤ 逐根下界）----------
def m9():
    t = load(GUARD)
    assert "path.join(ROOT, 'specs')" in t
    write(GUARD, t.replace("path.join(ROOT, 'specs')", "path.join(ROOT, 'specs_typo')", 1))
    return [GUARD]
mutate('M9', 'md 扫描面根路径写错 specs→specs_typo', 'RED', m9)

# ---------- M10 单源换等价表达式 7*24*60*60*1000（应仍绿）----------
def m10():
    t = load(SRC)
    write(SRC, t.replace('7 * 24 * 3600 * 1000', '7 * 24 * 60 * 60 * 1000', 1))
    return [SRC]
mutate('M10', '单源换等价表达式（60*60 写法，不错杀）', 'GREEN', m10)

# ---------- M11 切断单源被归档守卫使用（应红：B2-③ 不是死常量）----------
def m11():
    t = load(SRC)
    assert '(now - archivedAt) < GRACE_DAYS_MS' in t
    write(SRC, t.replace('(now - archivedAt) < GRACE_DAYS_MS', '(now - archivedAt) < 999', 1))
    return [SRC]
mutate('M11', '归档守卫表达式不再引用 GRACE_DAYS_MS（死常量）', 'RED', m11)

bad = [r for r in results if not r[6]]
print('\n===== 双向变异汇总：%d 组，异常 %d 组 =====' % (len(results), len(bad)))
for r in bad:
    print('  MISMATCH', r[0], r[1], 'expect=%s got=%s restore=%s' % (r[2], r[3], r[4]), r[5])
sys.exit(1 if bad else 0)
