# -*- coding: utf-8 -*-
"""R213 六处同步（新增第 136 个套件 + 断言数口径 + A15 登记 + 两处注释错位修正）。"""
import io
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
VA = 'verify_all.js'
KEY = 'specs/dev-specs/\u2605\u77e5\u8bc6\u5b58\u50a8\u70b9_2026-09-10.md'
CASC = 'tools/check_suite_assert_counts.js'
R85 = 'tools/selftest_r85.js'

VA_HEAD = '''//       + 会员权益链路守卫（tools/check_entitlement_flow.js，R213：**收钱的那条线必须有机器判据** ——
//         豆包把「会员权限全流程 e2e」列为 P0 阻塞项，而 R212 对账确认仓内**零权益 e2e**
//         （73 个 check_* + 17 个 selftest_* 无一条覆盖权益链路）。判据 = E-A **实跑**单源 isPaid
//         （0 / null / 过期 / 未来 / 注入 now / 等号边界）+ E-B **实跑**配额判定（20→21 翻转点 /
//         硬上限 / 缺配置必抛）+ E-C 链路在场穷尽（额度真相源 / 写侧拦截 / **到期判定单源不扩散** /
//         续费 / 后台调权 / 查询 / 到期通知 / 前端触发键）+ E-D 自失效护栏。
//         🔴 E-C③ 首跑当场抓到**两处手写「到期判定」扩散**（adminQueryUser 的 tier、payQueryEntitlement
//           的 is_active）—— entitlement.js 注释白纸黑字禁止「在函数体内再写一遍」，此前无守卫
//           ⇒ 本轮接回单源；并连带修 `adminQueryUser/selftest.js` 里**复刻的那一份**（付费语义第二源）。
//         🔒 同轮：给 R113 限流守卫补 **A8「必须真接线」**判据（零件齐全 ≠ 限流生效）、给 R159 付费墙
//           守卫补 **L6-②「穷尽分类」**修「扫描面一空即恒绿」；28 条断言，变异回灌 4/4 全部点名目标断言）
'''

VA_L53 = "51 \u6761\u65ad\u8a00\uff0c\u53d8\u5f02\u56de\u704c 12/12\u5168\u90e8\u70b9\u540d\u76ee\u6807\u65ad\u8a00\uff09"

SE38 = (" \u2192 **136\uff08R213\uff1a\u65b0\u589e `tools/check_entitlement_flow.js`\uff0c"
        "\u4f1a\u5458\u6743\u76ca\u94fe\u8def\u5b88\u536b\uff08\u514d\u8d39\u989d\u5ea6\u9608\u503c / \u5230\u671f / \u7eed\u8d39 / "
        "\u540e\u53f0\u8c03\u6743\u56db\u6bb5\u673a\u5668\u53ef\u5224\uff1a\u5b9e\u8dd1\u751f\u4ea7\u5355\u6e90 isPaid \u4e0e "
        "checkQuota/service\uff09\uff1b\u540c\u8f6e\u628a\u4e24\u5904\u624b\u5199\u300c\u5230\u671f\u5224\u5b9a\u300d\u63a5\u56de\u5355\u6e90\u3001"
        "\u7ed9 R113 \u9650\u6d41\u5b88\u536b\u8865\u300c\u5fc5\u987b\u771f\u63a5\u7ebf\u300d\u5224\u636e A8\u3001"
        "\u7ed9 R159 \u4ed8\u8d39\u5899\u5b88\u536b\u8865\u81ea\u5931\u6548\u62a4\u680f\uff1b28 \u65ad\u8a00\uff0c\u53d8\u5f02\u56de\u704c 4/4\uff09**")

SE853 = (" \u2192 **136\uff08R213\uff1a\u65b0\u589e `tools/check_entitlement_flow.js`\uff0c\u4f1a\u5458\u6743\u76ca\u94fe\u8def\u5b88\u536b\uff1b"
         "\u540c\u8f6e\u7ed9 R113 \u8865 A8 \u63a5\u7ebf\u5224\u636e\u3001\u7ed9 R159 \u8865\u81ea\u5931\u6548\u62a4\u680f\uff0c"
         "\u5e76\u628a\u4e24\u5904\u624b\u5199\u5230\u671f\u5224\u5b9a\u63a5\u56de\u5355\u6e90\uff1b28 \u65ad\u8a00\uff09**")

