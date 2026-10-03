# -*- coding: utf-8 -*-
# R194 门禁挂套件同步：六处必改 + 两处按需 + 云函数同步面（core/10 全集+登记行 / selftest 计数）
# 纪律（gate-suite-checklist §3）：全部锚点"命中数==1"校验通过才统一落盘；任一不符 ⇒ 一个文件都不写。
import os
import sys

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
errors = []
plan = {}


def load(rel):
    with open(os.path.join(ROOT, rel), 'rb') as f:
        return f.read().decode('utf-8')


def process(rel, ops):
    s = load(rel)
    nl = '\r\n' if '\r\n' in s else '\n'
    for op in ops:
        if op[0] == 'rep':
            _, anchor, new = op
            new = new.replace('\n', nl)
            c = s.count(anchor)
            if c != 1:
                errors.append('[%s] rep 锚点命中 %d 次（期望 1）: %r' % (rel, c, anchor[:70]))
                return
            s = s.replace(anchor, new)
        elif op[0] == 'append_line':
            _, marker, suffix = op
            lines = s.split(nl)
            idxs = [i for i, l in enumerate(lines) if marker in l]
            if len(idxs) != 1:
                errors.append('[%s] append_line 命中 %d 行（期望 1）: %r' % (rel, len(idxs), marker[:70]))
                return
            i = idxs[0]
            lines[i] = lines[i].rstrip() + suffix
            s = nl.join(lines)
        else:
            errors.append('[%s] 未知 op: %r' % (rel, op[0]))
            return
    plan[rel] = s


# ---------------- 1. verify_all.js（第 1/2/3 处） ----------------
VA = 'verify_all.js'
va_note = (
    '//       + 鉴权返回形状守卫（tools/check_auth_guard_shape.js，R194：**越权拦截整体失效** ——\n'
    '//         `common/auth.js::assertShopOwner` 原用 `fail()` 返回 `{code,msg,data}`（无 error 字段），\n'
    '//         而 20 处调用点统一判 `owner.error` ⇒ **恒 undefined ⇒ 归属校验形同不存在**，\n'
    '//         任意用户改 shop_id 即可读写他人店铺数据（真云可达）。判据=G1 扫描面非退化 + G2 每个 return\n'
    '//         分支都带 error + G3 单源无 ok()/fail() + G4 派生副本同形 + G5 关键锚点在场 + G6 调用点判据与形状一致）'
)
process(VA, [
    ('rep', '// 串联：125 个套件', '// 串联：126 个套件'),
    ('rep', 'material_total_fen=876 必须原样复现，且 per100g ≡ 全份（恒等语义）。',
            'material_total_fen=876 必须原样复现，且 per100g ≡ 全份（恒等语义）。\n' + va_note),
    ('rep', "  ['spec-per100g-identity', 'tools/check_spec_per100g_identity.js'],",
            "  ['spec-per100g-identity', 'tools/check_spec_per100g_identity.js'],\n"
            "  // R194：鉴权返回形状守卫 —— 修「20 处调用点判 owner.error 而单源返回 {code,msg,data}」导致越权拦截整体失效。\n"
            "  ['auth-guard-shape', 'tools/check_auth_guard_shape.js'],"),
])

# ---------------- 2. 重启键（第 4/5/6 处 + F5 selftest 计数） ----------------
RST = 'specs/dev-specs/★知识存储点_2026-09-10.md'
evochain = (
    ' → **126（round194：新增 `tools/check_auth_guard_shape.js`，鉴权返回形状守卫，R194 —— '
    '根因＝`common/auth.js::assertShopOwner` 用 `fail()` 返回 `{code,msg,data}`（无 error 字段），'
    '而 20 处调用点统一判 `owner.error` ⇒ 恒 undefined ⇒ **越权拦截整体失效**'
    '（任意用户改 shop_id 即可读写他人店铺）；判据＝G1 扫描面非退化 + G2 每个 return 分支带 error + '
    'G3 单源无 ok()/fail() + G4 派生副本同形 + G5 关键锚点在场 + G6 调用点判据与形状一致）**'
)
process(RST, [
    ('rep', '串 **125** 个套件', '串 **126** 个套件'),
    ('append_line', '串 **126** 个套件',
     ' ⚠️ R194 新增第 126 个套件 `auth-guard-shape`（`tools/check_auth_guard_shape.js`，鉴权返回形状守卫）。'),
    ('rep', '（现 **125**；', '（现 **126**；'),
    ('append_line', '（现 **126**；', evochain),
    ('rep', '（**四十一者**均 ≡ 实跑 pass 数', '（**四十二者**均 ≡ 实跑 pass 数'),
    ('rep', '`check_spec_per100g_identity`=6（', '`check_spec_per100g_identity`=6 / `check_auth_guard_shape`=17（'),
    ('rep', '40 个云函数都叫 `selftest.js`', '41 个云函数都叫 `selftest.js`'),
])

