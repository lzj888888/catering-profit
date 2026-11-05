# -*- coding: utf-8 -*-
# R446 / 队列 #46：删掉 R441 删「L3 专业参数」后留下的三处死引用。
# 为什么用字节级精确替换：本仓换行符混用（js 是 LF），Python 文本模式写回会整文件翻写。
import io, sys

REPO = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit'
EDITS = [
    # (相对路径, 原串, 新串, 该原串应命中次数)
    ('subpkg/tools/sandbox/index.js',
     b'      l2Toggle: M.l2Toggle,\n      l3Toggle: M.l3Toggle,\n',
     b'      l2Toggle: M.l2Toggle,\n', 1),
    ('subpkg/tools/sandbox/index.js',
     b'    showL2: false,\n    showL3: false,\n',
     b'    showL2: false,\n', 1),
    ('subpkg/tools/sandbox/index.js',
     b'//   \xe2\x9a\xa0\xef\xb8\x8f \xe4\xb8\x8e\xe4\xb8\x8a\xe9\x9d\xa2\xe4\xb8\x89\xe4\xb8\xaa\xe5\x8c\xba\xe6\xae\xb5\xe7\xba\xa7\xe6\x8a\x98\xe5\x8f\xa0\xef\xbc\x88showL2/showL3/showAssumptions',
     b'//   \xe2\x9a\xa0\xef\xb8\x8f \xe4\xb8\x8e\xe4\xb8\x8a\xe9\x9d\xa2\xe4\xb8\x89\xe4\xb8\xaa\xe5\x8c\xba\xe6\xae\xb5\xe7\xba\xa7\xe6\x8a\x98\xe5\x8f\xa0\xef\xbc\x88showL2/showPromo/showAssumptions', 1),
    ('subpkg/tools/sandbox/index.js',
     b'  onToggleL3() { this.setData({ showL3: !this.data.showL3 }); },\n',
     b'', 1),
    ('miniprogram/i18n/terms.js',
     b"    l3Toggle: '\xe4\xb8\x93\xe4\xb8\x9a\xe5\x8f\x82\xe6\x95\xb0\xef\xbc\x88\xe8\x80\x81\xe6\x89\x8b\xe6\x89\x8d\xe7\x94\xa8\xef\xbc\x89',\n",
     b'', 1),
    ('specs/dev-specs/i18n/terms.js',
     b"    l3Toggle: '\xe4\xb8\x93\xe4\xb8\x9a\xe5\x8f\x82\xe6\x95\xb0\xef\xbc\x88\xe8\x80\x81\xe6\x89\x8b\xe6\x89\x8d\xe7\x94\xa8\xef\xbc\x89',\n",
     b'', 1),
]

for rel, old, new, want in EDITS:
    p = REPO + '/' + rel
    with open(p, 'rb') as f:
        data = f.read()
    n = data.count(old)
    if n != want:
        print('ABORT %s: 命中 %d 次，期望 %d' % (rel, n, want))
        sys.exit(2)
    data = data.replace(old, new)
    with open(p, 'wb') as f:
        f.write(data)
    print('OK   %s  (%d 处)' % (rel, n))

# 落盘自证
for rel in ('subpkg/tools/sandbox/index.js', 'miniprogram/i18n/terms.js', 'specs/dev-specs/i18n/terms.js'):
    with open(REPO + '/' + rel, 'rb') as f:
        d = f.read()
    print('CHECK %-38s l3Toggle=%d showL3=%d onToggleL3=%d CRLF=%d' % (
        rel, d.count(b'l3Toggle'), d.count(b'showL3'), d.count(b'onToggleL3'), d.count(b'\r\n')))
