# -*- coding: utf-8 -*-
# R298 · B4 两阶段补丁（先在内存改完 + 每个锚点断言命中数，全过才统一落盘）
import io, os, re, sys

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

def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()

def load(rel):
    t = rd(rel)
    assert '\r' not in t, 'LF 假定被破坏: ' + rel
    return t

PLAN = []   # (rel, old, new, expected_hits)

# ============ 1. cloudfunctions/checkQuota/index.js ============
P1 = 'cloudfunctions/checkQuota/index.js'
PLAN.append((P1,
  "const { resolveAuth } = common;\n",
  "const { resolveAuth, assertShopOwner } = common;\n", 1))

PLAN.append((P1,
  "  // ===== 2. 校验 =====\n"
  "  const v = validateInput(event);\n"
  "  if (v.error) return fail(v.error, v.msg);\n",
  "  // ===== 2. 校验 =====\n"
  "  const v = validateInput(event);\n"
  "  if (v.error) return fail(v.error, v.msg);\n"
  "\n"
  "  // ===== 2.2. 店铺归属校验（🔴 R298 · B4 越权面修补）=====\n"
  "  //  契约 `specs/dev-specs/core/10_云函数清单与接口契约.md` §9 的「鉴权」列写的是 **`user+shop`**，\n"
  "  //  而本函数此前**只做了 user**（resolveAuth），**没有 shop 归属校验** ⇒ 契约 ≡ 实然不一致。\n"
  "  //  真实后果（行为级实证，非静态推断）：任意已登录用户把 `shop_id` 换成别人的，即可拿到\n"
  "  //  他人店铺的**成本卡计数**（`used`）。取证件：\n"
  "  //    `review/evidence/r298_b4_tenant/probe_checkquota_cross_tenant.js`\n"
  "  //    —— 修前：调用者 B + shop_A ⇒ `{code:'SUCCESS', used:3}`（= A 店的卡数）。\n"
  "  //  ⚠️ `shop_cost_card` 没有 `user_id` 字段，成本卡维度**只能按 shop_id 计数**\n"
  "  //     （见本文件头注与 service.js），所以归属校验在这里不是可选项，是**唯一**的隔离手段。\n"
  "  const owner = await assertShopOwner(db, shopId, userId);\n"
  "  if (owner.error) return fail(owner.error, owner.msg);\n", 1))

# ============ 2. cloudfunctions/verifyTangshi/index.js ============
P2 = 'cloudfunctions/verifyTangshi/index.js'
PLAN.append((P2,
  "exports.main = async () => {\n"
  "  const where = { platform: 'pos', biz_date: '2026-09-13', is_deleted: false };\n",
  "exports.main = async () => {\n"
  "  // 🔴 R298（B4）：**加来源校验**。本函数原先 `exports.main = async () => {...}` 无任何来源判定，\n"
  "  //   而契约明写「不进前端调用链」—— 但 `wx.cloud.callFunction` 是**客户端可直达**的，\n"
  "  //   ⇒ 任意已登录用户都能拿到**全库聚合**（count / sumYuan）与**跨店 `shopIds` 列表**。\n"
  "  //   判据沿用 R215 既定定式（payExpireNotify / smokeTest 同款）：**有用户 OPENID 即客户端调用 ⇒ 拒绝**；\n"
  "  //   云控制台「测试」与 `cli` 调用都没有用户上下文（OPENID 为空）⇒ 诊断能力不受影响。\n"
  "  //   ⚠️ 同族守卫 `tools/check_fn_public_surface.js` 的 PUBLIC_FNS 已把本项从 `mustSelfGuard: false`\n"
  "  //      改为 `true`（原先的豁免理由只答了「不写库」，没答「别人能不能调」）。\n"
  "  const ctx = cloud.getWXContext();\n"
  "  if (ctx && ctx.OPENID) return { ok: false, code: 'FORBIDDEN', msg: 'verifyTangshi 仅限云控制台 / cli 调用（R298 加固）' };\n"
  "\n"
  "  const where = { platform: 'pos', biz_date: '2026-09-13', is_deleted: false };\n", 1))

