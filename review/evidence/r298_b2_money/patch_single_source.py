# -*- coding: utf-8 -*-
"""R298 · B2 两阶段补丁：yuanToFen 十进制安全（前端 + 云端单源）
纪律：先在内存里全量校验（每锚点命中须 == 1），全部通过才统一落盘；任一不符则一个文件都不写。
行尾：按各文件**现有行尾**写回（money.js 工作树是 CRLF、api.js 是 LF），零行尾噪音。
"""
import os, io, sys

def find_root(start):
    d = os.path.abspath(start)
    while True:
        if os.path.exists(os.path.join(d, 'verify_all.js')):
            return d
        p = os.path.dirname(d)
        if p == d:
            raise RuntimeError('未找到仓根')
        d = p

ROOT = find_root(os.path.dirname(os.path.abspath(__file__)))

# ============ 改动 1：cloudfunctions/common/money.js（云端单源）============
F1 = 'cloudfunctions/common/money.js'
OLD1 = (
"// 元 \u2192 分（整数）。非数/非有限 \u2192 抛 INVALID_PARAM。\n"
"function yuanToFen(yuan) {\n"
"  if (typeof yuan !== 'number' || !isFinite(yuan)) {\n"
"    throw { code: ERROR_CODES.INVALID_PARAM, msg: 'yuan must be a finite number' };\n"
"  }\n"
"  return Math.round(yuan * 100);\n"
"}"
)
NEW1 = (
"// 元 \u2192 分（整数）。非数/非有限 \u2192 抛 INVALID_PARAM。\n"
"// \U0001F534 R298（B2）：**十进制安全**。原式 `Math.round(yuan * 100)` 在 IEEE754 下会因\n"
"//   「乘 100 后的二进制表示略小于十进制真值」而**少进 1 分** \u2014\u2014 实测三位小数全域 18 万点\n"
"//   错 1147 点（0.145\u219214 / 0.285\u219228 / 1.005\u2192100 真值 101 \u2026），方向恒为**偏小**。\n"
"//   两位小数（老板日常输入形态）穷举 100 万点原本就 0 错 \u21D2 本修法**对合法日常输入零漂移**。\n"
"//   `toFixed(10)` 只消掉 1e-13 量级的浮点噪声、不动真实半步 \u21D2 x.xx5 恢复十进制语义。\n"
"//   \u26A0\uFE0F 前端同源实现见 `utils/api.js::yuanToFen` \u2014\u2014 两份**必须同款**，否则两端算出的「分」不同。\n"
"//   伴侣守卫：tools/check_money_precision.js\uff08A 组行为穷举 + B 组双副本等价\uff09\u3002\n"
"function yuanToFen(yuan) {\n"
"  if (typeof yuan !== 'number' || !isFinite(yuan)) {\n"
"    throw { code: ERROR_CODES.INVALID_PARAM, msg: 'yuan must be a finite number' };\n"
"  }\n"
"  return Math.round(Number((yuan * 100).toFixed(10)));\n"
"}"
)

# ============ 改动 2：utils/api.js（前端同源实现）============
F2 = 'utils/api.js'
OLD2 = (
"  /** 元（字符串/数字）\u2192 分（number）整数。input 值是字符串、界面单位是元。 */\n"
"  yuanToFen(yuanInput) {\n"
"    const n = Number(yuanInput);\n"
"    if (!isFinite(n) || n < 0) return 0;\n"
"    return Math.round(n * 100);\n"
"  },"
)
NEW2 = (
"  /** 元（字符串/数字）\u2192 分（number）整数。input 值是字符串、界面单位是元。 */\n"
"  // \U0001F534 R298（B2）：十进制安全 \u2014\u2014 原式 `Math.round(n * 100)` 对 x.xx5 会**少进 1 分**\n"
"  //   （1.005\u2192100 真值 101），而输入框 `type=\"digit\"` 不拦三位小数、handler 又原样存字符串\n"
"  //   \u21D2 **可达**。两位小数穷举 100 万点零漂移，故本修法不改日常行为。\n"
"  //   \u26A0\uFE0F 与云端单源 `cloudfunctions/common/money.js::yuanToFen` **必须同款**\n"
"  //   \uff08差异：本端非数/负数 \u21D2 0\uff08fail-soft\uff09；云端非数 \u21D2 抛 INVALID_PARAM\uff08fail-closed\uff09\u3002\n"
"  //   该差异**仅在非法输入域**，合法输入域两份必须逐点等价 \u2014\u2014 守卫 B 组专钉这条\uff09\u3002\n"
"  yuanToFen(yuanInput) {\n"
"    const n = Number(yuanInput);\n"
"    if (!isFinite(n) || n < 0) return 0;\n"
"    return Math.round(Number((n * 100).toFixed(10)));\n"
"  },"
)

TARGETS = [(F1, OLD1, NEW1), (F2, OLD2, NEW2)]

# ---------- 阶段 1：全量校验 ----------
plan = {}
print('=' * 72)
print('阶段 1：全量校验（任一不符 ⇒ 一个文件都不写）')
print('=' * 72)
ok_all = True
for rel, old, new in TARGETS:
    p = os.path.join(ROOT, rel)
    raw = open(p, 'rb').read()
    cr = raw.count(b'\r')
    crlf = raw.count(b'\r\n')
    eol = '\r\n' if crlf > 0 else '\n'
    s = raw.decode('utf-8')
    norm = s.replace('\r\n', '\n')
    cr_before = norm.count('\r')
    n = norm.count(old)
    print('%-42s CR=%-4d eol=%-4s 锚点命中=%d' % (rel, cr, repr(eol), n))
    if n != 1:
        print('   ❌ 锚点命中必须为 1')
        ok_all = False
        continue
    out_norm = norm.replace(old, new, 1)
    # 还原行尾
    out = out_norm.replace('\n', eol) if eol == '\r\n' else out_norm
    # 行尾风格断言（不是「CR 数守恒」—— 新增行必然新增 CR）；
    #   真判据 = **不混入另一种行尾**：CRLF 文件里 CR 数必须等于换行总数；LF 文件里 CR 数必须为 0。
    n_lf = out.count('\n')
    out_cr = out.count('\r')
    style_ok = (out_cr == n_lf) if eol == '\r\n' else (out_cr == 0)
    print('   换行数=%d  CR=%d  行尾风格一致=%s' % (n_lf, out_cr, style_ok))
    if not style_ok:
        ok_all = False
        continue
    plan[rel] = out.encode('utf-8')

print()
if not ok_all or len(plan) != len(TARGETS):
    print('❌ 校验未全通过 ⇒ 一个文件都不写，退出')
    sys.exit(1)
print('✅ 全部 %d 个文件校验通过' % len(plan))

# ---------- 阶段 2：统一落盘 ----------
print()
print('=' * 72)
print('阶段 2：统一落盘')
print('=' * 72)
for rel, data in plan.items():
    open(os.path.join(ROOT, rel), 'wb').write(data)
    print('  已写 %-42s %d 字节' % (rel, len(data)))
print('\n完成。下一步：跑 node tools/sync_common.js 同步 51 份派生副本')
