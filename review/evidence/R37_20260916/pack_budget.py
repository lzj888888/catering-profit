# -*- coding: utf-8 -*-
"""按 project.config.json 的 packOptions.ignore 计算「预期打包体积」。
不依赖开发者工具：纯文件系统模拟 ignore 规则。

⚠️ 实现范围限制（round 12 复审方指出，2026-09-16 标注）：
    只实现了官方六型里的 **folder / file / suffix / prefix 四型**，
    **未实现 regexp / glob** —— 当前 project.config.json 没用到那两型，故结果有效；
    但**若将来新增 regexp/glob 规则，本脚本会漏判（把该忽略的算成要打包）**，
    届时要么补实现，要么在调用前人工核对。切勿在未确认配置类型前直接采信输出。

    另：本脚本算的是「按 ignore 规则模拟的候选集」，**不等于真机代码包**
    （真机还会做依赖分析，实测 9 KB；本脚本偏保守，含 LICENSE/project.config.json 等非代码文件）。"""
import json
import os
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
os.chdir(ROOT)
cfg = json.load(open('project.config.json', encoding='utf-8'))
rules = cfg.get('packOptions', {}).get('ignore', [])


def norm(p):
    return p.replace(os.sep, '/')


def ignored(rel):
    rel = norm(rel)
    parts = rel.split('/')
    name = parts[-1]
    for r in rules:
        t, v = r.get('type'), r.get('value', '')
        if t == 'folder' and any(p == v for p in parts[:-1]):
            return True
        if t == 'file' and rel == v:
            return True
        if t == 'suffix' and name.lower().endswith(v.lower()):
            return True
        if t == 'prefix' and name.lower().startswith(v.lower()):
            return True
    return False


keep, drop = [], []
for dp, dns, fns in os.walk('.'):
    if '.git' in dp.split(os.sep):
        continue
    for fn in fns:
        full = os.path.join(dp, fn)
        rel = os.path.relpath(full, '.')
        (drop if ignored(rel) else keep).append((rel, os.path.getsize(full)))

sk = sum(s for _, s in keep)
sd = sum(s for _, s in drop)
print('ignore 规则数 = %d' % len(rules))
print('=== 会被打包 keep: %d 文件 / %.1f KB ===' % (len(keep), sk / 1024))
for r, s in sorted(keep, key=lambda x: -x[1])[:15]:
    print('  %9.1f KB  %s' % (s / 1024, norm(r)))
print('=== 被 ignore 排除 drop: %d 文件 / %.1f KB ===' % (len(drop), sd / 1024))
tot = sk + sd
print('修前（ignore 为空）预期包体 = %8.1f KB = %.2f MB  -> 超 2MB? %s' % (tot / 1024, tot / 1048576, tot > 2 * 1048576))
print('修后（当前 ignore）预期包体 = %8.1f KB = %.2f MB  -> 超 2MB? %s' % (sk / 1024, sk / 1048576, sk > 2 * 1048576))
