# -*- coding: utf-8 -*-
"""店算 · 小店决策对比表（小面样例）
输入假设 -> 计算区 -> 结果矩阵，三区分离；全部派生量走 Excel 公式，不写死。
"""
try:
    import openpyxl
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", "openpyxl>=3.1.0"])
    import openpyxl

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter


def xl_color(css_hex: str) -> str:
    value = css_hex.removeprefix("#").upper()
    if len(value) != 6:
        raise ValueError(f"Expected #RRGGBB, got: {css_hex}")
    return "FF" + value


XL_HEAD_BG = xl_color("#4472C4")
XL_HEAD_FG = xl_color("#FFFFFF")
XL_INPUT_BG = xl_color("#D9E2F3")
XL_CALC_BG = xl_color("#F2F2F2")
XL_SUM_BG = xl_color("#2F5597")
XL_SEC_FG = xl_color("#2F5597")
XL_WARN_BG = xl_color("#FFF2CC")
XL_BORDER = xl_color("#BFBFBF")

thin = Side(style="thin", color=XL_BORDER)
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)

F_TITLE = Font(name="微软雅黑", size=15, bold=True, color=XL_HEAD_FG)
F_SEC = Font(name="微软雅黑", size=11.5, bold=True, color=XL_SEC_FG)
F_HEAD = Font(name="微软雅黑", size=10, bold=True, color=XL_HEAD_FG)
F_BODY = Font(name="微软雅黑", size=10)
F_BOLD = Font(name="微软雅黑", size=10, bold=True)
F_NOTE = Font(name="微软雅黑", size=9, color="FF595959")
F_WARN = Font(name="微软雅黑", size=9.5, color="FF833C00")

CEN = Alignment(horizontal="center", vertical="center", wrap_text=True)
LEFT = Alignment(horizontal="left", vertical="center", wrap_text=True)
RIGHT = Alignment(horizontal="right", vertical="center")

FMT_MONEY = "#,##0"
FMT_MONEY2 = "#,##0.00"
FMT_PCT = "0%"
FMT_INT = "0"

wb = Workbook()

# ============================================================
# Sheet 1  客户版 · 决策对比表
# ============================================================
s1 = wb.active
s1.title = "客户版·决策对比表"

s1.merge_cells("A1:H1")
s1["A1"] = "店算 · 小店决策对比表（示例：小面 · 30㎡）"
s1["A1"].font = F_TITLE
s1["A1"].fill = PatternFill("solid", fgColor=XL_HEAD_BG)
s1["A1"].alignment = CEN
s1.row_dimensions[1].height = 30

s1.merge_cells("A2:H2")
s1["A2"] = "一眼看懂版：不同房租下，每天要做到多少营业额。参数由店算按业态自动预置，客户不需要填任何专业指标。"
s1["A2"].font = F_NOTE
s1["A2"].alignment = LEFT

# ---- 假设区（输入，浅底，无公式，边际贡献率除外） ----
s1.merge_cells("A4:H4")
s1["A4"] = "一、本次测算使用的行业预置参数（改这里，全表自动重算）"
s1["A4"].font = F_SEC

head1 = ["业态", "菜品毛利率", "水电燃气", "管理费", "杂支损耗", "人工单价(元/人·月)", "月营业天数"]
ASSET_ROW = 5
for i, h in enumerate(head1, start=1):
    c = s1.cell(row=ASSET_ROW, column=i, value=h)
    c.font = F_HEAD; c.fill = PatternFill("solid", fgColor=XL_HEAD_BG); c.alignment = CEN; c.border = BOX

AR = 6  # 参数值行
s1.cell(row=AR, column=1, value="小面（快餐）").font = F_BODY
for col, val in ((2, 0.60), (3, 0.03), (4, 0.08), (5, 0.02)):
    c = s1.cell(row=AR, column=col, value=val)
    c.font = F_BODY; c.number_format = FMT_PCT; c.fill = PatternFill("solid", fgColor=XL_INPUT_BG)
