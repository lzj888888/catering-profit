# -*- coding: utf-8 -*-
"""
R253 变异回灌（mutation backfill）
================================
目的：证明 R253 新增的守卫**不是假绿** —— 把源码改回「错误写法」，看目标断言是否**点名转红**。

铁律遵循（技能 mutation-backfill）：
- 纯内存**字节**备份（坑 2-b：不落 .mutbak 磁盘临时文件，避 safe-delete-bulk-guard）
- 每条变异**独立**（每条前 reset_to_base）
- 锚点只按 \n 书写，**运行时按目标文件自身 eol 展开**（本仓混合行尾：billParse/service 是 CRLF，
  index/getDishReview 是 LF）
- 锚点命中数**必须恰为 1**，否则 fail-closed（铁律 6）
- 判据**点名到目标断言关键字**（坑 6/坑 11：取断言编号 D1/7-⑤ 等守卫自己打印的串）
- 组 A（该红）+ 组 B（不该红）
- 还原后 git status -uno 必须为空（已先 commit ⇒ 免费的强还原证明）
- 变异体自检三问（坑 14）：语义上真的把判据变假了吗？

用法：
  python mut_r253.py --dry     # 只做锚点预检（命中次数 + 行尾），不写文件
  python mut_r253.py           # 正式跑
"""
import os
import re
import subprocess
import sys

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
NODE = r'C:\Users\lzj\.workbuddy\binaries\node\versions\22.22.2-6\node.exe'

# 被变异的文件（key -> 相对路径）
TARGETS = {
    'front':   'utils/billParse.js',
    'cloudsvc': 'cloudfunctions/importSalesBill/service.js',
    'cloudidx': 'cloudfunctions/importSalesBill/index.js',
    'dishsvc': 'cloudfunctions/getDishReview/service.js',
}

# 跑哪个套件（每条变异只跑相关套件，快；跑完再看门禁）
SUITES = {
    'bill':  'tools/selftest_bill_parse.js',
    'dish':  'tools/check_dishreview_engine.js',
}


def abspath(rel):
    return os.path.join(ROOT, rel.replace('/', os.sep))


def read(rel):
    with open(abspath(rel), 'r', encoding='utf-8', newline='') as f:
        return f.read()


def write(rel, s):
    data = s.encode('utf-8')          # 坑 2-c：先 encode 再 open('wb')
    with open(abspath(rel), 'wb') as f:
        f.write(data)


BASE = {}                             # 纯内存字节备份


def backup():
    for k, rel in TARGETS.items():
        BASE[k] = open(abspath(rel), 'rb').read()


def reset_to_base():
    for k, rel in TARGETS.items():
        with open(abspath(rel), 'wb') as f:
            f.write(BASE[k])


def run_suite(rel):
    r = subprocess.run([NODE, os.path.join(ROOT, rel.replace('/', os.sep))],
                       capture_output=True, text=True, encoding='utf-8',
                       errors='replace', cwd=ROOT)
    out = (r.stdout or '') + (r.stderr or '')
    failed = [l.strip() for l in out.splitlines() if '❌' in l]
    crashed = (r.returncode != 0) and not re.search(r'\d+\s*通过\s*/\s*\d+\s*失败', out)
    return failed, crashed, out


def expand(key, text):
    """锚点只按 \\n 书写，运行时按目标文件自身 eol 展开；并 re.escape（锚点里全是代码）。"""
    src = read(TARGETS[key])
    eol = '\r\n' if '\r\n' in src else '\n'
    t = text.replace('\n', eol) if eol != '\n' else text
    return src, re.escape(t)


def count_hits(key, text):
    src, pat = expand(key, text)
    return len(re.findall(pat, src)), ('CRLF' if '\r\n' in src else 'LF')


def sub1(key, pattern, repl):
    """单次替换 + 强制锚点唯一（铁律 6）。"""
    rel = TARGETS[key]
    src = read(rel)
    eol = '\r\n' if '\r\n' in src else '\n'
    rep = repl.replace('\n', eol) if eol != '\n' else repl
    n, _ = count_hits(key, pattern)
    if n != 1:
        raise RuntimeError('锚点命中 %d 次（须恰为 1）: %s' % (n, pattern[:80]))
    _, pat = expand(key, pattern)
    write(rel, re.sub(pat, lambda m: rep, src, count=1))


