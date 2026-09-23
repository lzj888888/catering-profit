# -*- coding: utf-8 -*-
"""round70 独立变异回灌：R106（后台鉴权参数口径）+ 48bf7c9（UI 折叠/渠道行两行）
只做字节级 copy2 备份/还原，不用文本写回（防 CRLF/LF 漂移，坑⑧/⑳）。
"""
import shutil, subprocess, os, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
BAK = os.path.join(ROOT, '_bak_r70')
os.makedirs(BAK, exist_ok=True)

TARGETS = {
    'MUT_ADMIN_AUTH': 'cloudfunctions/_adminCore/adminAuth.js',
    'MUT_DECL16': 'specs/dev-specs/core/16_后台鉴权规范.md',
    'MUT_WXML': 'pages/month/input.wxml',
    'MUT_WXSS': 'pages/month/input.wxss',
    'MUT_COV': 'tools/check_suite_coverage.js',
    'MUT_VA': 'verify_all.js',
}
GATE = {'r106': 'tools/check_admin_auth_params.js',
        'b8b': None, 'ui': 'tools/selftest_ui_fix.js'}


def abspath(rel):
    return os.path.join(ROOT, rel.replace('/', os.sep))


def backup():
    for k, rel in TARGETS.items():
        p = abspath(rel)
        if os.path.exists(p):
            shutil.copy2(p, os.path.join(BAK, k))


def restore(rel_key):
    src = os.path.join(BAK, rel_key)
    dst = abspath(TARGETS[rel_key])
    if os.path.exists(src):
        shutil.copy2(src, dst)


def read(rel_key):
    with open(abspath(TARGETS[rel_key]), 'rb') as f:
        return f.read().decode('utf-8')


def write(rel_key, txt):
    with open(abspath(TARGETS[rel_key]), 'wb') as f:
        f.write(txt.encode('utf-8'))


def run(script):
    r = subprocess.run(['node', script], cwd=ROOT, capture_output=True, encoding='utf-8', errors='ignore')
    return r.returncode


def mut(key, old, new, script, expect_red=True, label=''):
    """expect_red=True => 期望 rc!=0；False => 期望 rc==0（不错杀）"""
    backup()
    t = read(key)
    if old not in t:
        print('  [SKIP] %s 锚点不存在: %r' % (label, old[:60]))
        return 'SKIP'
    write(key, t.replace(old, new, 1))
    rc = run(script)
    restore(key)
    rc2 = run(script)
    red = (rc != 0)
    green = (rc2 == 0)
    if expect_red:
        verdict = 'OK' if red else 'MISMATCH(应红却绿=漏)'
    else:
        verdict = 'OK' if (rc == 0) else 'MISMATCH(应绿却红=误杀)'
    print('  [%s] %-42s mut_rc=%d restore_rc=%d  %s' % (verdict, label, rc, rc2, '' if green else ' !!还原未回绿'))
    return verdict


if __name__ == '__main__':
    backup()
    print('=== A 组：R106 后台鉴权参数口径守卫 ===')
    mut('MUT_ADMIN_AUTH', 'const LOCK_AFTER_FAILS = 5;', 'const LOCK_AFTER_FAILS = 10;',
        GATE['r106'], True, 'A1 单源锁阈值 5→10')
    mut('MUT_ADMIN_AUTH', 'const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;', 'const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;',
        GATE['r106'], True, 'A2 单源 token 7天→30天')
    mut('MUT_DECL16', '锁阈值 **5** 次 / 锁时长 **30** 分钟 / token 有效期 **7** 天。',
        '连续 **5** 次密码错误即锁定 **30** 分钟，token **7** 天有效。',
        GATE['r106'], False, 'A3 声明换措辞(不错杀)')
    mut('MUT_DECL16', '后台鉴权参数口径（唯一声明处）', '后台鉴权参数口径',
        GATE['r106'], True, 'A4 删唯一声明(fail-closed)')
    mut('MUT_DECL16', '- 所有 `core/10 §6` 的 admin 云函数（除 `adminLogin`）**必须在请求头带 `Authorization: Bearer <token>`**',
        '- 所有 `core/10 §6` 的 admin 云函数（除 `adminLogin`）**必须在请求头带 `Authorization: Bearer <token>`**；管理端密码错误 **8** 次锁定（adminAuth LOCK_AFTER_FAILS）。',
        GATE['r106'], True, 'A5 文档另写错值 8 次')

    print('=== B 组：48bf7c9 UI 判据（口径折叠 / 渠道行两行 / × 高度） ===')
    mut('MUT_WXML', '<view class="scope" wx:if="{{g.scopeOpen}}">', '<view class="scope" wx:if="{{g.scope}}">',
        'tools/selftest_batch8b.js', True, 'B1 口径句退回常展开')
    mut('MUT_WXSS', 'min-height: 88rpx', 'min-height: 60rpx',
        'tools/selftest_batch8b.js', True, 'B2 × min-height 88→60rpx')
    mut('MUT_WXML', 'class="dine-line1"', 'class="dine-row"',
        'tools/selftest_batch8b.js', True, 'B3 渠道行退回一行三列')
    mut('MUT_WXSS', '.scope-head {', '.scope-head-x {',
        'tools/selftest_batch8c.js', True, 'B4 折叠样式被改名')
    print('DONE')
