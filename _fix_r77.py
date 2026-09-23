# -*- coding: utf-8 -*-
"""round77 加固：selftest_ui_fix「月份集合」判据由绑字面写法改语义级（byte 写入，保持 LF）"""
import hashlib, os

P = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit\tools\selftest_ui_fix.js'
b = open(P, 'rb').read()
print('before md5', hashlib.md5(b).hexdigest(), 'CRLF', b.count(b'\r\n'), 'LF', b.count(b'\n'))

OLD = """check('\U0001f534 月份集合 = 滚动窗口 ∪ 已建档（不纯靠 getMonthList，去重靠 Set）',
  /getMonthList/.test(mj) && /const months = Array\\.from\\(new Set\\(/.test(mj));"""

NEW = """check('\U0001f534 月份集合 = 滚动窗口 ∪ 已建档 ∪ 当月（语义判据：并入已建档 + 调窗口函数 + 去重，均不认具体写法）', (() => {
  // 🔴 round77 加固：原判据绑死字面写法 `Array.from(new Set(` ⇒ 正确实现改用 `[...new Set(...)]`
  //    或 `.filter(indexOf)` 去重会被**误杀**（round55/59 同族病：绑字面 ⇒ 换个写法就错判）。
  //    改语义三条腿：① 并入已建档月份 ② 真的调用窗口函数（不绑函数名）③ 有去重动作（写法随意）。
  const m = mj.match(/(?:const|let|var)\\s+months\\s*=\\s*([\\s\\S]{0,240}?)\\.sort\\(\\)\\.reverse\\(\\)/);
  if (!m) return false;                                       // 拿不到赋值块 ⇒ fail-closed
  const blk = m[1];
  const dedupe = /new Set\\(|indexOf|\\.filter\\(|\\.reduce\\(/.test(blk);
  const win = !!winFn && new RegExp('ui\\\\.' + winFn + '\\\\(').test(blk);
  return /ml\\.list|getMonthList/.test(blk) && win && dedupe && /\\bcur\\b/.test(blk);
})());"""

ob = OLD.encode('utf-8')
nb = NEW.encode('utf-8')
if ob not in b:
    print('ANCHOR MISS')
    raise SystemExit(1)
b2 = b.replace(ob, nb, 1)
open(P, 'wb').write(b2)
print('after  md5', hashlib.md5(b2).hexdigest(), 'CRLF', b2.count(b'\r\n'), 'LF', b2.count(b'\n'))
print('APPLIED')