# ============ 3. 契约文档：verifyTangshi 鉴权格补加固说明 ============
P3 = 'specs/dev-specs/core/10_云函数清单与接口契约.md'
PLAN.append((P3,
  "| 无（仅 dev 诊断；服务端 admin 直读 external_sales_daily，不依赖 OPENID、不写库） |",
  "| 无（仅 dev 诊断；**R298 加固**：有用户 OPENID 即拒 —— 同 `payExpireNotify`/`smokeTest` 定式；服务端 admin 直读 external_sales_daily、不写库） |", 1))

# ============ 4. tools/check_fn_public_surface.js ============
P4 = 'tools/check_fn_public_surface.js'
# 4a 登记表：verifyTangshi 改 mustSelfGuard true
PLAN.append((P4,
  "  { fn: 'verifyTangshi', why: 'M3.33 一次性只读探针：固定 where 聚合 external_sales_daily，不读 OPENID、不写库、仅 dev 诊断用', mustSelfGuard: false },\n",
  "  // 🔴 R298（B4）：本项原先 `mustSelfGuard: false`，理由写的是「不读 OPENID、不写库」——\n"
  "  //   那句**只回答了「它自己会不会写坏数据」，没回答「别人能不能调它」**。实测：\n"
  "  //   `wx.cloud.callFunction({name:'verifyTangshi'})` 是**客户端可直达**的（其自身头注的触发方式就是 `mp.evaluate`），\n"
  "  //   返回 `{count, sumYuan, shopIds, ...}` ⇒ **跨租户**暴露（含他人 `shop_id` 列表 + 全库聚合）。\n"
  "  //   ⇒ 与 `payExpireNotify` / `smokeTest` 同族，按 R215 定式改为必须自保（同批已在源码侧加来源校验）。\n"
  "  { fn: 'verifyTangshi', why: 'M3.33 一次性只读探针（固定 where 聚合 external_sales_daily；不写库）—— R298 已加固：有用户 OPENID 即拒绝', mustSelfGuard: true },\n", 1))

# 4b 前提：新增 SHOP_AUTH_WAIVED 常量（插在 let pass 之前）
PLAN.append((P4,
  "let pass = 0, failN = 0;\n",
  "// ===== E 组配套：契约「鉴权」列含 shop、但**有意不做** `assertShopOwner` 的登记表 =====\n"
  "// 双向防腐（同 §B 组手法）：① 陈旧键（契约里其实不含 shop）⇒ 红；② 腐化（代码其实做了归属校验）⇒ 红。\n"
  "// 每条必须写 why ≥12 字。\n"
  "const SHOP_AUTH_WAIVED = [\n"
  "  {\n"
  "    fn: 'getShopContext',\n"
  "    why: '恒取「本人第一店」（da.list(shop,{user_id})[0]），**完全忽略** event.shop_id ⇒ 按构造不可能读到他人店',\n"
  "  },\n"
  "];\n"
  "\n"
  "let pass = 0, failN = 0;\n", 1))

# 4c 头注：补 E 组说明（并在原 E 自失效护栏前插入）
PLAN.append((P4,
  "//   E 自失效护栏：断言数下界 + 扫描面文件数下界（防\"扫空 ⇒ 0 ≤ 预算 ⇒ 恒绿\"）。\n",
  "//   E 契约「鉴权」列 ≡ 实然归属校验（**R298 / B4 越权面**）：契约说 `user+shop` 的函数，\n"
  "//     代码里必须真的做归属校验（`= await assertShopOwner(`），或显式登记进 SHOP_AUTH_WAIVED；\n"
  "//     豁免表双向防腐 + 解析器自证（含「入参格里带转义竖线」的样本 —— 手切列会切歪）。\n"
  "//     ⚠️ E 组**置于 D 组之前**，使 D-①「断言数下界」覆盖全部判据（D 是收尾的自失效护栏）。\n"
  "//   F 自失效护栏：断言数下界 + 扫描面文件数下界（防\"扫空 ⇒ 0 ≤ 预算 ⇒ 恒绿\"）。\n", 1))

