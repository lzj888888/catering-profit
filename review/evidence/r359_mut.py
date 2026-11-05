# -*- coding: utf-8 -*-
"""R359 B15 判据变异验证：
M1 把 catch 退回旧写法（只清 loading + calcError）      ⇒ 必须红，且点名 B15
M2 只从清空清单里漏掉 payback（其余不动）              ⇒ 必须红，且消息里点名 payback
M3 只改动引号/顺序（语义不变）                          ⇒ 必须仍绿（防误伤）
"""
import io
import os
import signal
import subprocess
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
JS = os.path.join(REPO, 'pages', 'sandbox', 'index.js')

with io.open(JS, 'rb') as f:
    ORIG = f.read()


def restore():
    with io.open(JS, 'wb') as f:
        f.write(ORIG)


def on_sig(signum, frame):
    restore()
    sys.exit(130)


for s in (signal.SIGTERM, signal.SIGINT):
    try:
        signal.signal(s, on_sig)
    except Exception:
        pass


def run():
    r = subprocess.run(['node', os.path.join(REPO, 'tools', 'check_m2_matrix.js')],
                       cwd=REPO, capture_output=True)
    return r.returncode, (r.stdout + r.stderr).decode('utf-8', 'replace')


def summary(out):
    for ln in out.strip().splitlines():
        if '结果：' in ln:
            return ln.strip()
    return out.strip().splitlines()[-1] if out.strip() else '(no output)'


OLD_CATCH = """    } catch (e) {
      if (seq !== this._seq) return;
      this.setData({ loading: false });
      if (e.code === 'M2_RED_ALERT') { this.setData({ result: { red_alert: true }, calcError: '' }); }
      else { this.setData({ calcError: e.msg || '' }); api.toastError(e); }
    }"""

NEW_TAIL = """      this.setData({ loading: false, result: { red_alert: true }, calcError: '' });
        return;
      }"""

NEW_TAIL_OLD = """      if (e.code === 'M2_RED_ALERT') {
        this.setData({ loading: false, result: { red_alert: true }, calcError: '' });
        return;
      }"""

results = []
try:
    rc0, out0 = run()
    print('[基线]', summary(out0), '| rc=', rc0)
    assert rc0 == 0, out0

    # M1：整块退回旧写法
    with io.open(JS, encoding='utf-8') as f:
        src = f.read()
    start = src.index('    } catch (e) {\n      if (seq !== this._seq) return;')
    end = src.index('    }\n  },\n\n  // 🔴 R296-E', start) + len('    }')
    new = src[:start] + OLD_CATCH + src[end:]
    assert new != src, 'M1 变异未生效'
    with io.open(JS, 'w', encoding='utf-8', newline='') as f:
        f.write(new)
    rc, out = run()
    ok = rc != 0 and 'B15' in out
    results.append(('M1 退回旧 catch', ok))
    print('[%s] M1 →' % ('抓到了' if ok else '漏过'), summary(out))

    restore()

    # M2：只漏 payback 一个键
    with io.open(JS, encoding='utf-8') as f:
        src = f.read()
    assert src.count('        payback: null,\n') == 1
    with io.open(JS, 'w', encoding='utf-8', newline='') as f:
        f.write(src.replace('        payback: null,\n', '', 1))
    rc, out = run()
    ok = rc != 0 and 'payback' in out
    results.append(('M2 漏 clean payback', ok))
    print('[%s] M2 →' % ('抓到了' if ok else '漏过'), summary(out))
    print('        命中：', 'payback' in out)

    restore()

    # M3：语义不变的重排（把 red_alert 分支顺序调换）—— 应仍绿
    with io.open(JS, encoding='utf-8') as f:
        src = f.read()
    assert NEW_TAIL_OLD in src
    swapped_inner = NEW_TAIL_OLD.replace(
        "      if (e.code === 'M2_RED_ALERT') {\n        this.setData({ loading: false, result: { red_alert: true }, calcError: '' });\n        return;\n      }",
        "      if (e.code === 'M2_RED_ALERT') {\n        this.setData({\n          calcError: '',\n          loading: false,\n          result: { red_alert: true },\n        });\n        return;\n      }")
    assert swapped_inner != NEW_TAIL_OLD
    # ⚠️ 必须回写**整份源码**（首版误把片段当整文件写回，差点毁掉 index.js）
    mutated = src.replace(NEW_TAIL_OLD, swapped_inner, 1)
    assert mutated != src
    with io.open(JS, 'w', encoding='utf-8', newline='') as f:
        f.write(mutated)
    rc, out = run()
    ok = rc == 0
    results.append(('M3 语义不变重排', ok))
    print('[%s] M3 →' % ('通过' if ok else '误伤'), summary(out))
    # M4：只删「失败分支里的 refreshStick()」⇒ 吸底条留着上一次的保本数
    with io.open(JS, encoding='utf-8') as f:
        src = f.read()
    assert '      this.refreshStick();\n      api.toastError(e);' in src
    mutated = src.replace('      this.refreshStick();\n      api.toastError(e);', '      api.toastError(e);', 1)
    assert mutated != src
    with io.open(JS, 'w', encoding='utf-8', newline='') as f:
        f.write(mutated)
    rc, out = run()
    ok = rc != 0 and '吸底条' in out
    results.append(('M4 不重算吸底条', ok))
    print('[%s] M4 →' % ('抓到了' if ok else '漏过'), summary(out))
finally:
    restore()

rc1, out1 = run()
print('[还原后]', summary(out1), '| rc=', rc1)

bad = [r for r in results if not r[1]]
print('\n=== 结论：%d/%d 条变异符合预期 ===' % (len(results) - len(bad), len(results)))
if bad:
    sys.exit(1)
