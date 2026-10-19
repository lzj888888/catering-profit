import io
import os
import signal
import subprocess
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MJS = os.path.join(REPO, 'pages', 'sandbox', 'matrix.js')
WXML = os.path.join(REPO, 'pages', 'sandbox', 'matrix.wxml')

ORIG = {}
for p in (MJS, WXML):
    with io.open(p, 'rb') as f:
        ORIG[p] = f.read()


def restore_all():
    for p, b in ORIG.items():
        with io.open(p, 'wb') as f:
            f.write(b)


def on_sig(signum, frame):
    restore_all()
    sys.exit(130)


for s in (signal.SIGTERM, signal.SIGINT):
    try:
        signal.signal(s, on_sig)
    except Exception:
        pass


def write(p, data):
    with io.open(p, 'wb') as f:
        f.write(data.encode('utf-8'))


def run():
    r = subprocess.run(['node', os.path.join(REPO, 'tools', 'check_m2_matrix.js')],
                       cwd=REPO, capture_output=True)
    out = r.stdout.decode('utf-8', 'replace') + r.stderr.decode('utf-8', 'replace')
    return r.returncode, out


def summary(out):
    for ln in out.strip().splitlines():
        if '结果：' in ln:
            return ln.strip()
    return out.strip().splitlines()[-1] if out.strip() else '(no output)'


TRY_BLOCK = """        try {
          const d = await api.call('calcSandbox', { action: 'matrix', clean_array: part });
          const got = d.rows || [];
          for (let k = 0; k < got.length; k++) allRows.push(got[k]);
          (d.rejected || []).forEach((x) => {
            rejected.push({ index: (Number(x.index) || 0) + off, code: x.code, msg: x.msg });
          });
        } catch (e) {
          failedAt = off;
          failedMsg = (e && e.msg) || '';
          break;
        }
"""

NO_TRY = """        const d = await api.call('calcSandbox', { action: 'matrix', clean_array: part });
        const got = d.rows || [];
        for (let k = 0; k < got.length; k++) allRows.push(got[k]);
        (d.rejected || []).forEach((x) => {
          rejected.push({ index: (Number(x.index) || 0) + off, code: x.code, msg: x.msg });
        });
"""

ROWS_VIEW = '<view class="partial-note" wx:if="{{result.partialText}}">{{result.partialText}}</view>'

MUTATIONS = [
    ('M1 去掉内层 try（退回外层 catch）', MJS, lambda s: s.replace(TRY_BLOCK, NO_TRY, 1),
     ['分批没有内层 try']),
    ('M2 只算不 emit（从 result 字面量删掉 partialText）', MJS,
     lambda s: s.replace('rejected, partialText },', 'rejected },', 1),
     ['没送进 result']),
    ('M3 页面不渲染（删掉 partial-note 行）', WXML, lambda s: s.replace(ROWS_VIEW + '\n', '', 1),
     ['没渲染 partialText']),
    ('M4 只改名 failedAt→failOff（判据不得钉字面量，应仍为绿）', MJS,
     lambda s: s.replace('failedAt', 'failOff'), []),
]

results = []
try:
    rc0, out0 = run()
    print('[基线]', summary(out0), '| rc=', rc0)
    assert rc0 == 0, out0

    for name, path, mut, expect in MUTATIONS:
        with io.open(path, encoding='utf-8') as f:
            src = f.read()
        new = mut(src)
        assert new != src, ('变异未生效：' + name)
        write(path, new)
        try:
            rc, out = run()
        finally:
            restore_all()
        hit = [e for e in expect if e in out]
        if expect:
            okk = rc != 0 and len(hit) == len(expect)
        else:
            okk = rc == 0
        results.append((name, okk, summary(out), hit))
        print('[%s]' % ('抓到了' if okk else '漏过/误判'), name, '→', summary(out))
        if expect:
            print('        命中：', hit)

    rc1, out1 = run()
    print('[还原后]', summary(out1), '| rc=', rc1)
finally:
    restore_all()

bad = [r for r in results if not r[1]]
print('\n=== 结论：%d/%d 条变异符合预期 ===' % (len(results) - len(bad), len(results)))
if bad:
    for b in bad:
        print('  ✗', b[0], b[2])
    sys.exit(1)