c = s1.cell(row=AR, column=6, value=4500); c.font = F_BODY; c.number_format = FMT_MONEY; c.fill = PatternFill("solid", fgColor=XL_INPUT_BG)
c = s1.cell(row=AR, column=7, value=30); c.font = F_BODY; c.number_format = FMT_INT; c.fill = PatternFill("solid", fgColor=XL_INPUT_BG)
for col in range(1, 8):
    s1.cell(row=AR, column=col).border = BOX
    s1.cell(row=AR, column=col).alignment = CEN

# 派生：边际贡献率 + 客单价（放 H/I 两列，避免与主表串列）
s1["H5"] = "边际贡献率"; s1["H5"].font = F_HEAD; s1["H5"].fill = PatternFill("solid", fgColor=XL_HEAD_BG); s1["H5"].alignment = CEN; s1["H5"].border = BOX
s1["I5"] = "客单价(元)"; s1["I5"].font = F_HEAD; s1["I5"].fill = PatternFill("solid", fgColor=XL_HEAD_BG); s1["I5"].alignment = CEN; s1["I5"].border = BOX
s1["H6"] = f"=1-(1-B{AR})-C{AR}-D{AR}-E{AR}"
s1["H6"].font = F_BOLD; s1["H6"].number_format = FMT_PCT; s1["H6"].fill = PatternFill("solid", fgColor=XL_CALC_BG); s1["H6"].alignment = CEN; s1["H6"].border = BOX
s1["I6"] = 12; s1["I6"].font = F_BODY; s1["I6"].number_format = FMT_MONEY; s1["I6"].fill = PatternFill("solid", fgColor=XL_INPUT_BG); s1["I6"].alignment = CEN; s1["I6"].border = BOX
s1["J6"] = ("边际贡献率 = 1 − 食材成本率 − 水电燃气 − 管理费 − 杂支损耗；食材成本率 = 1 − 菜品毛利率（内部量，不对外展示）。最右一列「日碗数」为单品业态（小面/米粉等）专属，其他业态请忽略该列。")
s1["J6"].font = F_NOTE; s1["J6"].alignment = LEFT

# ---- 主矩阵：行=房租，列=盈利目标 ----
s1.merge_cells("A8:H8")
s1["A8"] = "二、已有铺面测算：每天要做到多少营业额（元 / 天）"
s1["A8"].font = F_SEC

M_HEAD = 9
head2 = ["月租金(元)", "员工人数(人)", "月固定成本(元)", "保本·日营业额(元)",
         "月赚1万·日营业额(元)", "月赚1.5万·日营业额(元)", "保本·月营业额(元)",
         "保本·日碗数(碗)〔可选〕"]
for i, h in enumerate(head2, start=1):
    c = s1.cell(row=M_HEAD, column=i, value=h)
    c.font = F_HEAD; c.fill = PatternFill("solid", fgColor=XL_HEAD_BG); c.alignment = CEN; c.border = BOX
s1.row_dimensions[M_HEAD].height = 30

rents = [3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000]
r = M_HEAD + 1
for people in (2, 3):
    for rent in rents:
        s1.cell(row=r, column=1, value=rent).number_format = FMT_MONEY
        s1.cell(row=r, column=2, value=people).number_format = FMT_INT
        s1.cell(row=r, column=3, value=f"=A{r}+B{r}*$F${AR}").number_format = FMT_MONEY
        s1.cell(row=r, column=4, value=f"=ROUND((C{r}+0)/$H${AR}/$G${AR},0)").number_format = FMT_MONEY
        s1.cell(row=r, column=5, value=f"=ROUND((C{r}+10000)/$H${AR}/$G${AR},0)").number_format = FMT_MONEY
        s1.cell(row=r, column=6, value=f"=ROUND((C{r}+15000)/$H${AR}/$G${AR},0)").number_format = FMT_MONEY
        s1.cell(row=r, column=7, value=f"=ROUND(C{r}/$H${AR},0)").number_format = FMT_MONEY
        s1.cell(row=r, column=8, value=f"=ROUNDUP((C{r}/$H${AR})/$I${AR}/$G${AR},0)").number_format = FMT_INT
        for col in range(1, 9):
            cc = s1.cell(row=r, column=col)
            cc.font = F_BOLD if col >= 4 else F_BODY
            cc.alignment = CEN
            cc.border = BOX
            if col == 3:
                cc.fill = PatternFill("solid", fgColor=XL_CALC_BG)
        r += 1
