# -*- coding: utf-8 -*-
"""R373：生成 3 款 UI 风格设计板（HTML → 截图）。不改动小程序代码。"""
import io, os, re

OUT = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/design/r373"

PHONE1 = """
<div class="phone">
  <div class="pbar"><span>9:41</span><span class="dots">●●●</span></div>
  <div class="phead">
    <div class="pback">‹</div>
    <div class="ptitle">已有铺面 · 本月测算</div>
    <div class="pmore">⋯</div>
  </div>
  <div class="pscroll">
    <div class="kpi">
      <div class="kpi-l">
        <div class="kpi-cap">保本营业额 / 月</div>
        <div class="kpi-num">¥9,160</div>
      </div>
      <div class="kpi-r">
        <div class="kpi-cap">按实际营业额算</div>
        <div class="kpi-num2">+¥8,400</div>
      </div>
    </div>
    <div class="verdict">结构健康 · 六项指标中 4 项在行业带内</div>

    <div class="secname">指标对照</div>
    <div class="tbl">
      <div class="trow"><span class="tl">房租占比</span><span class="track"><i style="left:46%"></i><b style="left:38%;width:30%"></b></span><span class="tv">18.4%</span></div>
      <div class="trow"><span class="tl">人工占比</span><span class="track"><i style="left:62%"></i><b style="left:52%;width:26%"></b></span><span class="tv hot">23.1%</span></div>
      <div class="trow"><span class="tl">菜品毛利率</span><span class="track"><i style="left:64%"></i><b style="left:58%;width:22%"></b></span><span class="tv">63.0%</span></div>
      <div class="trow"><span class="tl">能耗占比</span><span class="track"><i style="left:34%"></i><b style="left:28%;width:32%"></b></span><span class="tv">3.2%</span></div>
    </div>

    <div class="secname">想月赚 10,000，要怎么做</div>
    <div class="advice">
      <div class="arow"><span class="ak">毛利率做到</span><span class="av">49.5%</span><span class="an">现在 63.0%</span></div>
      <div class="arow"><span class="ak">人工压到</span><span class="av">¥29,300</span><span class="an">现在 ¥20,000</span></div>
      <div class="anote">两项各自单算：做到其中一项就够了，不要同时按最紧的算</div>
    </div>
  </div>
  <div class="pstick">
    <div><span class="sl">保本</span><span class="sv">¥9,160</span></div>
    <div><span class="sl">月赚</span><span class="sv2">+¥8,400</span></div>
    <div class="sgo">明细 ›</div>
  </div>
</div>
"""

PHONE2 = """
<div class="phone">
  <div class="pbar"><span>9:41</span><span class="dots">●●●</span></div>
  <div class="phead">
    <div class="pback">‹</div>
    <div class="ptitle">菜品成本卡 · 编辑</div>
    <div class="pmore">⋯</div>
  </div>
  <div class="pscroll">
    <div class="secname2">基本信息</div>
    <div class="gcard">
      <div class="grow"><span class="gl">菜品名称</span><span class="gv">耙牛肉</span></div>
      <div class="grow"><span class="gl">卡片类型</span><span class="gv">单品</span></div>
      <div class="grow"><span class="gl">菜品分类</span><span class="gv">招牌 / 荤菜</span></div>
    </div>

    <div class="secname2">成本明细</div>
    <div class="gcard">
      <div class="grow"><span class="gl">牛腩（净料）</span><span class="gv">320 g</span></div>
      <div class="grow"><span class="gl">香料包</span><span class="gv">1 份</span></div>
      <div class="grow"><span class="gl">损耗率</span><span class="gv">4%</span></div>
      <div class="grow"><span class="gl">单份成本</span><span class="gv strong">¥12.40</span></div>
    </div>

    <div class="secname2">定价与收益</div>
    <div class="gcard">
      <div class="grow"><span class="gl">建议售价</span><span class="gv">¥38.00</span></div>
      <div class="grow"><span class="gl">活动价</span><span class="gv dim">未设置</span></div>
      <div class="grow"><span class="gl">毛利率</span><span class="gv strong">67.4%</span></div>
    </div>
  </div>
  <div class="pstick">
    <div><span class="sl">成本</span><span class="sv">¥12.40</span></div>
    <div><span class="sl">毛利率</span><span class="sv2">67.4%</span></div>
    <div class="sgo">保存</div>
  </div>
</div>
"""

