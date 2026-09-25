// _r123_verify_fix.js —— 验证 pages/card/edit.js 两个缺陷已修（正负互证）
//   缺陷 A：非编辑路径 init.lines 未赋值 ⇒ TypeError ⇒ toast「系统异常」（新增菜品必现）
//   缺陷 B：wx:key="idx" 重复（预填写死 idx:0 + delLine 不重排）⇒ 明细行输入即丢
// 纪律：断言对象是**真源码**（renumber 从 edit.js 抽取后 eval），不是复制的副本。
const fs = require('fs');
const pathmod = require('path');
// 入仓版：相对仓根定位（本脚本位于 review/evidence/，上溯两级到仓根）
const path = pathmod.resolve(__dirname, '..', '..', 'pages', 'card', 'edit.js');
const src = fs.readFileSync(path, 'utf8');

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { pass++; results.push('  ✅ ' + name); }
  else { fail++; results.push('  ❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function codeOnly(t) {
  // 剥掉注释，避免「注释里提到旧写法」被误判（本题的注释里确实提到了 idx:0 / init.lines.length）
  return t.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
}
const code = codeOnly(src);

console.log('===== A. 形态断言（真源码，剥注释后）=====');
check('A1 不再出现「idx: 0」缺陷字面量', !/idx:\s*0\b/.test(code),
  (code.match(/.*idx:\s*0\b.*/) || [''])[0].trim().slice(0, 80));
check('A2 非编辑路径有 undefined 短路保护', /if\s*\(\s*!init\.lines\s*\|\|/.test(code),
  '未找到 `!init.lines ||`');
check('A3 存在 renumber 定义', /function\s+renumber\s*\(/.test(code));
const renumCalls = (code.match(/renumber\s*\(/g) || []).length - (/function\s+renumber\s*\(/.test(code) ? 1 : 0);
check('A4 renumber 被调用 ≥3 次（onLoad 预填 / 空行兜底 / addLine / delLine）', renumCalls >= 3,
  '实际调用 ' + renumCalls + ' 次');
check('A5 存在空行工厂 emptyLine', /function\s+emptyLine\s*\(/.test(code));
check('A6 delLine 内使用 renumber 重排', /delLine[\s\S]{0,400}?renumber\s*\(/.test(code));
check('A7 addLine 内使用 renumber 重排', /addLine[\s\S]{0,200}?renumber\s*\(/.test(code));

console.log('\n===== B. 行为断言（renumber 从真源码抽取后 eval）=====');
const m = src.match(/function\s+renumber\s*\(lines\)\s*\{[\s\S]*?\n\}/);
check('B0 成功从 edit.js 抽取 renumber 源码', !!m);
let renumber = null;
if (m) { eval('renumber = ' + m[0].replace(/^function\s+renumber/, 'function') + ';'); }
check('B1 抽取的函数可执行', typeof renumber === 'function');

// 旧写法等价物（不重排 idx）—— 用于「负向对照」：证明本测试能抓到重复键
const oldPrefill = (n) => Array.from({ length: n }, () => ({ idx: 0, material_id: 'm', qty: '1' }));
const oldDel = (arr, i) => arr.filter((_, k) => k !== i);          // 只 filter、不重排
const oldAdd = (arr) => arr.concat([{ idx: arr.length, material_id: '', qty: '' }]);

function keysOf(lines) { return lines.map((l) => l.idx); }
function hasDup(keys) { return new Set(keys).size !== keys.length; }
function isCanonical(lines) { return lines.every((l, i) => l.idx === i); }

if (typeof renumber === 'function') {
  // B2 预填多原料（用户场景：打开已有 3 个原料的菜）
  const pre = renumber([{ material_id: 'a' }, { material_id: 'b' }, { material_id: 'c' }]);
  check('B2 预填 3 行 ⇒ idx = 0,1,2（唯一）', !hasDup(keysOf(pre)) && isCanonical(pre), 'keys=' + keysOf(pre).join(','));

  // B3 删中间行后 idx 连续
  const afterDel = renumber(pre.filter((_, i) => i !== 1));
  check('B3 删中间行 ⇒ 重排为 0,1（不断号）', !hasDup(keysOf(afterDel)) && isCanonical(afterDel), 'keys=' + keysOf(afterDel).join(','));

  // B4 删后再新增不撞键（旧实现的致命路径）
  const afterAdd = renumber(afterDel.concat([{}]));
  check('B4 删后再新增 ⇒ idx = 0,1,2（不撞键）', !hasDup(keysOf(afterAdd)) && isCanonical(afterAdd), 'keys=' + keysOf(afterAdd).join(','));

  // B5 删到空 ⇒ 由调用方兜底（renumber 自身对空数组应返回空，不崩）
  const empty = renumber([]);
  check('B5 空数组不崩且返回空', Array.isArray(empty) && empty.length === 0);

  // B6 不修改入参（不可变性：原对象不被就地改写，避免 setData diff 失效）
  const input = [{ idx: 9, material_id: 'x' }];
  const out = renumber(input);
  check('B6 不就地修改入参对象', input[0].idx === 9 && out[0].idx === 0, 'in=' + input[0].idx + ' out=' + out[0].idx);
}

console.log('\n===== C. 负向对照（证明本测试能抓到旧写法的错）=====');
{
  const bad1 = oldPrefill(3);
  check('C1 旧预填写法 ⇒ idx 全为 0、必然重复', hasDup(keysOf(bad1)), 'keys=' + keysOf(bad1).join(','));
  const bad2 = oldAdd(oldDel(bad1, 1));
  check('C2 旧「删中间→新增」⇒ 重复键 0,2,2', hasDup(keysOf(bad2)), 'keys=' + keysOf(bad2).join(','));
  // 若把真 renumber 换成"恒等函数"，上面 B2/B3/B4 必须转红 —— 用一个假 renumber 走一遍同样断言
  const fakeRenumber = (l) => l.slice();                 // 变异体：不重排
  const vPre = fakeRenumber([{ material_id: 'a' }, { material_id: 'b' }, { material_id: 'c' }].map((o) => Object.assign({ idx: 0 }, o)));
  check('C3 变异体（不重排）⇒ B2 断言会转红（测试非退化）', hasDup(keysOf(vPre)), 'keys=' + keysOf(vPre).join(','));
}

console.log('\n===== D. 缺陷 A 的静态确认（新增路径不再抛 TypeError）=====');
{
  // 用最小复刻执行"旧代码路径"与"新代码路径"，证明前者抛、后者不抛
  function oldLoad(isEdit) {
    const init = { materials: [], loading: false };
    if (isEdit) init.lines = [{ idx: 0, material_id: 'a', qty: '1' }];
    if (init.lines.length === 0) init.lines = [];       // 旧代码
    return init;
  }
  function newLoad(isEdit) {
    const init = { materials: [], loading: false };
    if (isEdit) init.lines = renumber([{ material_id: 'a', qty: '1' }]);
    if (!init.lines || init.lines.length === 0) init.lines = renumber([emptyLineLike()]);
    return init;
  }
  function emptyLineLike() { return { material_id: '', material_name: '', qty: '' }; }
  let oldThrew = false, newOk = true;
  try { oldLoad(false); } catch (e) { oldThrew = (e instanceof TypeError); }
  try { const r = newLoad(false); newOk = Array.isArray(r.lines) && r.lines.length === 1 && r.lines[0].idx === 0; } catch (e) { newOk = false; }
  check('D1 旧代码（新增路径）⇒ 抛 TypeError（即线上「系统异常」）', oldThrew);
  check('D2 新代码（新增路径）⇒ 正常给出 1 行空行、idx=0', newOk);
  // 编辑路径回归：不能被修坏
  let editOk = false;
  try { const r = newLoad(true); editOk = r.lines.length === 1 && r.lines[0].material_id === 'a' && r.lines[0].idx === 0; } catch (e) { editOk = false; }
  check('D3 编辑路径回归 ⇒ 预填 1 行仍正确', editOk);
}

console.log('\n' + results.join('\n'));
console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
