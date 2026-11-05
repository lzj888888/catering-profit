# -*- coding: utf-8 -*-
"""R298 · B2 第二批补丁：「元→分」同族裸换算 16 处 → 十进制安全
纪律：所有文件**一律从 HEAD blob 取内容**（消除工作树 CRLF 噪声），按纯 LF 写回；
     两阶段：先在内存全量校验（每锚点命中须 == 1），全通过才统一落盘。
"""
import os, subprocess, sys

def find_root(start):
    d = os.path.abspath(start)
    while True:
        if os.path.exists(os.path.join(d, 'verify_all.js')):
            return d
        p = os.path.dirname(d)
        if p == d:
            raise RuntimeError('未找到仓根')
        d = p

ROOT = find_root(os.path.dirname(os.path.abspath(__file__)))
NL = chr(10)

def safe(expr):
    """十进制安全的「元 × 100」取整表达式（原 expr 形如 'yuan * 100'）"""
    return 'Math.round(Number((' + expr + ').toFixed(10)))'

def L(*parts):
    return NL.join(parts)

# 各文件共同的一句注释（首处）
CMT = [
    '// 🔴 R298（B2）：**十进制安全** —— 原式 `Math.round(<元> * 100)` 在半步（真值恰为 x.xx5）会',
    '//   **少进 1 分**（实测 qty=0.1 × 净料 14500 万分之元 ⇒ 真值 14.5 分，原式取 14）。根因与',
    '//   `money.yuanToFen` 同一处浮点：`toFixed(10)` 只消 1e-13 量级噪声、不动真实半步。',
    '//   成本引擎三副本（calcBom / saveCostCard / syncCostCard）**必须同源同口径**。',
]

PATCHES = []

# ================= 1. calcBom/service.js =================
PATCHES.append(('cloudfunctions/calcBom/service.js', [
 ('      line_net_cost_fen: Math.round(yuan * 100), // 展示用；合计用高精度 yuan，不逐行 round 累加',
  L(*['      ' + c for c in CMT],
    '      line_net_cost_fen: ' + safe('yuan * 100') + ', // 展示用；合计用高精度 yuan，不逐行 round 累加')),
 ('  const materialTotalFen = Math.round(detailSumYuan * 100);',
  '  const materialTotalFen = ' + safe('detailSumYuan * 100') + ';'),
 ('  const unitCostFen = Math.round(rawTotalYuan * 100); // round 到分（落库值）',
  '  const unitCostFen = ' + safe('rawTotalYuan * 100') + '; // round 到分（落库值）'),
]))

# ================= 2. saveCostCard/service.js =================
PATCHES.append(('cloudfunctions/saveCostCard/service.js', [
 ('    lineOut.push({ quantity: qty, net_unit_cost: wan, line_net_cost_fen: Math.round(yuan * 100) });',
  L(*['    ' + c for c in CMT],
    '    lineOut.push({ quantity: qty, net_unit_cost: wan, line_net_cost_fen: ' + safe('yuan * 100') + ' });')),
 ('  const materialTotalFen = Math.round(detailSumYuan * 100);',
  '  const materialTotalFen = ' + safe('detailSumYuan * 100') + ';'),
 ('  let unitCostFen = Math.round(rawTotalYuan * 100);',
  '  let unitCostFen = ' + safe('rawTotalYuan * 100') + ';'),
]))

# ================= 3. syncCostCard/service.js =================
PATCHES.append(('cloudfunctions/syncCostCard/service.js', [
 ('    lineOut.push({ quantity: qty, net_unit_cost: wan, line_net_cost_fen: Math.round(yuan * 100) });',
  L(*['    ' + c for c in CMT],
    '    lineOut.push({ quantity: qty, net_unit_cost: wan, line_net_cost_fen: ' + safe('yuan * 100') + ' });')),
 ('  const materialTotalFen = Math.round(detailSumYuan * 100);',
  '  const materialTotalFen = ' + safe('detailSumYuan * 100') + ';'),
 ('  let unitCostFen = Math.round(rawTotalYuan * 100);',
  '  let unitCostFen = ' + safe('rawTotalYuan * 100') + ';'),
]))