# ─────────────────────────── 变异清单 ───────────────────────────
# (名字, 文件key, 套件key, 组(A=该红/B=不该红), 目标断言关键字, 原锚点, 变异文本)
MUTATIONS = [
    # ── 组 A：D1 哨兵本身 ──────────────────────────────
    ('A1 退回「命中第一个即返回」(旧 bug)',
     'front', 'bill', 'A', 'D1',
     '  if (hits.length === 1) return hits[0];                 // 唯一命中 ⇒ 现状不变\n'
     '  return PLATFORM_AMBIGUOUS;                             // 🔴 ≥2 命中 ⇒ 拒绝代选',
     '  return hits.length ? hits[0] : null;'),

    # ── 组 A：D4 truthy 陷阱（行级）────────────────────
    # 🔴 首轮回灌 A2/A3 漏网（❌=0）：哨兵是字符串 ⇒ `if (p)` 透传结果与显式拦**逐字节相同**
    #    ⇒ 行为判据无辨识力。已补源码级断言 D4b/D5b（本变异必须点名到 D4b）。
    ('A2 行级去掉哨兵显式比较（truthy 陷阱）',
     'front', 'bill', 'A', 'D4b',
     "    if (p === PLATFORM_AMBIGUOUS) return { platform: PLATFORM_AMBIGUOUS, headerRow: i };\n"
     "    if (p) return { platform: p, headerRow: i };",
     "    if (p) return { platform: p, headerRow: i };"),

    # ── 组 A：D5 truthy 陷阱（矩阵级）──────────────────
    ('A3 矩阵级去掉哨兵显式比较（跨 sheet 代选）',
     'front', 'bill', 'A', 'D5b',
     "    if (hit && hit.platform === PLATFORM_AMBIGUOUS) return { platform: PLATFORM_AMBIGUOUS, headerRow: hit.headerRow, sheet: name };\n"
     "    if (hit) return { platform: hit.platform, headerRow: hit.headerRow, sheet: name };",
     "    if (hit) return { platform: hit.platform, headerRow: hit.headerRow, sheet: name };"),

    # ── 组 A：D12 云端副本同步 ────────────────────────
    ('A4 只改前端、云端副本退回旧写法（双副本失同步）',
     'cloudsvc', 'bill', 'A', 'D12',
     '  if (hits.length === 1) return hits[0];                 // 唯一命中 ⇒ 现状不变\n'
     '  return PLATFORM_AMBIGUOUS;                             // 🔴 R253：≥2 命中 ⇒ 拒绝代选',
     '  return hits.length ? hits[0] : null;'),

    # ── 组 A：D7/D8/D9 index.js 显式比较 + 顺序 + 文案 ──
    ('A5 index.js 删掉哨兵分支（退回"认不出"错误归因）',
     'cloudidx', 'bill', 'A', 'D7',
     "  if (platform === PLATFORM_AMBIGUOUS) {\n"
     "    return fail(ERROR_CODES.INVALID_PARAM, '这张表同时符合多个平台的账单特征（例如同时含「结算金额」与「商家应收款」），无法自动判定是哪个平台。请在导入时手动选择平台后再试。');\n"
     "  }\n",
     ''),

    # ── 组 A：D10 import 缺则 ReferenceError ──────────
    ('A6 index.js 去掉 PLATFORM_AMBIGUOUS 导入',
     'cloudidx', 'bill', 'A', 'D10',
     '  PLATFORM_AMBIGUOUS,   // R253：多平台同时命中哨兵 —— 🔴 必须 import，truthy 陷阱见 :73 附近\n',
     ''),

    # ── 组 A：7-⑤ 映射优先（缺口救回）─────────────────
    ('A7 删掉映射优先分支（只留名称匹配）',
     'dishsvc', 'dish', 'A', '7-⑤',
     "    if (typeof lookupCardCode === 'function') {\n"
     "      cardCode = lookupCardCode(dishKey, a.platform) || '';\n"
     "    }\n",
     ''),

    # ── 组 A：7-⑥ 脏映射回落 ──────────────────────────
    ('A8 去掉脏映射回落分支',
     'dishsvc', 'dish', 'A', '7-⑥',
     '    if (!cardCode || !latestByCode.has(cardCode)) {\n'
     '      cardCode = nameToCode.get(normalizeDishName(dishKey)) || \'\';   // 回落：同名归一（原口径）\n'
     '    }',
     "    if (!cardCode) {\n"
     "      cardCode = nameToCode.get(normalizeDishName(dishKey)) || '';\n"
     "    }"),

    # ── 组 A：7-⑨a 键必须是 dishKey（不是 external_ref_id）──
    ('A9 查表键改用 external_ref_id（含日期 ⇒ 天天失配）',
     'dishsvc', 'dish', 'A', '7-⑤',
     'cardCode = lookupCardCode(dishKey, a.platform) || \'\';',
     "cardCode = lookupCardCode(dishKey + '_WRONGKEY', a.platform) || '';"),

    # ── 组 A：7-⑦ 查表带平台（防跨平台串卡）──────────
    ('A10 查表不带平台（跨平台串卡）',
     'dishsvc', 'dish', 'A', '7-⑦',
     'cardCode = lookupCardCode(dishKey, a.platform) || \'\';',
     "cardCode = lookupCardCode(dishKey, '') || '';"),

    # ── 组 B：不该红（语义等价改写 / 无害改动）────────
    ('B1 等价改写：hits.length===0 分支改成 !hits.length',
     'front', 'bill', 'B', None,
     '  if (hits.length === 0) return null;',
     '  if (!hits.length) return null;'),

    ('B2 等价改写：行级哨兵比较改成 switch 形态',
     'front', 'bill', 'B', None,
     "    if (p === PLATFORM_AMBIGUOUS) return { platform: PLATFORM_AMBIGUOUS, headerRow: i };",
     "    if (String(p) === PLATFORM_AMBIGUOUS) return { platform: PLATFORM_AMBIGUOUS, headerRow: i };"),
]


