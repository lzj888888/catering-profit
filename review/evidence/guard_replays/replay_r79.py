# -*- coding: utf-8 -*-
"""R79 回灌：核对单派生守卫（方案②）六组变异。
正向（该红时红）：M1 改单源不重跑 / M6 磁盘件被手填
反向（不该红时不红）：M2 重跑 / M3 末尾加空行 / M4 整份转 CRLF / M5 恢复
备份一律放 TEMP（不污染仓库 ⇒ 不留 .bak 在 git status 里）。
"""
import subprocess, os, hashlib, shutil, tempfile, sys

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
NODE = r'C:\Users\lzj\.workbuddy\binaries\node\versions\22.22.2-3\node.exe'
SINGLE = os.path.join(ROOT, 'cloudfunctions', 'initDb', 'collections.js')
MD = os.path.join(ROOT, '\u7d22\u5f15\u8865\u9f50\u6838\u5bf9\u5355.md')  # 索引补齐核对单.md
BAK = os.path.join(tempfile.gettempdir(), 'r79_bak')
os.makedirs(BAK, exist_ok=True)


def md5(p):
    return hashlib.md5(open(p, 'rb').read()).hexdigest()


def run(args):
    r = subprocess.run([NODE] + args, cwd=ROOT, capture_output=True,
                       text=True, encoding='utf-8', errors='replace')
    return r.returncode, (r.stdout or '') + (r.stderr or '')


def verdict(tag, rc, out, expect_rc):
    ok = (rc == expect_rc)
    lines = [l for l in out.strip().split('\n') if l.strip()]
    last = lines[-1] if lines else ''
    print('[%s] rc=%d（期望 %d）⇒ %s' % (tag, rc, expect_rc, '✅ 符合预期' if ok else '❌ 不符合预期'))
    print('       末行: %s' % last[:100])
    for l in out.split('\n'):
        if 'WARN' in l:
            print('       ' + l.strip()[:150])
    for l in out.split('\n'):
        if '\u91cd\u7b97:' in l or 'e7ae97:' in l:  # 重算:
            print('       ' + l.strip()[:110])
    return ok


res = {}
shutil.copy2(SINGLE, os.path.join(BAK, 'collections.js'))
shutil.copy2(MD, os.path.join(BAK, 'checklist.md'))
ORIG_S = md5(SINGLE)

print('=' * 70)
print('M1 · 改单源（idx_audit_idem → _MUT）但**不重跑** ⇒ 期望 RC=1')
print('=' * 70)
src = open(SINGLE, encoding='utf-8', newline='').read()
assert 'idx_audit_idem' in src, '锚点不在，脚本需改'
open(SINGLE, 'w', encoding='utf-8', newline='').write(src.replace('idx_audit_idem', 'idx_audit_idem_MUT', 1))
rc, out = run(['tools/gen_index_checklist.js', '--check'])
res['M1 改单源不重跑⇒红'] = verdict('M1', rc, out, 1)

print()
print('=' * 70)
print('M2 · 重跑生成器 ⇒ 期望 RC=0（"改了就重跑"是修复动作）')
print('=' * 70)
run(['tools/gen_index_checklist.js'])
rc, out = run(['tools/gen_index_checklist.js', '--check'])
res['M2 重跑⇒绿'] = verdict('M2', rc, out, 0)

print()
print('--- 恢复单源并重跑（回到基线）---')
shutil.copy2(os.path.join(BAK, 'collections.js'), SINGLE)
assert md5(SINGLE) == ORIG_S, '单源未恢复！'
run(['tools/gen_index_checklist.js'])

print()
print('=' * 70)
print('M3 · 磁盘件末尾加空行（编辑器/git 常见）⇒ 期望 RC=0 且告警点名')
print('=' * 70)
d = open(MD, 'rb').read()
open(MD, 'wb').write(d + b'\n\n')
rc, out = run(['tools/gen_index_checklist.js', '--check'])
res['M3 末尾空行⇒保持绿'] = verdict('M3', rc, out, 0)

print()
print('=' * 70)
print('M4 · 整份转 CRLF（R79 本体场景）⇒ 期望 RC=0 且告警点名')
print('=' * 70)
t = open(MD, encoding='utf-8', newline='').read().replace('\r\n', '\n')
open(MD, 'w', encoding='utf-8', newline='').write(t.replace('\n', '\r\n'))
rc, out = run(['tools/gen_index_checklist.js', '--check'])
res['M4 CRLF⇒保持绿'] = verdict('M4', rc, out, 0)

print()
print('=' * 70)
print('M5 · 恢复（重跑生成器）⇒ 期望 RC=0')
print('=' * 70)
run(['tools/gen_index_checklist.js'])
rc, out = run(['tools/gen_index_checklist.js', '--check'])
res['M5 恢复⇒绿'] = verdict('M5', rc, out, 0)

print()
print('=' * 70)
print('M6 · 有人手改 §6（塞回 ____ 占位）⇒ 期望 RC=1')
print('=' * 70)
t = open(MD, encoding='utf-8', newline='').read()
assert '\u6838\u5bf9\u4eba\uff1a' in t, '锚点「核对人：」不在'
open(MD, 'w', encoding='utf-8', newline='').write(t.replace('\u6838\u5bf9\u4eba\uff1a', '\u6838\u5bf9\u4eba\uff1a`____`\u3000', 1))
rc, out = run(['tools/gen_index_checklist.js', '--check'])
res['M6 手填占位⇒红'] = verdict('M6', rc, out, 1)

print()
print('--- 收尾：重跑生成器恢复磁盘件 ---')
run(['tools/gen_index_checklist.js'])
rc, out = run(['tools/gen_index_checklist.js', '--check'])
print('最终 --check rc=%d' % rc)

print()
print('=' * 70)
bad = [k for k, v in res.items() if not v]
for k, v in res.items():
    print(('  ✅ ' if v else '  ❌ ') + k)
print('=' * 70)
print('回灌结论：%d/%d 组符合预期' % (len(res) - len(bad), len(res)))
sys.exit(1 if bad else 0)
