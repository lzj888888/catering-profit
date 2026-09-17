# -*- coding: utf-8 -*-
"""云开发控制台 · 批量建索引（v4 · 坐标全部实测/派生版）

## 实测事实（坐标=屏幕坐标；窗口 rect=(60,0,1860,1034)，png 坐标 + (60,0) = 屏幕）
  弹窗横向固定（居中定宽）⇒ **x 用固定值**；y 随「行数」与「是否显示校验红字」变 ⇒ **y 必须现读**。
    · 索引名称输入框   x=920
    · 「唯一」标签     x=795      （点标签即选中；确定性判据见下）
    · 字段名输入框     x=890
    · 方向下拉控件     x=1102
    · ⊕ 加行           x=1243     ⚠️ 只在**第 1 行**；最后一行是 ⊖（删行）！
    · 取消             x=1146
    · 确定             x=1247
  行高 65px。弹窗顶部（标题/名称/属性/字段标签）**不随行数移动**，只有底部按钮下移。
  仅在出现校验红字（如「请输入索引名称」）时，名称行以下整体 +39px —— 所以全部 y 现读。

## 三个曾把我坑住的判据（务必保持）
  1. 弹窗是否打开 = OCR 里「添加索引」且 **y<250**（列表页的「+添加索引」在 y≈304 ⇒ 只判存在恒真）
  2. ⊕ 恒在第 1 行；点最后一行右侧只会**删行**
  3. 单选「唯一」是否生效 = 该行**绿色像素簇中心**相对「索引属性」标签中心的左右（唯一的点在左）
     —— 不要写死绝对 x（实测 684/791 会随状态漂），用「label_x + 130」做分界
  4. 降序 = 点方向控件（x=1102, y=本行 y）后在 **y+58** 处选「降序」（+116 是「地理位置」）

用法: python do_indexes3.py <tasks.json> [--only-coll xxx] [--limit N]
"""
import sys, re, os, json, time, difflib, subprocess
from collections import Counter
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *
from PIL import Image

PY = r'C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe'
OCR = r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py'
TMP = r'C:/Users/lzj/AppData/Local/Temp'
LINE_RE = re.compile(r"\[\s*([\d.]+),\s*([\d.]+)\]\s*'(.*)'")
OX = 60

SEARCH, FIRST, TAB, ADD = (470, 280), (400, 333), (1232, 228), (723, 305)
X_NAME, X_UNIQ_LBL, X_FIELD, X_DIR, X_PLUS, X_CANCEL, X_OK = 920, 795, 890, 1102, 1243, 1146, 1247
ROW_H = 65

H = find_window(title='云开发控制台')
focus(H)


def shot(tag=None):
    args = [PY, OCR, 'shot', '--window', '云开发控制台']
    if tag:
        args += ['--out', '%s/idx3_%s.png' % (TMP, tag)]
    r = subprocess.run(args, capture_output=True, text=True, timeout=90)
    return [(float(m.group(1)), float(m.group(2)), m.group(3))
            for m in LINE_RE.finditer(r.stdout or '')]


def ocr_png(png, crop, scale=3):
    args = [PY, OCR, 'list', png, '--crop'] + [str(v) for v in crop] + ['--scale', str(scale)]
    r = subprocess.run(args, capture_output=True, text=True, timeout=90)
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
    if abs(len(a) - len(b)) > 2:      # 关键：容不下长度差 >2，否则 idx_shop_user 会吞掉 idx_shop_user_del
        return False
    return difflib.SequenceMatcher(None, a, b).ratio() >= 0.86


def paste(s):
    """粘贴前先 Ctrl+A + Delete 清空 —— 残留弹窗里可能已有旧值，不清会把名字拼起来造出错名字。"""
    key(VK['A'], ctrl=True); time.sleep(0.15)
    key(VK['DELETE']); time.sleep(0.15)
    set_clipboard(s); time.sleep(0.28)
    key(VK['V'], ctrl=True); time.sleep(0.45)


def y_of(kw, lines, idx=0, maxy=None):
    ys = sorted(y for _, y, t in lines if kw in t and (maxy is None or y <= maxy))
    return ys[idx] if len(ys) > idx else None


def x_of(kw, lines, idx=0, maxy=None):
    xs = sorted(x for x, y, t in lines if kw in t and (maxy is None or y <= maxy))
    return xs[idx] if len(xs) > idx else None


def dialog_open(lines=None):
    lines = lines or shot()
    return any('添加索引' in t and y < 250 for _, y, t in lines)


