# round49 独立变异回灌 —— 不采信并发方自述，我方自己证伪两个新守卫
# 三组：M1 抽掉 paywall.onConfirm 的 iOS 拦截 / M2 抽掉 env.getEnv 的占位符防护 / M3 新增漏网支付入口
import subprocess, os, shutil

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
NODE = r'C:\Users\lzj\.workbuddy\binaries\node\versions\22.22.2-3\node.exe'
EVD = os.path.join(ROOT, 'review', 'evidence', 'selfdrive_20260919_r49')


def run(rel):
    p = subprocess.run([NODE, rel], cwd=ROOT, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    out = (p.stdout or '') + (p.stderr or '')
    tail = [l for l in out.splitlines() if l.strip()][-6:]
    return p.returncode, ' | '.join(tail), out


def backup(rel):
    src = os.path.join(ROOT, rel.replace('/', os.sep))
    dst = os.path.join(EVD, 'bak_' + os.path.basename(rel))
    shutil.copy2(src, dst)
    with open(src, 'r', encoding='utf-8') as f:
        return f.read()


def restore(rel, content):
    src = os.path.join(ROOT, rel.replace('/', os.sep))
    with open(src, 'w', encoding='utf-8', newline='') as f:
        f.write(content)


lines = []
def log(s):
    print(s)
    lines.append(s)


results = {}

# ---------- M1：抽掉 paywall.onConfirm 的 iOS 纵深拦截 ----------
rel = 'utils/paywall.js'
orig = backup(rel)
mut = orig.replace('  if (isIOS()) return showIOSBlocked();\n  const shopId', '  const shopId')
log('=== M1 抽掉 utils/paywall.js::onConfirm 的 isIOS 拦截 ===')
log('  变异生效(内容已变): %s' % (mut != orig))
restore(rel, mut)
rc, tail, _ = run('tools/check_ios_pay.js')
log('  变异后 rc=%s :: %s' % (rc, tail[:300]))
results['M1_mutated_rc'] = rc
restore(rel, orig)
rc2, tail2, _ = run('tools/check_ios_pay.js')
log('  还原后 rc=%s :: %s' % (rc2, tail2[:200]))
results['M1_restored_rc'] = rc2

# ---------- M2：抽掉 env.getEnv 的占位符防护 ----------
rel = 'miniprogram/config/env.js'
orig2 = backup(rel)
mut2 = orig2.replace('if (!this.isPlaceholder(id)) return id;', 'if (true) return id;')
log('')
log('=== M2 抽掉 miniprogram/config/env.js::getEnv 的 isPlaceholder 防护 ===')
log('  变异生效: %s' % (mut2 != orig2))
restore(rel, mut2)
rc, tail, _ = run('tools/check_env_ready.js')
log('  变异后 rc=%s :: %s' % (rc, tail[:300]))
results['M2_mutated_rc'] = rc
restore(rel, orig2)
rc2, tail2, _ = run('tools/check_env_ready.js')
log('  还原后 rc=%s :: %s' % (rc2, tail2[:200]))
results['M2_restored_rc'] = rc2

# ---------- M3：新增一个「漏网」支付入口（无 isIOS） ----------
probe = 'pages/__mut_probe_r49.js'
pabs = os.path.join(ROOT, probe)
log('')
log('=== M3 新增漏网支付入口 pages/__mut_probe_r49.js（有 payRenew 调用、无 isIOS）===')
with open(pabs, 'w', encoding='utf-8') as f:
    f.write("Page({\n  async onRenew() {\n    await api.call('payRenew', { plan_id: 'p' });\n  }\n});\n")
rc, tail, full = run('tools/check_ios_pay.js')
caught = '__mut_probe_r49' in full
log('  变异后 rc=%s 捕获到新文件=%s :: %s' % (rc, caught, tail[:300]))
results['M3_mutated_rc'] = rc
results['M3_caught'] = caught
os.remove(pabs)
log('  已删除探针文件，存在性=%s' % os.path.exists(pabs))
rc2, tail2, _ = run('tools/check_ios_pay.js')
log('  还原后 rc=%s :: %s' % (rc2, tail2[:200]))
results['M3_restored_rc'] = rc2

# ---------- M4 反向：注释里裸写 payRenew（不该红时不红） ----------
rel = 'utils/paywall.js'
orig3 = backup(rel)
mut3 = orig3.replace('function openPaywall(type, opts) {',
                     'function openPaywall(type, opts) {\n  // 注释里裸写 payRenew 不应被判为支付入口')
restore(rel, mut3)
rc, tail, _ = run('tools/check_ios_pay.js')
log('')
log('=== M4 反向：注释里裸写 payRenew（应仍绿，不该红时不红）rc=%s :: %s' % (rc, tail[:200]))
results['M4_comment_rc'] = rc
restore(rel, orig3)

log('')
log('=== 汇总 ===')
for k, v in results.items():
    log('  %s = %s' % (k, v))

with open(os.path.join(EVD, 'mutation_result_r49.txt'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))
