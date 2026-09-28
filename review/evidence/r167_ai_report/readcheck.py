"""R167 可靠回读：反复读剪贴板，直到【本轮回答已生成完】（以结束标记判定）。
用法: readcheck.py <tag> <marker> [max_minutes] [interval_s]
判"完成" = 抽取出的回答里同时出现 结束标记（'全文' 或 '字以内' 不算）之一，且末尾 200 字里含 '字'/
           或回答长度连续两次不再增长且以句末标点结尾。
"""
import sys, os, time, ctypes, subprocess
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/_m3/dbai'
TAIL_MARKERS = ['对话摘要', '对话产物', '技能〉', '最近文件〉']

tag = sys.argv[1]
marker = sys.argv[2]
max_min = float(sys.argv[3]) if len(sys.argv) > 3 else 10.0
interval = float(sys.argv[4]) if len(sys.argv) > 4 else 25.0


def read_clip():
    click(900, 400); time.sleep(0.8)
    key(VK['A'], ctrl=True); time.sleep(0.7)
    key(VK['C'], ctrl=True); time.sleep(1.5)
    return get_clipboard() or ''


def answer_of(txt):
    i = txt.rfind(marker)
    body = txt[i:] if i >= 0 else txt
    cut = len(body)
    for m in TAIL_MARKERS:
        j = body.find(m)
        if j >= 0:
            cut = min(cut, j)
    return body[:cut].strip()


h = find_window(title='豆包')
for a in range(5):
    focus(h); time.sleep(1.0)
    if ctypes.windll.user32.GetForegroundWindow() == h:
        break

prev_ans, same = '', 0
t0 = time.time()
best = ''
while (time.time() - t0) < max_min * 60:
    clip = read_clip()
    ans = answer_of(clip)
    done = ('全文' in ans[-120:]) or ('（全文' in ans)
    grew = len(ans) - len(prev_ans)
    print('[%4.1f min] clip=%d ans=%d grew=%+d done=%s tail=%s'
          % ((time.time() - t0) / 60, len(clip), len(ans), grew, done, repr(ans[-40:])), flush=True)
    if ans:
        best = ans
        with open(os.path.join(OUT, '%s_answer_clip.txt' % tag), 'w', encoding='utf-8') as f:
            f.write(clip)
        with open(os.path.join(OUT, '%s_answer.txt' % tag), 'w', encoding='utf-8') as f:
            f.write(ans + '\n')
    if done and grew == 0:
        same += 1
        if same >= 1:
            break
    else:
        same = 0
    if grew == 0 and len(ans) > 200 and ans.endswith(('。', '）', '!', '?')):
        same += 1
        if same >= 2:
            break
    prev_ans = ans
    time.sleep(interval)

with open(os.path.join(OUT, '%s_answer.txt' % tag), 'w', encoding='utf-8') as f:
    f.write(best + '\n')
print('==== 落盘 %s_answer.txt（%d 字符）====' % (tag, len(best)))