BASE = """
*{box-sizing:border-box;margin:0;padding:0}
body{background:#fff;font-family:"Microsoft YaHei","PingFang SC",sans-serif;-webkit-font-smoothing:antialiased}
.board{width:1180px;padding:34px 36px 30px;background:%(board_bg)s}
.head{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:24px}
.h1{font-size:30px;font-weight:800;color:%(ink)s;letter-spacing:.5px}
.h2{font-size:14px;color:%(sub)s;margin-top:8px;line-height:1.6;max-width:760px}
.tagline{font-size:12px;letter-spacing:2px;color:%(accent)s;font-weight:700;text-transform:uppercase}
.tokens{display:flex;gap:10px;align-items:center}
.sw{width:26px;height:26px;border-radius:6px;border:1px solid rgba(0,0,0,.08)}
.frames{display:flex;gap:34px;align-items:stretch}
.phone{width:352px;min-height:660px;background:%(phone_bg)s;border-radius:26px;overflow:hidden;
  border:1px solid %(phone_border)s;%(phone_shadow)s;display:flex;flex-direction:column;position:relative}
.pbar{height:26px;display:flex;justify-content:space-between;align-items:center;padding:0 18px;
  font-size:10px;color:%(sub)s}
.dots{letter-spacing:2px;font-size:8px}
.phead{height:44px;display:flex;align-items:center;padding:0 14px;border-bottom:1px solid %(hair)s}
.pback{width:22px;font-size:20px;color:%(ink)s}
.ptitle{flex:1;text-align:center;font-size:15px;font-weight:600;color:%(ink)s}
.pmore{width:22px;text-align:right;color:%(sub)s}
.pscroll{flex:1;min-height:0;padding:14px 14px 8px;overflow:hidden}
.kpi{display:flex;justify-content:space-between;align-items:flex-end;padding:4px 2px 10px}
.kpi-cap{font-size:11px;color:%(sub)s;margin-bottom:4px}
.kpi-num{font-size:34px;font-weight:800;color:%(ink)s;font-variant-numeric:tabular-nums;line-height:1}
.kpi-num2{font-size:22px;font-weight:700;color:%(good)s;font-variant-numeric:tabular-nums}
.verdict{font-size:11px;color:%(sub)s;padding:8px 10px;background:%(chip_bg)s;border-radius:%(r1)s;
  border-left:3px solid %(accent)s;margin-bottom:12px}
.secname{font-size:11px;font-weight:700;color:%(sub)s;letter-spacing:1px;margin:10px 2px 6px}
.secname2{font-size:11px;font-weight:700;color:%(sub)s;letter-spacing:1px;margin:12px 2px 6px}
.tbl{background:%(card_bg)s;border-radius:%(r2)s;border:1px solid %(hair)s;overflow:hidden}
.trow{display:flex;align-items:center;height:38px;padding:0 12px;border-bottom:1px solid %(hair)s}
.trow:last-child{border-bottom:none}
.tl{width:74px;font-size:12px;color:%(ink)s}
.tv{width:52px;text-align:right;font-size:12px;font-weight:700;color:%(ink)s;font-variant-numeric:tabular-nums}
.tv.hot{color:%(warn)s}
.track{flex:1;height:6px;background:%(track_bg)s;border-radius:3px;position:relative;margin:0 10px}
.track b{position:absolute;top:0;height:6px;background:%(band)s;border-radius:3px}
.track i{position:absolute;top:-3px;width:12px;height:12px;border-radius:50%;background:%(ink)s;
  transform:translateX(-6px);border:2px solid #fff}
.advice{background:%(card_bg)s;border:1px solid %(hair)s;border-radius:%(r2)s;padding:10px 12px}
.arow{display:flex;align-items:baseline;height:30px;border-bottom:1px dashed %(hair)s}
.arow:last-of-type{border-bottom:none}
.ak{width:78px;font-size:12px;color:%(sub)s}
.av{width:86px;font-size:16px;font-weight:800;color:%(ink)s;font-variant-numeric:tabular-nums}
.an{font-size:11px;color:%(faint)s}
.anote{font-size:10px;color:%(faint)s;line-height:1.5;margin-top:6px}
.gcard{background:%(card_bg)s;border:1px solid %(hair)s;border-radius:%(r2)s;overflow:hidden}
.grow{display:flex;align-items:center;justify-content:space-between;height:44px;padding:0 12px;
  border-bottom:1px solid %(hair)s}
.grow:last-child{border-bottom:none}
.gl{font-size:13px;color:%(ink)s}
.gv{font-size:13px;color:%(sub)s;font-variant-numeric:tabular-nums}
.gv.strong{font-weight:800;color:%(ink)s;font-size:15px}
.gv.dim{color:%(faint)s}
.pstick{flex:0 0 52px;height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;
  background:%(stick_bg)s;border-top:1px solid %(hair)s}
.sl{font-size:10px;color:%(stick_sub)s;margin-right:6px}
.sv{font-size:16px;font-weight:800;color:%(stick_ink)s;font-variant-numeric:tabular-nums}
.sv2{font-size:16px;font-weight:800;color:%(stick_accent)s;font-variant-numeric:tabular-nums}
.sgo{font-size:11px;color:%(stick_sub)s}
.foot{margin-top:20px;display:flex;gap:26px;font-size:12px;color:%(sub)s}
.foot b{color:%(ink)s}
"""