def green_center(png, x0, x1, y0, y1, min_px=60):
    """绿色簇中心（png 坐标）。
    🔴 不能用 min/max 取中点：实测扫描框里混进了 **2 个游离绿像素**（png x≈1390, y≈305，
       右上角那个小绿元素），把「确定」按钮的中点从 1186 拉到 **1269** ⇒ 据此算出的
       「取消」在 1228（弹窗外），连点 4 次全落空、弹窗关不掉（当时误判成"窗口不接受输入"）。
    改用「x 众数 ±45 窗口」收敛：真按钮 328 像素、游离点只有 2 像素 ⇒ 众数必然落在真按钮上。
    """
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
    """把弹窗关掉（点取消）。返回 True 表示确认已关。"""
    for _ in range(4):
        if not dialog_open():
            return True
        shot('cd')
        gc = green_center('%s/idx3_cd.png' % TMP, 1000, 1400, 300, 900)
        if not gc:
            key(VK['ESCAPE']); time.sleep(0.8); continue
        click(gc[0] + OX - 101, gc[1]); time.sleep(1.2)   # 取消 = 确定左侧 101px
    return not dialog_open()


def goto(coll):
    click(*SEARCH); time.sleep(0.45)
    key(VK['A'], ctrl=True); time.sleep(0.12)
    key(VK['DELETE']); time.sleep(0.12)
    paste(coll); time.sleep(1.3)
    click(*FIRST); time.sleep(1.7)
    click(*TAB); time.sleep(0.9)
    lines = shot()
    rx = x_of('刷新', lines, maxy=340)
    if rx:
        click(int(rx), int(y_of('刷新', lines, maxy=340))); time.sleep(1.5)
        lines = shot()
    return lines


def list_names(tag):
    """读当前集合的索引名称列（png 560..830 × 385..1015，3x）。返回名字碎片列表。"""
    png = '%s/idx3_%s.png' % (TMP, tag)
    shot(tag)
    rows = ocr_png(png, (560, 385, 830, 1015), 3)
    rows.sort(key=lambda r: (round(r[1] / 10), r[0]))
    merged, cur = [], None
    for x, y, t in rows:
        if cur and abs(cur[1] - y) < 10:
            cur = (cur[0], cur[1], cur[2] + t)
        else:
            if cur:
                merged.append(cur[2])
            cur = (x, y, t)
    if cur:
        merged.append(cur[2])
    return [m for m in merged if m.strip()]


def dialog_geometry(lines):
    """从当次 OCR 派生弹窗几何。返回 (字段标签y, 名称输入y, 属性行y) 或 None。"""
    y_lab = y_of('索引字段', lines, maxy=560)
    y_name = y_of('索引名称', lines, maxy=560)
    y_attr = y_of('索引属性', lines, maxy=560)
    if y_lab is None or y_name is None:
        return None
    return y_lab, y_name, y_attr


def dialog_rows(lines):
    """弹窗内字段行的 y 列表。
    🔴 关键：列表页背后也有「升序」文字（索引字段列 x≈1149~1182），而弹窗内的方向控件
       固定在 x≈1093 ⇒ 用 **x < 1130** 一刀把两者分开，否则会读到背后列表的行、把 y 弄错。
    """
    return sorted(int(y) for x, y, t in lines if ('升序' in t or '降序' in t) and x < 1130)


