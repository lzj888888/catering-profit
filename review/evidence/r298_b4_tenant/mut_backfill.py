# -*- coding: utf-8 -*-
# R298 · B4 变异回灌：证明 E 组与两处修补**非假绿**
# 纪律：每条变异独立施加 → 跑守卫 → 记录 RC/首个 ❌ 行 → 还原 → 校验 md5 全等
import hashlib, io, os, re, subprocess, sys

# ROOT：从本文件出发向上找 `verify_all.js`（仓根哨兵）—— 本件放在 review/evidence/** 下，
# ROOT：向上找 `verify_all.js`（仓根哨兵）。本件位于 review/evidence/** 下，
#   按固定层数回退会算错（实测：按 2 层落到 review/ ⇒ FileNotFoundError）。
def _find_root(start):
    d = os.path.abspath(start)
    while True:
        if os.path.exists(os.path.join(d, 'verify_all.js')):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            raise RuntimeError('仓根未找到（缺 verify_all.js 哨兵）')
        d = parent
ROOT = _find_root(os.path.dirname(os.path.abspath(__file__)))
NODE = r'C:\Users\lzj\.workbuddy\binaries\node\versions\22.22.2-6\node.exe'

FILES = [
    'cloudfunctions/checkQuota/index.js',
    'cloudfunctions/verifyTangshi/index.js',
    'tools/check_fn_public_surface.js',
]
ABS = {f: os.path.join(ROOT, f) for f in FILES}

def md5(p):
    return hashlib.md5(open(p, 'rb').read()).hexdigest()

BASELINE = {f: md5(ABS[f]) for f in FILES}
# 🔴 本轮改动**尚未提交** ⇒ 绝不能用 `git checkout` 还原（那会退回 HEAD = 未修补态）。
#   基线字节先在内存里留一份，还原一律从这里写回。
BASELINE_BYTES = {f: open(ABS[f], 'rb').read() for f in FILES}

MUT = []

def add(tag, rel, old, new, guard, expect_sub, expect_red=True):
    MUT.append(dict(tag=tag, rel=rel, old=old, new=new, guard=guard,
                    expect_sub=expect_sub, expect_red=expect_red))

# ============ 组 A：必须转红，且点名到预期断言 ============
add('M1 撤掉 checkQuota 归属校验（退回原样）',
    'cloudfunctions/checkQuota/index.js',
    '  const owner = await assertShopOwner(db, shopId, userId);\n',
    '  const owner = { error: null }; // MUT\n',
    'check_fn_public_surface', 'E-②')

add('M2 给 checkQuota 塞豁免以绕过 E-②（豁免表腐化）',
    'tools/check_fn_public_surface.js',
    "    why: '恒取「本人第一店」（da.list(shop,{user_id})[0]），**完全忽略** event.shop_id ⇒ 按构造不可能读到他人店',\n  },\n",
    "    why: '恒取「本人第一店」（da.list(shop,{user_id})[0]），**完全忽略** event.shop_id ⇒ 按构造不可能读到他人店',\n"
    "  },\n"
    "  { fn: 'checkQuota', why: '偷懒豁免（MUT）', },\n",
    'check_fn_public_surface', 'E-④')

add('M3 删掉 getShopContext 豁免项（该豁免是必须的）',
    'tools/check_fn_public_surface.js',
    "  {\n    fn: 'getShopContext',\n",
    "  {\n    fn: 'getShopContextX',\n",
    'check_fn_public_surface', 'E-②')

add('M4 撤掉 verifyTangshi 来源校验（退回原样）',
    'cloudfunctions/verifyTangshi/index.js',
    "  if (ctx && ctx.OPENID) return { ok: false, code: 'FORBIDDEN', msg: 'verifyTangshi 仅限云控制台 / cli 调用（R298 加固）' };\n",
    "",
    'check_fn_public_surface', 'C-②')

add('M5 把 verifyTangshi 改回 mustSelfGuard:false（登记表缩表）',
    'tools/check_fn_public_surface.js',
    "why: 'M3.33 一次性只读探针（固定 where 聚合 external_sales_daily；不写库）—— R298 已加固：有用户 OPENID 即拒绝', mustSelfGuard: true }",
    "why: 'M3.33 一次性只读探针（固定 where 聚合 external_sales_daily；不写库）—— R298 已加固：有用户 OPENID 即拒绝', mustSelfGuard: false }",
    'check_fn_public_surface', 'C-①')

add('M6 契约表解析退回朴素 split("|")（丢掉转义竖线处理）',
    'tools/check_fn_public_surface.js',
    "    const parts = l.split(/(?<!\\\\)\\|/);\n",
    "    const parts = l.split('|');\n",
    'check_fn_public_surface', 'E-⑨')