STYLES = [
    dict(
        key="A_statement", cls="vA", extra='',
        name="A · 对账单风（Statement）",
        concept="把测算页做成一张可核对的经营对账单：白底、发丝线、等宽数字，靠对齐与留白建立秩序，几乎不用色块。",
        board_bg="#FFFFFF", ink="#12263A", sub="#5B6B7C", faint="#93A1B0", accent="#0B6E4F",
        good="#0B6E4F", warn="#B4690E",
        phone_bg="#FFFFFF", phone_border="#DFE5EC", phone_shadow="box-shadow:0 18px 40px rgba(18,38,58,.10)",
        hair="#EDF1F5", card_bg="#FFFFFF", chip_bg="#F7F9FB",
        track_bg="#EEF2F6", band="#CFE3DA",
        stick_bg="#12263A", stick_ink="#FFFFFF", stick_sub="#9FB3C6", stick_accent="#8FD9BD",
        r1="2px", r2="3px",
        tokens=["#12263A", "#0B6E4F", "#EDF1F5", "#B4690E"],
        notes=["零阴影、零渐变：只用 1px 线与 1 种强调色", "所有金额 tabular-nums 右对齐，可逐行核对", "指标带用极浅色段 + 实心点，不抢数字"],
    ),
    dict(
        key="B_dashboard", cls="vB", extra="""
/* ===== B：深色 KPI 主视觉 + 白卡浮起 ===== */
.vB .kpi{background:#0F1C2E;border-radius:12px;padding:14px 16px 12px;margin-bottom:10px;
  box-shadow:0 8px 20px rgba(15,28,46,.18)}
.vB .kpi-cap{color:#9FB3C6;font-size:10px}
.vB .kpi-num{color:#FFFFFF;font-size:32px}
.vB .kpi-num2{color:#5BE3A3}
.vB .verdict{background:#FFFFFF;border-left:none;border-radius:8px;color:#0F1C2E;
  font-weight:600;box-shadow:0 2px 8px rgba(15,28,46,.06);padding:10px 12px}
.vB .secname{color:#1677FF;font-weight:800;letter-spacing:.5px}
.vB .tbl,.vB .advice,.vB .gcard{border:none;box-shadow:0 2px 10px rgba(15,28,46,.07)}
.vB .track b{background:#8FB8FF}
.vB .track i{background:#1677FF;border-color:#fff}
.vB .gv.strong{color:#1677FF}
""",
        name="B · 仪表盘风（Dashboard）",
        concept="把关键结论压进一块深色 KPI 区，下方用浅灰底承载数据卡；指标用「行业带 + 落点」表达，一眼看出偏没偏。",
        board_bg="#F0F2F5", ink="#0F1C2E", sub="#5A6B80", faint="#94A3B8", accent="#1677FF",
        good="#12A150", warn="#D9822B",
        phone_bg="#F5F7FA", phone_border="#DDE3EB", phone_shadow="box-shadow:0 20px 44px rgba(15,28,46,.16)",
        hair="#E8EDF4", card_bg="#FFFFFF", chip_bg="#FFFFFF",
        track_bg="#EDF1F7", band="#BBD6FF",
        stick_bg="#FFFFFF", stick_ink="#0F1C2E", stick_sub="#5A6B80", stick_accent="#1677FF",
        r1="8px", r2="10px",
        tokens=["#0F1C2E", "#1677FF", "#F0F2F5", "#12A150"],
        notes=["深色 KPI 块 = 唯一视觉焦点，其余全部降噪", "卡片圆角 10px、阴影极轻，分区靠底色差", "状态色只给「超带」那一项，全页不超过 1 处"],
    ),
    dict(
        key="C_editorial", cls="vC", extra="""
/* ===== C：编辑排版 —— 超大数字 + 竖色条 + 纸感 ===== */
.vC .kpi{padding:2px 2px 14px;border-bottom:2px solid #1B1B1B;margin-bottom:14px}
.vC .kpi-num{font-family:"Songti SC","SimSun",serif;font-size:46px;letter-spacing:-1px}
.vC .kpi-num2{font-family:"Songti SC","SimSun",serif;font-size:26px}
.vC .kpi-cap{font-size:10px;letter-spacing:1px;color:#A39A8E}
.vC .verdict{background:transparent;border-left:3px solid #B4552D;border-radius:0;
  padding:6px 0 6px 10px;margin-bottom:16px;font-size:11px}
.vC .secname,.vC .secname2{border-left:3px solid #B4552D;padding-left:8px;font-size:12px;
  color:#1B1B1B;font-weight:800;letter-spacing:0;margin:16px 0 8px}
.vC .tbl,.vC .advice,.vC .gcard{border:1px solid #EFE7DA;border-radius:2px;box-shadow:none}
.vC .grow{height:48px}
.vC .gv.strong{font-family:"Songti SC","SimSun",serif;font-size:18px}
.vC .track{background:#F0E9DC}
.vC .track b{background:#F0D9C8;border-radius:0}
.vC .track i{background:#B4552D;border-radius:0;width:3px;height:12px;top:-3px;border:none}
""",
        name="C · 编辑排版风（Editorial）",
        concept="用杂志式层级解决「通篇一个颜色」：米白纸感、超大数字、左侧细色条分段，暖赭色只做点睛，信息依旧可核对。",
        board_bg="#FBF9F5", ink="#1B1B1B", sub="#6B645C", faint="#A39A8E", accent="#B4552D",
        good="#2F6B4F", warn="#B4552D",
        phone_bg="#FFFDF9", phone_border="#E7DFD3", phone_shadow="box-shadow:0 20px 44px rgba(80,60,40,.14)",
        hair="#EFE7DA", card_bg="#FFFFFF", chip_bg="#F6F1E7",
        track_bg="#F0E9DC", band="#F0D9C8",
        stick_bg="#1B1B1B", stick_ink="#FFFFFF", stick_sub="#BDB3A6", stick_accent="#F0B48F",
        r1="3px", r2="4px",
        tokens=["#1B1B1B", "#B4552D", "#FBF9F5", "#2F6B4F"],
        notes=["大号数字 + 小号说明，层级差拉开到 3 倍", "分段用 3px 竖色条，不用整块色带", "暖色只出现在「要你注意」的地方"],
    ),
]