def add_index(name, fields, unique, tag):
    if not close_dialog():
        return 'FAIL:开工前关不掉残留弹窗'
    click(*ADD); time.sleep(1.3)
    lines = shot(tag + '_open')
    if not dialog_open(lines):
        return 'FAIL:弹窗未打开'
    g = dialog_geometry(lines)
    if not g:
        return 'FAIL:读不到弹窗几何'
    y_lab, y_name, y_attr = g
    rows = dialog_rows(lines)
    if not rows:
        return 'FAIL:读不到字段行'

    click(X_NAME, int(y_name)); paste(name)

    if unique and y_attr is not None:
        click(X_UNIQ_LBL, int(y_attr)); time.sleep(0.45)
        shot(tag + '_u')
        gc = green_center('%s/idx3_%s_u.png' % (TMP, tag), 600, 950,
                          int(y_attr) - 22, int(y_attr) + 22)
        if not gc:
            return 'FAIL:唯一/非唯一绿点未找到'
        # 实测（各 328 像素）：唯一选中 ⇒ 绿点 png x≈698；非唯一选中 ⇒ ≈791。中点 744.5 做分界。
        # ⚠️ 曾经写成 `gc[0]+OX >= lab_x-60`（把 png 坐标和屏幕坐标混着比）⇒ 明明选上了却判红。
        if gc[0] > 745:
            return 'FAIL:唯一未选中(绿点 png x=%d，应为≈698 而非≈791)' % gc[0]

    for i, (fname, fdir) in enumerate(fields):
        if i > 0:
            click(X_PLUS, rows[0]); time.sleep(1.0)      # ⚠️ ⊕ 恒在第 1 行（最后一行是 ⊖ 删行）
            lines = shot(tag + '_p%d' % i)
            if not dialog_open(lines):
                return 'FAIL:加行后弹窗消失'
            rows2 = dialog_rows(lines)
            if len(rows2) != len(rows) + 1:
                return 'FAIL:加行无效(%d→%d 行)' % (len(rows), len(rows2))
            rows = rows2
        click(X_FIELD, rows[i]); paste(fname)
        if str(fdir) == '-1':
            # 实测：点方向控件文字区 (X_DIR, 本行 y) 即可展开；下拉面板里
            #   升序 = 本行 y + 65、降序 = +112、地理位置 = +160（行距 48）
            # ⚠️ 判据必须用**裁切 3x**：全屏 OCR 读不到面板里的「地理位置」（曾因此假失败）
            click(X_DIR, rows[i]); time.sleep(1.0)
            shot(tag + '_dd%d' % i)
            dd = ocr_png('%s/idx3_%s_dd%d.png' % (TMP, tag, i),
                         (980, rows[i] + 20, 1170, rows[i] + 200), 3)
            if not any(('降序' in t or '地理' in t) for _, _, t in dd):
                return 'FAIL:方向下拉没打开(dd=%s)' % ([t for _, _, t in dd],)
            click(X_DIR, rows[i] + 112); time.sleep(0.9)   # 「降序」
            lines = shot(tag + '_d%d' % i)
            if not any('降序' in t and abs(y - rows[i]) < 26 for _, y, t in lines):
                return 'FAIL:降序未生效'

    shot(tag + '_filled')
    bk = green_center('%s/idx3_%s_filled.png' % (TMP, tag), 1000, 1400, 300, 900)
    if not bk:
        return 'FAIL:找不到确定按钮'
    click(bk[0] + OX, bk[1]); time.sleep(2.2)          # 确定 = 唯一绿色按钮（实测定位）
    lines = shot(tag + '_after')
    if dialog_open(lines):
        err = [t for _, y, t in lines if y < 700 and ('请输入' in t or '不能为空' in t
                                                     or '已存在' in t or '重复' in t or '非法' in t)]
        return 'FAIL:提交后弹窗未关 %s' % ('/'.join(err) or '(无错误文字 ⇒ 确定点空了)')
    return 'OK'


TASKS = json.load(open(sys.argv[1], encoding='utf-8'))
only = None
if '--only-coll' in sys.argv:
    only = sys.argv[sys.argv.index('--only-coll') + 1]
limit = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else 10 ** 9

t0 = time.time()
stat = {'ok': 0, 'exists': 0, 'fail': 0}
report, consec = [], 0
for t in TASKS:
    coll = t['coll']
    if only and coll != only:
        continue
    print('== coll %s' % coll, flush=True)
    close_dialog()          # 弹窗是模态：不先关掉，goto 里点集合列表根本不生效
    goto(coll)
    close_dialog()          # 🔴 读列表前也要关：模态遮罩会把列表压暗，OCR 读不出来
    names = list_names('nm_%s' % coll)
    print('   现有可见: %s' % (names,), flush=True)
    for it in t['items']:
        if stat['ok'] >= limit:
            break
        name, fields, uniq = it[0], it[1], bool(it[2])
        if any(near(name, tk) for tk in names):
            print('   EXISTS   %s' % name, flush=True)
            stat['exists'] += 1; report.append([coll, name, 'EXISTS']); consec = 0
            continue
        k = stat['ok'] + stat['fail'] + 1
        r = add_index(name, fields, uniq, 'a%d' % k)
        print('   %-6s %s' % (r.split(':')[0], '%s  %s' % (name, r)), flush=True)
        report.append([coll, name, r])
        if r == 'OK':
            stat['ok'] += 1; consec = 0
            names = list_names('nm2_%s' % coll)
            print('       建后可见: %s' % (names,), flush=True)
        else:
            stat['fail'] += 1; consec += 1
            print('       !! 留证 idx3_a%d_*.png' % k, flush=True)
            if consec >= 2:
                print('   !! 连续 2 次失败 ⇒ 中止', flush=True); break
    if consec >= 2 or stat['ok'] >= limit:
        break

print('\nDONE ok=%d exists=%d fail=%d in %.0fs' % (stat['ok'], stat['exists'], stat['fail'], time.time() - t0))
json.dump(report, open('%s/idx3_report.json' % TMP, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
sys.exit(1 if stat['fail'] else 0)
