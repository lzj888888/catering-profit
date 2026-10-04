# -*- coding: utf-8 -*-
# R215 同步面补丁（六处套件同步 + A15 白名单）—— 两阶段写入
import os, sys

ROOT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit'
SPEC = r'specs/dev-specs/★知识存储点_2026-09-10.md'

EVO = (' \u2192 **137\uff08R215\uff1a\u65b0\u589e `tools/check_fn_public_surface.js`\uff0c'
       '\u4e91\u51fd\u6570\u516c\u5f00\u9762\u5b88\u536b \u2014\u2014 \u65e0\u9274\u6743\u51fd\u6570\u5fc5\u987b\u9010\u6761\u767b\u8bb0'
       '\u4e14\u5b9a\u65f6/\u63a2\u9488\u7c7b\u5fc5\u987b\u81ea\u5e26\u6765\u6e90\u6821\u9a8c\uff1b\u540c\u8f6e\u7ed9 payExpireNotify '
       '\u4e0e smokeTest \u8865\u6765\u6e90\u6821\u9a8c\uff08\u6b64\u524d\u4efb\u610f\u7528\u6237\u53ef\u62c9\u5168\u8868\u4ed8\u8d39\u72b6\u6001/\u5199\u5e93\uff09\uff1b'
       '17 \u65ad\u8a00\uff09**')

EDITS = []


def E(rel, old, new):
    EDITS.append((rel, old, new))


# ---------- 1/2/3 · verify_all.js ----------
E('verify_all.js',
  '// \u4e32\u8054\uff1a136 \u4e2a\u5957\u4ef6',
  '// \u4e32\u8054\uff1a137 \u4e2a\u5957\u4ef6')

E('verify_all.js',
  "  ['entitlement-flow',     'tools/check_entitlement_flow.js'],\n];\n",
  "  ['entitlement-flow',     'tools/check_entitlement_flow.js'],\n"
  "  ['fn-public-surface',    'tools/check_fn_public_surface.js'],\n"
  "];\n")

E('verify_all.js',
  '//           \u5b88\u536b\u8865 **L6-\u2461\u300c\u7a77\u5c3d\u5206\u7c7b\u300d**\u4fee\u300c\u626b\u63cf\u9762\u4e00\u7a7a\u5373\u6052\u7eff\u300d\uff1b28 \u6761\u65ad\u8a00\uff0c\u53d8\u5f02\u56de\u704c 4/4 \u5168\u90e8\u70b9\u540d\u76ee\u6807\u65ad\u8a00\uff09\n',
  '//           \u5b88\u536b\u8865 **L6-\u2461\u300c\u7a77\u5c3d\u5206\u7c7b\u300d**\u4fee\u300c\u626b\u63cf\u9762\u4e00\u7a7a\u5373\u6052\u7eff\u300d\uff1b28 \u6761\u65ad\u8a00\uff0c\u53d8\u5f02\u56de\u704c 4/4 \u5168\u90e8\u70b9\u540d\u76ee\u6807\u65ad\u8a00\uff09\n'
  '//       + \u4e91\u51fd\u6570\u516c\u5f00\u9762\u5b88\u536b\uff08tools/check_fn_public_surface.js\uff0cR215\uff1a**\u5165\u53e3\u6709\u6ca1\u6709\u9274\u6743/\u81ea\u4fdd\uff0c\u5fc5\u987b\u6709\u4eba\u5b88** \u2014\u2014\n'
  '//         R214 \u5168\u94fe\u8def\u901a\u8dd1\u53d1\u73b0 `payExpireNotify` \u7684 exports.main **\u96f6\u6765\u6e90\u6821\u9a8c**\uff0c\n'
  '//         \u800c\u5b83\u626b shop_entitlement **\u5168\u8868**\u5e76\u56de user_id + expire_at \u21d2 \u4efb\u610f\u5df2\u767b\u5f55\u7528\u6237\n'
  '//         \u5728\u5c0f\u7a0b\u5e8f\u7aef\u5373\u53ef\u62c9\u8d70\u522b\u4eba\u7684\u4ed8\u8d39\u72b6\u6001\uff1b\u540c\u65cf `smokeTest`\uff08\u5199\u5e93\u63a2\u9488\uff09\u4ea6\u7136\u3002\n'
  '//         \u800c\u65e2\u6709\u5b88\u536b\u5168\u6293\u4e0d\u5230\uff1aR194 \u53ea\u770b**\u5df2\u6709\u9274\u6743**\u51fd\u6570\u7684\u8fd4\u56de\u5f62\u72b6\u3001R62 \u53ea\u5b88\u300c\u51fd\u6570\u6e05\u5355\n'
  '//         \u2261 \u5951\u7ea6\u6587\u6863\u300d\u3001R68 \u53ea\u5b88\u9690\u79c1\u6536\u96c6\u9879 \u21d2\u300c\u5165\u53e3\u9274\u6743\u300d\u8fd9\u4e00\u5c42\u6b64\u524d\u96f6\u5224\u636e\u3002\n'
  '//         \u5224\u636e = S \u626b\u63cf\u9762 + A **\u4e09\u5206\u7a77\u5c3d**\uff08A \u7528\u6237\u9274\u6743 / B admin \u9274\u6743 / C \u514d\u9274\u6743\uff09\n'
  '//         + B C \u7c7b\u9010\u6761\u767b\u8bb0\u4e14\u53cc\u5411\u9632\u8150 + C \u5b9a\u65f6/\u63a2\u9488\u7c7b\u5fc5\u987b\u771f\u5224\u6765\u6e90\n'
  '//         \uff08OPENID \u540e return \u62d2\u7edd\uff0c\u542b\u89e3\u6790\u5668\u81ea\u8bc1\u6b63\u8d1f\u6837\u672c\uff09+ D \u81ea\u5931\u6548\u62a4\u680f\u3002\n'
  '//         \u8bda\u5b9e\u8fb9\u754c\uff1a\u4e0d\u5224\u9274\u6743**\u5f3a\u5ea6**\u3001\u4e0d\u5224 payCallback \u9a8c\u7b7e\u5b9e\u73b0\u3001\u4e0d\u5224 admin \u5165\u53e3\u7684\u5e42\u7b49\u4e0e\u9650\u989d\u3002\n'
  '//         \u540c\u8f6e\uff1a\u7ed9 payExpireNotify \u4e0e smokeTest \u8865\u6765\u6e90\u6821\u9a8c\uff1b17 \u6761\u65ad\u8a00\uff09\n')

