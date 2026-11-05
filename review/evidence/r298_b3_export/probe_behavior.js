// B3 行为探针：把 SheetJS 的**真实边界行为**测准，判据才不会写歪。
// 只回答「真的会怎样」，不做任何断言（断言在守卫里）。
const path = require('path');
const WS = 'C:/Users/lzj/.workbuddy/binaries/node/workspace/node_modules';
const XLSX = require(path.join(WS, 'xlsx'));
console.log('xlsx 版本 =', XLSX.version);

const J = (x) => JSON.stringify(x);
function wbOf(sheets) {
  const wb = XLSX.utils.book_new();
  (sheets || []).forEach((s) => {
    const aoa = [s.header].concat((s.rows || []).map((r) => r.map((v) => (typeof v === 'number' ? v : String(v == null ? '' : v)))));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), String(s.name || 'Sheet1').slice(0, 31));
  });
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}

console.log('\n--- ① 空行 [空串 x3] 的读回形态 ---');
{
  const b64 = wbOf([{ name: 'T', header: ['a', 'b', 'c'], rows: [['x', 1, 'y'], ['', '', ''], ['z', 2, 'w']] }]);
  const wb2 = XLSX.read(b64, { type: 'base64' });
  const ws = wb2.Sheets['T'];
  console.log('  !ref =', ws['!ref']);
  console.log('  blankrows:true  ->', J(XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true })));
  console.log('  blankrows:false ->', J(XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false })));
  console.log('  A3 单元格 =', J(ws['A3']), ' A4 =', J(ws['A4']));
}

console.log('\n--- ② 只有表头（rows 为空）---');
{
  const b64 = wbOf([{ name: 'T', header: ['a', 'b'], rows: [] }]);
  const ws = XLSX.read(b64, { type: 'base64' }).Sheets['T'];
  console.log('  !ref =', ws['!ref'], ' 读回 =', J(XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true })));
}

console.log('\n--- ③ 空 sheets 数组 ---');
{
  let threw = null, b64 = null;
  try { b64 = wbOf([]); } catch (e) { threw = e; }
  console.log('  抛异常？', threw ? 'YES · ' + threw.message : 'NO');
  if (b64) {
    const wb2 = XLSX.read(b64, { type: 'base64' });
    console.log('  base64 长度 =', b64.length, ' SheetNames =', J(wb2.SheetNames));
  }
  // 复刻 exportData 真实调用形态：把异常吞成什么？
  let content = null;
  try { content = wbOf([]); } catch (e) { content = null; }
  console.log('  真实形态下 content =', J(content), '  ⇒ if(!content) 兜得住吗？', content === null ? '兜得住（但异常已被吞）' : '兜不住');
}

console.log('\n--- ④ 工作表名超 31 字符（先切片再由 SheetJS 处理）---');
{
  const long = '这是一个非常非常非常长的工作表名称用于测试三十一字符硬限行为测试';
  const b64 = wbOf([{ name: long, header: ['a'], rows: [[1]] }]);
  const wb2 = XLSX.read(b64, { type: 'base64' });
  console.log('  源名长度 =', long.length, ' 切片后长度 =', long.slice(0, 31).length);
  console.log('  读回名 =', J(wb2.SheetNames), ' 长度 =', wb2.SheetNames[0].length);
}

console.log('\n--- ⑤ 重名工作表（两表同名，SheetJS 如何处理）---');
{
  try {
    const b64 = wbOf([{ name: '同名', header: ['a'], rows: [[1]] }, { name: '同名', header: ['a'], rows: [[2]] }]);
    const wb2 = XLSX.read(b64, { type: 'base64' });
    console.log('  未抛异常，读回 SheetNames =', J(wb2.SheetNames));
  } catch (e) { console.log('  抛异常 ⇒', e.message); }
  // 截断制造重名：两个长得像的名字共享前 31 字符
  const p = '第一部分口径说明附录甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥甲乙丙丁戊己庚辛壬癸';
  try {
    wbOf([{ name: p + 'A', header: ['a'], rows: [[1]] }, { name: p + 'B', header: ['a'], rows: [[2]] }]);
    console.log('  截断重名：未抛异常');
  } catch (e) { console.log('  截断重名 ⇒ 抛异常：', e.message); }
  // 两个都缺 name ⇒ 双 'Sheet1'
  try {
    wbOf([{ header: ['a'], rows: [[1]] }, { header: ['a'], rows: [[2]] }]);
    console.log('  双双缺名：未抛异常');
  } catch (e) { console.log('  双双缺名 ⇒ 抛异常：', e.message); }
}

console.log('\n--- ⑥ 负数 / 大数 / 三位小数 金额往返 ---');
{
  const vals = [-12345.67, 1000000.01, 0, 3333.33, 0.01];
  const b64 = wbOf([{ name: 'T', header: ['金额(元)'], rows: vals.map((v) => [v]) }]);
  const ws = XLSX.read(b64, { type: 'base64' }).Sheets['T'];
  vals.forEach((v, i) => {
    const c = ws['A' + (i + 2)];
    console.log(`  A${i + 2} 源=${v} t=${c && c.t} v=${c && c.v} 回算分=${Math.round(Number((c.v * 100).toFixed(10)))} 期望分=${Math.round(Number((v * 100).toFixed(10)))}`);
  });
}

console.log('\n--- ⑦ 表头含特殊字符 / 空表头 ---');
{
  const b64 = wbOf([{ name: 'T', header: ['项目', '', '毛利率%'], rows: [['收入', 1, 37.5]] }]);
  const ws = XLSX.read(b64, { type: 'base64' }).Sheets['T'];
  console.log('  !ref =', ws['!ref']);
  console.log('  读回 =', J(XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true })));
  console.log('  B1 =', J(ws['B1']), ' C2 =', J(ws['C2']));
}

console.log('\n--- ⑧ base64 魔数（是否真 PK zip）---');
{
  const b64 = wbOf([{ name: 'T', header: ['a'], rows: [[1]] }]);
  console.log('  前 8 字符 =', J(b64.slice(0, 8)), ' 解出前 4 字节 hex =', Buffer.from(b64, 'base64').slice(0, 4).toString('hex'));
}
