/**
 * 生成 POC 喂投包（一键复制版 HTML + 三份独立 .txt 兜底）
 * 运行：node gen_poc_html.js
 */
const fs = require('fs');
const path = require('path');

const base = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit/specs/dev-specs/poc';
const outDir = 'C:/Users/lzj/Desktop';
const files = [
  { key: 'POC3', label: 'POC3 · 双利润口径锁（最简单·先喂）', file: 'POC3_双利润口径锁.md' },
  { key: 'POC1', label: 'POC1 · 摊销边界与尾差残值（最易错）', file: 'POC1_摊销边界与尾差残值.md' },
  { key: 'POC2', label: 'POC2 · BOM 两层与循环拦截（依赖最多·最后）', file: 'POC2_BOM两层与循环拦截.md' },
];

function extract(md) {
  // 只匹配「独占一行」的标记，避开第 3 行用法说明里的内联引用
  const sm = md.match(/^===== 提示词开始 =====\s*$/m);
  const em = md.match(/^===== 提示词结束 =====\s*$/m);
  if (!sm || !em) return md.trim();
  return md.slice(sm.index + sm[0].length, em.index).trim();
}

const blocks = files.map(f => {
  const md = fs.readFileSync(path.join(base, f.file), 'utf8');
  const text = extract(md);
  // 兜底 .txt
  fs.writeFileSync(path.join(outDir, `${f.key}_提示词_可直接复制.txt`), text, 'utf-8');
  return { ...f, text };
});

const data = JSON.stringify(blocks.map(b => ({ key: b.key, label: b.label, text: b.text })));

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>店算 POC 喂投包 · 一键复制</title>
<style>
  body{font-family:-apple-system,"Microsoft YaHei",sans-serif;max-width:920px;margin:24px auto;padding:0 16px;color:#222}
  h1{font-size:20px;border-left:4px solid #07c160;padding-left:10px}
  .tip{background:#f6ffed;border:1px solid #b7eb8f;padding:10px 14px;border-radius:6px;font-size:14px;margin:12px 0}
  .card{border:1px solid #e3e3e3;border-radius:8px;margin:18px 0;overflow:hidden}
  .card h2{margin:0;font-size:15px;padding:10px 14px;background:#fafafa;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center}
  .card h2 button{background:#07c160;color:#fff;border:0;border-radius:5px;padding:6px 14px;font-size:13px;cursor:pointer}
  .card h2 button:active{transform:scale(.97)}
  textarea{width:100%;height:300px;border:0;padding:12px;font-size:12px;line-height:1.5;resize:vertical;box-sizing:border-box;font-family:Consolas,Menlo,monospace}
  .order{color:#fa8c16;font-weight:bold}
</style>
</head>
<body>
<h1>店算 · POC 喂投包（按 POC3 → POC1 → POC2 顺序）</h1>
<div class="tip">用法：点每块右上角「复制」→ 粘进 inscode 对话框发送。每份须 <b>100% 命中验收锚点</b>（误差≤0.01元）才能进下一份。锚点速查见每块标题下方。</div>
<div id="root"></div>
<script>
const BLOCKS = ${data};
const root = document.getElementById('root');
BLOCKS.forEach(b=>{
  const card = document.createElement('div'); card.className='card';
  const h2 = document.createElement('h2');
  const order = b.key==='POC3'?'①':b.key==='POC1'?'②':'③';
  h2.innerHTML = '<span><span class="order">'+order+' </span>'+b.label+'</span>';
  const btn = document.createElement('button'); btn.textContent='复制';
  h2.appendChild(btn);
  const ta = document.createElement('textarea'); ta.readOnly=true; ta.value=b.text;
  btn.onclick=()=>{
    ta.select();
    const done=()=>{btn.textContent='已复制✓';setTimeout(()=>btn.textContent='复制',1500);};
    if(navigator.clipboard){navigator.clipboard.writeText(b.text).then(done).catch(()=>{document.execCommand('copy');done();});}
    else{document.execCommand('copy');done();}
  };
  card.appendChild(h2); card.appendChild(ta); root.appendChild(card);
});
</script>
</body>
</html>`;

fs.writeFileSync(path.join(outDir, 'POC喂投包_综合版.html'), html, 'utf-8');
console.log('✅ 已生成：');
console.log('  ' + path.join(outDir, 'POC喂投包_综合版.html'));
blocks.forEach(b => console.log('  ' + path.join(outDir, b.key + '_提示词_可直接复制.txt')));
