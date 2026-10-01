# -*- coding: utf-8 -*-
"""R182 打包体积守卫 · 变异回灌（证明它不是假绿）。
铁律：逐条独立 · 先断言"变异真的改了内容" · 判据必须**点名到本守卫自己的断言** · 还原后字节全等。
产出：mut_r181p_results.json / mut_r181p_log.txt（均在 review/evidence/r181p_pack_guard/）。
本脚本不改任何生产代码的最终状态：每条变异跑完立即按原始字节还原。
"""
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys

ROOT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit'
NODE = r'C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe'
GUARD = os.path.join(ROOT, 'tools/check_pack_size.js')
CFG = os.path.join(ROOT, 'project.config.json')
OUT = os.path.join(ROOT, 'review/evidence/r181p_pack_guard')
BIGDIR = os.path.join(ROOT, 'zzbigprobe')


def rb(p):
    with open(p, 'rb') as f:
        return f.read()


def wb(p, b):
    with open(p, 'wb') as f:
        f.write(b)


def sha(b):
    return hashlib.sha256(b).hexdigest()


def nl_of(text):
    return '\r\n' if '\r\n' in text else '\n'


def run_guard():
    r = subprocess.run([NODE, GUARD], cwd=ROOT, capture_output=True, timeout=300)
    out = (r.stdout or b'').decode('utf-8', 'replace')
    return r.returncode, out


ORIG_GUARD = rb(GUARD)
ORIG_CFG = rb(CFG)
H_GUARD, H_CFG = sha(ORIG_GUARD), sha(ORIG_CFG)

results = []
log = []


def record(mid, desc, expect_red, rc, out, targets):
    lines = [l for l in out.split('\n') if l.startswith('❌ ')]
    hit = {t: any(t in l for l in lines) for t in targets}
    ok_red = (rc != 0) and all(hit.values())
    ok_green = (rc == 0) and not lines
    verdict = (ok_green if not expect_red else ok_red)
    rec = {
        'id': mid, 'desc': desc, 'expect': 'GREEN(等价改写须保持绿)' if not expect_red else 'RED',
        'rc': rc, 'failed_asserts': lines,
        'targets': targets, 'target_hit': hit,
        'verdict': 'VALID' if verdict else 'INVALID',
    }
    results.append(rec)
    log.append('--- %s %s ---' % (mid, desc))
    log.append('  expect=%s rc=%d verdict=%s' % (rec['expect'], rc, rec['verdict']))
    log.append('  失败断言(%d)：%s' % (len(lines), ' | '.join(l[2:110] for l in lines) if lines else '(无)'))
    log.append('  目标断言命中：%s' % json.dumps(hit, ensure_ascii=False))
    print(log[-4])
    print(log[-3])
    print(log[-2])
    print(log[-1])


def mutate_text(path, old, new, label):
    txt = rb(path).decode('utf-8')
    if txt.count(old) != 1:
        print('❌ %s 锚点命中 %d 次' % (label, txt.count(old)))
        sys.exit(2)
    wb(path, txt.replace(old, new, 1).encode('utf-8'))


def restore():
    wb(GUARD, ORIG_GUARD)
    wb(CFG, ORIG_CFG)
    if os.path.isdir(BIGDIR):
        shutil.rmtree(BIGDIR)


os.makedirs(OUT, exist_ok=True)

# ---------- M1：删掉必备规则 admin-h5 ⇒ 期望 G-① 红 ----------
# 用「改坏 value」而非删行：避开 CRLF 行尾差异，且语义等价于「该规则不再覆盖 admin-h5」
mutate_text(CFG, '{ "type": "folder", "value": "admin-h5" }',
            '{ "type": "folder", "value": "admin-h5-off" }', 'M1')
assert sha(rb(CFG)) != H_CFG, 'M1 变异未生效'
rc, out = run_guard()
record('M1', '撤掉必备规则 admin-h5（真缺陷：内部后台会随包发布）', True, rc, out, ['G-①'])
restore()
assert sha(rb(CFG)) == H_CFG, 'M1 还原失败'

