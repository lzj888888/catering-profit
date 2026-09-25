# -*- coding: utf-8 -*-
"""索引核对 v2（修掉 v1 的假阴性）

v1 为什么假阴性：拿**全屏 1x OCR** 的文本做子串匹配 —— 实测深色小字丢字严重
（`idx_openid` 那行的名称格**整格没被识别**，只读到字段列的 "ogEnid升序"），
而 `idx_user_id` 通过纯属巧合（被切成 `idXuser`+`id` 拼对）。
⇒ v2 三条修法：
  1. **裁切名称列 + 3x 放大**再 OCR（实测能把 `_openid_1`/`idx_openid` 读出来）
  2. 容错比对：normalize 后允许 1~2 字符误差（OCR 常丢首字母，如 idx_openid→dx_openid），
     但**长度差 >2 直接否**，否则 idx_shop_user 会吞掉 idx_shop_user_del
  3. 认领式匹配：**长名优先**认领 token，避免前缀互相误配
判据仍可能假阴性 ⇒ 任何 MISS 都**留证图**（裁切放大后的 png），人工看图定夺：
  图片证据 > OCR 结论。

用法: python verify_indexes2.py [coll1,coll2,...]
"""
import sys, re, json, time, difflib, subprocess
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *

PY = r'C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe'
OCR = r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py'
TMP = r'C:/Users/lzj/AppData/Local/Temp'
DUMP = '%s/_idx_dump.json' % TMP
LINE_RE = re.compile(r"\[\s*([\d.]+),\s*([\d.]+)\]\s*'(.*)'")

H = find_window(title='云开发控制台')
focus(H)
SEARCH, FIRST, TAB = (470, 280), (400, 333), (1232, 228)
NAME_CROP = (560, 385, 830, 1015)


def shot(tag):
    png = '%s/vf2_%s.png' % (TMP, tag)
    r = subprocess.run([PY, OCR, 'shot', '--window', '云开发控制台', '--out', png],
                       capture_output=True, text=True, timeout=90)
    return png, [(float(m.group(1)), float(m.group(2)), m.group(3))
                 for m in LINE_RE.finditer(r.stdout or '')]


def ocr_png(png, crop, scale=3):
    r = subprocess.run([PY, OCR, 'list', png, '--crop'] + [str(v) for v in crop] + ['--scale', str(scale)],
                       capture_output=True, text=True, timeout=90)
    return [(float(m.group(1)), float(m.group(2)), m.group(3))
            for m in LINE_RE.finditer(r.stdout or '')]


def nz(s):
    return re.sub(r'[^0-9a-zA-Z]', '', s).lower()


def near(a, b):
    a, b = nz(a), nz(b)
    if not a or not b:
        return False
    if a == b:
        return True
    if abs(len(a) - len(b)) > 2:
        return False
    return difflib.SequenceMatcher(None, a, b).ratio() >= 0.86


def dialog_open(lines):
    return any('添加索引' in t and y < 250 for _, y, t in lines)


def paste(s):
    key(VK['A'], ctrl=True); time.sleep(0.12)
    key(VK['DELETE']); time.sleep(0.12)
    set_clipboard(s); time.sleep(0.28)
    key(VK['V'], ctrl=True); time.sleep(0.4)


def green_center(png, x0, x1, y0, y1, min_px=60):
    """⚠️ 必须抗噪：min/max 取中点会被 2 个游离绿像素（png x≈1390,y≈305）拉偏 83px。"""
    from PIL import Image
    from collections import Counter
    im = Image.open(png).convert('RGB')
    pts = [(x, y) for x in range(x0, x1) for y in range(y0, y1)
           if (lambda p: p[1] > 140 and p[0] < 130 and p[2] < 160)(im.getpixel((x, y)))]
    if len(pts) < min_px:
        return None
    cx = Counter(x for x, _ in pts)
    xm = max(cx, key=cx.get)
    sel = [(x, y) for x, y in pts if xm - 45 <= x <= xm + 45]
    return sum(p[0] for p in sel) // len(sel), sum(p[1] for p in sel) // len(sel)


def close_dialog():
    for _ in range(3):
        _, L = shot('cd')
        if not dialog_open(L):
            return
        gc = green_center('%s/vf2_cd.png' % TMP, 1000, 1400, 300, 900)
        if not gc:
            key(VK['ESCAPE']); time.sleep(0.8); continue
        click(gc[0] + 60 - 101, gc[1]); time.sleep(1.2)


def goto(coll):
    click(*SEARCH); time.sleep(0.45)
    key(VK['A'], ctrl=True); time.sleep(0.12)
    key(VK['DELETE']); time.sleep(0.12)
    paste(coll); time.sleep(1.3)
    click(*FIRST); time.sleep(1.7)
    click(*TAB); time.sleep(0.9)


def tokens(png):
    rows = ocr_png(png, NAME_CROP, 3)
    rows.sort(key=lambda r: (round(r[1] / 10), r[0]))
    out, cur = [], None
    for x, y, t in rows:
        if cur and abs(cur[1] - y) < 10:
            cur = (cur[0], cur[1], cur[2] + t)
        else:
            if cur:
                out.append(cur[2])
            cur = (x, y, t)
    if cur:
        out.append(cur[2])
    return [o for o in out if o.strip()]


D = json.load(open(DUMP, encoding='utf-8'))
expect = {e['coll']: [ix['name'] for ix in e['indexes']] for e in D['byCollection']}
colls = sys.argv[1].split(',') if len(sys.argv) > 1 else list(expect.keys())

n_ok = n_bad = 0
missing = {}
for c in colls:
    if c not in expect:
        print('SKIP %s' % c, flush=True); continue
    close_dialog()
    goto(c)
    close_dialog()
    png, _ = shot('list')
    toks = tokens(png)
    # 长名优先认领
    pool = list(toks)
    miss = []
    for name in sorted(expect[c], key=len, reverse=True):
        hit = None
        for tk in pool:
            if near(name, tk):
                hit = tk; break
        if hit is not None:
            pool.remove(hit)
        else:
            miss.append(name)
    print('%-5s %-24s 期望%2d 读到 %s%s' % ('OK' if not miss else 'MISS', c, len(expect[c]),
          toks, '' if not miss else '  缺:' + ','.join(miss)), flush=True)
    if miss:
        n_bad += 1
        missing[c] = miss
        # 二次机会：点刷新后重读（防列表沿用旧 DOM = 假阳性来源）
        rx = [x for x, y, t in shot('rf')[1] if '刷新' in t and y < 340]
        if rx:
            click(int(rx[0]), 305); time.sleep(1.6)
        png2, _ = shot('list2')
        toks2 = tokens(png2)
        pool2 = list(toks2)
        miss2 = []
        for n in miss:
            hit = None
            for tk in pool2:
                if near(n, tk):
                    hit = tk; break
            if hit is not None:
                pool2.remove(hit)
            else:
                miss2.append(n)
        # 留证：名称列裁切 3x 放大图（人工看图 > OCR）
        from PIL import Image
        im = Image.open(png2)
        box = im.crop((560, 385, 860, 1015)).resize(((860 - 560) * 3, (1015 - 385) * 3))
        box.save('%s/miss2_%s.png' % (TMP, c))
        print('     刷新后读到 %s ⇒ 仍缺 %s  (留证 miss2_%s.png)' % (toks2, miss2, c), flush=True)
    else:
        n_ok += 1

print('\n===== 核对结果：%d 个集合齐全 / %d 个有缺 =====' % (n_ok, n_bad))
if missing:
    print(json.dumps(missing, ensure_ascii=False, indent=1))
sys.exit(1 if n_bad else 0)
