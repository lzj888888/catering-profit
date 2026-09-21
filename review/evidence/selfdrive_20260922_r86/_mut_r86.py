# -*- coding: utf-8 -*-
"""round86 独立双向变异回灌（复核并发方 R115 主题色守卫 + r85-takeaway 自测）
铁律：字节快照还原，绝不用 git checkout（autocrlf 仓会反向改行尾）
"""
import subprocess, sys, os

NODE = 'node'
E = '\n'

# ---------- 变异定义：(id, 期望, 说明, [(file, old, new), ...]) ----------
MUTS = []

# ===== R115 主题色守卫 =====
MUTS.append(('T1', 'RED', '旧橘黄回流到生效样式（input.wxss）',
             [('pages/month/input.wxss',
               '.dine-sum-val { font-size: 34rpx; font-weight: 600; color: #1e3a5f; }' + E,
               '.dine-sum-val { font-size: 34rpx; font-weight: 600; color: #1e3a5f; }' + E +
               '.mut-r86 { background: #ff6b35; }' + E)]))

MUTS.append(('T2', 'RED', '深色模式回流（app.wxss 生效 @media）',
             [('app.wxss', 'page { background: #f5f6f8;',
               '@media (prefers-color-scheme: dark) { .x { color: #000; } }' + E +
               'page { background: #f5f6f8;')]))

MUTS.append(('T3', 'RED', '删除深色模式退役声明（fail-closed 应转红）',
             [('app.wxss', ' * ⚠️ 深色模式：已移除（2026-09-20 · 真机走查缺陷②）' + E, '')]))

MUTS.append(('T4', 'RED', 'EXTS 缩水删掉 .wxss（A3-③ 应转红）',
             [('tools/check_theme_color.js',
               "const EXTS = ['.wxss', '.wxml', '.json', '.js'];",
               "const EXTS = ['.wxml', '.json', '.js'];")]))

MUTS.append(('T5', 'GREEN', '注释里出现旧橘黄/prefers-color-scheme（不得误报）',
             [('app.wxss', 'page { background: #f5f6f8;',
               '/* 历史遗留：#ff6b35 与 @media (prefers-color-scheme: dark) 均已下线 */' + E +
               'page { background: #f5f6f8;')]))

MUTS.append(('T6', 'GREEN', '页面合法使用 backgroundTextStyle:"dark"（不得误杀）',
             [('pages/month/input.wxss', '.dine-sum-val { font-size: 34rpx; font-weight: 600; color: #1e3a5f; }' + E,
               '.dine-sum-val { font-size: 34rpx; font-weight: 600; color: #1e3a5f; }' + E +
               '/* dark 是合法下拉刷新指示器样式，不得被深色模式判据误杀 */' + E)]))

MUTS.append(('T7', 'GREEN?', '【探漏】旧橘黄的 rgba 等价写法（预期判绿=强度缺口）',
             [('pages/month/input.wxss', '.dine-sum-val { font-size: 34rpx; font-weight: 600; color: #1e3a5f; }' + E,
               '.dine-sum-val { font-size: 34rpx; font-weight: 600; color: #1e3a5f; }' + E +
               '.mut-r86b { background: rgba(255, 107, 53, 1); }' + E)]))

# ===== r85-takeaway 自测 =====
MUTS.append(('W1', 'RED', 'firstNumber 退回截断版（≥4 位只取前 3 位）',
             [('utils/takeaway.js',
               r'/-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/',
               r'/-?\d{1,3}(?:,\d{3})*(?:\.\d+)?/')]))

MUTS.append(('W2', 'RED', 'stripNonMoney 去掉账期/日期剔除',
             [('utils/takeaway.js',
               r"    .replace(/\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?/g, ' ')     // 2026-09 / 2026-09-21 / 2026/9/1" + E,
               '')]))

MUTS.append(('W3', 'RED', '补贴带出退回「回读旧值≠合计即加锁」误判',
             [('pages/month/input.js',
               'if (cur === target) return;',
               'if (cur && cur !== target) { g.rows[ri].twCarryLock = true; return; }')]))

MUTS.append(('W4', 'GREEN?', '【探误杀】工具注释里合法提及平台名（A13 裸 includes 会否误报）',
             [('utils/takeaway.js',
               '// 🔒 单一数据源：平台名与顺序只来自 terms.js::ledger.income[takeaway].items；' + E,
               '// 🔒 单一数据源：平台名与顺序只来自 terms.js::ledger.income[takeaway].items；' + E +
               '//   例如「美团外卖」「淘宝闪购」等名称一律不在此处写死。' + E)]))

MUTS.append(('W5', 'GREEN', 'firstNumber 换等价写法（不错杀）',
             [('utils/takeaway.js',
               r'/-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/',
               r'/-?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/')]))

MUTS.append(('W6', 'RED', '补贴求和去掉空值兜底（NaN 传播）',
             [('utils/takeaway.js',
               '(s, r) => s + (Number(r && r.subsidy) || 0), 0);',
               '(s, r) => s + Number(r && r.subsidy), 0);')]))

TARGET = {
    'T': ['tools/check_theme_color.js'],
    'W': ['tools/selftest_r85.js'],
}


def run(node_script):
    p = subprocess.run([NODE, node_script], capture_output=True, encoding='utf-8', errors='replace')
    return p.returncode, (p.stdout or '') + (p.stderr or '')


def apply_muts(edits):
    snaps = {}
    ok = True
    for f, old, new in edits:
        p = f
        if p not in snaps:
            snaps[p] = open(p, 'rb').read()
        data = snaps[p]
        ob, nb = old.encode('utf-8'), new.encode('utf-8')
        if data.count(ob) != 1:
            print('  !! ANCHOR_MISS %s  count=%d  old=%r' % (p, data.count(ob), old[:70]))
            ok = False
            continue
        open(p, 'wb').write(data.replace(ob, nb, 1))
    return snaps, ok


def restore(snaps):
    for p, b in snaps.items():
        open(p, 'wb').write(b)


def main():
    results = []
    for mid, expect, desc, edits in MUTS:
        snaps, ok = apply_muts(edits)
        if not ok:
            restore(snaps)
            results.append((mid, 'NOT_APPLIED', expect, desc))
            continue
        rcs = {}
        for t in TARGET[mid[0]]:
            rc, out = run(t)
            rcs[t] = (rc, out)
        restore(snaps)
        # 复合判据：任一套件红即视为 RED
        red = any(rc != 0 for rc, _ in rcs.values())
        actual = 'RED' if red else 'GREEN'
        verdict = 'OK' if actual == expect else ('MISMATCH' if expect != 'GREEN?' else 'INFO')
        results.append((mid, actual + '(' + verdict + ')', expect, desc))
        for t, (rc, out) in rcs.items():
            tail = [l for l in out.strip().split('\n') if l.strip()][-1:]
            print('  [%s] %s rc=%d  %s' % (mid, t, rc, tail[0][:110] if tail else ''))
        sys.stdout.flush()

    print('\n===== round86 独立变异回灌汇总 =====')
    for mid, actual, expect, desc in results:
        print('%-4s 期望=%-7s 实测=%-14s %s' % (mid, expect, actual, desc))


if __name__ == '__main__':
    main()