M_LAST = r - 1

# ---- 风险提示 ----
warn_row = M_LAST + 2
s1.merge_cells(start_row=warn_row, start_column=1, end_row=warn_row + 1, end_column=8)
s1.cell(row=warn_row, column=1,
        value=("⚠️ 测算仅供决策参考：以上结果基于【小面·快餐】行业通用参数估算，实际经营受选址、客流、管理水平影响会有较大偏差。"
               "若你的门店成本结构与行业默认差异较大，请修改上表参数后重新测算。")).font = F_WARN
s1.cell(row=warn_row, column=1).fill = PatternFill("solid", fgColor=XL_WARN_BG)
s1.cell(row=warn_row, column=1).alignment = LEFT

widths1 = {"A": 13, "B": 12, "C": 15, "D": 19, "E": 21, "F": 22, "G": 17, "H": 20, "I": 12}
for k, v in widths1.items():
    s1.column_dimensions[k].width = v
s1.column_dimensions["J"].width = 46

# ============================================================
# Sheet 4  业态参数包（配置）
# ============================================================
s2 = wb.create_sheet("业态参数包")
s2.merge_cells("A1:G1")
s2["A1"] = "店算 · 业态参数包（行业预置，单源）"
s2["A1"].font = F_TITLE
s2["A1"].fill = PatternFill("solid", fgColor=XL_HEAD_BG)
s2["A1"].alignment = CEN
s2.row_dimensions[1].height = 28

s2.merge_cells("A2:G2")
s2["A2"] = "核心纪律：每个业态整套参数独立配置，禁止只改食材率、其余沿用别业态模板。"
s2["A2"].font = F_NOTE; s2["A2"].alignment = LEFT

h4 = ["参数项", "单位", "小面（快餐）", "火锅", "新式奶茶", "烧烤", "取值依据 / 来源"]
for i, h in enumerate(h4, start=1):
    c = s2.cell(row=4, column=i, value=h)
    c.font = F_HEAD; c.fill = PatternFill("solid", fgColor=XL_HEAD_BG); c.alignment = CEN; c.border = BOX
s2.row_dimensions[4].height = 26

P_START = 5
rows2 = [
    ("菜品毛利率", "%", 0.60, 0.55, 0.68, 0.58, "%", "仓内行业参考带 58~68 / 52~67 / 62~72 / 55~65；取带内偏保守值"),
    ("水电燃气", "%", 0.03, 0.05, 0.02, 0.04, "%", "参考带 2~4 / 4~6 / 1~3 / 3~5。⚠️ 外部口径称火锅 8~12%，与仓内单源冲突，待核"),
    ("管理费", "%", 0.08, 0.08, 0.08, 0.08, "%", "参考带 5~10；四业态暂取中值 8%"),
    ("杂支损耗", "%", 0.02, 0.03, 0.02, 0.04, "%", "小面沿用客户原表 2%；其余为我方自定值，待样本校准"),
    ("人工单价", "元/人·月", 4500, 5000, 4500, 4800, "money", "小面沿用客户原表 4500。⚠️ 其余为自定值，随城市层级系数联动，待校准"),
    ("月营业天数", "天", 30, 27, 30, 26, "int", "快餐/奶茶多为 30 天；火锅月休 4~6 天；烧烤夜宵市场天数偏少"),
    ("客单价", "元", 12, 85, 15, 60, "money", "小面沿用客户原表 12。⚠️ 其余为自定值，待校准"),
]
for i, (name, unit, a, b, c_, d, kind, src) in enumerate(rows2):
    rr = P_START + i
    s2.cell(row=rr, column=1, value=name).font = F_BODY
    s2.cell(row=rr, column=2, value=unit).font = F_BODY
    for j, v in enumerate((a, b, c_, d)):
        cc = s2.cell(row=rr, column=3 + j, value=v)
        cc.font = F_BODY; cc.fill = PatternFill("solid", fgColor=XL_INPUT_BG)
        cc.number_format = FMT_PCT if kind == "%" else (FMT_MONEY if kind == "money" else FMT_INT)
    s2.cell(row=rr, column=7, value=src).font = F_NOTE
    for col in range(1, 8):
        s2.cell(row=rr, column=col).border = BOX
        s2.cell(row=rr, column=col).alignment = CEN if col != 7 else LEFT