os.makedirs(OUT, exist_ok=True)
for st in STYLES:
    css = re.sub(r'%\((\w+)\)s', lambda m: str(st[m.group(1)]), BASE)
    tokens = "".join('<div class="sw" style="background:%s"></div>' % c for c in st["tokens"])
    notes = "".join("<div>· %s</div>" % n for n in st["notes"])
    html = """<!DOCTYPE html><html><head><meta charset="utf-8"><style>@@CSS@@</style></head><body>
<div class="board @@CLS@@">
  <div class="head">
    <div>
      <div class="tagline">UI DIRECTION @@K@@</div>
      <div class="h1" style="margin-top:6px">@@NAME@@</div>
      <div class="h2">@@CONCEPT@@</div>
    </div>
    <div class="tokens">@@TOKENS@@</div>
  </div>
  <div class="frames">@@P1@@@@P2@@</div>
  <div class="foot">@@NOTES@@</div>
</div></body></html>"""
    for a, b in [('@@CSS@@', css + st['extra']), ('@@CLS@@', st['cls']), ('@@K@@', st['key'][0]), ('@@NAME@@', st['name']),
                 ('@@CONCEPT@@', st['concept']), ('@@TOKENS@@', tokens),
                 ('@@P1@@', PHONE1), ('@@P2@@', PHONE2), ('@@NOTES@@', notes)]:
        html = html.replace(a, b)
    io.open(os.path.join(OUT, st["key"] + ".html"), "w", encoding="utf-8").write(html)
    print("wrote", st["key"])
