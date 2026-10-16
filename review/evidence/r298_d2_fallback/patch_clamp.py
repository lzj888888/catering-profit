# -*- coding: utf-8 -*-
"""R298-D2 两阶段补丁：给 5 个 netUnitCostWan 副本加「出成率/换算系数」夹紧。
纪律：① 全部锚点命中数必须 == 1，否则一个文件都不写；② 按目标文件自身行尾展开；③ 先 encode 再 write_bytes。
"""
import os, re, sys, hashlib

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'

OLD_PLAIN = '''function netUnitCostWan(purchasePriceFen, convertFactor, yieldRate) {
  const yuan = (purchasePriceFen / 100) / convertFactor / (yieldRate / 100);
  return Math.round(yuan * 10000);
}'''

NEW_PLAIN = '''function netUnitCostWan(purchasePriceFen, convertFactor, yieldRate) {
  // 🔴 R298（D2）：出成率 / 换算系数**夹紧**（口径同前端 utils/units.js::yieldRateOf：未填=100）。
  //   原实现裸除 ⇒ yieldRate=0 时 ÷0 = Infinity、缺失时 NaN、>100 时成本被系统性低估（静默错账）。
  //   手工行路径（saveCostCard/index.js）云端**无 validate 兜底** ⇒ 必须在本函数内 fail-closed。
  //   越界 / 缺失 / 非数 ⇒ 100（不折损，中性值）；换算系数 ≤0 ⇒ 1。
  const y = Number(yieldRate);
  const yr = (Number.isFinite(y) && y > 0 && y <= 100) ? y : 100;
  const cf = Number(convertFactor) > 0 ? Number(convertFactor) : 1;
  const yuan = (purchasePriceFen / 100) / cf / (yr / 100);
  return Math.round(yuan * 10000);
}'''

OLD_CALCBOM = '''function netUnitCostWan(purchasePriceFen, convertFactor, yieldRate) {
  const yuan = purchasePerGramYuan(purchasePriceFen, convertFactor) / (yieldRate / 100);
  return Math.round(yuan * 10000); // round 到 4 位小数（万分）
}'''

NEW_CALCBOM = '''function netUnitCostWan(purchasePriceFen, convertFactor, yieldRate) {
  // 🔴 R298（D2）：出成率 / 换算系数**夹紧**（口径同前端 utils/units.js::yieldRateOf：未填=100）。
  //   原实现裸除 ⇒ yieldRate=0 时 ÷0 = Infinity、缺失时 NaN、>100 时成本被低估（静默错账）。
  //   与另 4 个副本（getMaterial / saveCostCard / saveMaterial / syncCostCard）行为同源。
  const y = Number(yieldRate);
  const yr = (Number.isFinite(y) && y > 0 && y <= 100) ? y : 100;
  const cf = Number(convertFactor) > 0 ? Number(convertFactor) : 1;
  const yuan = purchasePerGramYuan(purchasePriceFen, cf) / (yr / 100);
  return Math.round(yuan * 10000); // round 到 4 位小数（万分）
}'''

PLAIN = ['cloudfunctions/getMaterial/service.js',
         'cloudfunctions/saveCostCard/service.js',
         'cloudfunctions/saveMaterial/service.js',
         'cloudfunctions/syncCostCard/service.js']
CALCBOM = 'cloudfunctions/calcBom/service.js'

plan = [(rel, OLD_PLAIN, NEW_PLAIN) for rel in PLAIN] + [(CALCBOM, OLD_CALCBOM, NEW_CALCBOM)]

# ---------- 阶段 1：全部在内存里改 + 断言 ----------
pending = []
ok = True
for rel, old, new in plan:
    ap = os.path.join(ROOT, rel.replace('/', os.sep))
    raw = open(ap, 'rb').read()
    eol = '\r\n' if b'\r\n' in raw else '\n'
    txt = raw.decode('utf-8')
    o = old.replace('\n', eol)
    n = new.replace('\n', eol)
    cnt = txt.count(o)
    print('%-45s 锚点命中=%d  行尾=%s' % (rel, cnt, 'CRLF' if eol == '\r\n' else 'LF'))
    if cnt != 1:
        ok = False
        print('   ❌ 命中 != 1 ⇒ 整批不写')
        continue
    pending.append((ap, txt.replace(o, n, 1), raw))

if not ok:
    print('\n阶段 1 失败 ⇒ 一个文件都没写。')
    sys.exit(1)

# ---------- 阶段 2：统一落盘 ----------
for ap, newtxt, oldraw in pending:
    data = newtxt.encode('utf-8')      # 先 encode 再 open('wb')
    with open(ap, 'wb') as f:
        f.write(data)
    print('  ✅ 写入 %s  (%d -> %d 字节)' % (os.path.relpath(ap, ROOT), len(oldraw), len(data)))

print('\n阶段 2 完成：%d 个文件已落盘。' % len(pending))
