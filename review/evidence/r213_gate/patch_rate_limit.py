# -*- coding: utf-8 -*-
"""R213 接线补丁：把 common/rateLimit 真正接到两个写入口（saveCostCard / syncCostCard）。

铁律（gate-suite-checklist §3.3）：两阶段写入 —— 先在内存里改完 + 每个锚点断言命中数 == 1，
全部通过才统一落盘；任一不符则一个文件都不写并响亮退出。
"""
import io
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))

SINGLETON = '''const { validateInput } = require('./validate');

// 🔒 R213 写限流（批次 0 §2.2.5 · openid 维度 60 次/分钟）
//   单源 cloudfunctions/common/rateLimit.js —— 已挂在聚合入口 common.rateLimit 上（sync_common 派生出
//   cx_rateLimit.js，本目录内即有），故本次接线**零 common 改动**、无需重跑 sync_common。
//   ⚠️ store 必须放**模块级单例**：若写在 exports.main 里 `makeRateLimiter(new Map())`，每次调用都是
//      新桶 ⇒ 计数永远为 1 ⇒ 限流恒不触发（零件齐全却等于没接线，正是 R212 挖出的那个盲区）。
//      守卫 tools/check_rate_limit_params.js::A8 把这一点钉死（含"不得在 main 内建 store"的负判据）。
const RATE_STORE = new Map();
const rateLimitCheck = common.rateLimit.makeRateLimiter(RATE_STORE);
'''

SAVE_GUARD = '''  if (v.error) return fail(v.error, v.msg);

  // ===== 2.5 写限流（R213）=====
  //   本函数所有分支皆写库（只 INSERT 新版本 / 软删 / 模式 B 虚拟原料落库）⇒ 无条件计入写限额。
  //   位置说明：放在「通过鉴权 + 通过校验」之后 —— 非法请求由鉴权/校验当场拒绝，不占用限额；
  //   能走到这里的请求都是会真正落库的，正是限流要保护的对象。
  const rl = await rateLimitCheck(userId);
  if (rl.limited) return fail(rl.code);

  // ===== 3. 幂等预检 ====='''

SYNC_GUARD = '''  const clientRequestId = v.input.client_request_id;

  // ===== 2.4 写限流（R213）=====
  //   dry_run 是「影响面预览」（M3.19）—— 只读、零写库、不产生新版本 ⇒ **不计入写限额**，
  //   否则用户反复预览会被误拒。只有真正落库的重算才计数。
  if (!v.dry_run) {
    const rl = await rateLimitCheck(userId);
    if (rl.limited) return fail(rl.code);
  }

  const da = makeAdapter(db);'''

# (相对路径, [(old, new), ...])
PLAN = [
    ('cloudfunctions/saveCostCard/index.js', [
        ("const { validateInput } = require('./validate');\n", SINGLETON),
        ("  if (v.error) return fail(v.error, v.msg);\n\n  // ===== 3. 幂等预检 =====", SAVE_GUARD),
    ]),
    ('cloudfunctions/syncCostCard/index.js', [
        ("const { validateInput } = require('./validate');\n", SINGLETON),
        ("  const clientRequestId = v.input.client_request_id;\n\n  const da = makeAdapter(db);", SYNC_GUARD),
    ]),
]


def main():
    buffers = {}
    for rel, edits in PLAN:
        p = os.path.join(ROOT, rel)
        with io.open(p, 'r', encoding='utf-8', newline='') as f:
            text = f.read()
        nl = '\r\n' if '\r\n' in text else '\n'
        norm = text.replace('\r\n', '\n')
        for old, new in edits:
            o = old.replace('\r\n', '\n')
            n = new.replace('\r\n', '\n')
            cnt = norm.count(o)
            if cnt != 1:
                print('ABORT: anchor hit %d (expect 1) in %s :: %r' % (cnt, rel, o[:70]))
                return 1
            norm = norm.replace(o, n)
        # 形态自检：单例与调用点都必须只出现预期次数
        if norm.count('RATE_STORE') != 2 or norm.count('await rateLimitCheck(userId)') != 1:
            print('ABORT: shape check failed in %s (RATE_STORE=%d, await=%d)'
                  % (rel, norm.count('RATE_STORE'), norm.count('await rateLimitCheck(userId)')))
            return 1
        buffers[rel] = norm.replace('\n', nl)
        print('OK: %s  (anchors 1/1, shape ok)' % rel)

    for rel, out in buffers.items():
        p = os.path.join(ROOT, rel)
        with io.open(p, 'w', encoding='utf-8', newline='') as f:
            f.write(out)
        print('WROTE: %s' % rel)
    return 0


if __name__ == '__main__':
    sys.exit(main())