# ---------- 4/5 · 重启键 §1.1 入口行 ----------
E(SPEC,
  '\uff08\u4ed3\u5e93\u6839\uff1b\u4e32 **136** \u4e2a\u5957\u4ef6',
  '\uff08\u4ed3\u5e93\u6839\uff1b\u4e32 **137** \u4e2a\u5957\u4ef6')

E(SPEC,
  '\u7ed9 R159 \u4ed8\u8d39\u5899\u5b88\u536b\u8865\u81ea\u5931\u6548\u62a4\u680f\uff1b28 \u65ad\u8a00\uff0c\u53d8\u5f02\u56de\u704c 4/4\uff09**',
  '\u7ed9 R159 \u4ed8\u8d39\u5899\u5b88\u536b\u8865\u81ea\u5931\u6548\u62a4\u680f\uff1b28 \u65ad\u8a00\uff0c\u53d8\u5f02\u56de\u704c 4/4\uff09**' + EVO)

# ---------- 6/7 · 重启键「套件数会漂」行 ----------
E(SPEC,
  '\u6570\u91cf\uff08\u73b0 **136**\uff1b',
  '\u6570\u91cf\uff08\u73b0 **137**\uff1b')

E(SPEC,
  '\u5e76\u628a\u4e24\u5904\u624b\u5199\u5230\u671f\u5224\u5b9a\u63a5\u56de\u5355\u6e90\uff1b28 \u65ad\u8a00\uff09**',
  '\u5e76\u628a\u4e24\u5904\u624b\u5199\u5230\u671f\u5224\u5b9a\u63a5\u56de\u5355\u6e90\uff1b28 \u65ad\u8a00\uff09**' + EVO)

# ---------- 8 · CASES ----------
E('tools/check_suite_assert_counts.js',
  "  { key: 'check_entitlement_flow', rel: 'tools/check_entitlement_flow.js' }, // 28 \u6761\uff08R213\uff1aE-A \u5b9e\u8dd1\u5355\u6e90 9 / E-B \u5b9e\u8dd1\u914d\u989d 7 / E-C \u94fe\u8def\u5728\u573a 9 / E-D \u62a4\u680f 3\uff09\n];\n",
  "  { key: 'check_entitlement_flow', rel: 'tools/check_entitlement_flow.js' }, // 28 \u6761\uff08R213\uff1aE-A \u5b9e\u8dd1\u5355\u6e90 9 / E-B \u5b9e\u8dd1\u914d\u989d 7 / E-C \u94fe\u8def\u5728\u573a 9 / E-D \u62a4\u680f 3\uff09\n"
  "  { key: 'check_fn_public_surface', rel: 'tools/check_fn_public_surface.js' }, // 17 \u6761\uff08R215\uff1aS \u626b\u63cf\u9762 5 / A \u4e09\u5206\u7a77\u5c3d 2 / B \u767b\u8bb0\u53cc\u5411 4 / C \u6765\u6e90\u81ea\u4fdd 4 / D \u81ea\u5931\u6548 2\uff09\n"
  "];\n")

# ---------- 9 · 重启键断言数声明行 ----------
E(SPEC,
  '`check_entitlement_flow`=28\uff08**\u56db\u5341\u4e5d\u8005**\u5747 \u2261 \u5b9e\u8dd1 pass \u6570\uff1b',
  '`check_entitlement_flow`=28 / `check_fn_public_surface`=17\uff08**\u4e94\u5341\u8005**\u5747 \u2261 \u5b9e\u8dd1 pass \u6570\uff1b')

