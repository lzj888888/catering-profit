# -*- coding: utf-8 -*-
"""
R234/M2v1.4 变异回灌 —— 证明 check_m2_biz_inputs.js 的断言**真能抓到错**。

纪律（本仓 R232 系列）：
  · 修复 ≠ 闭环，必须双向变异回灌；
  · 变异必须**红在目标断言名上**（崩溃红 / 别的断言红 都算无效红）；
  · 用临时备份 + md5 终态校验，**禁用 git checkout**（会把别人的改动一起冲掉）。
"""
import io, os, shutil, subprocess, sys, hashlib

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
GUARD = os.path.join('tools', 'check_m2_biz_inputs.js')
MUT = 'tools/check_m2_biz_inputs.js'

FILES = [
    'pages/sandbox/index.js',
    'pages/sandbox/index.wxml',
    'miniprogram/i18n/terms.js',
    'tools/check_m2_biz_inputs.js',   # 🔴 R234-实测：守卫**自身**也要变异 —— 证明判据不是恒绿
]

def rd(p):
    with io.open(os.path.join(ROOT, p), encoding='utf-8') as f:
        return f.read()

def wr(p, s):
    with io.open(os.path.join(ROOT, p), 'w', encoding='utf-8', newline='') as f:
        f.write(s)

def md5(p):
    with io.open(os.path.join(ROOT, p), 'rb') as f:
        return hashlib.md5(f.read()).hexdigest()