def dry_run():
    print('=== 锚点预检（--dry，不写文件）===')
    ok = True
    for (name, key, suite, grp, exp, old, new) in MUTATIONS:
        n, eol = count_hits(key, old)
        flag = 'OK ' if n == 1 else 'BAD'
        if n != 1:
            ok = False
        print('%-8s hit=%-6d [%s]  %s' % (flag, n, eol, name))
    return ok


def main():
    if '--dry' in sys.argv:
        return 0 if dry_run() else 1

    backup()
    try:
        # 基线先绿
        for sname, rel in SUITES.items():
            f, c, _ = run_suite(rel)
            print('基线 %-6s ❌=%d crash=%s' % (sname, len(f), c))
            if f or c:
                print('!! 基线不绿，先修再回灌'); return 1
        print('')

        miss = []
        results = []
        for (name, key, suite, grp, exp, old, new) in MUTATIONS:
            reset_to_base()
            try:
                sub1(key, old, new)
            except RuntimeError as e:
                print('SKIP  %-52s %s' % (name, e)); miss.append(name); continue
            failed, crashed, out = run_suite(SUITES[suite])
            hit = bool(exp) and any(re.search(r'❌\s*' + re.escape(exp), l) for l in failed)
            if grp == 'A':
                caught = hit            # 组 A：必须点名到目标断言
                ok = caught
            else:
                # 组 B：不得红；且不得崩塌成崩溃红
                ok = (len(failed) == 0 and not crashed)
            label = ('✅抓到' if hit else ('崩溃红' if crashed else '❌未点名'))
            if grp == 'B':
                label = '✅未误红' if ok else ('假红' if failed else '崩溃红')
            print('%-52s grp%s ❌=%-2d %s' % (name, grp, len(failed), label))
            if not ok:
                miss.append(name)
                if grp == 'A' and crashed:
                    print('       (崩溃红，非有效红)')
                for l in failed[:4]:
                    print('       ' + l[:150])
            results.append((name, grp, len(failed), crashed, hit, ok))

        reset_to_base()
        print('')
        for sname, rel in SUITES.items():
            f, c, _ = run_suite(rel)
            print('还原后 %-6s ❌=%d crash=%s' % (sname, len(f), c))
            if f or c:
                miss.append('RESTORE-' + sname)

        print('')
        print('变异 %d 条 / 漏网 %d 条' % (len(MUTATIONS), len(miss)))
        if miss:
            print('漏网或异常: ' + ', '.join(miss))
        return 0 if not miss else 1
    finally:
        reset_to_base()


sys.exit(main())