P_DERIV = P_START + len(rows2)
s2.cell(row=P_DERIV, column=1, value="边际贡献率").font = F_BOLD
s2.cell(row=P_DERIV, column=2, value="%").font = F_BODY
for j in range(4):
    col = 3 + j
    cc = s2.cell(row=P_DERIV, column=col,
                 value=f"=1-(1-{get_column_letter(col)}{P_START})-{get_column_letter(col)}{P_START+1}-{get_column_letter(col)}{P_START+2}-{get_column_letter(col)}{P_START+3}")
    cc.font = F_BOLD; cc.number_format = FMT_PCT
    cc.fill = PatternFill("solid", fgColor=XL_CALC_BG)
s2.cell(row=P_DERIV, column=7, value="边际贡献率 = 1 − 食材成本率 − 水电燃气 − 管理费 − 杂支损耗（由左侧参数自动算出）").font = F_NOTE
for col in range(1, 8):
    s2.cell(row=P_DERIV, column=col).border = BOX
    s2.cell(row=P_DERIV, column=col).alignment = CEN if col != 7 else LEFT

note_row = P_DERIV + 2
s2.merge_cells(start_row=note_row, start_column=1, end_row=note_row + 2, end_column=7)
s2.cell(row=note_row, column=1,
        value=("口径说明：① 本表把水电燃气、管理费、杂支损耗按「随营业额变动的费率」处理，"
               "与客户原《小面测算》一致，小白无需估算金额；② 店算主引擎的固定成本科目仍支持按金额录入，"
               "两套口径由「入参变换」切换，引擎本身无需改动；③ 标 ⚠️ 的取值为待校准项，"
               "落地前需用真实门店样本回归。")).font = F_NOTE
s2.cell(row=note_row, column=1).alignment = LEFT

for k, v in {"A": 14, "B": 12, "C": 14, "D": 12, "E": 14, "F": 12, "G": 62}.items():
    s2.column_dimensions[k].width = v

# ============================================================
# Sheet 3  多业态对照
# ============================================================
s3 = wb.create_sheet("多业态对照")
s3.merge_cells("A1:H1")
s3["A1"] = "多业态对照：同一家店，换个业态，门槛差多少"
s3["A1"].font = F_TITLE; s3["A1"].fill = PatternFill("solid", fgColor=XL_HEAD_BG); s3["A1"].alignment = CEN
s3.row_dimensions[1].height = 28
s3.merge_cells("A2:H2")
s3["A2"] = "统一条件：面积 30㎡ ｜ 月租金 5,000 元 ｜ 员工 2 人 ｜ 目标：月净赚 1 万元"
s3["A2"].font = F_NOTE; s3["A2"].alignment = LEFT

h3 = ["业态", "月人工(元)", "月固定成本(元)", "边际贡献率", "保本·日营业额(元)",
      "月赚1万·日营业额(元)", "月赚1万·月营业额(元)", "说明"]
for i, h in enumerate(h3, start=1):
    c = s3.cell(row=4, column=i, value=h)
    c.font = F_HEAD; c.fill = PatternFill("solid", fgColor=XL_HEAD_BG); c.alignment = CEN; c.border = BOX
s3.row_dimensions[4].height = 30

