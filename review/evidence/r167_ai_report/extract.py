"""R167 抽取器：从剪贴板回读全文里切出【本轮回答】。
用法: extract.py <tag> <marker> [outfile]
逻辑: 取 marker 最后一次出现的位置 -> 到结尾；再砍掉尾部界面样板文字。
"""
import sys, os
OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/_m3/dbai'
TAIL_MARKERS = ['对话摘要', '对话产物', '技能〉', '最近文件〉']

tag = sys.argv[1]
marker = sys.argv[2]
src = os.path.join(OUT, '%s_answer_clip.txt' % tag)
txt = open(src, encoding='utf-8').read()
i = txt.rfind(marker)
body = txt[i:] if i >= 0 else txt
cut = len(body)
for m in TAIL_MARKERS:
    j = body.find(m)
    if j >= 0:
        cut = min(cut, j)
body = body[:cut].strip()
print('marker@%d / clip=%d / answer=%d 字符' % (i, len(txt), len(body)))
print('-' * 60)
print(body)
if len(sys.argv) > 3:
    with open(sys.argv[3], 'w', encoding='utf-8') as f:
        f.write(body + '\n')
    print('-' * 60)
    print('落盘 ->', sys.argv[3])