# ---------- M2：造 2MB 未忽略垃圾目录（复现 round181o 事故形态）⇒ 期望 P-③ 点名 ----------
os.makedirs(BIGDIR, exist_ok=True)
with open(os.path.join(BIGDIR, 'junk.bin'), 'wb') as f:
    f.write(b'\0' * (2 * 1024 * 1024))
assert os.path.getsize(os.path.join(BIGDIR, 'junk.bin')) == 2 * 1024 * 1024, 'M2 变异未生效'
rc, out = run_guard()
record('M2', '仓库根新增 2MB 未忽略目录 zzbigprobe/（= round181o 事故形态）', True, rc, out, ['P-③'])
restore()
assert not os.path.exists(BIGDIR), 'M2 还原失败'

# ---------- M3：等价改写（打乱 ignore 数组顺序）⇒ 期望保持绿（反向证据）----------
cfg_txt = rb(CFG).decode('utf-8')
cfg_obj = json.loads(cfg_txt)
cfg_obj['packOptions']['ignore'] = list(reversed(cfg_obj['packOptions']['ignore']))
wb(CFG, json.dumps(cfg_obj, ensure_ascii=False, indent=2).encode('utf-8'))
assert sha(rb(CFG)) != H_CFG, 'M3 变异未生效'
rc, out = run_guard()
record('M3', '等价改写：打乱 packOptions.ignore 顺序（语义不变）', False, rc, out, [])
restore()
assert sha(rb(CFG)) == H_CFG, 'M3 还原失败'

# ---------- M4：把预算放宽到 5MB（削弱判据）⇒ 期望 P-② 自反断言红 ----------
mutate_text(GUARD, 'const TOTAL_BUDGET_MB = 1.5;', 'const TOTAL_BUDGET_MB = 5;', 'M4')
assert sha(rb(GUARD)) != H_GUARD, 'M4 变异未生效'
rc, out = run_guard()
record('M4', '削弱判据：TOTAL_BUDGET_MB 1.5 → 5（想放宽到硬上限以上）', True, rc, out, ['P-②'])
restore()
assert sha(rb(GUARD)) == H_GUARD, 'M4 还原失败'

# ---------- M5：打坏匹配器（恒不忽略）⇒ 期望 S3-a 自失效护栏红 ----------
mutate_text(GUARD, '    return function hit(rel) {',
            '    return function hit(rel) {\n      return null; // MUT5 恒不忽略', 'M5')
assert sha(rb(GUARD)) != H_GUARD, 'M5 变异未生效'
rc, out = run_guard()
record('M5', '打坏匹配器：hit() 恒返回 null（判据腐化成恒真）', True, rc, out, ['S3-a'])
restore()
assert sha(rb(GUARD)) == H_GUARD, 'M5 还原失败'

# ---------- 收尾：最终字节还原核对 ----------
final = {
    'guard_sha256_before': H_GUARD, 'guard_sha256_after': sha(rb(GUARD)),
    'cfg_sha256_before': H_CFG, 'cfg_sha256_after': sha(rb(CFG)),
    'bigdir_exists_after': os.path.isdir(BIGDIR),
}
final['all_restored'] = (final['guard_sha256_before'] == final['guard_sha256_after']
                         and final['cfg_sha256_before'] == final['cfg_sha256_after']
                         and not final['bigdir_exists_after'])

valid = sum(1 for r in results if r['verdict'] == 'VALID')
summary = '%d/%d 组变异有效' % (valid, len(results))

with open(os.path.join(OUT, 'mut_r181p_results.json'), 'w', encoding='utf-8') as f:
    json.dump({'summary': summary, 'results': results, 'restore': final}, f, ensure_ascii=False, indent=1)
with open(os.path.join(OUT, 'mut_r181p_log.txt'), 'w', encoding='utf-8') as f:
    f.write('R182 打包体积守卫 · 变异回灌\n' + summary + '\n\n' + '\n'.join(log) + '\n\n'
            + '还原核对：' + json.dumps(final, ensure_ascii=False, indent=1) + '\n')

print()
print('===== %s · 还原全等 = %s =====' % (summary, final['all_restored']))
sys.exit(0 if (valid == len(results) and final['all_restored']) else 1)
