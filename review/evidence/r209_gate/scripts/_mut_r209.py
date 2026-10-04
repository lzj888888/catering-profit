# -*- coding: utf-8 -*-
# _mut_r209.py —— R209 变异回灌：把刚修的月份 picker bug 逐条改回去，看守卫是否（且仅）红在目标断言
# 铁律：逐条、独立、可还原；还原后 md5 必须与开工前一致。
import hashlib, subprocess, os, sys, io

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
NODE = r'C:\Users\lzj\.workbuddy\binaries\node\versions\22.22.2-3\node.exe'
GUARD = 'tools/check_month_picker.js'
TARGET = 'pages/month/index.js'

GOOD = """  onMonthChange(e) {
    // 🔴 R209：`<picker mode="selector">` 的 `e.detail.value` 是**选中项下标（数字）**，不是月份字符串。
    //   旧实现直接 `const month = e.detail.value` 往下传 ⇒ 后端 getLedger 收到 month=0/1/2
    //   ⇒ validate 判 INVALID_PARAM ⇒ 前端弹 ERR.INVALID_PARAM「填写有误，请检查后重试」。
    //   真机表现正是「月份只能停在本月、点任何一个月就报错」（李老师 2026-10-04 反馈）。
    //   ⚠️ 全站其余 12 处 selector picker 都是 `Number(e.detail.value)` 取数组元素，这里是唯一走漏的一处。
    const i = Number(e.detail.value);
    const month = this.data.months[i];
    if (!month || month === this.data.curMonth) return;   // 越界/重复选择：不发起无效请求
    this.setData({ monthIndex: i, loading: true });
    this.loadMonth(month).then(() => this.setData({ loading: false }));
  },"""

def read_txt(rel):
    with io.open(os.path.join(ROOT, rel), 'r', encoding='utf-8', newline='') as f:
        return f.read()

def write_bytes(rel, text):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8', newline='') as f:
        f.write(text)

def md5(rel):
    with open(os.path.join(ROOT, rel), 'rb') as f:
        return hashlib.md5(f.read()).hexdigest()

def run_guard():
    p = subprocess.run([NODE, GUARD], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    out = (p.stdout or '') + (p.stderr or '')
    red = [l.strip() for l in out.splitlines() if l.strip().startswith('❌')]
    return p.returncode, out, red

BASE = read_txt(TARGET)
BASE_MD5 = md5(TARGET)
if GOOD not in BASE:
    print('PRECHECK FAIL: 目标文件里找不到刚修的 GOOD 片段 ⇒ 起点不是预期状态，停手')
    sys.exit(2)

# 变异表：(编号, 说明, 变异后文本, 期望至少红这些断言编号)
MUTS = [
    ('M1', '改回原 bug：`const month = e.detail.value` 直接往下传',
     BASE.replace(GOOD, """  onMonthChange(e) {
    const month = e.detail.value;
    this.setData({ loading: true });
    this.loadMonth(month).then(() => this.setData({ loading: false }));
  },"""),
     ['A-①', 'A-②', 'C-②']),

    ('M2', '去掉越界/重复的 early return（保留正确取值）',
     BASE.replace(GOOD, GOOD.replace(
         "    if (!month || month === this.data.curMonth) return;   // 越界/重复选择：不发起无效请求\n", '')),
     ['A-③', 'A-④']),

    ('M3', 'picker 高亮不跟随（setData 去掉 monthIndex）',
     BASE.replace(GOOD, GOOD.replace(
         "this.setData({ monthIndex: i, loading: true });", "this.setData({ loading: true });")),
     ['A-⑤']),
]

print('起点 md5 =', BASE_MD5)
overall_ok = True
for mid, desc, mut_text, expect in MUTS:
    write_bytes(TARGET, mut_text)
    rc, out, red = run_guard()
    write_bytes(TARGET, BASE)          # 立即还原
    restored = (md5(TARGET) == BASE_MD5)
    hit = set()
    for r in red:
        for tok in r.split():
            if len(tok) >= 3 and tok[0] in 'SABCD' and tok[1] == '-':
                hit.add(tok[:3])
    ok = (rc != 0) and all(e in hit for e in expect) and restored
    if not ok:
        overall_ok = False
    print('\n[{0}] {1}'.format(mid, desc))
    print('   rc={0} | 红 says={1} | 期望全命中={2} | 已还原={3}'.format(
        rc, sorted(hit), all(e in hit for e in expect), restored))
    for r in red:
        print('     ' + r)
    if not ok:
        print('   ⚠️ 未达逐条判据（红得不完整 / 没红 / 未还原）')

print('\n还原校验 md5 =', md5(TARGET), '| 与起点一致 =', md5(TARGET) == BASE_MD5)
print('=== ' + ('变异回灌全部有效' if overall_ok else 'MUTATION INCOMPLETE') + ' ===')
sys.exit(0 if overall_ok else 1)
