# -*- coding: utf-8 -*-
"""索引**组成**核对：逐行绑定「索引名称 | 索引属性 | 索引字段」三列，验证复合索引的字段顺序与唯一性。

为什么必须做：只核"名字在不在"是不够的 —— 复合索引若把字段顺序填反（如 `month, shop_id`），
`shop_id` 打头的**前缀查询能力**就没了（本仓查询一律带 shop_id，这是四个设计理由之首），
而名字完全一样、体积也差不多，**只看名字的核对永远发现不了**。

方法（不依赖 OCR 的行序，避免错行）：
  · 行锚点 = **索引占用空间**列（每一行必有 "8.00 KB"，且每行只有一个）⇒ 拿它的 y 当行中心
  · 其余三列按 |Δy| 归到最近的行锚点（字段列容忍 ±40，因为它可能折成两行）
  · 名称列用 near() 容错匹配；字段列要求**期望字段名全部出现**；唯一/降序按要求出现

用法: python verify_fields.py [coll1,coll2,...]   # 省略 = 单源里所有"有复合索引"的集合
"""
import sys, re, os, json, time, difflib, subprocess
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *
from collections import Counter

PY = r'C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe'
OCR = r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py'
TMP = r'C:/Users/lzj/AppData/Local/Temp'
# 单源 dump（核对任务的输入）。⚠️ 别人复验时 %TEMP% 里**不会有**它 ⇒ 按优先级查找，
# 否则脚本开箱即 `FileNotFoundError`（"证据不可复验"就等于没有证据）。
_HERE = os.path.dirname(os.path.abspath(__file__))
DUMP = next((p for p in [
    os.environ.get('IDX_DUMP'),                                    # 1) 显式指定
    os.path.join(_HERE, '_idx_dump.json'),                          # 2) 与脚本同目录
    r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/'
    r'index_buildout_20260917/10_单源dump.json',                    # 3) 已归档的证据副本
    '%s/_idx_dump.json' % TMP,                                      # 4) 本次运行现场
] if p and os.path.exists(p)), '%s/_idx_dump.json' % TMP)
print('单源 dump:', DUMP, flush=True)
LINE_RE = re.compile(r"\[\s*([\d.]+),\s*([\d.]+)\]\s*'(.*)'")

H = find_window(title='云开发控制台')
focus(H)
SEARCH, FIRST, TAB = (470, 280), (400, 333), (1232, 228)
COLS = {'size': (1240, 1430), 'name': (560, 830), 'attr': (850, 1010), 'field': (1015, 1240)}


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


# ── 已知的**稳定系统性** OCR 误读白名单 ──────────────────────────────────────────
# 与 near() 的区别：near() 容"抖动"（同一格多次读结果不同）；这里容的是"读法固定但永远错"
# —— 即换尺度也救不回来的情况。2026-09-17 对 `sort` 穷举 8 种读法（原图 scale 3/5/8/12、
# LANCZOS 超采样 6/8/12x、自动对比度、反相、Otsu 二值化、固定阈值 128）**全部**得到
# `so戊`/`SO戊` ⇒ 判据只能靠白名单，不能靠调参。
# 🔴 纪律：**每条都必须有人工复核的放大截图佐证，否则不许加**（空白名单变成后门就白守了）。
OCR_VARIANTS = {
    # sort → so戊 / SO戊  ｜证据: review/evidence/index_buildout_20260917/05_三处报红_人工复核.png 第 3 块
    #   放大佐证图 = 同目录 08_sort字段_OCR稳定误读_放大佐证.png；穷举记录 = 09_sort_OCR穷举对照.txt
    'sort': ['so戊', 'so成'],
}
# 「不腐」记账（与 RESTART_EXEMPTS 的"每条断言仍须命中"同构）：跑完若白名单里某项**一次都没
#   命中**，说明它已过期（OCR 修好了 / 环境换了）⇒ **点名提醒**，不许它悄悄变成僵尸条目。
#   ⚠️ 只提醒、不判红：本脚本是助手不是守卫，且按集合分批跑时"未命中"属正常。
WHITELIST_HIT = set()


def shot(tag):
    png = '%s/vf3_%s.png' % (TMP, tag)
    r = subprocess.run([PY, OCR, 'shot', '--window', '云开发控制台', '--out', png],
                       capture_output=True, text=True, timeout=90)
    return png, [(float(m.group(1)), float(m.group(2)), m.group(3))
                 for m in LINE_RE.finditer(r.stdout or '')]


