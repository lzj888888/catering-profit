# -*- coding: utf-8 -*-
"""R305：把 4 个待决问题拆成 4 个短问，逐个调豆包（桥脚本 timeout=300 写死，长稿会超时）。"""
import io, os, subprocess, sys, time

DIR = os.path.join(os.path.dirname(__file__))
BRIDGE = r"C:/Users/lzj/.workbuddy/skills/doubao-bridge/doubao_bridge.py"
EP = "ep-20261011210929-mgqd6"
SYS = "你是餐饮财务审计与产品口径顾问。回答要短、要具体、敢指出对方判断的错。每条不超过 180 字。"

QS = [
    ("q1", """我是餐饮小程序开发方。有一份审计汇总写着「M1 面 B2~B9（8 条）未复核」，其中 B2/B5 已回源码验证是误报；剩 6 条（B3/B4/B6/B7/B8/B9）要求逐条回源码验证，但**这 6 条的正文在仓库任何文件里都找不到**（只在当初审计对话里，未落盘）。
我的处置：判「卡在源头、无源可核」，不猜不编，等用户补描述。
请判断：这样对吗？还是我自己重新独立审一遍 M1 面更靠谱？请给推荐并说明理由（注意：我担心自审会重复劳动或凑数）。"""),

    ("q2", """我的小程序 M3 有个付费点，卖点文案现在挂在「单品毛利复盘」上。我新加了一个**免费**区块「外卖到手账」：用已录入数据反算外卖营收 / 平台扣费 / 到手金额 / 到手率 / 单均到手。老板每天在平台 App 上看的就是"回款"这一级。
顾虑：把付费话术从「单品毛利」迁到「到手账」上，卖点更软；但把免费的东西当卖点又显得没货。
请判断：话术该挂哪？怎么措辞不算虚标？给一句可直接用的文案。"""),

    ("q3", """我要做「导入表 vs 账本」的二级校验：拿平台商品销量表的销售额，去对我账本里该月该平台的外卖营收，对不上就提示。
但口径不同：我的账本里外卖营收 = 商品总价 + 打包费 + 商家承担补贴（三项相加）；而平台导出的商品销量表通常**只有商品销售额**（无打包费、无补贴）。
请给可落地的差额规则：阈值怎么定才不会变成假红噪声源？（例如"差额落在 [0, 打包费+补贴] 内即算对得上"？还是干脆不比？）"""),

    ("q4", """场景：老板导进来一张平台商品销量表，可能要算单品毛利榜。风险是表不准 ⇒ 产出一个"看起来很确定"的错榜。
选项 A 只提示（现状）；B 对不上就**不出榜**（红叉+去核对）；C 出榜但带"不确定"标记。
顾虑：B 会让老板"今天什么也看不到"可能弃用；A 则让错表静默产出。
请给推荐项 + 「什么算对不上」的具体触发条件（要可判的数字规则）。"""),
]

sys.path.insert(0, DIR)
for name, q in QS:
    pf = os.path.join(DIR, "_%s.md" % name)
    of = os.path.join(DIR, "_%s_reply.md" % name)
    io.open(pf, "w", encoding="utf-8").write(q)
    if os.path.exists(of):
        os.remove(of)
    print("=== %s 开始 ===" % name, flush=True)
    try:
        r = subprocess.run(
            [sys.executable, BRIDGE, "--file", pf, "--endpoint", EP,
             "--system", SYS, "--out", of],
            capture_output=True, timeout=420)
        print("  rc=%d" % r.returncode, flush=True)
        if r.returncode != 0:
            print("  stderr:", (r.stderr or b'').decode('utf-8', 'replace')[-300:], flush=True)
    except subprocess.TimeoutExpired:
        print("  超时(本地 420s)", flush=True)
    time.sleep(2)
print("=== 全部结束 ===", flush=True)
