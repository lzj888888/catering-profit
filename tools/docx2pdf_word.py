# -*- coding: utf-8 -*-
"""批量 docx → pdf（本机 Word / WPS COM）。

用法：
    python tools/docx2pdf_word.py <docx1> [docx2 ...]   # 指定文件
    python tools/docx2pdf_word.py --all                 # 仓库根所有 .docx

依赖：pywin32（`python -m pip install pywin32`）+ 本机装了 Word 或 WPS。

⚠️ 两个必踩的坑（2026-09-15 实测，勿删这段注释）：
  1) **不能复用同一个 Word 实例连续导出多份** —— 第二份起报 `Open.SaveAs` 失败、
     第三份报 `RPC 服务器不可用`（进程已崩）。⇒ 每份都 `DispatchEx` 新建实例，导出完 `Quit()`。
  2) **中文文件名直接给 `SaveAs` 不稳** —— 先复制到临时英文路径导出，再拷回目标名。

背景：`.pdf` 是被打印/递出去的那份派生件，曾出现过 `.md` 已改、`.pdf` 还停在旧结论的情况
（装过已被否定的「A7 成立 / 9 个 unique / __probe」）。`.md` 一改，`.txt`/`.docx`/`.pdf` 必须整链重生。
"""
import os
import shutil
import sys
import tempfile
import time

PROGIDS = ("Word.Application", "KWPS.Application", "KET.Application")


def export_one(progid, src_docx_abs, tmp_pdf_abs):
    import win32com.client as wc
    app = wc.DispatchEx(progid)          # 独立实例
    app.Visible = False
    try:
        app.DisplayAlerts = 0
    except Exception:
        pass
    try:
        doc = app.Documents.Open(src_docx_abs, ReadOnly=True)
        doc.SaveAs(tmp_pdf_abs, FileFormat=17)   # 17 = wdFormatPDF
        doc.Close(False)
        return True, ""
    except Exception as e:
        return False, str(e)[:160]
    finally:
        try:
            app.Quit()
        except Exception:
            pass


def convert(src, dst):
    tmpdir = tempfile.mkdtemp(prefix="d2p_")
    alias = os.path.splitext(os.path.basename(src))[0]
    # 用序号做英文名，彻底避开中文/全角文件名
    tmp_docx = os.path.join(tmpdir, "doc.docx")
    tmp_pdf = os.path.join(tmpdir, "doc.pdf")
    shutil.copyfile(src, tmp_docx)
    last_err = ""
    try:
        for pid in PROGIDS:
            try:
                ok, last_err = export_one(pid, tmp_docx, tmp_pdf)
            except Exception as e:
                ok, last_err = False, str(e)[:160]
            if ok:
                break
            time.sleep(1)
        if os.path.exists(tmp_pdf):
            os.makedirs(os.path.dirname(os.path.abspath(dst)) or ".", exist_ok=True)
            shutil.copyfile(tmp_pdf, dst)
            return True, os.path.getsize(dst)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
    return False, last_err


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return 2
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if args[0] == "--all":
        files = sorted(f for f in os.listdir(root) if f.lower().endswith(".docx"))
    else:
        files = args
    ok = bad = 0
    for name in files:
        src = name if os.path.isabs(name) else os.path.join(root, name)
        if not src.lower().endswith(".docx"):
            src += ".docx"
        dst = src[:-5] + ".pdf"
        if not os.path.exists(src):
            print("MISS  %s" % os.path.basename(src))
            bad += 1
            continue
        success, info = convert(src, dst)
        if success:
            print("OK    %-28s -> %s  %d bytes" % (os.path.basename(src), os.path.basename(dst), info))
            ok += 1
        else:
            print("FAIL  %-28s : %s" % (os.path.basename(src), info))
            bad += 1
        time.sleep(1)
    print("RESULT ok=%d fail=%d" % (ok, bad))
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