def run_guard():
    r = subprocess.run(['node', 'tools/check_m2_biz_inputs.js'],
                       cwd=ROOT, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    out = (r.stdout or '') + (r.stderr or '')
    reds = []
    for line in out.split('\n'):
        s = line.strip()
        if s.startswith('❌'):
            # 断言名形如「A-① wxml 的 input value 绑定…」⇒ 取第一个 token
            reds.append(s[1:].split()[0] if len(s) > 1 else '?')
    total = ''
    for line in out.split('\n'):
        if '守卫结果' in line:
            total = line.strip()
    return r.returncode, reds, total, out

# ---- 备份 ----
BAK = {}
for p in FILES:
    BAK[p] = rd(p)
    shutil.copy2(os.path.join(ROOT, p), os.path.join(ROOT, p + '.r234bak'))
print('已备份 %d 个文件' % len(FILES))

MUTATIONS = [
    # (名称, 文件, old, new, 期望红在)
    ('① 把专业指标塞回 input', 'pages/sandbox/index.wxml',
     'value="{{seatsNum}}"', 'value="{{revRentRate}}"', 'A-①'),
    ('② 业态预设退回两级 picker', 'pages/sandbox/index.js',
     '    const opts = BIZ_PRESETS.map((p) => ({',
     '    const bizKey = this.data.t.bizTypes[this.data.bizIdx].key;\n'
     '    const opts = BIZ_PRESETS.filter((p) => p.bizKey === bizKey).map((p) => ({',
     'B-①'),
    ('③ 选完预设不回写 bizIdx', 'pages/sandbox/index.js',
     '        patch.bizIdx = bi;', '        void bi;', 'B-③'),
    ('④ verdictOf 自造判定', 'pages/sandbox/index.js',
     "    const lv = row.level || 'na';",
     "    const lv = levelOf(row.pct, row.lo, row.hi, 'cost') || 'na';", 'C-②'),
    # ⚠️ 目标名 = **C-①a**：首版写 `C-①`，而 C-① 已拆成 a/b/c 三条（一条断言守一个要素），
    #    期望值必须跟着拆 —— 否则会误报"判据失效"，实际它红得很准。
    ('⑤ 主结论卡的判定等级不渲染', 'pages/sandbox/index.wxml',
     '<text class="verdict-lv lv-{{verdict.level}}">{{verdict.levelName}}</text>',
     '', 'C-①a'),
    ('⑥ Tab 名退回算法词', 'miniprogram/i18n/terms.js',
     "    tabForward: '已有铺面',", "    tabForward: '正向测算',", 'D-②'),
    ('⑦ 房租指标名退回无宾语', 'miniprogram/i18n/terms.js',
     "rent: '房租占营业额'", "rent: '房租占比'", 'D-③'),

    # ===== R234-实测新增：针对"首版守卫全绿却漏了两个专业指标"这个洞 =====
    # 背景：首版 BAN_INPUTS 只有 rev* 两项 ⇒ L3 里的 pixelEffYuan/turnNum 一个没被扫到，
    #       而李老师点名的正是这两个。下面 ⑧⑨ 证明**补全后**真能抓住；⑩⑪ 变异守卫自身，
    #       证明新判据（A-⑥/A-⑦/V-⑤）不是恒绿 —— 否则它们只是给已修的 bug 补合格证。
    ('⑧ 把历史死输入 turnNum 塞回 input（引擎根本不收）', 'pages/sandbox/index.wxml',
     'value="{{seatsNum}}"', 'value="{{turnNum}}"', 'A-⑥'),
    ('⑨ 把历史坪效 pixelEffYuan 塞回 input', 'pages/sandbox/index.wxml',
     'value="{{openDaysNum}}"', 'value="{{pixelEffYuan}}"', 'A-⑥'),
    ('⑩ 守卫退化：BAN_INPUTS 缩回只含 rev*（首版那个洞）', 'tools/check_m2_biz_inputs.js',
     "const BAN_INPUTS = ['revRentRate', 'revPixelEff', 'pixelEffYuan', 'turnNum'];",
     "const BAN_INPUTS = ['revRentRate', 'revPixelEff'];", 'V-⑤'),
    # ⚠️ ⑪ 首版我删 1 项（13→12）却期望 A-⑦ 红 —— **期望值错了，不是判据错**：
    #    A-⑦ 的下界是 ≥10，删 1 项还剩 12 ⇒ 它本来就该绿（真红的其实是 A-⑥/V-⑦）。
    #    要打 A-⑦ 必须**真把它打到 10 以下** ⇒ 一次性删末尾 4 项（13→9）。
    #    （守卫红先怀疑判据；但"期望值写错"属于第三种：变异脚本自己写歪了。）
    ('⑪ 守卫退化：ALLOW_INPUTS 砍到 9 项（自失效护栏下界）', 'tools/check_m2_biz_inputs.js',
     "  planName: '方案名（快照用，非测算入参）',\n"
     "  presetIdx: '业态预设 picker（枚举，非专业指标）',\n"
     "  rentYuan: '月租金 → fixed_items.rent；房东报价，填得出',\n"
     "  seatsNum: '座位数 → seats（反推算翻台必需）；由面积×密度估算、用户可改',\n",
     "", 'A-⑦'),
]

results = []
try:
    # ---- 零变异基线 ----
    rc, reds, total, _ = run_guard()
    ok = (rc == 0 and not reds)
    results.append(('〇 零变异基线（必须全绿）', ok, '全绿' if ok else '红了：' + ','.join(reds), total))
    print('〇 基线: %s | %s' % ('绿' if ok else '红', total))

    for name, f, old, new, want in MUTATIONS:
        src = rd(f)
        if old not in src:
            results.append((name, False, '锚点未命中（old 不在文件里）⇒ 变异没生效', ''))
            print('%s … ❌ 锚点未命中' % name)
            continue
        wr(f, src.replace(old, new, 1))
        rc, reds, total, _ = run_guard()
        wr(f, src)   # 立即还原
        hit = want in reds
        results.append((name, hit, ('恰红在 ' + want) if hit else
                        ('未红在目标：期望 %s，实得 %s' % (want, ','.join(reds) or '无')), total))
        print('%s … %s | 实得 %s' % (name, '✅' if hit else '❌', ','.join(reds) or '无'))
finally:
    # ---- 还原 + md5 终态校验 ----
    for p in FILES:
        wr(p, BAK[p])
    print('\n=== 终态 md5 校验（必须与备份一致）===')
    allok = True
    for p in FILES:
        a = md5(p); b = md5(p + '.r234bak')
        same = a == b
        allok = allok and same
        print('  %-30s %s  %s' % (p, a[:12], '✅ 一致' if same else '❌ 不一致'))
        os.remove(os.path.join(ROOT, p + '.r234bak'))

print('\n===== 变异回灌结果 =====')
good = 0
for name, ok, detail, total in results:
    print('  %s %-28s %s' % ('✅' if ok else '❌', name, detail))
    if ok: good += 1
print('\n%d / %d 条变异有效（含零变异基线）· 终态还原 %s' % (good, len(results), '一致' if allok else '🔴 不一致'))
sys.exit(0 if (good == len(results) and allok) else 1)