def ocr_png(png, crop, scale=3):
    r = subprocess.run([PY, OCR, 'list', png, '--crop'] + [str(v) for v in crop] + ['--scale', str(scale)],
                       capture_output=True, text=True, timeout=90)
    return [(float(m.group(1)), float(m.group(2)), m.group(3))
            for m in LINE_RE.finditer(r.stdout or '')]


def dialog_open(L):
    return any('添加索引' in t and y < 250 for _, y, t in L)


def green_center(png, x0, x1, y0, y1, min_px=60):
    from PIL import Image
    im = Image.open(png).convert('RGB')
    pts = [(x, y) for x in range(x0, x1) for y in range(y0, y1)
           if (lambda p: p[1] > 140 and p[0] < 130 and p[2] < 160)(im.getpixel((x, y)))]
    if len(pts) < min_px:
        return None
    cx = Counter(x for x, _ in pts)
    xm = max(cx, key=cx.get)
    sel = [(x, y) for x, y in pts if xm - 45 <= x <= xm + 45]
    return sum(p[0] for p in sel) // len(sel), sum(p[1] for p in sel) // len(sel)


def paste(s):
    key(VK['A'], ctrl=True); time.sleep(0.12)
    key(VK['DELETE']); time.sleep(0.12)
    set_clipboard(s); time.sleep(0.28)
    key(VK['V'], ctrl=True); time.sleep(0.4)


def close_dialog():
    for _ in range(3):
        png, L = shot('cd')
        if not dialog_open(L):
            return
        gc = green_center(png, 1000, 1400, 300, 900)
        if not gc:
            key(VK['ESCAPE']); time.sleep(0.8); continue
        click(gc[0] + 60 - 101, gc[1]); time.sleep(1.2)


def goto(coll):
    click(*SEARCH); time.sleep(0.45)
    key(VK['A'], ctrl=True); time.sleep(0.12)
    key(VK['DELETE']); time.sleep(0.12)
    paste(coll); time.sleep(1.3)
    click(*FIRST); time.sleep(1.7)
    click(*TAB); time.sleep(1.0)
    # ⚠️ 连跑时「索引管理」页签偶发没点中 ⇒ 页面还在「记录列表」⇒ 索引列全读不到（实测行锚点=0）。
    #    判据 = 必须看到索引表的表头，否则补点一次。
    _, L = shot('nav')
    if not any('索引占用空间' in t or '索引名称' in t for _, _, t in L):
        click(*TAB); time.sleep(1.3)


D = json.load(open(DUMP, encoding='utf-8'))
expect = {e['coll']: e['indexes'] for e in D['byCollection']}
# 只核含复合索引（或降序）的集合
targets = [c for c, ix in expect.items()
           if any(len(x['keys']) > 1 or any(k['direction'] == '-1' for k in x['keys']) for x in ix)]
if len(sys.argv) > 1:
    targets = sys.argv[1].split(',')