R85_ADD = r'''  // \u26a0\ufe0f 2026-10-04\uff08round213\uff09**\u5341\u4e94\u6b21\u89e6\u53d1** \u2014\u2014 \u540c\u4e00\u65f6\u673a\u5173\u5361\u7b2c 15 \u6b21\uff1aR213 \u6536\u53e3\u300c\u4ed8\u8d39\u5224\u5b9a\u5355\u6e90\u300d
  //   \uff08\u674e\u8001\u5e08\u300c\u542c\u4f60\u7684\uff0c\u5148\u8c03\u6574\u7ec6\u8282\uff0c\u67e5\u7f3a\u8865\u6f0f\u300d\u6388\u6743\uff09\u3002\u6539\u52a8\u9762 = \u4e24\u5904**\u624b\u5199\u5230\u671f\u5224\u5b9a**\u63a5\u56de\u5355\u6e90
  //   `common/entitlement.js::isPaid`\uff1a\u2460 `adminQueryUser/`\uff08tier \u5224\u5b9a\uff09\u2461 `payQueryEntitlement/`
  //   \uff08is_active \u5224\u5b9a\uff09\u2014\u2014 \u4e24\u5904\u5747\u4e3a entitlement.js \u6ce8\u91ca\u660e\u6587\u7981\u6b62\u7684\u300c\u518d\u5199\u4e00\u904d expireAt > now\u300d\uff0c
  //   \u5c5e**\u7f3a\u9677\u4fee\u590d**\uff08\u4ed8\u8d39\u8bed\u4e49\u53cc\u6e90\uff09\uff0c\u975e\u987a\u624b\u6539\u903b\u8f91\uff1b\u8fde\u5e26\u4fee `adminQueryUser/selftest.js` \u91cc\u590d\u523b\u7684\u90a3\u4e00\u4efd\u3002
  //   \u4ecd\u6309 round103 \u7684**\u767d\u540d\u5355\u5f0f**\u767b\u8bb0\uff08\u7cbe\u786e\u5230\u76ee\u5f55\uff09\uff0c**\u7edd\u4e0d\u653e\u5bbd\u6210 `cloudfunctions/` \u5168\u8c41\u514d**\uff1a
  //   by=WorkBuddy / date=2026-10-04 / reason=round213 \u6388\u6743\u4ed8\u8d39\u5224\u5b9a\u5355\u6e90\u6536\u53e3\uff08\u4e24\u5904\u624b\u5199\u5224\u5b9a\u63a5\u56de isPaid\uff09
  /^cloudfunctions\/adminQueryUser\//,
  /^cloudfunctions\/payQueryEntitlement\//,
'''


NLS = {}


def read(rel):
    with io.open(os.path.join(ROOT, rel), 'r', encoding='utf-8', newline='') as f:
        raw = f.read()
    NLS[rel] = '\r\n' if '\r\n' in raw else '\n'
    return raw.replace('\r\n', '\n')     # 统一归一化后再匹配锚点（本仓多数文件是 CRLF）


def write(rel, text):
    nl = NLS.get(rel, '\n')
    if nl != '\n':
        text = text.replace('\n', nl)
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8', newline='') as f:
        f.write(text)


def sub1(text, old, new, tag):
    c = text.count(old)
    if c != 1:
        raise SystemExit('ABORT: %s anchor hit %d (expect 1) :: %r' % (tag, c, old[:60]))
    return text.replace(old, new)


