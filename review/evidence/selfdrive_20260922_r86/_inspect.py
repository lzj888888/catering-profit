import io, re
files = ['app.wxss', 'pages/month/input.wxss', 'tools/check_theme_color.js',
         'utils/takeaway.js', 'pages/month/input.js']
for f in files:
    d = open(f, 'rb').read()
    print('%s  CRLF=%d LF=%d' % (f, d.count(b'\r\n'), d.count(b'\n')))

print('--- app.wxss 深色模式声明行 ---')
t = open('app.wxss', encoding='utf-8').read().split('\n')
for i, l in enumerate(t, 1):
    if '深色模式' in l or 'prefers-color-scheme' in l:
        print(i, repr(l[:120]))

print('--- takeaway.js stripNonMoney 体 ---')
t = open('utils/takeaway.js', encoding='utf-8').read().split('\n')
for i, l in enumerate(t, 1):
    if 113 <= i <= 122:
        print(i, repr(l))

print('--- input.js cur===target 上下文 ---')
t = open('pages/month/input.js', encoding='utf-8').read().split('\n')
for i, l in enumerate(t, 1):
    if 'cur === target' in l or 'twCarryLock' in l:
        print(i, repr(l.strip()[:130]))
