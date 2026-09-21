#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
_mut_r84.py —— round84 变异回灌（证明 tools/check_waimai_spec_sync.js **不是假绿**）

纪律（本仓已付过学费）：
  · 双向变异：抽掉拦截 ⇒ 必须转红；换措辞/换无关列 ⇒ 必须仍绿。
    （只跑基线绿不算验过 —— R85 首版教训、R60/R77/R82/R84 四次审定式断言漂移）
  · 逐条独立：一次只变异一处，跑完立刻还原，再跑下一条。
  · 还原用**内存原字节写回**，不用 `git checkout --`：
    本轮 ModuleA 的 A.11 尚未提交 ⇒ index 里是旧版，`git checkout`/`git show :path`
    会把新章节一起抹掉；且 autocrlf 仓还会把 LF 还原成 CRLF（round78 §8.5 坑⑳）。
  · 写回一律 `newline=''` 保持 LF，规避行尾污染。
  · 证据输出只写 review/evidence/**，绝不落仓库根（坑㉔ 自指判红）。
"""
import os
import subprocess
import sys

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
SPEC = os.path.join(ROOT, 'specs', 'dev-specs', 'core', '开发规范v1.0_ModuleA_收入费用核算.md')
NODE = r'C:\Users\lzj\.workbuddy\binaries\node\versions\22.22.2-3\node.exe'
GUARD = os.path.join(ROOT, 'tools', 'check_waimai_spec_sync.js')

ORIG = open(SPEC, 'rb').read()
print(f'[基线] {os.path.basename(SPEC)} = {len(ORIG)} 字节，CRLF={ORIG.count(bytes([13, 10]))}')


def run_guard():
    r = subprocess.run([NODE, GUARD], cwd=ROOT, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    return r.returncode


def assert_pristine():
    cur = open(SPEC, 'rb').read()
    if cur != ORIG:
        print('  !!! 基线被污染，中止（还原逻辑失效）')
        sys.exit(2)


def mutate(name, old, new, expect_red, note=''):
    """返回 True 表示行为符合期望"""
    assert_pristine()
    s = ORIG.decode('utf-8')
    if old not in s:
        print(f'  SKIP | {name} | 定位串不存在（脚本需同步）')
        return False
    s2 = s.replace(old, new, 1)
    if s2 == s:
        print(f'  SKIP | {name} | 替换等效（无变化）')
        return False
    with open(SPEC, 'w', encoding='utf-8', newline='') as f:
        f.write(s2)
    rc = run_guard()
    with open(SPEC, 'wb') as f:
        f.write(ORIG)
    back = open(SPEC, 'rb').read()
    restored = (back == ORIG)
    if expect_red:
        ok = (rc != 0) and restored
    else:
        ok = (rc == 0) and restored
    tag = 'PASS' if ok else 'FAIL'
    exp = 'RED ' if expect_red else 'GREEN'
    print(f'  {tag} | {name:16s} | 期望 {exp} | 实得 rc={rc} | 还原字节相等={restored}'
          + (f' | {note}' if note else ''))
    return ok


CASES = [
    # ---- 正向：抽掉拦截，必须红 ----
    ('M1 平台改名', '| 3 | 京东外卖 | 同上 |', '| 3 | 京东到家 | 同上 |', True,
     'W1-① 平台名漂移'),
    ('M2 平台换序',
     '| 1 | 美团外卖 | 该平台账单三项之和 |\n| 2 | 淘宝闪购 | 同上 |',
     '| 1 | 淘宝闪购 | 该平台账单三项之和 |\n| 2 | 美团外卖 | 同上 |', True,
     'W1-① 顺序漂移（名称集合不变，只有顺序错）'),
    ('M3 item_key 改名', 'exp_mkt_takeaway_promo', 'exp_mkt_takeaway_ads', True,
     'W2-① key 漂移'),
    ('M4 显示名改名', '| 外卖推广费 | 手填 |', '| 外卖推广费X | 手填 |', True,
     'W2-② 显示名漂移'),
    ('M5 章节改名', '### A.11.2 ', '### A.11.2X ', True,
     'W3-① fail-closed（段定位失败）'),

    # ---- 反向：换措辞/改无关列，必须仍绿（证明判据不是恒真） ----
    ('M6 无关列换措辞', '| 1 | 美团外卖 | 该平台账单三项之和 |', '| 1 | 美团外卖 | 账单三项加总 |', False,
     '第三列说明列，不参与判据'),
    ('M7 末列换措辞', '账单「技术服务费」列求和', '技术服务费列合计', False,
     'A.11.3 末列说明，不参与判据'),
    ('M8 追加无关正文', '### A.11.7 ',
     '### A.11.7 ', False, '--- 占位：正文追加见下'),
]

results = []
print('\n===== 变异回灌开始 =====')
for name, old, new, expect_red, note in CASES:
    if name.startswith('M8'):
        # M8 特殊：追加正文而不改表格（换措辞类）
        assert_pristine()
        s = ORIG.decode('utf-8')
        s2 = s + '\n<!-- round84 变异：追加无关正文，守卫应仍绿 -->\n'
        with open(SPEC, 'w', encoding='utf-8', newline='') as f:
            f.write(s2)
        rc = run_guard()
        with open(SPEC, 'wb') as f:
            f.write(ORIG)
        restored = (open(SPEC, 'rb').read() == ORIG)
        ok = (rc == 0) and restored
        print(f'  {"PASS" if ok else "FAIL"} | {name:16s} | 期望 GREEN | 实得 rc={rc} | 还原字节相等={restored} | {note}')
        results.append(ok)
        continue
    results.append(mutate(name, old, new, expect_red, note))

assert_pristine()
n_ok = sum(1 for r in results if r)
print(f'\n===== 变异回灌结果：{n_ok} / {len(results)} 符合期望 =====')
print(f'[终态] 文件已还原，字节相等 = {open(SPEC, "rb").read() == ORIG}')
sys.exit(0 if n_ok == len(results) else 1)
