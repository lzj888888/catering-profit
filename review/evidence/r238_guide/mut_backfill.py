# -*- coding: utf-8 -*-
# R238 变异回灌 —— 证明本轮新增的两组判据**真能红**，且不误伤等价改写。
#
# 覆盖：
#   · tools/check_shape_machine_value.js 的 **E 组**（导入后下游引导）
#   · tools/check_modal_button_len.js 的 **C-⑥**（页面局部别名防腐化）
#
# 纪律（仓内铁律）：
#   · 组 A：故意把实现改回错误写法 ⇒ 必须转红，且**红在目标断言名**上（崩溃红不算有效红）。
#   · 组 B：等价改写 ⇒ **不得**转红（防「反向伤害二型」：把正确实现判红）。
#   · 每个变异独立施加、跑完立即还原；还原后必须再跑一次确认回绿（否则说明还原失败）。
#   · 锚点失配 ⇒ **主动作废并计入无效**，绝不静默算通过（fail-closed）。
#
# 运行：python review/evidence/r238_guide/mut_backfill.py
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(r'C:/Users/lzj/WorkBuddy/Claw/catering-profit')
BACKUP = ROOT / 'review/evidence/r238_guide/mut_backup'
SHAPE = 'tools/check_shape_machine_value.js'
MODAL = 'tools/check_modal_button_len.js'
PAGE = 'pages/takeaway/index.js'

# 目标片段（源码原文，逐字）
NAV_LINE = b"        success: (m) => { if (m.confirm) wx.navigateTo({ url: '/pages/m3/dishreview/index' }); },"
NAV_COMMENTED = b"        success: (m) => { if (m.confirm) { /* wx.navigateTo({ url: '/pages/m3/dishreview/index' }) */ } },"
NAV_WITH_FAIL = (b"        success: (m) => { if (m.confirm) wx.navigateTo({ url: '/pages/m3/dishreview/index',"
                 b" fail: () => {} }); },")
TK_BIND = b'const TK = TERMS.ledger.takeaway;'
TK_BIND_SPACED = b'const TK   =   TERMS.ledger.takeaway;'

MUTATIONS = [
    # ---------- 组 A：必须转红 ----------
    dict(id='A1', group='A', want_red=True, assert_named='E-①', suite=SHAPE, file=PAGE,
         note='删掉 showModal（退回纯 toast）⇒ 用户又到这就断了',
         pairs=[(b'      wx.showModal({', b'      wx.__showModal({', 1)]),
    dict(id='A2', group='A', want_red=True, assert_named='E-②', suite=SHAPE, file=PAGE,
         note='navigateTo → switchTab（目标不再是 navigateTo url ⇒ 提取不到）',
         pairs=[(b"wx.navigateTo({ url: '/pages/m3/dishreview/index' })",
                 b"wx.switchTab({ url: '/pages/m3/dishreview/index' })", 1)]),
    dict(id='A3', group='A', want_red=True, assert_named='E-③', suite=SHAPE, file=PAGE,
         note='url 改成未注册页面 ⇒ 死链（点「去看」会失败）',
         pairs=[(b"url: '/pages/m3/dishreview/index'", b"url: '/pages/m3/nonexist/index'", 1)]),
    dict(id='A4', group='A', want_red=True, assert_named='E-④', suite=SHAPE, file=PAGE,
         note='url 改成 tabBar 页 ⇒ 用 navigateTo 会静默失败',
         pairs=[(b"url: '/pages/m3/dishreview/index'", b"url: '/pages/m3/hub'", 1)]),
    dict(id='A5', group='A', want_red=True, assert_named='E-②', suite=SHAPE, file=PAGE,
         note='把 navigateTo 那一行整段挪进注释 ⇒ 剥注释后提取不到（证明注释骗不过判据）',
         pairs=[(NAV_LINE, NAV_COMMENTED, 1)]),
    dict(id='A6', group='A', want_red=True, assert_named='C-⑥-0', suite=MODAL, file=PAGE,
         note='把 takeaway 页的 TK 绑定改掉（别名表指向的源变了）⇒ C-⑥ 防腐化应红',
         pairs=[(TK_BIND, b'const TK = TERMS.buttons;', 1)]),
    # ---------- 组 B：不得转红（防反向伤害）----------
    dict(id='B1', group='B', want_red=False, assert_named='E-②', suite=SHAPE, file=PAGE,
         note='等价改写：给 navigateTo 加一个合法 fail 回调 ⇒ 目标仍可提取 ⇒ 不得红',
         pairs=[(NAV_LINE, NAV_WITH_FAIL, 1)]),
    dict(id='B2', group='B', want_red=False, assert_named='E-①', suite=SHAPE, file=PAGE,
         note='等价改写：showModal 参数顺序调整 ⇒ 行为不变 ⇒ 不得红',
         pairs=[(b'        confirmText: TK.importGoReview,\n        cancelText: TK.importGoLater,',
                 b'        cancelText: TK.importGoLater,\n        confirmText: TK.importGoReview,', 1)]),
    dict(id='B3', group='B', want_red=False, assert_named='C-⑥-0', suite=MODAL, file=PAGE,
         note='等价改写：TK 绑定行多余空白 ⇒ 正则仍命中 ⇒ 不得红（判行为不判字面）',
         pairs=[(TK_BIND, TK_BIND_SPACED, 1)]),
]


