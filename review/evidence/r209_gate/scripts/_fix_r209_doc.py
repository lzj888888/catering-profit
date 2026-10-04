# -*- coding: utf-8 -*-
# _fix_r209_doc.py —— 还原被误删的锚点原文，并正确追加 R209 演进链第 134 条
import io, os, subprocess, sys

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
REL = 'specs/dev-specs/★知识存储点_2026-09-10.md'

# ① 取 HEAD 原文，确认被我替换掉的那段到底长什么样（字节级，不信肉眼）
r = subprocess.run(['git', 'show', 'HEAD:' + REL], cwd=ROOT, capture_output=True)
orig = r.stdout.decode('utf-8')
key = 'M6→D-①D-③）'
i = orig.find(key)
print('① HEAD 原文里锚点 idx =', i)
if i < 0:
    raise SystemExit('HEAD 里也找不到锚点，停手')
print('   原文后 30 字符 =', repr(orig[i:i + 30]))

p = os.path.join(ROOT, REL)
cur = io.open(p, 'r', encoding='utf-8', newline='').read()

# ② 我上一支补丁把锚点那段连 \r 一起替换掉了，且多留了两个空格
bad = 'M5→C-⑧ /  → **134（R209'
print('② 当前文件里待修片段出现次数 =', cur.count(bad))
if cur.count(bad) != 1:
    raise SystemExit('待修片段不唯一，停手')

good = key + '**' + ' → **134（R209'
cur2 = cur.replace(bad, 'M5→C-⑧ / ' + good, 1)

with io.open(p, 'w', encoding='utf-8', newline='') as f:
    f.write(cur2)

# ③ 回读校验
chk = io.open(p, 'r', encoding='utf-8', newline='').read()
j = chk.find('M5→C-⑧ / ')
print('③ 修复后该处 =', repr(chk[j:j + 60]))
print('④ 四处同步 present:', bool('串 **134** 个套件' in chk), bool('（现 **134**' in chk),
      bool('check_month_picker`=18' in chk), bool('134（R209：新增' in chk))
print('⑤ size =', os.path.getsize(p))
