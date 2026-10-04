# -*- coding: utf-8 -*-
"""R213-C 补丁二：① adminQueryUser/selftest.js 接单源（原复刻了一份 tier 判定 = 第二源，
且其"源码正则"断言要求 index.js 里存在手写比较 —— 与单源纪律冲突）
② tools/check_entitlement_flow.js 修两处我方判据缺陷（async 未 await / 硬上限样本写错）。"""
import io
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
SELF = 'cloudfunctions/adminQueryUser/selftest.js'
GUARD = 'tools/check_entitlement_flow.js'

PLAN = [
    (SELF, [
        ("console.log('===== 档位判定（解耦铁律：只读 expire_at）=====');\n"
         "const tier = (expireAt) => (expireAt > Date.now() ? 'paid' : 'free');",
         "console.log('===== 档位判定（解耦铁律：只读 expire_at）=====');\n"
         "// 🔒 R213：判定走单源 —— 原本地复刻一份比较，与 common/entitlement.js 构成「付费语义第二源」。\n"
         "const { isPaid } = require('./common');\n"
         "const tier = (expireAt) => (isPaid(expireAt) ? 'paid' : 'free');"),
        ("check('判定不依赖 plan_id（无 plan 字段参与）',",
         "check('判定不依赖 plan_id、且走单源 isPaid（无手写到期比较）',"),
        (r"return /expireAt\s*>\s*Date\.now\(\)/.test(s) && !/plan_id/.test(s); })(),",
         r"return /isPaid\s*\(/.test(s) && !/plan_id/.test(s) && !new RegExp('expireAt' + '\\s*>\\s*Date\\.now').test(s); })(),"),
        ("'index.js:74：tier 仅由 expire_at 决定（🔒 R71：原为恒真断言）');",
         "'index.js：tier 仅由 expire_at 决定，判定走 common/entitlement.js::isPaid（R71/R213）');"),
    ]),
    (GUARD, [
        ("console.log('===== E-A 实跑单源（cloudfunctions/common/entitlement.js）=====');",
         "(async () => {\nconsole.log('===== E-A 实跑单源（cloudfunctions/common/entitlement.js）=====');"),
        ("check('E-A⑧ 开放默认：未登记能力恒解锁（不因漏登记而锁死用户）',\n"
         "  hasFeature(null, 'u', 'no_such_feature') === true);",
         "// ⚠️ hasFeature 是 async ⇒ 必须 await（同步写 === true 会与 Promise 比较，恒假）\n"
         "let openDefault = null;\n"
         "try { openDefault = await hasFeature(null, 'u', 'no_such_feature'); } catch (_) { openDefault = null; }\n"
         "check('E-A⑧ 开放默认：未登记能力恒解锁（不因漏登记而锁死用户）', openDefault === true, String(openDefault));"),
        ("const r199 = call({ userId: 'u', scope: 'cost_card', activeCount: 199, limits: LIM });\n"
         "const r200 = call({ userId: 'u', scope: 'cost_card', activeCount: 200, limits: LIM });",
         "const r1999 = call({ userId: 'u', scope: 'cost_card', activeCount: 1999, limits: LIM });\n"
         "const r2000 = call({ userId: 'u', scope: 'cost_card', activeCount: 2000, limits: LIM });"),
        ("check('E-B④ 硬上限：used=199 未触顶 / used=200 触顶',\n"
         "  !!(r199 && r199.hit_hard_limit === false && r200 && r200.hit_hard_limit === true));",
         "check('E-B④ 硬上限：used=1999 未触顶 / used=2000 触顶',\n"
         "  !!(r1999 && r1999.hit_hard_limit === false && r2000 && r2000.hit_hard_limit === true));"),
        ("process.exit(fails.length === 0 ? 0 : 1);",
         "process.exit(fails.length === 0 ? 0 : 1);\n"
         "})().catch((e) => { console.log('❌ 守卫自身异常：' + (e && e.message)); process.exit(1); });"),
    ]),
]


def main():
    bufs = {}
    for rel, edits in PLAN:
        p = os.path.join(ROOT, rel)
        with io.open(p, 'r', encoding='utf-8', newline='') as f:
            text = f.read()
        nl = '\r\n' if '\r\n' in text else '\n'
        norm = text.replace('\r\n', '\n')
        for old, new in edits:
            o, n = old.replace('\r\n', '\n'), new.replace('\r\n', '\n')
            c = norm.count(o)
            if c != 1:
                print('ABORT: anchor hit %d (expect 1) in %s :: %r' % (c, rel, o[:60]))
                return 1
            norm = norm.replace(o, n)
        bufs[rel] = norm.replace('\n', nl)
        print('OK: %s (4 anchors 1/1)' % rel)
    for rel, out in bufs.items():
        with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8', newline='') as f:
            f.write(out)
        print('WROTE: %s' % rel)
    return 0


if __name__ == '__main__':
    sys.exit(main())