def main():
    out = {}

    # ---------- 1) verify_all.js ----------
    va = read(VA)
    va = sub1(va, '// \u4e32\u8054\uff1a135 \u4e2a\u5957\u4ef6', '// \u4e32\u8054\uff1a136 \u4e2a\u5957\u4ef6', 'VA-head')
    va = sub1(va, "  ['shop-reset',           'tools/check_shop_reset.js'],\n];",
              "  ['shop-reset',           'tools/check_shop_reset.js'],\n"
              "  ['entitlement-flow',     'tools/check_entitlement_flow.js'],\n];", 'VA-suites')
    va = sub1(va, "//         51 \u6761\u65ad\u8a00\uff0c\u53d8\u5f02\u56de\u704c 12/12 \u5168\u90e8\u70b9\u540d\u76ee\u6807\u65ad\u8a00\uff09\n",
              "//         51 \u6761\u65ad\u8a00\uff0c\u53d8\u5f02\u56de\u704c 12/12 \u5168\u90e8\u70b9\u540d\u76ee\u6807\u65ad\u8a00\uff09\n" + VA_HEAD, 'VA-notes')
    out[VA] = va

    # ---------- 2) 重启键（按行号，先校验特征） ----------
    raw = read(KEY)
    lines = raw.split('\n')
    assert '\u4e32 **135** \u4e2a\u5957\u4ef6' in lines[37], 'L38 特征不匹配'
    assert '\u5957\u4ef6\u65ad\u8a00\u6570\u53e3\u5f84\uff08\u552f\u4e00\u58f0\u660e\u5904\uff09' in lines[43], 'L44 特征不匹配'
    assert '\u5957\u4ef6\u6570\u4f1a\u6f02' in lines[852], 'L853 特征不匹配'
    lines[37] = lines[37].replace('\u4e32 **135** \u4e2a\u5957\u4ef6', '\u4e32 **136** \u4e2a\u5957\u4ef6') + SE38
    lines[43] = sub1(lines[43], '`check_paywall_coverage`=13', '`check_paywall_coverage`=17', 'KEY-decl-paywall')
    lines[43] = sub1(lines[43], '`check_shop_reset`=52\uff08**\u56db\u5341\u516b\u8005**',
                     '`check_shop_reset`=52 / `check_entitlement_flow`=28\uff08**\u56db\u5341\u4e5d\u8005**', 'KEY-decl-add')
    lines[852] = lines[852].replace('\uff08\u73b0 **135**\uff1b', '\uff08\u73b0 **136**\uff1b') + SE853
    out[KEY] = '\n'.join(lines)

    # ---------- 3) check_suite_assert_counts.js ----------
    cas = read(CASC)
    cas = sub1(cas, "// 13 \u6761\uff08R159\uff1aL1 \u4e09\u5355\u6e90\u89e3\u6790 + L2 \u80fd\u529b\u2286\u653e\u884c + L3 \u653e\u884c\u6709\u6587\u6848 + L4 \u56db\u5b57\u6bb5\u975e\u7a7a + L5 \u5f71\u5b50\u6b63\u8d1f + L6 \u4e91\u51fd\u6570\u53cc\u5411 + L7 \u81ea\u5931\u6548\u62a4\u680f\uff09",
              "// 17 \u6761\uff08R159\uff1aL1 \u4e09\u5355\u6e90\u89e3\u6790 + L2 \u80fd\u529b\u2286\u653e\u884c + L3 \u653e\u884c\u6709\u6587\u6848 + L4 \u56db\u5b57\u6bb5\u975e\u7a7a + L5 \u5f71\u5b50\u6b63\u8d1f + L6 \u4e91\u51fd\u6570\u53cc\u5411 + L7 \u81ea\u5931\u6548\u62a4\u680f\uff1bR213 \u4fee\u5047\u7eff\uff1aL6-\u2461 \u6539\u300c\u7a77\u5c3d\u5206\u7c7b\u300d+4 \u6761\uff09", 'CASC-paywall')
    cas = sub1(cas, "  { key: 'check_month_picker', rel: 'tools/check_month_picker.js' },\n"
                    "  { key: 'check_shop_reset', rel: 'tools/check_shop_reset.js' }, // 18 \u6761\uff08R209\uff1aS \u62a4\u680f 4 / A handler \u5b9e\u8dd1 5 / B \u540e\u7aef\u5b9e\u8dd1 4 / C \u5168\u4ed3\u56de\u5f52 3 / D UI \u4e00\u81f4 2\uff09\n",
              "  { key: 'check_month_picker', rel: 'tools/check_month_picker.js' }, // 18 \u6761\uff08R209\uff1aS \u62a4\u680f 4 / A handler \u5b9e\u8dd1 5 / B \u540e\u7aef\u5b9e\u8dd1 4 / C \u5168\u4ed3\u56de\u5f52 3 / D UI \u4e00\u81f4 2\uff09\n"
              "  { key: 'check_shop_reset', rel: 'tools/check_shop_reset.js' }, // 52 \u6761\uff08R210\uff1aS \u62a4\u680f / A \u5b9e\u8dd1 decideReset / B \u5b9e\u8dd1 validateInput / C \u8303\u56f4\u6070\u4e09\u8868\u4e0d\u542b\u8d44\u4ea7 / D \u524d\u7aef\u4e09\u6309\u94ae / E \u6587\u6848\u91cf\u7ea7 / F \u5199\u5e93\u7eaa\u5f8b\uff09\n"
              "  { key: 'check_entitlement_flow', rel: 'tools/check_entitlement_flow.js' }, // 28 \u6761\uff08R213\uff1aE-A \u5b9e\u8dd1\u5355\u6e90 9 / E-B \u5b9e\u8dd1\u914d\u989d 7 / E-C \u94fe\u8def\u5728\u573a 9 / E-D \u62a4\u680f 3\uff09\n", 'CASC-cases')
    out[CASC] = cas

    # ---------- 4) selftest_r85.js A15 白名单 ----------
    r85 = read(R85)
    r85 = sub1(r85, "  /^cloudfunctions\\/[^/]+\\/cx_auth\\.js$/,\n];",
               "  /^cloudfunctions\\/[^/]+\\/cx_auth\\.js$/,\n" + R85_ADD + "];", 'R85-a15')
    out[R85] = r85

    for rel, text in out.items():
        write(rel, text)
        print('WROTE: %s' % rel)
    print('ALL OK')
    return 0


if __name__ == '__main__':
    sys.exit(main())