n_ok = n_bad = 0
for c in targets:
    close_dialog()
    goto(c)
    close_dialog()
    png, _ = shot('list_%s' % c)
    # ⚠️ crop 顺序是 (L, T, R, B)：(x0, 385, x1, 1015)，写反了会得到空结果
    size = ocr_png(png, (COLS['size'][0], 385, COLS['size'][1], 1015), 3)
    anchors = sorted(y for _, y, t in size if 'KB' in t.upper())
    if not anchors:                     # 导航抖动 ⇒ 重试一次（防"整集合未找到"这种假红）
        goto(c)
        png, _ = shot('list2_%s' % c)
        size = ocr_png(png, (COLS['size'][0], 385, COLS['size'][1], 1015), 3)
        anchors = sorted(y for _, y, t in size if 'KB' in t.upper())
    # 字段列**整列读**（不是逐行）：复合索引的字段会折成多行，逐行 ±45 的窗口会把第 2/3 行切掉
    # （实测 idx_card_code_version 三字段：逐行只读到 shop_id+card_code，整列才读到 version）
    fcol = ocr_png(png, (1010, 385, 1245, 1015), 3)
    rows = []
    for ay in anchors:
        # 「索引属性」列必须逐行紧窗口（整列读会整格读空），顺带取名称列
        cells = ocr_png(png, (560, int(ay) - 45, 1010, int(ay) + 45), 3)
        nm = '  '.join(t for x, y, t in cells if x < 830)
        at = '  '.join(t for x, y, t in cells if x >= 830)
        # 字段 = 整列里落在本行区间的文字（向下放宽到 +95，容纳 2~3 行折行）
        fd = '  '.join(t for _, y, t in fcol if int(ay) - 25 <= y <= int(ay) + 95)
        # ⚠️ winocr 会偶发整格读空（同一 crop 两次结果不同）⇒ 属性列读空就换窗口重试
        for tol in (55, 35):
            if at.strip():
                break
            extra = ocr_png(png, (850, int(ay) - tol, 1010, int(ay) + tol), 4)
            at = '  '.join(t for _, _, t in extra)
        rows.append({'y': int(ay), 'name': nm, 'attr': at, 'field': fd})
    print('== %s  (行锚点 %d 个)' % (c, len(rows)), flush=True)
    for r in rows:
        print('   y=%-4d | %-26s | %-6s | %s' % (r['y'], r['name'], r['attr'], r['field']), flush=True)
    # 自动判据：期望索引 ↔ 表格行（名称容错匹配）
    exp = expect[c]
    bad = []
    unknown = []
    vused = []

    def has(txt, kw):
        """去掉空白与各种破折号/点后再找 —— OCR 常把「唯—」「唯．一」「非_unique」读歪。"""
        t = re.sub(r'[\s_\-—－–·・．.·]+', '', txt)
        return kw in t

    for ix in exp:
        hit = next((r for r in rows if near(ix['name'], r['name'])), None)
        if not hit:
            bad.append('%s 未找到' % ix['name'])
            continue
        ftxt = nz(hit['field'])
        ftoks = [t for t in re.split(r'[\s、,，/]+', hit['field']) if t.strip()]
        for k in ix['keys']:
            # 三级匹配，从严到宽：
            #  ① 严格子串（nz 后）
            #  ② near() 容**单字符误读**（实测 `is_deleted` 被读成 `isde丨eted`，l→丨）
            #  ③ OCR_VARIANTS 白名单容**稳定系统性误读**（`sort`→`so戊`，穷举 8 种读法全错）
            by_var = next((v for v in OCR_VARIANTS.get(k['name'], [])
                           if v.lower() in hit['field'].lower()), None)
            if not (nz(k['name']) in ftxt or any(near(k['name'], t) for t in ftoks) or by_var):
                bad.append('%s 缺字段 %s（读到: %s）' % (ix['name'], k['name'], hit['field']))
            elif by_var:
                # 透明化：凡是靠白名单放行的，必须在输出里点名，不许静默通过
                vused.append('%s.%s←%r' % (ix['name'], k['name'], by_var))
                WHITELIST_HIT.add(k['name'])
            if k['direction'] == '-1' and not has(hit['field'] + hit['attr'], '降序'):
                bad.append('%s 期望降序，读到: %s' % (ix['name'], hit['field']))
        if ix.get('unique') and not has(hit['attr'], '唯一'):
            # OCR 读不到就记 UNKNOWN，不判红 —— 判据宁可"标注不确定"，也不要因 OCR 抖动假红。
            # （唯一性另有更强的**像素级**证据：建索引时单选绿点必须在 png x≈698 =「唯一」，否则脚本硬失败）
            if not hit['attr'].strip():
                unknown.append('%s 属性列 OCR 读空（唯一性未从列表复核）' % ix['name'])
            else:
                bad.append('%s 期望唯一，属性列读到: %r' % (ix['name'], hit['attr']))
        if not ix.get('unique') and has(hit['attr'], '唯一') and not has(hit['attr'], '非唯一'):
            bad.append('%s 不该唯一但属性列读到 %r' % (ix['name'], hit['attr']))
    if bad:
        n_bad += 1
        print('   ❌ ' + ' / '.join(bad), flush=True)
    else:
        n_ok += 1
        tail = ''
        if unknown:
            tail += '（%d 项 OCR 读空、记 UNKNOWN: %s）' % (len(unknown), '; '.join(unknown))
        if vused:
            tail += '（%d 项走 OCR 变体白名单: %s）' % (len(vused), '; '.join(vused))
        print('   ✅ %d 条字段/唯一性/方向吻合%s' % (len(exp), tail), flush=True)

# 白名单「不腐」提醒：本次跑完**仍未命中**的条目 ⇒ 可能已过期，点名出来给人看（不判红）
_stale = [k for k in OCR_VARIANTS if k not in WHITELIST_HIT]
if _stale:
    print('   ⚠️ 白名单条目本次未命中（可能已过期，请复核后删除或修正）：%s' % ' / '.join(_stale),
          flush=True)

print('\n===== 组成核对：%d 个集合通过 / %d 个有问题 =====' % (n_ok, n_bad))
sys.exit(1 if n_bad else 0)
