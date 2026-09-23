import subprocess, shutil, os, re, sys

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
RUNNER = r'C:\Users\lzj\.workbuddy\binaries\node\versions\22.22.2-3\node.exe'
TARGETS = {
    'js': os.path.join(ROOT, 'pages', 'month', 'input.js'),
    'wxml': os.path.join(ROOT, 'pages', 'month', 'input.wxml'),
    'dc': os.path.join(ROOT, 'utils', 'dineChannels.js'),
    'terms': os.path.join(ROOT, 'miniprogram', 'i18n', 'terms.js'),
}
TEST = os.path.join(ROOT, 'tools', 'selftest_batch8b.js')


def read(p):
    with open(p, 'r', encoding='utf-8', newline='') as f:
        return f.read()


def write(p, s):
    with open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)


def run():
    r = subprocess.run([RUNNER, TEST], capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    out = (r.stdout or '') + (r.stderr or '')
    failed = [l for l in out.splitlines() if l.startswith('\u274c')]
    crashed = (r.returncode != 0) and not re.search(r'\d+ \u901a\u8fc7 / \d+ \u5931\u8d25', out)
    return failed, crashed


def backup():
    for p in TARGETS.values():
        shutil.copy2(p, p + '.mutbak')


def reset_to_base():
    for p in TARGETS.values():
        b = p + '.mutbak'
        if os.path.exists(b):
            shutil.copy2(b, p)


def cleanup():
    for p in TARGETS.values():
        b = p + '.mutbak'
        if os.path.exists(b):
            os.remove(b)


MUTATIONS = [
    # 1) 退回旧 bug：非堂食行不再标 fixed，且绕过唯一装配口（各自拼装）
    ('M1 \u7ed5\u8fc7\u552f\u4e00\u88c5\u914d\u53e3\uff08\u975e\u5802\u98df\u884c\u76f4\u63a5\u8fd4\u56de\uff09', 'js',
     "dine_in' ? this.decorateDineRows(rows) : markFixedRows(rows, g.items)",
     "dine_in' ? this.decorateDineRows(rows) : rows"),
    # 2) 预设行又被允许删除（退回「人人都有 ×」）
    ('M2 \u6536\u5165\u9884\u8bbe\u884c\u53c8\u7ed9\u4e86\u5220\u9664\u952e', 'wxml',
     'class="btn-del" wx:if="{{g.expanded && !r.fixed && g.rows.length > 1}}"',
     'class="btn-del" wx:if="{{g.expanded && g.rows.length > 1}}"'),
    # 3) 别名归并失效（只认完全同名 ⇒ 美团/现金 又各占一行）
    ('M3 \u522b\u540d\u5f52\u5e76\u5931\u6548\uff08\u53ea\u8ba4\u5b8c\u5168\u540c\u540d\uff09', 'dc',
     'const t = aliasMap[n];',
     "const t = '';"),
    # 4) 页面忘了把别名表传进装配口（静默失效，最阴的一种）
    ('M4 \u9875\u9762\u4e0d\u4f20\u522b\u540d\u8868', 'js',
     'TERMS.ledger.channelAliases || {}',
     '{}'),
    # 5) 预设行名又变成可编辑输入框（退回「人人可改名」）
    ('M5 \u9884\u8bbe\u884c\u540d\u53c8\u53d8\u53ef\u7f16\u8f91\u8f93\u5165\u6846', 'wxml',
     '<text class="sub-item-fixed" wx:elif="{{g.expanded}}">{{r.subItem}}</text>',
     '<input class="sub-item-inp" wx:elif="{{g.expanded}}" value="{{r.subItem}}" />'),
    # 6) 别名指向写错渠道名（错字型事故）
    ('M6 \u522b\u540d\u6307\u5411\u5199\u9519\u6e20\u9053\u540d', 'terms',
     "'\u73b0\u91d1': '\u73b0\u91d1\u6536\u6b3e',",
     "'\u73b0\u91d1': '\u73b0\u91d1\u94b1',"),
]


def main():
    backup()
    try:
        f, c = run()
        if f or c:
            print('BASELINE NOT GREEN -> abort')
            return 1
        print('baseline: GREEN (0 fail)')
        missed = []
        for name, key, old, new in MUTATIONS:
            reset_to_base()
            p = TARGETS[key]
            src = read(p)
            if old not in src:
                print('SKIP anchor miss: %s' % name)
                missed.append(name)
                continue
            write(p, src.replace(old, new, 1))
            failed, crashed = run()
            caught = bool(failed) or crashed
            print('%-46s FAIL=%d%s %s' % (name, len(failed),
                                          ' (CRASH=caught)' if crashed else '',
                                          'CAUGHT' if caught else '*** MISSED ***'))
            if not caught:
                missed.append(name)
        reset_to_base()
        af, ac = run()
        print('after restore: FAIL=%d crash=%s' % (len(af), ac))
        print('SUMMARY: %d mutations, %d missed' % (len(MUTATIONS), len(missed)))
        return 0 if (not missed and not af and not ac) else 1
    finally:
        reset_to_base()
        cleanup()


sys.exit(main())
