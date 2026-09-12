# -*- coding: utf-8 -*-
"""生成 inscode 8 批喂投包：一键复制 HTML（8 块）+ 8 份独立 txt 兜底。

路径全部相对本脚本所在目录（specs/dev-specs/delivery/），
使生成器可随仓库单源重生成，不再依赖 C:/_parse 或 Desktop 绝对路径。
"""
import io, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "inscode喂投包_8批_自包含完整版.md")
OUT = HERE
LABELS = {
    0: "批次 0 · 工程地基（项目初始化+鉴权中间件+错误码+表结构+时间工具+软删过滤）⚠️不可跳过",
    1: "批次 1 · POC3 双利润引擎算法（12 锚点）",
    2: "批次 2 · POC1 摊销边界与尾差残值（4 锚点）",
    3: "批次 3 · POC2 BOM 两层+循环拦截+成本快照（16 锚点）",
    4: "批次 4 · M1/M2/M3 页面闭环 + 店铺设置",
    5: "批次 5 · 付费全流程（弹窗触发+订单+续费+提醒+iOS降级）",
    6: "批次 6 · 极简管理后台 H5（查询+调权+订单+退款+对账）",
    7: "批次 7 · 中优先级最简版（校验+loading+多店铺+导出）",
}

with io.open(SRC, encoding="utf-8") as f:
    md = f.read()

blocks = []
for n in range(8):
    sm = re.search(r"^===== 批次 %d 开始 =====\s*$" % n, md, re.M)
    em = re.search(r"^===== 批次 %d 结束 =====\s*$" % n, md, re.M)
    if not sm or not em:
        print("[WARN] 批次 %d 标记缺失" % n)
        continue
    text = md[sm.end():em.start()].strip()
    blocks.append({"n": n, "label": LABELS[n], "text": text})
    with io.open(os.path.join(OUT, "批次%d_提示词_可直接复制.txt" % n), "w", encoding="utf-8") as tf:
        tf.write(text)
    print("[txt] 批次%d (%d 字符)" % (n, len(text)))

import json
data = json.dumps([{"n": b["n"], "label": b["label"], "text": b["text"]} for b in blocks],
                  ensure_ascii=False)

html = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>店算 · inscode 8 批喂投包（一键复制）</title>
<style>
  body{font-family:-apple-system,"Microsoft YaHei",sans-serif;max-width:960px;margin:24px auto;padding:0 16px;color:#222}
  h1{font-size:20px;border-left:4px solid #07c160;padding-left:10px}
  .tip{background:#f6ffed;border:1px solid #b7eb8f;padding:10px 14px;border-radius:6px;font-size:14px;margin:12px 0}
  .warn{background:#fffbe6;border:1px solid #ffe58f;padding:10px 14px;border-radius:6px;font-size:14px;margin:12px 0}
  .card{border:1px solid #e3e3e3;border-radius:8px;margin:18px 0;overflow:hidden}
  .card h2{margin:0;font-size:15px;padding:10px 14px;background:#fafafa;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;gap:10px}
  .card h2 span{flex:1}
  .card h2 button{background:#07c160;color:#fff;border:0;border-radius:5px;padding:6px 14px;font-size:13px;cursor:pointer;white-space:nowrap}
  .card h2 button:active{transform:scale(.97)}
  .card.b0 h2{background:#fff1f0}
  textarea{width:100%;height:300px;border:0;padding:12px;font-size:12px;line-height:1.5;resize:vertical;box-sizing:border-box;font-family:Consolas,Menlo,monospace}
</style>
</head>
<body>
<h1>店算 · inscode 8 批喂投包（严格按 0 → 7 顺序）</h1>
<div class="tip">用法：点每块右上角「复制」→ 粘进 inscode 对话框发送。<b>上一批验收全过，再进下一批。</b>每批自包含，不依赖上下文。</div>
<div class="warn">⚠️ <b>批次 0（工程地基）不可跳过、不可简化</b> —— 地基打歪，后面 7 批全部返工。批次 0 的「明确禁止」8 条必须逐条写死。</div>
<div id="root"></div>
<script>
const BLOCKS = __DATA__;
const root = document.getElementById('root');
BLOCKS.forEach(b=>{
  const card = document.createElement('div'); card.className='card b'+b.n;
  const h2 = document.createElement('h2');
  h2.innerHTML = '<span><b>'+b.n+'</b> · '+b.label+'</span>';
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
</html>""".replace("__DATA__", data)

with io.open(os.path.join(OUT, "inscode喂投包_8批_一键复制.html"), "w", encoding="utf-8") as f:
    f.write(html)
print("[html] inscode喂投包_8批_一键复制.html")
print("ALL DONE (%d blocks)" % len(blocks))