add('M7 把豁免表的 why 改短（<12 字）',
    'tools/check_fn_public_surface.js',
    "why: '恒取「本人第一店」（da.list(shop,{user_id})[0]），**完全忽略** event.shop_id ⇒ 按构造不可能读到他人店',",
    "why: '安全',",
    'check_fn_public_surface', 'E-⑤')

add('M8 归属校验判据改成 .code（跨守卫：check_auth_guard_shape G6 必须抓到）',
    'cloudfunctions/checkQuota/index.js',
    '  if (owner.error) return fail(owner.error, owner.msg);\n\n  // ===== 2.5. 读免费配额配置',
    '  if (owner.code) return fail(owner.error, owner.msg);\n\n  // ===== 2.5. 读免费配额配置',
    'check_auth_guard_shape', 'G6')

# ============ 组 B：必须保持绿（等价改写 / 纯注释） ============
add('M9 等价改写：owner.error 加空值兜底（行为不变）',
    'cloudfunctions/checkQuota/index.js',
    '  if (owner.error) return fail(owner.error, owner.msg);\n',
    '  if (owner && owner.error) return fail(owner.error, owner.msg);\n',
    'check_fn_public_surface', '', expect_red=False)

add('M10 纯注释插入（不改行为）',
    'cloudfunctions/checkQuota/index.js',
    '  // ===== 2.2. 店铺归属校验（🔴 R298 · B4 越权面修补）=====\n',
    '  // ===== 2.2. 店铺归属校验（🔴 R298 · B4 越权面修补）=====\n  // MUT：本次变异只加一行注释，不触碰任何代码\n',
    'check_fn_public_surface', '', expect_red=False)


def run_guard(name):
    p = subprocess.run([NODE, os.path.join(ROOT, 'tools', name + '.js')],
                       cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    out = (p.stdout or '') + (p.stderr or '')
    return p.returncode, out


def apply_mut(m):
    p = ABS[m['rel']]
    raw = open(p, 'rb').read()
    eol_cr = raw.count(b'\r')
    s = raw.decode('utf-8')
    n = s.count(m['old'])
    if n != 1:
        return 'anchor-hit-%d' % n
    out = s.replace(m['old'], m['new'], 1).encode('utf-8')
    assert out.count(b'\r') == eol_cr
    open(p, 'wb').write(out)
    return 'ok'


print('===== R298 · B4 变异回灌 =====')
print('基线 md5：')
for f in FILES:
    print('  %-44s %s' % (f, BASELINE[f][:12]))
print()

ok_n = 0
bad = []
for i, m in enumerate(MUT, 1):
    st = apply_mut(m)
    if st != 'ok':
        print('[%2d] %-46s ⚠️ 施加失败：%s（跳过）' % (i, m['tag'], st))
        for f in FILES:
            open(ABS[f], 'wb').write(BASELINE_BYTES[f])
        continue
    rc, out = run_guard(m['guard'])
    red = (rc != 0)
    hit = [l.strip() for l in out.split('\n') if l.strip().startswith('❌')]
    if m['expect_red']:
        good = red and any(m['expect_sub'] in l for l in hit)
    else:
        good = (not red)
    mark = 'OK ' if good else 'FAIL'
    if good:
        ok_n += 1
    else:
        bad.append(m['tag'])
    print('[%2d] %s %-46s guard=%s rc=%d 红=%s' % (i, mark, m['tag'], m['guard'], rc, red))
    if hit:
        print('      首个 ❌：%s' % hit[0][:150])
    if m['expect_red'] and not good:
        print('      期望点名含「%s」—— 实际 ❌ 行：%s' % (m['expect_sub'], ' ｜ '.join(h[:100] for h in hit[:4]) or '(无红行)'))
    # 还原：一律从内存基线写回（不用 git checkout —— 本轮改动未提交）
    for f in FILES:
        open(ABS[f], 'wb').write(BASELINE_BYTES[f])

print()
print('===== 还原校验（逐字节 md5）=====')
allok = True
for f in FILES:
    same = md5(ABS[f]) == BASELINE[f]
    allok = allok and same
    print('  %-44s %s' % (f, 'md5 一致' if same else '🔴 md5 不一致！'))
if not allok:
    print('🔴 还原失败 ⇒ 立即停止，需人工介入')
    sys.exit(2)

print()
print('结果：%d/%d 如期；未如期：%s' % (ok_n, len(MUT), ', '.join(bad) or '无'))
sys.exit(0 if not bad else 1)
