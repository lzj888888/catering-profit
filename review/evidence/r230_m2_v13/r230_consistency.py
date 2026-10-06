#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""r230：比对 规范 §3.4-bis 与 投喂包 §3.4 的 BIZ_PRESETS 数值是否逐项一致。"""
import re, sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

R = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
SPEC = os.path.join(R, 'specs/dev-specs/core/开发规范v1.3_ModuleM2增量_业态参数包与回本卡.md')
FEED = os.path.join(R, 'specs/dev-specs/delivery/批次M2v1.3_业态参数包与回本卡_提示词_可直接复制.txt')


def extract_presets(path):
    txt = open(path, encoding='utf-8').read()
    # 抓**所有**含 BIZ_PRESETS 的 ```js 块，取**最长**的（= §3.4 完整块；§3.1/§3.2 是示意块）
    cands = [m.group(1) for m in re.finditer(r'```js\n(.*?)```', txt, re.S) if 'BIZ_PRESETS' in m.group(1)]
    return max(cands, key=len) if cands else None


def norm(block):
    """去注释、去空行、压空白 ⇒ 只留"代码实质"。"""
    out = []
    for line in block.splitlines():
        s = line.strip()
        if s.startswith('//'):
            continue
        s = re.sub(r'//.*$', '', s)        # 行尾注释
        s = re.sub(r'\s+', ' ', s).strip()
        if s:
            out.append(s)
    return out


a = extract_presets(SPEC)
b = extract_presets(FEED)
print('规范 §3.4-bis 抓到块 =', bool(a), ' 长度', len(a or ''))
print('投喂包 §3.4 抓到块 =', bool(b), ' 长度', len(b or ''))

na, nb = norm(a or ''), norm(b or '')
print('规范化行数：规范 %d / 投喂包 %d' % (len(na), len(nb)))

same = (na == nb)
print()
print('🟢 逐行一致' if same else '🔴 不一致')
if not same:
    import difflib
    for l in difflib.unified_diff(na, nb, '规范', '投喂包', lineterm='', n=1):
        print('  ', l)

# 关键数值抽取比对（兜底：即便排版不同也要数值一致）
def nums(block):
    return re.findall(r"(?:presetKey|bizKey|paybackView|pct|defaultYuan|baseYuan|perSqmYuan|fen|years|v)\s*:\s*'?([A-Za-z0-9_.\-]+)'?", block or '')
ka, kb = nums(a or ''), nums(b or '')
print()
print('关键赋值数：规范 %d 项 / 投喂包 %d 项 ⇒ %s' % (len(ka), len(kb), '一致' if ka == kb else '🔴 不一致'))
if ka != kb:
    import difflib
    for l in difflib.unified_diff(ka, kb, '规范', '投喂包', lineterm='', n=0):
        print('  ', l)