def run_suite(suite):
    r = subprocess.run(['node', suite], cwd=str(ROOT), capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    return r.returncode, r.stdout + (r.stderr or '')


def apply_pairs(path, pairs):
    raw = path.read_bytes()
    for old, new, want in pairs:
        n = raw.count(old)
        if n != want:
            return False, f'锚点命中 {n} 次（要求 {want}）'
        raw = raw.replace(old, new)
    path.write_bytes(raw)
    return True, 'ok'


def main():
    BACKUP.mkdir(parents=True, exist_ok=True)
    files = {}
    for m in MUTATIONS:
        p = ROOT / m['file']
        if m['file'] not in files:
            files[m['file']] = p.read_bytes()

    # 基线：两个套件都必须绿（否则后续判红无意义）
    base_ok = True
    for suite in sorted({m['suite'] for m in MUTATIONS}):
        rc0, out0 = run_suite(suite)
        print(f'[基线] {suite} rc={rc0} ⇒ {"绿 ✅" if rc0 == 0 else "红 ❌"}')
        if rc0 != 0:
            base_ok = False
            print(out0[-1200:])
    if not base_ok:
        print('❌ 基线不绿 ⇒ 回灌无意义，终止')
        sys.exit(2)

    results = []
    for m in MUTATIONS:
        page = ROOT / m['file']
        bak = BACKUP / (m['id'] + '__' + pathlib.Path(m['file']).name + '.bak')
        bak.write_bytes(files[m['file']])                # 备份原始
        ok, why = apply_pairs(page, m['pairs'])
        if not ok:
            page.write_bytes(files[m['file']])
            results.append((m, 'INVALID', f'锚点失配：{why}'))
            print(f"[{m['id']}] ⚠️ 无效（锚点失配：{why}）—— 主动作废，不静默算通过")
            continue

        rc, out = run_suite(m['suite'])
        is_red = rc != 0
        hit_target = ('❌ ' + m['assert_named']) in out
        page.write_bytes(files[m['file']])               # 立即还原
        rc2, _ = run_suite(m['suite'])
        restored = (rc2 == 0)

        if m['want_red']:
            verdict = 'PASS' if (is_red and hit_target and restored) else 'FAIL'
        else:
            verdict = 'PASS' if ((not is_red) and restored) else 'FAIL'
        results.append((m, verdict, f'rc={rc} 红={is_red} 命中{m["assert_named"]}={hit_target} 还原={restored}'))
        print(f"[{m['id']}] {'✅' if verdict == 'PASS' else '❌'} "
              f"[{m['suite'].split('/')[-1]}] 期望{'红' if m['want_red'] else '不红'} :: "
              f"rc={rc} 红={is_red} 命中{m['assert_named']}={hit_target} 还原={restored}"
              + ('' if verdict == 'PASS' else '\n   ' + out[-900:]))

    # 最终还原校验
    for rel, raw in files.items():
        (ROOT / rel).write_bytes(raw)
    final_ok = all(run_suite(s)[0] == 0 for s in sorted({m['suite'] for m in MUTATIONS}))

    a_pass = [r for r in results if r[0]['want_red'] and r[1] == 'PASS']
    a_all = [r for r in results if r[0]['want_red']]
    b_pass = [r for r in results if not r[0]['want_red'] and r[1] == 'PASS']
    b_all = [r for r in results if not r[0]['want_red']]
    invalid = [r for r in results if r[1] == 'INVALID']

    print('\n===== 变异回灌汇总 =====')
    print(f'组 A（必须红）: {len(a_pass)}/{len(a_all)} 有效红')
    print(f'组 B（不得红）: {len(b_pass)}/{len(b_all)} 无反向伤害')
    print(f'无效（锚点失配）: {len(invalid)}')
    print(f'最终还原校验: {"绿 ✅" if final_ok else "红 ❌"}')
    okk = (len(a_pass) == len(a_all) == 6 and len(b_pass) == len(b_all) == 3
           and not invalid and final_ok)
    print(f'\n{"✅ 全部通过" if okk else "❌ 存在未通过项"}')
    return 0 if okk else 1


if __name__ == '__main__':
    sys.exit(main())
