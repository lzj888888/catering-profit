# -*- coding: utf-8 -*-
"""round89 落地准备：① 新守卫转 CRLF（坑⑰）② core/13 插入口径声明行（保持 CRLF）"""
import io, os, sys

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'

# ---------- ① 新守卫转 CRLF（同族 tools/check_*.js 全为 CRLF）----------
guard = os.path.join(ROOT, 'tools', 'check_archive_grace.js')
d = open(guard, 'rb').read()
if d.count(b'\r\n') != d.count(b'\n'):
    d = d.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
    open(guard, 'wb').write(d)
    print('guard -> CRLF ok')
else:
    print('guard already CRLF')
d2 = open(guard, 'rb').read()
print('guard CRLF=%d LF=%d' % (d2.count(b'\r\n'), d2.count(b'\n')))

# ---------- ② core/13 插入声明行（字节级，保 CRLF）----------
decl = os.path.join(ROOT, 'specs', 'dev-specs', 'core', '13_上线前查缺补漏_决策与待办总览.md')
raw = open(decl, 'rb').read()
print('decl CRLF=%d LF=%d' % (raw.count(b'\r\n'), raw.count(b'\n')))
txt = raw.decode('utf-8')
NL = '\r\n'

MARK = '归档宽限口径（唯一声明处）'
if MARK in txt:
    print('DECL ALREADY EXISTS -> skip')
else:
    anchor = '- **补录（7 天宽限）**：'
    idx = txt.find(anchor)
    if idx < 0:
        print('ANCHOR NOT FOUND'); sys.exit(2)
    eol = txt.find(NL, idx)
    if eol < 0:
        print('EOL NOT FOUND'); sys.exit(3)
    line = ('- \U0001f522 ' + MARK + '：归档后 **7** 天内可补录（需二次确认，保存后重算）；'
            '超过 **7** 天硬锁，仅可查看/导出（有权限时），修改须走客服后台。'
            '单源 = `cloudfunctions/saveLedger/index.js` 的 `GRACE_DAYS_MS`，'
            '由 R118 穿透校验「服务端文案 + 前端 i18n 四条 + 本声明」三处与之同值。')
    new = txt[:eol] + NL + line + txt[eol:]
    open(decl, 'wb').write(new.encode('utf-8'))
    print('DECL INSERTED after line %d' % (txt[:idx].count(NL) + 1))

# ---------- 回读核行尾 ----------
for p in [guard, decl]:
    b = open(p, 'rb').read()
    print(os.path.basename(p), 'CRLF=%d LF=%d EQU=%s' % (b.count(b'\r\n'), b.count(b'\n'), b.count(b'\r\n') == b.count(b'\n')))
