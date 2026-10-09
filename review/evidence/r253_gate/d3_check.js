// D3 复核：cloudfunctions/importSalesBill/index.js 对哨兵的处理必须与错误码口径一致
// 手法：剥注释后判结构（防「注释里有、代码里没有」的假绿），并用真 require 的 service 复算哨兵确实触发
const fs = require('fs');
const path = require('path');
const R = (p) => path.join(__dirname, '..', '..', '..', p);

const src = fs.readFileSync(R('cloudfunctions/importSalesBill/index.js'), 'utf8');
// 剥注释：否则注释里写了 AMBIGUOUS 也算过（裸子串假绿）
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let bad = 0;
function ck(name, cond, detail) {
  console.log((cond ? '✅ ' : '❌ ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!cond) bad++;
}

ck('P1 index.js 显式比较 platform === PLATFORM_AMBIGUOUS（非 if(platform) 判空）',
  /platform\s*===\s*PLATFORM_AMBIGUOUS/.test(code), '');
ck('P2 index.js 从 service 导入 PLATFORM_AMBIGUOUS（避免 ReferenceError）',
  /PLATFORM_AMBIGUOUS/.test(code.split('require(\'./service\')')[0]), '');
ck('P3 哨兵分支在 pickSheet 之前（不被"认不出"分支抢先归因）',
  code.indexOf('PLATFORM_AMBIGUOUS') < code.indexOf('无法识别账单平台'), '');
ck('P4 哨兵分支给出可读提示且含"手动选择平台"指引',
  code.indexOf('同时符合多个平台') >= 0 && code.indexOf('手动选择平台') >= 0, '');
ck('P5 走既有的 ERROR_CODES.INVALID_PARAM（不新造错误码）',
  /fail\(ERROR_CODES\.INVALID_PARAM,\s*'这张表同时符合/.test(code), '');

// ---- 行为面：真 require service，确认哨兵真的会在矩阵级触发 ----
let svc = null;
try { svc = require(R('cloudfunctions/importSalesBill/service.js')); }
catch (e) {
  const Module = require('module');
  const orig = Module._load;
  Module._load = function (req) { if (req === 'xlsx') return {}; return orig.apply(this, arguments); };
  svc = require(R('cloudfunctions/importSalesBill/service.js'));
  Module._load = orig;
}
const m = { sheets: { '外卖账单明细': { rows: [['账单日期', '结算金额', '商家应收款'], ['1', '2', '3']] } } };
const hit = svc.detectPlatformInMatrix(m);
ck('P6 真调 service.detectPlatformInMatrix 在多平台表上返哨兵（行为级，非字面）',
  !!(hit && hit.platform === svc.PLATFORM_AMBIGUOUS), JSON.stringify(hit));
ck('P7 哨兵值域与 index.js 比较的常量同源（都是 service 导出的那个）',
  svc.PLATFORM_AMBIGUOUS === 'AMBIGUOUS', String(svc.PLATFORM_AMBIGUOUS));

console.log('\n结论：', bad === 0 ? '✅ D3 全通过' : ('❌ ' + bad + ' 处不符'));
process.exit(bad === 0 ? 0 : 1);
