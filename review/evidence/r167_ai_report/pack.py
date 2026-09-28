"""R167 证据打包：把 5 轮提问 + 5 轮回答整理进 review/evidence/r167_ai_report/
用法: pack.py
"""
import os, re, shutil

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/_m3/dbai'
SRC = r'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_r167'
DST = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r167_ai_report'
os.makedirs(DST, exist_ok=True)
TAIL = ['对话摘要', '对话产物', '技能〉', '最近文件〉']

for n in range(1, 6):
    tag = 'p%d' % n
    # 提问原文
    shutil.copyfile(os.path.join(SRC, '%s.txt' % tag), os.path.join(DST, '%s.txt' % tag))
    # 回答
    clip_path = os.path.join(OUT, '%s_answer_clip.txt' % tag)
    txt = open(clip_path, encoding='utf-8').read() if os.path.exists(clip_path) else ''
    m = None
    for pat in [r'第\s*%d\s*轮' % n]:
        ms = list(re.finditer(pat, txt))
        if ms:
            m = ms[-1]
    body = txt[m.start():] if m else txt
    cut = len(body)
    for t in TAIL:
        j = body.find(t)
        if j >= 0:
            cut = min(cut, j)
    body = body[:cut].strip()
    # 去掉提问回显：本轮回答 = 最后一个「展开全部」之后（R165 经验判据）
    k = body.rfind('展开全部')
    if k >= 0:
        body = body[k + len('展开全部'):].strip()
    with open(os.path.join(DST, 'r%d_answer.txt' % n), 'w', encoding='utf-8') as f:
        f.write(body + '\n')
    print('r%d: %d 字符 -> %s' % (n, len(body), os.path.join(DST, 'r%d_answer.txt' % n)))

print('\n落盘目录:', DST)
for fn in sorted(os.listdir(DST)):
    print('  ', fn, os.path.getsize(os.path.join(DST, fn)), 'B')
