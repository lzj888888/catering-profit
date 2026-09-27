// 全仓扫描：明细行字段用法 + 是否存在保留期/清理/TTL 机制
const fs = require('fs'), path = require('path');
const cr = [], cap = [];
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', '_qr_archive', 'evidence'].includes(e.name)) continue;
      walk(p);
    } else if (/\.(js|json)$/.test(e.name)) {
      const s = fs.readFileSync(p, 'utf8');
      const rel = path.relative('.', p).split(path.sep).join('/');
      if (s.includes('cost_card_row_id')) cr.push(rel);
      if (/TTL|expireAfter|expireAfterSeconds|retention|保留期|留存期|归档|清理|cleanup|purge|CLEANUP/i.test(s)) cap.push(rel);
    }
  }
}
walk('.');
console.log('=== 用到 cost_card_row_id 的文件 ===');
console.log([...new Set(cr)].join('\n') || '(0)');
console.log('\n=== 出现 保留/清理/TTL/归档 的文件 ===');
console.log([...new Set(cap)].join('\n') || '(0)');
