# -*- coding: utf-8 -*-
# R247：重启键三处同步（§1.1 一键校验入口行 / 套件数会漂行 / 断言数声明行）
# 两阶段：所有锚点断言命中数符合预期才落盘，否则一个字节都不写。
import sys

P = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/specs/dev-specs/★知识存储点_2026-09-10.md'
raw = open(P, 'rb').read()
nl = '\r\n' if b'\r\n' in raw else '\n'
lines = raw.decode('utf-8').replace('\r\n', '\n').split('\n')
orig = list(lines)

# ---------- 第 4 处：一键校验入口行（153 → 154 + 追加 R247 说明） ----------
hit4 = [i for i, l in enumerate(lines) if '串 **153** 个套件' in l]
assert len(hit4) == 1, ('hit4', hit4)
ADD38 = (' + **R247 形态 C 平台 picker 一致性守卫 `tools/check_picker_platform.js`'
         '（形态 C 平台由用户手选，picker 的 value 与云端 `SALES_SCHEMA.platform.enum`、'
         '术语单源 `reviewPlatformNames` 之间有三处**静默**失效：越界 value 被云函数拒收 · '
         '缺术语键 ⇒ label 回落成机器值（界面直接显示 `jd_sku`）· enum 新增平台而 picker 漏加 '
         '⇒ 选不到且零报错；判据 = S 扫描面（三道下界护栏防扫空）+ A 正向（picker ⊆ enum 且每项有术语键）'
         '+ B 反向（enum 中未进 picker 者必须逐一在显式排除名单内）+ C 合成样本自检 4 条；15 断言，首跑即绿）**')
i4 = hit4[0]
lines[i4] = lines[i4].replace('串 **153** 个套件', '串 **154** 个套件') + ADD38

# ---------- 第 6 处：断言数声明行（追加 key + 计数 +1） ----------
hit6 = [i for i, l in enumerate(lines) if '`check_m2_biz_inputs`=34（**六十四者**' in l]
assert len(hit6) == 1, ('hit6', hit6)
i6 = hit6[0]
old6 = '`check_m2_biz_inputs`=34（**六十四者**'
new6 = '`check_m2_biz_inputs`=34 / `check_picker_platform`=15（**六十五者**'
assert lines[i6].count(old6) == 1
lines[i6] = lines[i6].replace(old6, new6)

# ---------- 第 5 处：套件数会漂行（现 153 → 154 + 链尾补 153/154） ----------
hit5 = [i for i, l in enumerate(lines) if '（现 **153**；' in l]
assert len(hit5) == 1, ('hit5', hit5)
i5 = hit5[0]
assert lines[i5].startswith('- **套件数会漂**')
lines[i5] = lines[i5].replace('（现 **153**；', '（现 **154**；')
assert lines[i5].endswith('无崩溃红））**'), repr(lines[i5][-60:])
lines[i5] = lines[i5] + (' → **153（R234/M2v1.4：新增 `m2-biz-inputs` 套件，落地 R223 定案的输入面约束）**'
                         ' → **154（R247：新增 `picker-platform` 套件，形态 C 平台 picker 一致性守卫）**')

if lines == orig:
    sys.exit('NO-CHANGE')
open(P, 'wb').write('\n'.join(lines).replace('\n', nl).encode('utf-8'))
print('restart-key written; nl =', repr(nl))