biz = [
    ("小面（快餐）", "C", "客单价低、翻台快；门槛靠日均客流撑"),
    ("火锅", "D", "水电燃气高、月休多，保本线被显著抬高"),
    ("新式奶茶", "E", "食材占比低，保本线最低；但房租承受力弱"),
    ("烧烤", "F", "损耗高、营业天数少，同样利润需更高日流水"),
]
for i, (nm, colL, desc) in enumerate(biz):
    rr = 5 + i
    s3.cell(row=rr, column=1, value=nm).font = F_BODY
    s3.cell(row=rr, column=2, value=f"=2*业态参数包!{colL}9").number_format = FMT_MONEY
    s3.cell(row=rr, column=3, value=f"=5000+B{rr}").number_format = FMT_MONEY
    s3.cell(row=rr, column=4, value=f"=业态参数包!{colL}12").number_format = FMT_PCT
    s3.cell(row=rr, column=5, value=f"=ROUND(C{rr}/D{rr}/业态参数包!{colL}10,0)").number_format = FMT_MONEY
    s3.cell(row=rr, column=6, value=f"=ROUND((C{rr}+10000)/D{rr}/业态参数包!{colL}10,0)").number_format = FMT_MONEY
    s3.cell(row=rr, column=7, value=f"=ROUND((C{rr}+10000)/D{rr},0)").number_format = FMT_MONEY
    s3.cell(row=rr, column=8, value=desc).font = F_NOTE
    for c_ in range(1, 9):
        cc = s3.cell(row=rr, column=c_)
        cc.border = BOX
        cc.font = F_BOLD if 4 <= c_ <= 7 else F_BODY
        cc.alignment = LEFT if c_ == 8 else CEN
        if c_ == 4:
            cc.fill = PatternFill("solid", fgColor=XL_CALC_BG)

s3.merge_cells("A11:H11")
s3["A11"] = "结论：同一「30㎡ / 租金 5000 / 2 人 / 月赚 1 万」条件下，四个业态的日营业额门槛可相差约一倍 —— 参数包必须整套独立，不能只换食材率。"
s3["A11"].font = F_WARN; s3["A11"].fill = PatternFill("solid", fgColor=XL_WARN_BG); s3["A11"].alignment = LEFT

for k, v in {"A": 13, "B": 12, "C": 15, "D": 12, "E": 18, "F": 21, "G": 21, "H": 42}.items():
    s3.column_dimensions[k].width = v

# ============================================================
# Sheet 4  复现 · 原小面表校验
# ============================================================
s4 = wb.create_sheet("复现·原小面表校验")
s4.merge_cells("A1:K1")
s4["A1"] = "复现校验：原《小面测算.xlsx》口径逐行复算（贡献率 43%）"
s4["A1"].font = F_TITLE; s4["A1"].fill = PatternFill("solid", fgColor=XL_HEAD_BG); s4["A1"].alignment = CEN
s4.row_dimensions[1].height = 28
s4.merge_cells("A2:K2")
s4["A2"] = "原表口径：月人工 = 人数×4500 ｜ 固定成本 = 房租+人工 ｜ 贡献率 = 1−45%食材−5%水电−5%管理−2%杂支 = 43% ｜ 月营业额 =（固定成本+目标净利）÷43% ｜ 日碗数 = 向上取整(月营业额÷12÷30)"
s4["A2"].font = F_NOTE; s4["A2"].alignment = LEFT

h5 = ["月租金(元)", "人数(人)", "月人工(元)", "月固定成本(元)", "目标", "目标净利(元)",
      "原表月营业额", "复算月营业额", "差额", "原表日碗数", "复算日碗数"]
for i, h in enumerate(h5, start=1):
    c = s4.cell(row=4, column=i, value=h)
    c.font = F_HEAD; c.fill = PatternFill("solid", fgColor=XL_HEAD_BG); c.alignment = CEN; c.border = BOX
s4.row_dimensions[4].height = 28

