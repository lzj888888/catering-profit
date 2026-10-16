# -*- coding: utf-8 -*-
"""R298-D2：给 tools/check_yield_rate_range.js 插入 E 段（netUnitCostWan 五副本夹紧判据）。
纪律：锚点命中须 ==1；按目标文件自身 eol 展开；先 encode 再 write；不写 ASCII 双引号。
"""
import os, sys

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
REL = 'tools/check_yield_rate_range.js'
AP = os.path.join(ROOT, REL.replace('/', os.sep))

ANCHOR = '// ============ D 自失效护栏 ============'

E_SEG = '''// ============ E 五副本夹紧：netUnitCostWan 出成率/换算系数 fail-closed ============
// 🔴 R298（D2）：五份 netUnitCostWan（calcBom/getMaterial/saveCostCard/saveMaterial/syncCostCard）
//   原实现是**裸除** —— `(price/100)/cf/(yieldRate/100)`：出成率 0 ⇒ ÷0 = Infinity；
//   缺失/空串 ⇒ NaN；>100 ⇒ 成本被低估（R297 前端已拦，**云端无 validate 兜底**的手工行路径仍可达）。
//   夹紧口径与前端 `utils/units.js::yieldRateOf` 一致：越界/缺失 ⇒ 100（不折损，中性）；换算系数 ≤0 ⇒ 1。
//   本段判据：① 五副本都能解析求值；② 合法域输出与裸公式**完全一致**（证夹紧没改合法路径）；
//   ③ 越界/缺失输出**有限**且等于夹紧值；④ 裸实现在边界样本上与新实现**有差异**（证判据非恒真）。
sec('E 五副本夹紧：netUnitCostWan 出成率/换算系数 fail-closed（口径同 yieldRateOf：未填=100）');
const NFUW_FILES = [
  'cloudfunctions/calcBom/service.js',
  'cloudfunctions/getMaterial/service.js',
  'cloudfunctions/saveCostCard/service.js',
  'cloudfunctions/saveMaterial/service.js',
  'cloudfunctions/syncCostCard/service.js',
];
function loadNucw(rel) {
  let raw = '';
  try { raw = readRel(rel); } catch (e) { return null; }
  const body = (raw.match(/function netUnitCostWan\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}/) || [''])[0];
  const helper = (raw.match(/function purchasePerGramYuan\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}/) || [''])[0];
  if (!body) return null;
  try { return new Function(helper + '\\n' + body + '\\nreturn netUnitCostWan;')(); } catch (e) { return null; }
}
const NU = NFUW_FILES.map(loadNucw);
check('E-① 五副本均可解析并求值（fail-closed：读不到 / 求不出即红）',
  NU.every((f) => typeof f === 'function'),
  NU.map((f, i) => (typeof f === 'function' ? 'ok' : NFUW_FILES[i])).join(' / '));

// E-② 合法域：五副本输出一致、且等于裸公式 —— 证明夹紧**未改合法路径行为**
{
  const LEGAL = [[1500, 500, 90, 333], [2000, 500, 90, 444], [448, 1, 100, 44800], [1000, 500, 100, 2000]];
  const bad = [];
  for (const c of LEGAL) {
    for (let i = 0; i < NU.length; i++) {
      const got = NU[i] ? NU[i](c[0], c[1], c[2]) : NaN;
      if (got !== c[3]) bad.push(NFUW_FILES[i] + '(' + c[0] + ',' + c[1] + ',' + c[2] + ')=' + got + '(应 ' + c[3] + ')');
    }
  }
  check('E-② 合法域 ' + LEGAL.length + ' 组 × 5 副本 = ' + (LEGAL.length * 5) + ' 点全中（合法路径零漂移）',
    bad.length === 0, bad.length ? bad.slice(0, 6).join('；') : '全中');
}

// E-③ 越界/缺失：输出必须**有限**，且等于「夹紧后」的值（出成率→100 / 换算系数→1）
{
  const CASES = [
    [1500, 500, 0, 300, '出成率 0'],
    [1500, 500, undefined, 300, '出成率缺失'],
    [1500, 500, '', 300, '出成率空串'],
    [1500, 500, 'abc', 300, '出成率非数'],
    [1500, 500, -5, 300, '出成率负数'],
    [1500, 500, 150, 300, '出成率 >100（原算法给 200）'],
    [1500, 500, 1000, 300, '出成率夸张值'],
    [1500, 0, 100, 150000, '换算系数 0'],
    [1500, null, 100, 150000, '换算系数 null'],
    [1500, -2, 100, 150000, '换算系数负'],
  ];
  const bad = [];
  for (const c of CASES) {
    for (let i = 0; i < NU.length; i++) {
      const got = NU[i] ? NU[i](c[0], c[1], c[2]) : NaN;
      if (!Number.isFinite(got) || got !== c[3]) {
        bad.push('副本' + i + '(' + c[0] + ',' + c[1] + ',' + c[2] + ')=' + got + '(应 ' + c[3] + ')[' + c[4] + ']');
      }
    }
  }
  check('E-③ 越界/缺失 ' + CASES.length + ' 组 × 5 副本 = ' + (CASES.length * 5) + ' 点全部有限且夹紧到位（禁 Infinity / NaN）',
    bad.length === 0, bad.length ? bad.slice(0, 6).join('；') : (CASES.length * 5) + ' 点全中');
}

// E-④ 鉴别力钉死：裸实现（无夹紧）在边界样本上必须与新实现**不同** —— 证明 E-③ 不是恒真
{
  const bare = (p, cf, y) => Math.round((p / 100) / cf / (y / 100) * 10000);
  const NU0 = NU[0] || (() => NaN);
  const PROBES = [[1500, 500, 0], [1500, 500, 150], [1500, 500, ''], [1500, 0, 100]];
  const diff = PROBES.filter((c) => !Object.is(bare(c[0], c[1], c[2]), NU0(c[0], c[1], c[2]))).length;
  check('E-④ 裸实现与夹紧实现在 4 个边界样本上全部有差异（判据有鉴别力）', diff === PROBES.length,
    '差异 ' + diff + '/4（如 出成率0 ⇒ 裸 ' + bare(1500, 500, 0) + ' vs 夹紧 ' + NU0(1500, 500, 0) + '）');
}

'''

raw = open(AP, 'rb').read()
eol = '\r\n' if b'\r\n' in raw else '\n'
txt = raw.decode('utf-8')
anc = ANCHOR.replace('\n', eol)
seg = E_SEG.replace('\n', eol)
cnt = txt.count(anc)
print('锚点命中 =', cnt, ' 行尾 =', 'CRLF' if eol == '\r\n' else 'LF')
if cnt != 1:
    print('❌ 命中 != 1 ⇒ 不写')
    sys.exit(1)
out = txt.replace(anc, seg + anc, 1)
data = out.encode('utf-8')
open(AP, 'wb').write(data)
print('✅ 已插入 E 段 (%d -> %d 字节)' % (len(raw), len(data)))
