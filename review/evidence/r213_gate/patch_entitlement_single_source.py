# -*- coding: utf-8 -*-
"""R213-C 补丁：把两处手写「到期判定」接回单源 common/entitlement.js::isPaid。

背景（C 项实扫所得）：entitlement.js 注释明写「严禁在函数体内再写一遍 expireAt > nowUtc()」，
但实扫发现两处扩散：adminQueryUser/index.js（tier 判定）与 payQueryEntitlement/service.js（is_active）。
两处均**行为等价**可替换 ⇒ 接回单源，消除"付费语义双源"。
"""
import io
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))

ADMIN = 'cloudfunctions/adminQueryUser/index.js'
PAYQ = 'cloudfunctions/payQueryEntitlement/service.js'

PLAN = [
    (ADMIN, [
        ("const { ERROR_CODES, ok, fail } = common;",
         "const { ERROR_CODES, ok, fail, isPaid } = common;"),
        ("      tier: expireAt > Date.now() ? 'paid' : 'free',   // 档位判定：只读 expire_at（解耦铁律）",
         "      tier: isPaid(expireAt) ? 'paid' : 'free',        // 档位判定：只读 expire_at（解耦铁律）·判定走单源"),
    ]),
    (PAYQ, [
        ("const { ERROR_CODES } = require('./common');",
         "const { ERROR_CODES, isPaid } = require('./common');"),
        ("  const active = expireAt > now;",
         "  const active = isPaid(expireAt, now);   // 🔒 判定走单源 common/entitlement.js::isPaid（禁手写第二遍）"),
        (" *   - is_active: expire_at > now",
         " *   - is_active: 单源 isPaid(expire_at, now) 判定（不手写比较）"),
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
        # 形态自检：接单源后不得再留手写比较
        if 'expireAt > ' in norm or 'expire_at > now' in norm:
            print('ABORT: 仍残留手写到期比较 in %s' % rel)
            return 1
        bufs[rel] = norm.replace('\n', nl)
        print('OK: %s' % rel)
    for rel, out in bufs.items():
        with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8', newline='') as f:
            f.write(out)
        print('WROTE: %s' % rel)
    return 0


if __name__ == '__main__':
    sys.exit(main())
