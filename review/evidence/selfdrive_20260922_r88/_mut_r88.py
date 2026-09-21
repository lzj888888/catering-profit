"""round88 双向变异回灌：R117 免费店铺数口径穿透守卫。
坑⑳：还原一律用**字节快照**回写，不用 git checkout（autocrlf 仓会反向改行尾）。
坑⑨：变异锚点在 CRLF 文件里用 \\n 恒不命中 ⇒ 统一先归一成 \\n 再匹配，写回时再还原 \\r\\n。
"""
import subprocess, sys, os, re

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
assert os.path.isdir(os.path.join(ROOT, 'cloudfunctions')), ROOT
GUARD = 'tools/check_free_shop_limit.js'
SRC = 'cloudfunctions/checkQuota/service.js'
DUP = 'cloudfunctions/getShopList/index.js'
MIR = 'cloudfunctions/getShopList/selftest.js'
PROBE = 'pages/__mut_probe_r88.js'

snap = {}

def rd(rel):
    p = os.path.join(ROOT, rel)
    return open(p, 'rb').read()

def wr(rel, data):
    p = os.path.join(ROOT, rel)
    open(p, 'wb').write(data)

def keep(rel):
    """容错：文件原本不存在时记 None（新增型变异），还原时删掉。"""
    if rel not in snap:
        p = os.path.join(ROOT, rel)
        snap[rel] = rd(rel) if os.path.exists(p) else None

def restore_all():
    for rel, data in snap.items():
        if data is None:
            p = os.path.join(ROOT, rel)
            if os.path.exists(p):
                os.remove(p)
        else:
            wr(rel, data)

def text_of(rel):
    return rd(rel).decode('utf-8').replace('\r\n', '\n')

def put(rel, t):
    keep(rel)
    wr(rel, t.replace('\n', '\r\n').encode('utf-8'))

def run_guard():
    r = subprocess.run(['node', GUARD], cwd=ROOT, capture_output=True, text=True,
                       encoding='utf-8', errors='ignore')
    return r.returncode, (r.stdout or '') + (r.stderr or '')

def apply_mut(rel, old, new):
    t = text_of(rel)
    if old not in t:
        return False, 'ANCHOR_MISSING'
    n = t.count(old)
    t = t.replace(old, new, 1)
    put(rel, t)
    return True, 'ok(%d anchors)' % n

CASES = [
    # (id, expect_red, desc, fn)
]

def case(mid, expect_red, desc):
    def deco(fn):
        CASES.append((mid, expect_red, desc, fn))
        return fn
    return deco

@case('M1', True, '第二硬编码点 1→2（展示与拦截分叉）⇒ 应红')
def m1():
    return apply_mut(DUP, 'const FREE_SHOP_LIMIT = 1;', 'const FREE_SHOP_LIMIT = 2;')

@case('M2', True, '删掉第二硬编码点定义（fail-closed A3）⇒ 应红')
def m2():
    return apply_mut(DUP, 'const FREE_SHOP_LIMIT = 1;\n', '')

@case('M3', True, '单源 FREE_LIMIT.shop 1→2（反向穿透）⇒ 应红')
def m3():
    return apply_mut(SRC, 'const FREE_LIMIT = { shop: 1,', 'const FREE_LIMIT = { shop: 2,')

@case('M4', True, '测试镜像 1→2（只改 selftest 造成本地漂移）⇒ 应红')
def m4():
    return apply_mut(MIR, 'const FREE_SHOP_LIMIT = 1;', 'const FREE_SHOP_LIMIT = 2;')

@case('M5', True, '前端硬编码该口径（违反「后端权威」设计意图）⇒ 应红')
def m5():
    keep(PROBE)
    wr(PROBE, b"// mutation probe r88\r\nconst FREE_SHOP_LIMIT = 1;\r\nmodule.exports = FREE_SHOP_LIMIT;\r\n")
    return True, 'ok'

@case('M6', False, '正确实现换等价写法（去空格）⇒ 应仍绿（不错杀）')
def m6():
    return apply_mut(DUP, 'const FREE_SHOP_LIMIT = 1;', 'const FREE_SHOP_LIMIT=1;')

@case('M7', True, '前端扫描面根路径写错（扫空）⇒ 应红')
def m7():
    return apply_mut(GUARD, "const FE_DIRS = ['pages', 'utils', 'miniprogram'];",
                     "const FE_DIRS = ['pages_typo', 'utils', 'miniprogram'];")

@case('M8', False, '前端加无关常量 ⇒ 应仍绿（不错杀）')
def m8():
    keep(PROBE)
    wr(PROBE, b"// mutation probe r88 (irrelevant)\r\nconst OTHER_LIMIT_XYZ = 5;\r\nmodule.exports = OTHER_LIMIT_XYZ;\r\n")
    return True, 'ok'

@case('M9', True, '删掉出参 free_limit（违反 core/10:171 契约）⇒ 应红')
def m9():
    return apply_mut(DUP, '    free_limit: FREE_SHOP_LIMIT,\n', '')

def cleanup():
    restore_all()
    p = os.path.join(ROOT, PROBE)
    if os.path.exists(p):
        os.remove(p)

print('=== round88 双向变异回灌（R117 免费店铺数口径穿透守卫）===')
bad = 0
for mid, expect_red, desc in [(c[0], c[1], c[2]) for c in CASES]:
    fn = [c for c in CASES if c[0] == mid][0][3]
    ok, why = fn()
    if not ok:
        print(f'  {mid} MUTATION_NOT_APPLIED ({why}) —— {desc}')
        bad += 1
        cleanup()
        continue
    rc, out = run_guard()
    red = (rc != 0)
    verdict = 'OK' if red == expect_red else 'MISMATCH'
    if verdict != 'OK':
        bad += 1
    print(f'  {mid} rc={rc} red={red} expect_red={expect_red} [{verdict}] —— {desc}')
    if verdict == 'MISMATCH':
        for ln in out.splitlines():
            if '❌' in ln:
                print('        ', ln.strip()[:150])
    cleanup()

# 干净态复核
rc, out = run_guard()
clean = '通过 / 0 失败' in out
print(f'  clean rc={rc} 全绿={clean}')
if rc != 0 or not clean:
    bad += 1
print('=== 结果：%d 组，异常 %d 组 ===' % (len(CASES) + 1, bad))
sys.exit(1 if bad else 0)