# ---------- 10 · selftest_r85.js A15_EXEMPT ----------
E('tools/selftest_r85.js',
  '  /^cloudfunctions\\/adminQueryUser\\//,\n  /^cloudfunctions\\/payQueryEntitlement\\//,\n];\n',
  '  /^cloudfunctions\\/adminQueryUser\\//,\n'
  '  /^cloudfunctions\\/payQueryEntitlement\\//,\n'
  '  // \u26a0\ufe0f 2026-10-04\uff08round215\uff09**\u5341\u516d\u6b21\u89e6\u53d1** \u2014\u2014 \u540c\u4e00\u65f6\u673a\u5173\u5361\u7b2c 16 \u6b21\uff1aR215 \u4fee P0 \u672a\u6388\u6743\u8bbf\u95ee\n'
  '  //   \uff08R214 \u5168\u94fe\u8def\u901a\u8dd1\u53d1\u73b0\uff09\u3002\u6539\u52a8\u9762 = \u4e24\u4e2a**\u65e0\u9274\u6743**\u4e91\u51fd\u6570\u8865\u6765\u6e90\u6821\u9a8c\uff1a\n'
  '  //   \u2460 `payExpireNotify/`\uff08\u5b9a\u65f6\u4efb\u52a1\uff09\u2014\u2014 exports.main \u6b64\u524d\u65e0\u6821\u9a8c\uff0c\u4efb\u610f\u5df2\u767b\u5f55\u7528\u6237\u53ef\u4ece\u5c0f\u7a0b\u5e8f\u7aef\n'
  '  //      \u8c03\u7528\u5b83\u62c9\u8d70 `shop_entitlement` \u5168\u8868\uff08user_id + expire_at\uff09\uff1b\n'
  '  //   \u2461 `smokeTest/`\uff08\u771f\u4e91\u8bca\u65ad\u63a2\u9488\uff09\u2014\u2014 \u4f1a\u5efa\u96c6\u5408/\u5199 probe_tmp\uff0c\u540c\u6837\u53ef\u88ab\u4efb\u610f\u7528\u6237\u89e6\u53d1\u3002\n'
  '  //   \u5747\u4e3a**\u7f3a\u9677\u4fee\u590d**\uff08\u672a\u6388\u6743\u8bbf\u95ee\uff09\uff0c\u975e\u987a\u624b\u6539\u903b\u8f91\uff1b\u6cbf\u7528**\u767d\u540d\u5355\u5f0f**\u767b\u8bb0\uff08\u7cbe\u786e\u5230\u76ee\u5f55\uff09\uff1a\n'
  '  //   by=WorkBuddy / date=2026-10-04 / reason=round215 \u6388\u6743\uff1a\u65e0\u9274\u6743\u4e91\u51fd\u6570\u8865\u6765\u6e90\u6821\u9a8c\uff08\u5b9a\u65f6/\u63a2\u9488\u62d2\u5ba2\u6237\u7aef\u8c03\u7528\uff09\n'
  '  /^cloudfunctions\\/payExpireNotify\\/,\n'
  '  /^cloudfunctions\\/smokeTest\\/,\n'
  '];\n')


def main():
    problems, plans = [], []
    for rel, old, new in EDITS:
        p = os.path.join(ROOT, rel)
        if not os.path.exists(p):
            problems.append('文件不存在：' + rel); continue
        raw = open(p, 'rb').read()
        txt = raw.decode('utf-8')
        eol = '\r\n' if '\r\n' in txt else '\n'
        o = old.replace('\n', eol); n = new.replace('\n', eol)
        cnt = txt.count(o)
        if cnt != 1:
            problems.append('锚点命中 %d 次（须恰为 1）：%s :: %r' % (cnt, rel, old[:70])); continue
        plans.append((p, rel, o, n))
    if problems:
        print('ABORT —— 锚点校验未通过，一个文件都没写：')
        for x in problems: print('  - ' + x)
        return 1

    cache = {}
    for p, rel, o, n in plans:
        txt = cache.get(p)
        if txt is None:
            txt = open(p, 'rb').read().decode('utf-8')
        txt2 = txt.replace(o, n)
        if txt2.count(n) < 1:
            print('ABORT —— 替换后自检失败：' + rel); return 1
        cache[p] = txt2
    for p, txt in cache.items():
        # 🔴 必须先编码再 open：open(p,'wb') 会**立刻截断**文件，若 encode 之后再抛错
        #    （例如 lone surrogate），文件就停在 0 字节 —— R215 实测踩到（verify_all.js 被截断，
        #    靠 git checkout -- 恢复）。顺序错了的代价是**整份文件丢失**，不是"没改成"。
        data = txt.encode('utf-8')
        with open(p, 'wb') as f:
            f.write(data)
    print('OK —— 写入 %d 个文件 / %d 处锚点' % (len(cache), len(plans)))
    for p in sorted(cache): print('  · ' + os.path.relpath(p, ROOT).replace('\\', '/'))
    return 0


sys.exit(main())
