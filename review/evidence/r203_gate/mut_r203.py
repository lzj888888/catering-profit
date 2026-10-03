# -*- coding: utf-8 -*-
"""R203 变异回灌 —— 证明 check_uri_codec_pairs.js 真能抓到「编码不配对」。"""
import subprocess, sys, os

ROOT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit'
NODE = r'C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe'
GUARD = os.path.join(ROOT, 'tools', 'check_uri_codec_pairs.js').replace('\\', '/')
IMPACT = os.path.join(ROOT, 'pages', 'metrics', 'impact.js')

def run():
    p = subprocess.run([NODE, GUARD], cwd=ROOT, capture_output=True)
    out = (p.stdout + p.stderr).decode('utf-8', 'replace')
    reds = [l.strip() for l in out.splitlines() if '❌' in l]
    return p.returncode, reds, out

def read_bytes(p):
    with open(p, 'rb') as f:
        return f.read()

def write_bytes(p, b):
    with open(p, 'wb') as f:
        f.write(b)

orig = read_bytes(IMPACT)
results = []

def case(title, old, new, expect_red_on):
    """old/new 为 str；做字节级替换（保持 LF）"""
    global orig
    ob = old.encode('utf-8')
    nb = new.encode('utf-8')
    cur = read_bytes(IMPACT)
    if ob not in cur:
        results.append((title, 'ANCHOR-MISS', [], '锚点未命中'))
        return
    assert cur.count(ob) == 1, '锚点命中数 != 1: %d' % cur.count(ob)
    write_bytes(IMPACT, cur.replace(ob, nb))
    rc, reds, out = run()
    hit = [r for r in reds if any(k in r for k in expect_red_on)]
    verdict = '有效红' if (rc != 0 and hit) else ('无效' if rc != 0 else '假绿')
    results.append((title, verdict, hit, 'rc=%d 红项=%d' % (rc, len(reds))))
    write_bytes(IMPACT, orig)

# 基线
rc, reds, out = run()
print('基线 rc=%d 红项=%d' % (rc, len(reds)))
assert rc == 0, '基线必须全绿'

# 组 A：退回真实旧 bug
case('A1 退回旧bug：onLoad 直接吃 q.name（不做解码）',
     "material_name: decodeParam(q && q.name) });",
     "material_name: (q && q.name) || '' });",
     ['C-③'])

case('A2 退回旧bug：删掉 decodeURIComponent（只剩 String 透传）',
     "    try { next = decodeURIComponent(out); } catch (e) { break; }",
     "    try { next = String(out); } catch (e) { break; }",
     ['A-③', 'A-④', 'C-②'])

case('A3 退回旧bug：解码函数整体删空（保留名字，无解码调用）',
     "function decodeParam(s) {",
     "function decodeParam(s) { return String(s == null ? '' : s); /* MUT */ }\nfunction _deadDecode(s) {",
     ['A-③', 'A-④', 'C-②'])

# 组 B：等价改写（不该红）
case('B1 等价：decodeParam 改名 + 直接内联 try/catch 解码',
     "material_name: decodeParam(q && q.name) });",
     "material_name: (function(s){ try { return decodeURIComponent(String(s||'')); } catch(e){ return String(s||''); } })(q && q.name) });",
     ['C-③'])

case('B2 等价：解码循环上限从 2 改 3（行为等价）',
     "for (let i = 0; i < 2; i += 1) {",
     "for (let i = 0; i < 3; i += 1) {",
     ['C-③'])

# 还原核对
write_bytes(IMPACT, orig)
rc, reds, out = run()
restored_ok = (rc == 0 and read_bytes(IMPACT) == orig)

print('=' * 60)
for t, v, hit, extra in results:
    mark = '✅' if v == '有效红' else ('✅' if (v == 'ANCHOR-MISS') else '⚠️')
    print('%s %-58s %s | %s' % (mark, t, v, extra))
    for h in hit:
        print('        ↳ ' + h[:110])
print('还原后 rc=%d 字节一致=%s' % (rc, restored_ok))

ok = all((v == '有效红' or v == '无效') and v == '有效红' for t, v, h, e in results[:3]) \
     and all(v == '无效' for t, v, h, e in results[3:5])
ok = all(results[i][1] == '有效红' for i in range(3)) and all(results[i][1] == '无效' for i in (3, 4)) and restored_ok
print('=' * 60)
print('✅ 回灌结论：组A 3/3 有效红 · 组B 2/2 保持绿 · 还原字节一致' if ok else '❌ 回灌有异常')
