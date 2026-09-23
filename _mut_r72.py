# -*- coding: utf-8 -*-
"""round72 变异回灌：证明 G10 守卫不是假绿。

⚠️ 上一版有两个缺陷已修（都是「让回灌本身失真」的坑，别再犯）：
  ① restore() 顺手删了 .mutbak ⇒ 第二条起变异**没被还原、逐条累积**，最后文件被污染。
     修法：备份只在开头做一次、结尾才删；每条变异前先 reset_to_base()。
  ② 用「N 通过 / M 失败」里的 M 判是否抓到 ⇒ 变异若让 selftest **崩溃**（语法错），
     压根不打印汇总行，M 取不到 = -1，会被误判成「漏网」。
     修法：抓到与否看**有没有 ❌ 行 或 退出码非 0**，两者都算抓到。
"""
import subprocess, shutil, os, re, sys

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
NODE = r'C:\Users\lzj\.workbuddy\binaries\node\versions\22.22.2-3\node.exe'
SELFTEST = os.path.join(ROOT, 'tools', 'selftest_batch8b.js')

TARGETS = {
    'dine': os.path.join(ROOT, 'utils', 'dineChannels.js'),
    'js':   os.path.join(ROOT, 'pages', 'month', 'input.js'),
    'wxml': os.path.join(ROOT, 'pages', 'month', 'input.wxml'),
}

def read(p):
    with open(p, 'r', encoding='utf-8', newline='') as f:
        return f.read()

def write(p, s):
    with open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)

def run_selftest():
    r = subprocess.run([NODE, SELFTEST], capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    out = (r.stdout or '') + (r.stderr or '')
    failed = [l for l in out.splitlines() if l.startswith('❌')]
    crashed = (r.returncode != 0) and not re.search(r'\d+ 通过 / \d+ 失败', out)
    return failed, crashed

def backup():
    for k, p in TARGETS.items():
        shutil.copy2(p, p + '.mutbak')

def reset_to_base():
    for k, p in TARGETS.items():
        b = p + '.mutbak'
        if os.path.exists(b):
            shutil.copy2(b, p)

def cleanup():
    for k, p in TARGETS.items():
        b = p + '.mutbak'
        if os.path.exists(b):
            os.remove(b)

MUTATIONS = [
    # 每条都是「真实会犯的错」，不是随便涂改
    ('M1 装配函数不再铺预设全集（李老师现场 bug）', 'dine',
     "  const out = presets.map((name) => ({",
     "  const out = []; presets.map((name) => ({"),
    ('M2 页面绕过唯一入口、自行 map 拼装渠道行', 'js',
     "    return normalizeDineRows(rows, (def && def.items) || [], TERMS.ledger.channelNotes || {});",
     "    return (rows || []).map((r) => ({ subItem: r.subItem || '', amountYuan: r.amountYuan || '', fixed: false, note: '' }));"),
    ('M3 页面写死渠道名（清单脱离单一数据源）', 'js',
     "const DRAFT_KEY = 'draft_month_input_';",
     "const DRAFT_KEY = 'draft_month_input_';\nconst HARD_CODED = '现金收款';"),
    ('M4 保存不过滤空行（空渠道全落库）', 'js',
     "        .filter((r) => String(r.amountYuan === undefined || r.amountYuan === null ? '' : r.amountYuan).trim() !== '')",
     "        .filter((r) => true)"),
    ('M5 删除键退回「行数>1 就显示」（预设行又能删）', 'wxml',
     '<button class="btn-del" wx:if="{{!r.fixed}}"',
     '<button class="btn-del" wx:if="{{g.rows.length > 1}}"'),
    ('M6 新增空行不带 custom（点了添加没反应）', 'js',
     "g.rows = g.rows.concat([{ subItem: '', amountYuan: '', custom: true }]);",
     "g.rows = g.rows.concat([{ subItem: '', amountYuan: '' }]);"),
]

def main():
    os.chdir(ROOT)
    backup()
    try:
        base_failed, base_crash = run_selftest()
        print('BASELINE ❌=%d crash=%s %s' % (len(base_failed), base_crash, base_failed[:3]))
        if base_failed or base_crash:
            print('!!! 基线就不是绿的，先修再回灌'); return 1

        miss = []
        for name, key, old, new in MUTATIONS:
            reset_to_base()                      # ← 关键：每条都从干净基线开始
            p = TARGETS[key]
            src = read(p)
            if old not in src:
                print('SKIP（锚点未命中）: %s' % name); miss.append(name); continue
            write(p, src.replace(old, new, 1))
            failed, crashed = run_selftest()
            caught = bool(failed) or crashed
            print('%-50s -> ❌=%d%s %s' % (name, len(failed),
                  ' (脚本崩溃，等同抓到)' if crashed else '', '✅ 抓到' if caught else '❌ 漏网'))
            for l in failed[:3]:
                print('      %s' % l)
            if not caught:
                miss.append(name)

        reset_to_base()
        after_failed, after_crash = run_selftest()
        print('\n还原后 ❌=%d crash=%s（应全清）' % (len(after_failed), after_crash))
        print('变异 %d 条，抓到 %d 条，漏网 %d 条 %s' %
              (len(MUTATIONS), len(MUTATIONS) - len(miss), len(miss), miss or ''))
        return 0 if (not miss and not after_failed and not after_crash) else 1
    finally:
        reset_to_base()
        cleanup()

sys.exit(main())
