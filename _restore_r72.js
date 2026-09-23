// round72 变异残留清理：把 _mut_r72.py 未还原干净的 4 处改回正解，并逐条校验。
const fs = require('fs');
const ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const JS = ROOT + '/pages/month/input.js';
const WX = ROOT + '/pages/month/input.wxml';

let js = fs.readFileSync(JS, 'utf8');
let wx = fs.readFileSync(WX, 'utf8');
const before = { js: js.length, wx: wx.length };
const log = [];

function rep(src, oldS, newS, tag) {
  if (src.indexOf(oldS) < 0) { log.push('MISS  ' + tag); return src; }
  log.push('FIXED ' + tag);
  return src.split(oldS).join(newS);
}

// 1) 移除注入的硬编码渠道名
js = rep(js, "const DRAFT_KEY = 'draft_month_input_';\nconst HARD_CODED = '现金收款';",
             "const DRAFT_KEY = 'draft_month_input_';", 'JS HARD_CODED');
// 2) 恢复 decorateDineRows 转调唯一装配口
js = rep(js, "    return (rows || []).map((r) => ({ subItem: r.subItem || '', amountYuan: r.amountYuan || '', fixed: false, note: '' }));",
             "    return normalizeDineRows(rows, (def && def.items) || [], TERMS.ledger.channelNotes || {});", 'JS normalizeDineRows');
// 3) 恢复保存过滤空金额行
js = rep(js, "        .filter((r) => true)",
             "        .filter((r) => String(r.amountYuan === undefined || r.amountYuan === null ? '' : r.amountYuan).trim() !== '')", 'JS filter empty');
// 4) 恢复删除键只对自定义行
wx = rep(wx, '<button class="btn-del" wx:if="{{g.rows.length > 1}}"',
             '<button class="btn-del" wx:if="{{!r.fixed}}"', 'WXML btn-del');

fs.writeFileSync(JS, js);
fs.writeFileSync(WX, wx);

// 校验
const j2 = fs.readFileSync(JS, 'utf8');
const w2 = fs.readFileSync(WX, 'utf8');
const chk = {
  '无 HARD_CODED 残留': !/HARD_CODED = '现金收款'/.test(j2),
  'decorateDineRows 调唯一入口': /return normalizeDineRows\(rows, \(def && def\.items\)/.test(j2),
  '无自行map拼装残留': !/return \(rows \|\| \[\]\)\.map/.test(j2),
  '保存过滤空金额行': /\.filter\(\(r\) => String\(r\.amountYuan/.test(j2),
  '无 filter(r=>true) 残留': !/\.filter\(\(r\) => true\)/.test(j2),
  'WXML 删除键只对自定义行': /class="btn-del" wx:if="\{\{!r\.fixed\}\}"/.test(w2),
  'WXML 无旧条件残留': !/btn-del" wx:if="\{\{g\.rows\.length > 1\}\}"/.test(w2),
};
console.log(log.join('\n'));
console.log('--- 校验 ---');
let bad = 0;
Object.keys(chk).forEach((k) => { if (!chk[k]) bad++; console.log((chk[k] ? 'OK   ' : 'RED  ') + k); });
console.log('bytes js ' + before.js + '->' + j2.length + ', wx ' + before.wx + '->' + w2.length);
process.exit(bad === 0 ? 0 : 1);