# 4d 插入 E 组（在 D 组段首之前）
E_BLOCK = r"""
console.log('\n===== E · 契约「鉴权」列 ≡ 实然归属校验（R298 · B4 越权面）=====');
// 解析契约表行。🔴 必须按**未转义**的竖线切：`|` 在 markdown 表格里可用 `\|` 转义，
//   而本表「入参」格里的联合类型写作 `'cc'\|'user'\|'shop'\|'all'` ⇒ 朴素 split('|') 会把列**整体切歪**，
//   于是「鉴权」列会读到邻格内容（实测：smokeTest 的入参格含 'shop' ⇒ 它的鉴权格被误读成含 shop）。
function contractAuthByFn(lines) {
  const out = [];
  for (const l of lines) {
    const m = /^\|\s*`([A-Za-z_][A-Za-z0-9_]*)`\s*\|/.exec(l);
    if (!m) continue;
    const parts = l.split(/(?<!\\)\|/);
    if (parts.length < 7) continue;
    out.push({ fn: m[1], auth: parts[parts.length - 2].trim() });
  }
  return out;
}
const contractRows = contractAuthByFn(docLines);
const shopAuthFns = contractRows.filter((r) => /shop/i.test(r.auth)).map((r) => r.fn).filter((n) => withIdx.includes(n));
check('E-① 契约「鉴权」列含 shop 的函数数 ≥ 24（解析器非退化）', shopAuthFns.length >= 24, '实测 ' + shopAuthFns.length + ' 个');
// 生产形态归属校验（与 A 组同口径：解构导入后直接 await 取返回值）
const OWNER_PROD_RE = /=\s*await\s+assertShopOwner\s*\(/;
function hasOwnerCheck(fn) {
  const p = path.join(CF, fn, 'index.js');
  if (!fs.existsSync(p)) return false;
  return OWNER_PROD_RE.test(stripComments(fs.readFileSync(p, 'utf8')));
}
const waivedFns = SHOP_AUTH_WAIVED.map((x) => x.fn);
const noOwner = shopAuthFns.filter((n) => !hasOwnerCheck(n) && !waivedFns.includes(n));
check('E-② 契约含 shop 的函数都必须有归属校验（或显式豁免）', noOwner.length === 0,
  noOwner.length ? '缺归属校验：' + noOwner.join(' / ') : shopAuthFns.length + ' 个已覆盖（含 ' + waivedFns.length + ' 条豁免）');
const staleWaive = SHOP_AUTH_WAIVED.filter((x) => !shopAuthFns.includes(x.fn));
check('E-③ 豁免表无陈旧键（契约里确实标了含 shop）', staleWaive.length === 0,
  staleWaive.length ? '陈旧：' + staleWaive.map((x) => x.fn).join(' / ') : waivedFns.length + ' 条均对应');
const rotWaive = SHOP_AUTH_WAIVED.filter((x) => hasOwnerCheck(x.fn));
check('E-④ 豁免表反向防腐：已补归属校验却仍登记豁免 ⇒ 红', rotWaive.length === 0,
  rotWaive.length ? '已补仍登记：' + rotWaive.map((x) => x.fn).join(' / ') : '无腐化');
const noWhy2 = SHOP_AUTH_WAIVED.filter((x) => !x.why || x.why.length < 12);
check('E-⑤ 每条豁免都有 why（≥12 字，说明为什么不需要归属校验）', noWhy2.length === 0,
  noWhy2.length ? '缺 why：' + noWhy2.map((x) => x.fn).join(' / ') : SHOP_AUTH_WAIVED.length + ' 条全有');
const ownerCount = withIdx.filter(hasOwnerCheck).length;
check('E-⑥ 有归属校验的函数数 ≥ 26（扫描面非退化）', ownerCount >= 26, '实测 ' + ownerCount + ' 个');
// 解析器自证（合成样本）：正样本含转义竖线的入参格，负样本鉴权列不含 shop
const SAMPLE_SHOP = '| `fakeShopFn` | 用途 | `{ x: \'a\'\\|\'b\' }` | `{}` | user+shop |';
const SAMPLE_USER = '| `fakeUserFn` | 用途 | `{ shop_id }` | `{}` | user |';
const parsedShop = contractAuthByFn([SAMPLE_SHOP]);
const parsedUser = contractAuthByFn([SAMPLE_USER]);
check('E-⑦ 解析器自证：带转义竖线的 user+shop 行 ⇒ 认出该函数且鉴权含 shop',
  parsedShop.length === 1 && parsedShop[0].fn === 'fakeShopFn' && /shop/i.test(parsedShop[0].auth),
  parsedShop.length ? (parsedShop[0].fn + ' / auth=' + parsedShop[0].auth) : '未解析出');
check('E-⑧ 解析器自证：鉴权列=user 的行 ⇒ 不落入 shop 面（哪怕入参格含 shop_id）',
  parsedUser.length === 1 && !/shop/i.test(parsedUser[0].auth),
  parsedUser.length ? ('auth=' + parsedUser[0].auth) : '未解析出');

"""
PLAN.append((P4,
  "console.log('\\n===== D · 自失效护栏 =====');\n",
  E_BLOCK + "console.log('\\n===== D · 自失效护栏 =====');\n", 1))

