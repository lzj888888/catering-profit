# -*- coding: utf-8 -*-
"""C3 结果机器校验：解析 CLI 表格 → 与 N1 期望值表逐条比对（不做人眼判断）。"""
import re, json, sys

BASE = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence'
raw = open(BASE + '/r181e_c3c4/c3_timeout_final.txt', encoding='utf-8', errors='replace').read()

# 1) 解析实读值
got = {}
for ln in raw.splitlines():
    if '│' not in ln and '|' not in ln:
        continue
    parts = [p.strip() for p in re.split(r'[│|]', ln)]
    if len(parts) < 6:
        continue
    name = parts[1]
    if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*', name):
        continue
    if not re.fullmatch(r'\d+', parts[3]):
        continue
    got[name] = {'status': parts[2].strip("'"), 'timeout': int(parts[3]),
                 'runtime': parts[4].strip("'")}

# 2) 解析 N1 期望值表
exp = {}
n1 = open(BASE + '/r181b_gate/N1_timeout_readback_cmd.txt', encoding='utf-8').read()
inside = False
for ln in n1.splitlines():
    if ln.startswith('【期望值'):
        inside = True
        continue
    if inside:
        m = re.match(r'^\s{2}([A-Za-z][A-Za-z0-9_]*)\s+(\d+)\s*$', ln)
        if m:
            exp[m.group(1)] = int(m.group(2))
        elif ln.strip().startswith('【'):
            break

print('实读函数数 =', len(got))
print('期望函数数 =', len(exp))
print('timeout 分布 =', {v: sum(1 for x in got.values() if x['timeout'] == v) for v in sorted({x['timeout'] for x in got.values()}, reverse=True)})

missing = sorted(set(exp) - set(got))
extra = sorted(set(got) - set(exp))
mismatch = [(k, exp[k], got[k]['timeout']) for k in sorted(exp) if k in got and exp[k] != got[k]['timeout']]
threes = sorted(k for k, v in got.items() if v['timeout'] == 3)

print('缺失 =', missing)
print('多出 =', extra)
print('不一致 =', mismatch)
print('timeout==3 的函数 =', threes)
notactive = sorted(k for k, v in got.items() if v['status'] != 'Active')
print('非 Active =', notactive)
runtimes = sorted({v['runtime'] for v in got.values()})
print('runtime 集合 =', runtimes)

verdict = (len(got) == 42 and not missing and not extra and not mismatch and not threes)
print()
print('VERDICT =', 'C3_PASS (42/42 与期望值逐条一致, 无 timeout==3)' if verdict else 'C3_FAIL')
json.dump({'got': got, 'expected': exp, 'missing': missing, 'extra': extra,
           'mismatch': mismatch, 'timeout_eq_3': threes, 'verdict': 'PASS' if verdict else 'FAIL'},
          open(BASE + '/r181e_c3c4/c3_verify.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
