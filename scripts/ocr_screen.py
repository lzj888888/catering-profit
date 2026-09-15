# -*- coding: utf-8 -*-
"""OCR 读屏 / 读图 —— 把屏幕或图片上的**文字**抽成文本，并可按关键词定位坐标。

## 为什么需要它
Agent 的模型可能**读不了图片**（无图像输入）。这时 `win_gui.py shot` 截出来的 png
只能靠本脚本转成文字来看 —— 这是**界面取证**与**按钮定位**的唯一手段（比颜色定位稳）。

引擎：Windows 自带的 WinRT `Windows.Media.Ocr`（离线、无需联网、无需装 tesseract）。
依赖：`winocr` + `winrt-*` —— 技能已自带在 `vendor/ocrlibs/`，**换电脑解压即用**。

## 用法
    ocr_screen.py list  <png> [--crop L,T,R,B] [--scale N]
        列出所有行 + 坐标（png 坐标；若 png 是全屏截图则该坐标即屏幕坐标）

    ocr_screen.py read  <png> [--crop L,T,R,B] [--scale N] [--out txt]
        输出纯文本（每行一条）

    ocr_screen.py find  <png> <kw> [kw...] [--crop L,T,R,B] [--scale N]
        按关键词定位，输出该词的**中心坐标**（已换算回原 png 坐标）
        · 多字词会被 OCR 切成单字 → 本脚本会先做「同行相邻字合并」再匹配
        · 坐标换算：传了 --crop/--scale 也能正确还原

    ocr_screen.py shot  [--window <标题片段>] [--screen] [--out png] [--crop ...] [--scale N]
        先截图（复用 win_gui）再直接 OCR。--window 默认找包含 'Devtools' 的窗口。

    ocr_screen.py watch <kw> [kw...] [--frames 12] [--interval 0.5] [--window <片段>]
        连拍 + 逐帧 OCR，报告关键词**第几帧出现**（抓一闪而过的 Toast/提示框）。
        本机实战：DevTools 的「未能保存 … 文件的内容较新」就是这样抓到的。

## 坐标约定（重要）
    png 坐标 --(加窗口原点 L,T)--> 屏幕坐标
    `win_gui.py rect(hwnd)` 给出 (L,T,R,B)；`screenshot_window` 出的 png 与窗口 1:1
    （无缩放时）。全屏截图（`screenshot_screen`）的坐标**就是**屏幕坐标。
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VENDOR = os.path.join(ROOT, "vendor", "ocrlibs")
if os.path.isdir(VENDOR):
    sys.path.insert(0, VENDOR)
sys.path.insert(0, HERE)

LANGS = ("zh-Hans-CN", "zh-Hans", "zh-CN", "en-US")
_lang_cache = [None]


def _ocr(pil_img):
    """对 PIL 图像做 OCR，返回 winocr 结果 dict（自动挑语言）。"""
    try:
        import winocr
    except ImportError:
        sys.exit(
            "缺少 OCR 依赖。两种办法：\n"
            "  1) 用技能自带的：确认 %s 存在（换电脑解压即用）\n"
            "  2) 自行安装：  <python> -m pip install winocr\n" % VENDOR
        )
    from PIL import Image  # noqa: F401

    if _lang_cache[0]:
        return winocr.recognize_pil_sync(pil_img, _lang_cache[0])
    last = None
    for lg in LANGS:
        try:
            res = winocr.recognize_pil_sync(pil_img, lg)
            _lang_cache[0] = lg
            return res
        except Exception as e:  # 语言包不可用 → 试下一个
            last = e
    sys.exit("OCR 失败（所有语言都不行）：%s" % last)


def _lines(res, cl=0.0, ct=0.0, s=1.0):
    """归一化为 [{text, cx, cy, words:[(char,cx,cy,w)]}]，坐标已换算回原 png。"""
    out = []
    for ln in res.get("lines", []):
        words = []
        for w in ln.get("words", []):
            b = w.get("bounding_rect") or {}
            if not b:
                continue
            cx = cl + (b["x"] + b["width"] / 2.0) / s
            cy = ct + (b["y"] + b["height"] / 2.0) / s
            words.append((w.get("text", ""), cx, cy, b["width"] / s))
        if not words:
            continue
        text = "".join(t for t, _, _, _ in words)
        xs = [cx for _, cx, _, _ in words]
        ys = [cy for _, _, cy, _ in words]
        out.append({
            "text": text,
            "cx": sum(xs) / len(xs),
            "cy": sum(ys) / len(ys),
            "words": words,
        })
    return out


def _find_in_line(words, kw):
    """在同一行的字样序列里找 kw（按相邻字间距<2.5倍字宽拼接），
    返回匹配片段的中心坐标；找不到返回 None。

    实战原因：WinRT OCR 常把中文词切成**单字**（'预' '览'），
    直接按 word.text 匹配多字词会全 MISS。
    """
    n = len(words)
    for i in range(n):
        acc, span = "", []
        for j in range(i, n):
            t, cx, cy, wd = words[j]
            if span:
                prev = span[-1]
                gap = abs(cx - prev[1]) - (wd + prev[3]) / 2.0
                if gap > 2.5 * max(wd, prev[3]):
                    break  # 间距过大 → 属于另一个词组
            acc += t
            span.append((t, cx, cy, wd))
            if kw == acc:
                xs = [c for _, c, _, _ in span]
                ys = [c for _, _, c, _ in span]
                return sum(xs) / len(xs), sum(ys) / len(ys), acc
            if not kw.startswith(acc) and acc not in kw:
                break  # 已经不可能拼出 kw
    return None


def _load(path, crop, scale):
    from PIL import Image
    im = Image.open(path)
    if crop:
        im = im.crop(crop)
    if scale and scale != 1:
        im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
    return im


def cmd_list(a):
    im = _load(a.png, a.crop, a.scale)
    cl = a.crop[0] if a.crop else 0.0
    ct = a.crop[1] if a.crop else 0.0
    for ln in _lines(_ocr(im), cl, ct, a.scale):
        print("[%7.1f,%6.1f] %r" % (ln["cx"], ln["cy"], ln["text"][:110]))


def cmd_read(a):
    im = _load(a.png, a.crop, a.scale)
    txt = "\n".join(ln["text"] for ln in _lines(_ocr(im)))
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(txt)
        print("已写入", a.out)
    else:
        print(txt)


def cmd_find(a):
    im = _load(a.png, a.crop, a.scale)
    cl = a.crop[0] if a.crop else 0.0
    ct = a.crop[1] if a.crop else 0.0
    lines = _lines(_ocr(im), cl, ct, a.scale)
    for kw in a.kw:
        hit = None
        for ln in lines:
            hit = _find_in_line(ln["words"], kw)
            if hit:
                hit = (hit[0], hit[1], ln["text"])
                break
        if hit:
            print("HIT   %-16s center=(%7.1f, %6.1f)  line=%r" % (kw, hit[0], hit[1], hit[2][:70]))
        else:
            print("MISS  %-16s" % kw)


def _shot(a):
    """截图：--window（默认 Devtools）或 --screen。"""
    import win_gui
    out = a.out or os.path.join(os.environ.get("TEMP", "/tmp"), "ocr_shot.png")
    if a.screen:
        win_gui.screenshot_screen(out)
        return out, 0, 0
    title = a.window or "Devtools"
    h = win_gui.find_window(title=title)
    if not h:
        h = win_gui.find_window(title=title, contains=True)
    if not h:
        sys.exit("找不到窗口（title 片段 = %r）" % title)
    L, T, _, _ = win_gui.rect(h)
    win_gui.screenshot_window(h, out, focus_first=False)
    return out, L, T


def cmd_shot(a):
    png, L, T = _shot(a)
    print("# 截图 =", png, " 窗口原点 =", (L, T))
    im = _load(png, a.crop, a.scale)
    cl = (a.crop[0] if a.crop else 0) + L
    ct = (a.crop[1] if a.crop else 0) + T
    for ln in _lines(_ocr(im), cl, ct, a.scale):
        print("[%7.1f,%6.1f] %r" % (ln["cx"], ln["cy"], ln["text"][:110]))


def cmd_watch(a):
    import time
    import win_gui
    title = a.window or "Devtools"
    h = win_gui.find_window(title=title) or win_gui.find_window(title=title, contains=True)
    if not h:
        sys.exit("找不到窗口（title 片段 = %r）" % title)
    L, T, _, _ = win_gui.rect(h)
    tmp = os.environ.get("TEMP", "/tmp")
    for i in range(a.frames):
        p = os.path.join(tmp, "ocr_watch_%02d.png" % i)
        if a.screen:
            win_gui.screenshot_screen(p)
        else:
            win_gui.screenshot_window(h, p, focus_first=False)
        im = _load(p, a.crop, a.scale)
        cl = (a.crop[0] if a.crop else 0) + (0 if a.screen else L)
        ct = (a.crop[1] if a.crop else 0) + (0 if a.screen else T)
        lines = _lines(_ocr(im), cl, ct, a.scale)
        for kw in a.kw:
            for ln in lines:
                hit = _find_in_line(ln["words"], kw)
                if hit:
                    print("帧%02d HIT %s @ (%.1f, %.1f)  行=%r" % (i, kw, hit[0], hit[1], ln["text"][:90]))
                    break
        time.sleep(a.interval)
    print("# 已连拍 %d 帧（存于 %s/ocr_watch_*.png）" % (a.frames, tmp))


def main():
    ap = argparse.ArgumentParser(description="OCR 读屏/读图（Windows.Media.Ocr，离线）")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def add_common(p, with_png=True):
        if with_png:
            p.add_argument("png")
        p.add_argument("--crop", nargs=4, type=int, metavar=("L", "T", "R", "B"))
        p.add_argument("--scale", type=float, default=1.0)

    p = sub.add_parser("list"); add_common(p); p.set_defaults(fn=cmd_list)
    p = sub.add_parser("read"); add_common(p); p.add_argument("--out"); p.set_defaults(fn=cmd_read)
    p = sub.add_parser("find"); add_common(p); p.add_argument("kw", nargs="+"); p.set_defaults(fn=cmd_find)
    p = sub.add_parser("shot"); add_common(p, False)
    p.add_argument("--window"); p.add_argument("--screen", action="store_true")
    p.add_argument("--out"); p.set_defaults(fn=cmd_shot)
    p = sub.add_parser("watch"); add_common(p, False); p.add_argument("kw", nargs="+")
    p.add_argument("--window"); p.add_argument("--screen", action="store_true")
    p.add_argument("--frames", type=int, default=12); p.add_argument("--interval", type=float, default=0.5)
    p.set_defaults(fn=cmd_watch)

    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