# ---------------- 3. CASES（第 7 处） ----------------
CSC = 'tools/check_suite_assert_counts.js'
process(CSC, [
    ('rep',
     "{ key: 'check_spec_per100g_identity', rel: 'tools/check_spec_per100g_identity.js' }, // 6 条（R141：P1 存在 + P2 全1 + P3 反恒真 + P4 unit_label + 反向×2）",
     "{ key: 'check_spec_per100g_identity', rel: 'tools/check_spec_per100g_identity.js' }, // 6 条（R141：P1 存在 + P2 全1 + P3 反恒真 + P4 unit_label + 反向×2）\n"
     "  // R194 扩面：鉴权返回形状守卫同批纳入 —— 它的 G1/G6 两条扫描面下界护栏正是「非恒真」凭据；\n"
     "  //   断言数不受守则「把 20 处调用点判据改回 owner.code / 删掉 G2 分支遍历」同样静默通过。\n"
     "  { key: 'check_auth_guard_shape', rel: 'tools/check_auth_guard_shape.js' }, // 17 条（R194：G1 扫描面非退化 / G2 分支带 error / G3 无 ok()·fail() / G4 派生同形 / G5 锚点在场 / G6 调用点形状）"),
])

# ---------------- 4. A15_EXEMPT（第 8 处） ----------------
A15 = 'tools/selftest_r85.js'
a15_add = (
    '\n'
    '  // R194（李老师「都听你的，安排。做吧」授权）：修「越权拦截整体失效」缺陷 ——\n'
    '  //   ① 新增云函数 manageShop（店铺增 / 改名 / 删除，三 op 一体；写入走软删 + 至少保留一家）；\n'
    '  //   ② 单源 common/auth.js 的 assertShopOwner 由 {code,msg,data} 改为 {error} 形状（20 处调用点判 owner.error）；\n'
    '  //   ③ 派生面：sync_common 把新 auth 派生到全部函数目录 cx_auth.js。均为显式授权，非顺手改逻辑。\n'
    '  /^cloudfunctions\\/manageShop\\//,\n'
    '  /^cloudfunctions\\/[^/]+\\/cx_auth\\.js$/,'
)
process(A15, [
    ('rep', 'reason=round157 容量审计授权（索引字段对齐 + listAll 分页取全）',
            'reason=round157 容量审计授权（索引字段对齐 + listAll 分页取全）' + a15_add),
])

# ---------------- 5. core/10 云函数清单（F2 登记行 + F4 全集计数） ----------------
C10 = 'specs/dev-specs/core/10_云函数清单与接口契约.md'
ms_row = (
    '| `manageShop` | 店铺增 / 改名 / 删除（三 op 一体；**删除走软删**、且必须至少保留一家） | '
    '`{ op, name, target_shop_id, client_request_id }`（op ∈ create / rename / delete；'
    '⚠️ 目标店用 `target_shop_id` **不是** `shop_id` —— `utils/api.js::call()` 会无条件注入当前店 `shop_id`，同名会被覆盖） | '
    '`{ shop_id, name, deleted, client_request_id }` | user+shop+幂等 |'
)
process(C10, [
    ('rep', '本表共登记 **43** 个已部署云函数', '本表共登记 **44** 个已部署云函数'),
    ('rep', '| 无（仅 dev 诊断） |', '| 无（仅 dev 诊断） |\n' + ms_row),
])

# ---------------- 落盘（两阶段） ----------------
if errors:
    print('FAIL 校验未通过，一个文件都没写：')
    for e in errors:
        print('  ' + e)
    sys.exit(1)

for rel, s in plan.items():
    with open(os.path.join(ROOT, rel), 'wb') as f:
        f.write(s.encode('utf-8'))
    print('OK 已写入 ' + rel)
print('DONE')
