#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""pack.py — 把本技能打包成 zip，方便拷到另一台电脑 / 发给别人。

用法：
    python pack.py                 # 输出到 ./win-desktop-control.zip（当前目录）
    python pack.py --out D:\\x.zip  # 指定输出
"""
import argparse
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SKIP_DIRS = {'__pycache__', '.git'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(os.getcwd(), 'win-desktop-control.zip'))
    a = ap.parse_args()
    n = 0
    with zipfile.ZipFile(a.out, 'w', zipfile.ZIP_DEFLATED) as z:
        for dirpath, dirnames, filenames in os.walk(ROOT):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for fn in filenames:
                if fn.endswith(('.pyc', '.zip')):
                    continue
                full = os.path.join(dirpath, fn)
                z.write(full, os.path.relpath(full, os.path.dirname(ROOT)))
                n += 1
    print('packed %d files -> %s (%.1f KB)' % (n, a.out, os.path.getsize(a.out) / 1024.0))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
