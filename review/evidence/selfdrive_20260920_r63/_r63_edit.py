# -*- coding: utf-8 -*-
import io, os, sys

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
POLICY = os.path.join(ROOT, 'specs', 'dev-specs', '上线材料_隐私政策_v1.md')
PACK = os.path.join(ROOT, 'specs', 'dev-specs', '上线材料_提审材料包_v1.md')
RESTART = os.path.join(ROOT, 'specs', 'dev-specs', '★知识存储点_2026-09-10.md')


def load(p):
    with open(p, 'rb') as f:
        data = f.read()
    nl = b'\r\n' if b'\r\n' in data else b'\n'
    if data.startswith(b'\xef\xbb\xbf'):
        data = data[3:]
    return data.decode('utf-8'), nl


def save(p, text, nl):
    with open(p, 'wb') as f:
        f.write(text.encode('utf-8'))


def find_line(lines, needle):
    for i, l in enumerate(lines):
        if needle in l:
            return i
    raise SystemExit('NOT_FOUND: %s' % needle)


report = []

# ---------- A) 隐私政策：立唯一声明处 ----------
t, nl = load(POLICY)
lines = t.split('\n')
i = find_line(lines, '1. **填占位符**：共 **6 处**')
marker = '🔢 占位符全集口径（唯一声明处）：本文件共 **6** 处待填占位符（口径＝剥反引号后的裸 `【…】`；round63 实扫核准）。'
if any('占位符全集口径' in l for l in lines):
    report.append('POLICY marker already present')
else:
    lines.insert(i + 1, marker)
    save(POLICY, '\n'.join(lines), nl)
    report.append('POLICY: inserted marker after line %d' % (i + 1))

# ---------- B) 提审材料包：两处引用 ----------
t, nl = load(PACK)
lines = t.split('\n')
n = 0
for needle, tail in [
    ('| 用户隐私保护指引 |', ' 占位符全集口径引用：**6 处**（单源见隐私政策 v1）。'),
    ('- [ ] 隐私政策 **6 处**占位符已填', '（占位符全集口径引用：**6 处**）'),
]:
    i = find_line(lines, needle)
    if '占位符全集口径' in lines[i]:
        continue
    # 表格行：插到行尾的 ' |' 之前；普通行：直接追加
    if lines[i].rstrip().endswith('|'):
        lines[i] = lines[i].rstrip()[:-1].rstrip() + tail + ' |'
    else:
        lines[i] = lines[i].rstrip() + tail
    n += 1
save(PACK, '\n'.join(lines), nl)
report.append('PACK: %d reference marker(s) added' % n)

# ---------- C) 重启键：7 处 → 6 处（修陈述，不改扫描规则） ----------
t, nl = load(RESTART)
lines = t.split('\n')
i = find_line(lines, '阻塞抽查更正')
old = lines[i]
lines[i] = old.replace('**7 处未填**', '**6 处未填**').replace('/`【】`）', '`）')
if '占位符全集口径' not in lines[i]:
    lines[i] = lines[i].rstrip() + '（占位符全集口径引用：**6 处**）'
j = find_line(lines, '此前各轮记作')
lines[j] = lines[j].replace('本轮更正为 7 处', '本轮更正为 6 处（🔴 round63 再更正：round50 的「7 处」把格式说明行的 `【】` 元描述误计，round51/round63 两次实扫均为 **6 处**；本行已按 round63 实扫值改正并加 R99 守卫）')
save(RESTART, '\n'.join(lines), nl)
report.append('RESTART: 7->6 on line %d' % (i + 1))

for r in report:
    print(r)