# ================= 4. calcBom/validate.js =================
PATCHES.append(('cloudfunctions/calcBom/validate.js', [
 ("  const auxFen = isFiniteNum(src.aux_fen) ? src.aux_fen : (isFiniteNum(src.auxYuan) ? Math.round(src.auxYuan * 100) : 0);",
  L(*['  ' + c for c in CMT],
    '  const auxFen = isFiniteNum(src.aux_fen) ? src.aux_fen : (isFiniteNum(src.auxYuan) ? ' + safe('src.auxYuan * 100') + ' : 0);')),
 ("  const priceFen = isFiniteNum(src.price_fen) ? src.price_fen : (isFiniteNum(src.priceYuan) ? Math.round(src.priceYuan * 100) : 0);",
  '  const priceFen = isFiniteNum(src.price_fen) ? src.price_fen : (isFiniteNum(src.priceYuan) ? ' + safe('src.priceYuan * 100') + ' : 0);'),
]))

# ================= 5. saveCostCard/validate.js =================
PATCHES.append(('cloudfunctions/saveCostCard/validate.js', [
 ("    : (typeof card.auxYuan === 'number' ? Math.round(card.auxYuan * 100) : 0);",
  L(*['    ' + c for c in CMT],
    "    : (typeof card.auxYuan === 'number' ? " + safe('card.auxYuan * 100') + ' : 0);')),
 ("    : (typeof card.priceYuan === 'number' ? Math.round(card.priceYuan * 100) : 0);",
  "    : (typeof card.priceYuan === 'number' ? " + safe('card.priceYuan * 100') + ' : 0);'),
 ("    : (typeof card.activity_price_yuan === 'number' ? Math.round(card.activity_price_yuan * 100) : 0);",
  "    : (typeof card.activity_price_yuan === 'number' ? " + safe('card.activity_price_yuan * 100') + ' : 0);'),
]))

# ================= 6. pages/card/edit.js =================
PATCHES.append(('pages/card/edit.js', [
 ('        priceFen: Math.round(priceYuan * 100),',
  L(*['        ' + c for c in CMT],
    '        priceFen: ' + safe('priceYuan * 100') + ',')),
 ('    return Math.round(yuan * 100);',
  '    return ' + safe('yuan * 100') + ';'),
]))

# ---------- 阶段 1：全量校验 ----------
print('=' * 84)
print('阶段 1：全量校验（任一命中 != 1 或行尾不纯 ⇒ 一个文件都不写）')
print('=' * 84)
plan = {}
ok_all = True
total = 0
for rel, subs in PATCHES:
    raw = subprocess.run(['git', 'show', 'HEAD:' + rel], cwd=ROOT, capture_output=True).stdout
    txt = raw.decode('utf-8')
    if '\r' in txt:
        print('%-44s ❌ HEAD blob 含 CR，异常' % rel)
        ok_all = False
        continue
    cur = txt
    marks = []
    for old, new in subs:
        n = cur.count(old)
        marks.append(n)
        if n != 1:
            print('%-44s ❌ 锚点命中=%d（须 1）：%s' % (rel, n, old[:70]))
            ok_all = False
            continue
        cur = cur.replace(old, new, 1)
        total += 1
    if cur.count('\r') != 0:
        print('%-44s ❌ 结果非纯 LF' % rel)
        ok_all = False
        continue
    print('%-44s 命中 %s  改动 %d 处  结果 CR=%d' % (rel, marks, len(subs), cur.count('\r')))
    plan[rel] = cur.encode('utf-8')

print()
if not ok_all or len(plan) != len(PATCHES):
    print('❌ 校验未全通过 ⇒ 一个文件都不写')
    sys.exit(1)
print('✅ 全部 %d 个文件、共 %d 处校验通过' % (len(plan), total))

# ---------- 阶段 2：统一落盘 ----------
print()
print('=' * 84)
print('阶段 2：统一落盘（全部纯 LF）')
print('=' * 84)
for rel, data in plan.items():
    open(os.path.join(ROOT, rel), 'wb').write(data)
    print('  已写 %-44s %d 字节' % (rel, len(data)))
print('\n完成。')