orig = {
    (3000, 2): (27907, 51163, 62791, 78, 143, 175),
    (3000, 3): (38372, 61628, 73256, 107, 172, 204),
    (4000, 2): (30233, 53488, 65116, 84, 149, 181),
    (4000, 3): (40698, 63953, 75581, 114, 178, 210),
    (5000, 2): (32558, 55814, 67442, 91, 156, 188),
    (5000, 3): (43023, 66279, 77907, 120, 185, 217),
    (6000, 2): (34884, 58140, 69767, 97, 162, 194),
    (6000, 3): (45349, 68605, 80233, 126, 191, 223),
    (7000, 2): (37209, 60465, 72093, 104, 168, 201),
    (7000, 3): (47674, 70930, 82558, 133, 198, 230),
    (8000, 2): (39535, 62791, 74419, 110, 175, 207),
    (8000, 3): (50000, 73256, 84884, 139, 204, 236),
    (9000, 2): (41860, 65116, 76744, 117, 181, 214),
    (9000, 3): (52326, 75581, 87209, 146, 210, 243),
    (10000, 2): (44186, 67442, 79070, 123, 188, 220),
    (10000, 3): (54651, 77907, 89535, 152, 217, 249),
}
targets = [("保本", 0, 0), ("盈利1万", 10000, 1), ("盈利1.5万", 15000, 2)]

r = 5
for (rent, people), vals in orig.items():
    for label, profit, idx in targets:
        s4.cell(row=r, column=1, value=rent).number_format = FMT_MONEY
        s4.cell(row=r, column=2, value=people).number_format = FMT_INT
        s4.cell(row=r, column=3, value=f"=B{r}*4500").number_format = FMT_MONEY
        s4.cell(row=r, column=4, value=f"=A{r}+C{r}").number_format = FMT_MONEY
        s4.cell(row=r, column=5, value=label)
        s4.cell(row=r, column=6, value=profit).number_format = FMT_MONEY
        s4.cell(row=r, column=7, value=vals[idx]).number_format = FMT_MONEY
        s4.cell(row=r, column=8, value=f"=ROUND((D{r}+F{r})/0.43,0)").number_format = FMT_MONEY
        s4.cell(row=r, column=9, value=f"=H{r}-G{r}").number_format = FMT_MONEY
        s4.cell(row=r, column=10, value=vals[3 + idx]).number_format = FMT_INT
        s4.cell(row=r, column=11, value=f"=ROUNDUP(H{r}/12/30,0)").number_format = FMT_INT
        for c_ in range(1, 12):
            cc = s4.cell(row=r, column=c_)
            cc.font = F_BODY; cc.alignment = CEN; cc.border = BOX
            if c_ == 8:
                cc.fill = PatternFill("solid", fgColor=XL_CALC_BG)
        r += 1
S4_LAST = r - 1

s4.merge_cells(start_row=S4_LAST + 2, start_column=1, end_row=S4_LAST + 6, end_column=11)
s4.cell(row=S4_LAST + 2, column=1,
        value=("对上结论（逐格机器复核）：\n"
               "① 「差额」列应全为 0 —— 说明复算口径与原表逐行一致，模型可被完整复现。\n"
               "② 原表 A 列面积 20/30/40㎡ 三档，除面积列外其余 14 列 48 行数据逐格完全相同 ⇒ 面积对该表结果零影响。"
               "本方案把面积改为「合理性校验 + 坪效输出」，不再参与保本公式（中小餐饮面积确实不直接改变保本营业额）。\n"
               "③ 原表全表 0 条公式、参数写死在数值里 ⇒ 换业态必须整表重做。本方案改为参数包 + 全公式联动。")).font = F_NOTE
s4.cell(row=S4_LAST + 2, column=1).alignment = LEFT

for k, v in {"A": 12, "B": 10, "C": 12, "D": 15, "E": 11, "F": 13, "G": 15, "H": 15, "I": 9, "J": 12, "K": 12}.items():
    s4.column_dimensions[k].width = v
s4.freeze_panes = "A5"

wb.properties.title = "店算 · 小店决策对比表（小面样例）"
OUT = r"C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/输出_店算_小店决策对比表_小面样例.xlsx"
wb.save(OUT)
print("saved ->", OUT)
