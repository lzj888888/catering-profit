// _audit_m2fwd_cases.js —— 只读取证：forward 路径关键分支的数值对比
const { run } = require('./_audit_m2fwd_engine.js');

const BASE = { presetKey: 'fastfood_noodle', cityIdx: 1, bizIdx: 0, areaNum: '60', rentYuan: '8000',
  headcountNum: '2', laborTotalYuan: '9000', marginPct: 60, expectYuan: '100000', targetYuan: '20000' };
const WEG = { waterYuan: '200', electricYuan: '1500', gasYuan: '300' };

function show(name, ov) {
  const r = run(Object.assign({}, BASE, ov));
  if (r.err) { console.log(name + ' => 校验失败: ' + r.err); return null; }
  console.log(name.padEnd(46) + ' | fixed=' + JSON.stringify(r.fixed_items)
    + ' | 固定=' + r.fixed_ex_amort + ' 保本=' + r.break_even_monthly + ' 目标=' + r.target_monthly);
  return r;
}

console.log('--- 水电气「三项全 >0 才生效」边界 ---');
show('全填 200/1500/300', WEG);
show('只填电 1500', { electricYuan: '1500' });
show('只填水+电（无燃气，面馆常见）', { waterYuan: '200', electricYuan: '1500' });
show('只填电+气（忘填水）', { electricYuan: '1500', gasYuan: '300' });
show('只填水（漏了电）', { waterYuan: '200' });

console.log('\n--- 管理费（fixed_opt）---');
show('管理费留空（键在值空）', Object.assign({}, WEG, { manageYuan: '' }));
show('管理费填 0', Object.assign({}, WEG, { manageYuan: '0' }));
show('管理费填 2000', Object.assign({}, WEG, { manageYuan: '2000' }));

console.log('\n--- 房租填/不填（R294-C 复核）---');
show('房租 8000 + 水电气全填', WEG);
show('房租留空 + 水电气全填', Object.assign({}, WEG, { rentYuan: '' }));
show('房租 3000 + 水电气全填', Object.assign({}, WEG, { rentYuan: '3000' }));
show('房租 30000 + 水电气全填', Object.assign({}, WEG, { rentYuan: '30000' }));
show('房租 3000 手填水电 1000', { rentYuan: '3000', waterYuan: '200', electricYuan: '700', gasYuan: '100' });
show('房租 3000 水电留空（走派生）', { rentYuan: '3000' });

console.log('\n--- 城市系数（只调房租）---');
for (const [ci, nm] of [[0, '一线'], [1, '二三线'], [2, '县城']]) {
  show('房租留空 ' + nm + '（水电气全填）', Object.assign({}, WEG, { rentYuan: '', cityIdx: ci }));
  show('房租 8000 ' + nm + '（水电气全填）', Object.assign({}, WEG, { cityIdx: ci }));
}

console.log('\n--- 人工：填总额 vs 只填人数 ---');
show('人工总额 9000 + 人数 2', { laborTotalYuan: '9000', headcountNum: '2' });
show('人工总额留空 + 人数 2', { laborTotalYuan: '', headcountNum: '2' });
show('人工总额留空 + 人数留空', { laborTotalYuan: '', headcountNum: '' });

console.log('\n--- 火锅预设 buildRef 自动注入（用户未填建店投入）---');
show('hotpot_half_self 全默认', { presetKey: 'hotpot_half_self', bizIdx: 2, marginPct: 53,
  rentYuan: '20000', headcountNum: '5', laborTotalYuan: '25000', targetYuan: '30000' });
show('hotpot_half_self 用户填装修 10万/3年', { presetKey: 'hotpot_half_self', bizIdx: 2, marginPct: 53,
  rentYuan: '20000', headcountNum: '5', laborTotalYuan: '25000', targetYuan: '30000',
  buildRows: [{ key: 'transfer', name: '', note: '', yuan: '', years: 3 },
    { key: 'decor', name: '', note: '', yuan: '100000', years: 3 },
    { key: 'equip', name: '', note: '', yuan: '', years: 5 },
    { key: 'franchise', name: '', note: '', yuan: '', years: 3 }] });

console.log('\n--- 年限留空（buildYearsOf 兜底）---');
show('装修 10万 年限留空', { buildRows: [{ key: 'transfer', name: '', note: '', yuan: '', years: 3 },
  { key: 'decor', name: '', note: '', yuan: '100000', years: '' },
  { key: 'equip', name: '', note: '', yuan: '', years: 5 },
  { key: 'franchise', name: '', note: '', yuan: '', years: 3 }] });
show('装修 10万 年限 0', { buildRows: [{ key: 'transfer', name: '', note: '', yuan: '', years: 3 },
  { key: 'decor', name: '', note: '', yuan: '100000', years: 0 },
  { key: 'equip', name: '', note: '', yuan: '', years: 5 },
  { key: 'franchise', name: '', note: '', yuan: '', years: 3 }] });
