# -*- coding: utf-8 -*-
# R680 一次性迁移脚本：把全站冷色底/冷灰文字换成「暖账本」暖调。
# 只改 .wxss。墨蓝族（#1e3a5f / #2a4e7c / #162c49）与语义色（红/绿/琥珀）一律不动。
import os, re, io, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 冷 → 暖 映射（键一律小写比较；值保留大写以便人工审阅）
MAP = {
    # ---- 页面/卡面底 ----
    '#f5f6f8': '#F6F3EC',   # page 冷灰底
    '#f2f4f7': '#F6F3EC',   # sb-page 底（与 page 同色，避免"差一档"）
    '#f3f7fb': '#FBF6EC',   # 提示/状态块冷蓝底
    '#f5f8fc': '#FBF6EC',
    '#e8eff7': '#F5EBD8',   # 浅蓝标签底 → 浅米粉
    '#eef2f7': '#F0E9DC',   # 浅蓝分割底
    '#eef1f5': '#F0E9DC',
    '#f4f5f7': '#F2EBDE',
    '#f5f5f5': '#F3ECDF',
    '#f2f5f9': '#F3ECDF',
    '#f0f0f0': '#EFE8DA',   # 中性浅灰底/分割
    # ---- 边框/描边 ----
    '#cfdae8': '#DCD2C0',   # 输入框冷蓝描边
    '#e3e9f2': '#EDE6D8',   # 卡片冷蓝描边
    '#c8d4e4': '#DCD0BB',   # 空态虚线框
    '#b9cbe0': '#E0D3BC',   # 版本历史次要柱/图例
    # ---- 副文字（偏蓝的冷灰）----
    '#6b7a90': '#7C7264',
    '#4a5b70': '#6B6157',
    '#5a6678': '#6B6157',
    '#646a73': '#6B6157',
    '#7a8794': '#857A6B',
    '#8a97a8': '#9A9083',
    '#8a94a6': '#9A9184',
    '#9aa4b2': '#A99E8E',
    '#8792a3': '#A99E8E',
    '#888': '#857A6B',
    '#999': '#A99E8E',
    '#aaa': '#B5AB9C',
    '#666': '#6B6157',
    '#555': '#5F564C',
}

HEXLIT = re.compile(r'#[0-9a-fA-F]{3}(?![0-9a-fA-F])|#[0-9a-fA-F]{6}(?![0-9a-fA-F])')
# 卡面白：只改 background 位置，不碰 color:#fff（深底上的白字）
BG_WHITE = re.compile(r'(background(?:-color)?\s*:\s*)#fff(?![0-9a-fA-F])', re.I)

def targets():
    out = [os.path.join(ROOT, 'app.wxss')]
    for base in ('pages', 'subpkg'):
        for dp, dn, fn in os.walk(os.path.join(ROOT, base)):
            dn[:] = [d for d in dn if d not in ('node_modules', 'miniprogram_npm')]
            for f in fn:
                if f.endswith('.wxss'):
                    out.append(os.path.join(dp, f))
    return out

total_hex = 0
total_bg = 0
changed_files = 0
detail = []

for p in targets():
    with io.open(p, 'r', encoding='utf-8') as fh:
        src = fh.read()
    orig = src
    cnt = {}
    nb = 0

    def sub_hex(m):
        global total_hex
        tok = m.group(0)
        rep = MAP.get(tok.lower())
        if rep is None:
            return tok
        total_hex += 1
        cnt[tok.lower()] = cnt.get(tok.lower(), 0) + 1
        return rep.upper() if len(rep) == 7 else rep

    # 跳过注释行：块注释内部不改（注释里的旧色值是历史说明，改了反而失真）
    parts = re.split(r'(/\*[\s\S]*?\*/)', src)
    for i, seg in enumerate(parts):
        if seg.startswith('/*'):
            continue
        parts[i] = HEXLIT.sub(sub_hex, seg)
        nbc = [0]
        def sub_bg(m):
            nbc[0] += 1
            return m.group(1) + '#FFFDF8'
        parts[i] = BG_WHITE.sub(sub_bg, parts[i])
        nb += nbc[0]
    src = ''.join(parts)

    if src != orig:
        with io.open(p, 'w', encoding='utf-8', newline='') as fh:
            fh.write(src)
        changed_files += 1
        rel = os.path.relpath(p, ROOT).replace('\\', '/')
        detail.append('%s  hex=%d bg=%d' % (rel, sum(cnt.values()), nb))

print('files changed: %d' % changed_files)
print('hex replaced : %d' % total_hex)
print('bg-white     : %d' % total_bg)
for d in detail:
    print('  ' + d)
