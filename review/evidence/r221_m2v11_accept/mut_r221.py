# -*- coding: utf-8 -*-
# R221 · M2v1.1 反推分支 —— **变异回灌**（第 5 步）
#
# 铁律：只红 RC 不算数，必须红在**目标断言名**上；崩溃红（ReferenceError 等）不算有效红。
# 还原判据：变异前/后逐文件 **二进制 sha1** 必须相等（不用 md5 —— 会因 universal-newlines 假绿）。
import io, os, sys, hashlib, subprocess

ROOT  = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
NODE  = r'C:\Users\lzj\.workbuddy\binaries\node\versions\22.22.2-3\node.exe'
SV    = os.path.join(ROOT, r'cloudfunctions\calcSandbox\service.js')
VL    = os.path.join(ROOT, r'cloudfunctions\calcSandbox\validate.js')
GUARD = os.path.join(ROOT, r'tools\check_m2_reverse_rent.js')
ST    = os.path.join(ROOT, r'cloudfunctions\calcSandbox\selftest.js')
REPORT = os.path.join(ROOT, r'review\evidence\r221_m2v11_accept\mut_r221_report.txt')

def rb(p):  return io.open(p, 'rb').read()
def sha(p): return hashlib.sha1(rb(p)).hexdigest()
def rd(p):  return io.open(p, encoding='utf-8').read()
def wr(p, s): io.open(p, 'w', encoding='utf-8', newline='').write(s)

MUTS = [
  dict(id='M1', f=SV, why='变换层不剔 rent（filter 等价改写为不命中）',
       old=".filter((x) => x && x.key !== 'rent')",
       new=".filter((x) => x && x.key !== 'rent_x')",
       target=['A-①', 'B-①']),
  dict(id='M2', f=SV, why='目标日均硬编码 ÷30',
       old="const targetDailyFen = Math.round(R / openDays);",
       new="const targetDailyFen = Math.round(R / 30);",
       target=['B-③', 'B-④']),
  dict(id='M3', f=SV, why='日均客流硬编码 ÷30',
       old="const dailyTraffic = round2(monthlyTrafficRaw / openDays);",
       new="const dailyTraffic = round2(monthlyTrafficRaw / 30);",
       target=['B-⑤']),
  dict(id='M4', f=VL, why='校验层 rent 拦截被删',
       old="  if (isReverse && fixedSeen.rent) {\n    return err('反推模式下房租由目标租金率导出，请勿在固定支出中重复填写房租');\n  }",
       new="  // (变异：rent 拦截移除)",
       target=['A-②', 'C-②']),
  dict(id='M5', f=SV, why='红警不返回 null（冒充有解）',
       old="      red_alert: true,\n      warn_keys: [],",
       new="      red_alert: false,\n      warn_keys: [],",
       target=['C-④']),
  dict(id='M6', f=VL, why='mode 非法值不再拒（静默当正算）',
       old="  if (modeRaw !== 'forward' && modeRaw !== 'reverse') {\n    return err(`mode 必须是 'forward' 或 'reverse'（当前值：${JSON.stringify(modeRaw)}）`);\n  }",
       new="  // (变异：mode 白名单移除)",
       target=['C-⑥']),
  dict(id='M7', f=SV, why='租金率未追加进变动费用（房租从方程里消失）',
       old="  const varItemsPrime = arr(c.varItems).concat([{ key: 'rentRate', pct: targetRentRate }]);",
       new="  const varItemsPrime = arr(c.varItems);",
       target=['B-①']),
]

out = []
def log(s):
    out.append(s)
    print(s.encode('ascii', 'replace').decode('ascii'))

log('===== R221 变异回灌（靶子：tools/check_m2_reverse_rent.js + calcSandbox/selftest.js）=====')
before = {p: sha(p) for p in (SV, VL)}
log('变异前 sha1：service=%s validate=%s' % (before[SV][:12], before[VL][:12]))

def run(node_file):
    r = subprocess.run([NODE, node_file], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return r.returncode, (r.stdout or '') + (r.stderr or '')

okN = 0
for m in MUTS:
    raw = rd(m['f'])
    c = raw.count(m['old'])
    if c != 1:
        log('❌ %s 锚点命中 %d 次（须 1）—— 跳过' % (m['id'], c))
        continue
    wr(m['f'], raw.replace(m['old'], m['new'], 1))
    rc_g, o_g = run(GUARD)
    rc_s, o_s = run(ST)
    wr(m['f'], raw)  # 还原

    fails = [l.strip() for l in o_g.split('\n') if '❌' in l]
    crash = any(k in o_g for k in ('ReferenceError', 'TypeError', 'SyntaxError')) and not fails
    hit = any(any(t in l for t in m['target']) for l in fails)
    s_bad = [l.strip() for l in o_s.split('\n') if '❌' in l]
    flag = '✅ 有效红' if (rc_g != 0 and hit and not crash) else ('⚠️ 崩溃红' if crash else '❌ 未命中/假绿')
    if flag == '✅ 有效红':
        okN += 1
    log('')
    log('%s %s —— %s' % (flag, m['id'], m['why']))
    log('   守卫 rc=%d · ❌ 行：%s' % (rc_g, (' | '.join(fails[:4]) if fails else '(无)')))
    log('   自测 rc=%d · ❌ %d 行（首条：%s）' % (rc_s, len(s_bad), (s_bad[0] if s_bad else '(无)')))
    log('   目标断言名：%s ⇒ %s' % ('/'.join(m['target']), '命中' if hit else '**未命中**'))

after = {p: sha(p) for p in (SV, VL)}
log('')
log('===== 还原验证（二进制 sha1）=====')
for p, tag in ((SV, 'service.js'), (VL, 'validate.js')):
    same = before[p] == after[p]
    log('%s %s 变异前=%s 变异后=%s' % ('✅' if same else '❌', tag, before[p][:12], after[p][:12]))

log('')
log('===== 汇总：%d/%d 条为**有效红**（红在目标断言名上、非崩溃红）=====' % (okN, len(MUTS)))
wr(REPORT, '\n'.join(out) + '\n')
print('REPORT WRITTEN')