# 4e 断言数下界随实测上抬（R298：17 → 27；下界取保守下沿 20）
PLAN.append((P4,
  "const MIN_ASSERTIONS = 15;                   // 实测 16 条 ⇒ 保守下沿\n",
  "const MIN_ASSERTIONS = 20;                   // R298 扩 E 组后实测 27 条 ⇒ 保守下沿 20（原 17 条时为 15）\n", 1))

# ============ 5. tools/selftest_r85.js：A15 白名单登记 verifyTangshi ============
P5 = 'tools/selftest_r85.js'
PLAN.append((P5,
  "  /^cloudfunctions\\/importSalesBill\\//,\n",
  "  /^cloudfunctions\\/importSalesBill\\//,\n"
  "  /^cloudfunctions\\/verifyTangshi\\//,                 // R298（B4）：加来源校验（有用户 OPENID 即拒）—— 越权面修补，非同步动作\n", 1))

# ============ 两阶段：先全量校验 ============
texts = {}
for rel in [P1, P2, P3, P4, P5]:
    texts[rel] = load(rel)

ok = True
work = {}
for rel in [P1, P2, P3, P4, P5]:
    work[rel] = texts[rel]

for rel, old, new, want in PLAN:
    hits = work[rel].count(old)
    flag = 'OK ' if hits == want else 'FAIL'
    if hits != want:
        ok = False
    print('[%s] %-44s 命中 %d（期望 %d）  %s' % (flag, rel, hits, want, old.strip().split('\n')[0][:58]))
    if hits == want:
        work[rel] = work[rel].replace(old, new, want)

if not ok:
    print('\n❌ 有锚点未达期望 ⇒ 一个文件都不写，响亮退出。')
    sys.exit(1)

print('\n✅ 全部锚点命中正确 ⇒ 统一落盘')
for rel in [P1, P2, P3, P4, P5]:
    b = work[rel].encode('utf-8')
    assert b'\r' not in b, '落盘前自检：不允许 CR'
    with open(os.path.join(ROOT, rel), 'wb') as f:
        f.write(b)
    print('  写入 %s（%d 字节）' % (rel, len(b)))
