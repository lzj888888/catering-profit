# _m3/_patch_gate_r157.py —— R157 挂门禁：六处一次写回（含混合行尾处理）
# 纪律：每个锚点必须唯一命中；插入用「该处原行尾」；写后逐处回读验证。
import io, re, sys

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
OK = []

def rd(p):
    with io.open(ROOT + '\\' + p, 'rb') as f:
        return f.read().decode('utf-8')

def wr(p, s):
    with io.open(ROOT + '\\' + p, 'wb') as f:
        f.write(s.encode('utf-8'))

def sub_once(p, old, new, label):
    s = rd(p)
    n = s.count(old)
    if n != 1:
        print(u'  X %s: 锚点命中 %d 次（期望 1）: %s' % (label, n, old[:70]))
        return False
    s = s.replace(old, new, 1)
    wr(p, s)
    if new not in rd(p):
        print(u'  X %s: 回读未见新串' % label)
        return False
    print(u'  OK %s' % label)
    OK.append(label)
    return True

def insert_after_line(p, anchor, lines, label):
    """在含 anchor 的行之后插入 lines（保持该处原行尾）"""
    s = rd(p)
    pat = re.compile(r'([^\n]*' + re.escape(anchor) + r'[^\n]*)(\r?\n)')
    ms = list(pat.finditer(s))
    if len(ms) != 1:
        print(u'  X %s: 锚点行命中 %d 次（期望 1）' % (label, len(ms)))
        return False
    m = ms[0]
    eol = m.group(2)
    add = eol.join(lines) + eol
    s2 = s[:m.end()] + add + s[m.end():]
    wr(p, s2)
    back = rd(p)
    if lines[0] not in back:
        print(u'  X %s: 回读未见新行' % label)
        return False
    print(u'  OK %s' % label)
    OK.append(label)
    return True

VA = 'verify_all.js'
RK = 'specs/dev-specs/★知识存储点_2026-09-10.md'
CS = 'tools/check_suite_assert_counts.js'
R85 = 'tools/selftest_r85.js'

print(u'=== R157 挂门禁 ===')

# ---------- A1 verify_all.js 头注套件数 ----------
sub_once(VA, u'// 串联：111 个套件 = ', u'// 串联：112 个套件 = ', 'A1 verify_all 头注 111->112')

# ---------- A2 verify_all.js 头注补 R157 段 ----------
R157_BLOCK = [
 u'//       + 索引字段对齐守卫（tools/check_index_field_alignment.js，R157）—— 根因＝李老师「1 万用户时版本历史数据量会不会压崩」追问触发的容量审计：',
 u'//         自查发现 `shop_cost_card_line` 的索引 `idx_line_card` 建在 `card_id` 上，而生产**写入与查询一律用',
 u'//         `cost_card_row_id`**（写入 saveCostCard / 查询 getCostCard）⇒ `card_id` 除索引定义自身外**全树零出现**',
 u'//         ⇒ 该索引**从未生效**，每次按卡查配方明细都是全集合扫描（随数据量线性恶化，最终撞云函数 20s 超时）。',
 u'//         同根因第二层（与 R154 是同一缺陷换马甲）：**1000 是单页上限，不是「该集合最多 1000 条」** ——',
 u'//         成本卡是版本模型（只 INSERT 不 UPDATE）⇒ 每保存一次多一行 ⇒ 版本膨胀把 1000 吃满 ⇒ 列表**静默少卡**。',
 u'//         故 `common/dataAdapter.js` 新增 `listAll()`（skip/limit 分页取全）+ `truncated` 可见降级标记，',
 u'//         三处「读该店全部成本卡」的调用点（getCostCard / checkQuota / saveCostCard×2）全部切过去。',
 u'//         判据 = L1 化石索引（索引字段必须在云函数源码**词表**里以独立标识符出现；**挖掉索引定义段**防"自证"假绿）',
 u'//         + L2 锚点精确对齐（shop_cost_card_line 索引字段 ≡ {shop_id, cost_card_row_id} 且不含 card_id）',
 u'//         + L3 字段真在用（写入点与查询点都在） + S1~S3 自失效护栏 + C1~C3 反恒真影子样本。',
]
insert_after_line(VA, u'//         + S1~S2 自失效护栏 + C1~C5 反恒真（裸 get 必红', R157_BLOCK, 'A2 verify_all 头注补 R157 段')

# ---------- A3 verify_all.js SUITES 追加 ----------
SUITES_ADD = [
 u"  // R157（round157 容量审计触发的自查）：索引字段必须 ≡ 代码里真在用的字段 + 「要全部行」的读取必须分页 —— 详见头注 R157 段。",
 u"  ['index-field-alignment', 'tools/check_index_field_alignment.js'],",
]
insert_after_line(VA, u"['list-ux', 'tools/check_list_ux.js'],", SUITES_ADD, 'A3 verify_all SUITES 追加')

# ---------- B1 重启键 §1.1 一键校验入口行套件数 ----------
sub_once(RK, u'串 **111** 个套件', u'串 **112** 个套件', 'B1 重启键 §1.1 套件数 111->112')

# ---------- B2 重启键 断言数声明行 ----------
sub_once(RK,
 u'`check_list_ux`=32（**二十八者**均 ',
 u'`check_list_ux`=32 / `check_index_field_alignment`=11（**二十九者**均 ',
 'B2 重启键 断言数声明追加 check_index_field_alignment=11')

# ---------- B3 重启键 「套件数会漂」行当前值 ----------
sub_once(RK, u'（现 **111**；2026-09-17 由 41 → 45', u'（现 **112**；2026-09-17 由 41 → 45', 'B3 重启键 会漂行 111->112')

# ---------- B4 重启键 演进链尾部追加 ----------
sub_once(RK,
 u'/ WXML 内调方法恒 false））**',
 u'/ WXML 内调方法恒 false））** → **112（round157：新增 `tools/check_index_field_alignment.js`，索引字段对齐守卫，R157 —— `shop_cost_card_line` 的索引建在从不存在的 `card_id` 上 ⇒ 明细查询全表扫描；同根因第二层＝1000 是单页上限而非集合上限，版本膨胀吃满后列表静默少卡，故 `dataAdapter` 增 `listAll()` 分页取全）**',
 'B4 重启键 演进链尾部追加 112')

# ---------- B5 重启键 §1.1 补 R157 段 ----------
R157_RK = [
 u'- 🆕 **索引字段对齐守卫 `index-field-alignment`（R157，round157）`tools/check_index_field_alignment.js`**：**索引字段必须 ≡ 代码里真在用的字段** —— 起因＝李老师「1 万用户时菜品版本历史会不会压崩」追问触发的容量审计（报告 `review/NOTE_2026-09-27_菜品版本历史容量审计.md`）。两处同根因缺陷：① `shop_cost_card_line` 的 `idx_line_card` 建在 `card_id`，而生产写入/查询一律用 `cost_card_row_id` ⇒ 该索引**从未生效**、明细查询**全集合扫描**；② **1000 是单页上限，不是「该集合最多 1000 条」** —— 成本卡是版本模型（只 INSERT 不 UPDATE），每保存一次多一行，版本膨胀把 1000 吃满后列表**静默少卡**且无排序（丢哪张随机）。修法＝索引改名 + 按真实字段重建（`idx_line_row`，`{shop_id, cost_card_row_id}`）+ `common/dataAdapter.js` 新增 `listAll()` 分页取全（超护栏返回 `truncated:true` 可见降级，绝不静默）。判据＝L1 化石索引（字段须在云函数源码词表里以独立标识符出现，**挖掉索引定义段**防"自证"假绿）+ L2 锚点精确对齐 + L3 字段真在用 + S1~S3 + C1~C3。⚠️ 云端旧索引 `idx_line_card` 需**显式删除**（`createIndex` 不会更新同名索引定义），见 `tools/apply_indexes.js` 用法。',
]
insert_after_line(RK, u'均 ≡ 实跑 pass 数；增删断言后本行须跟，由 `tools/check_suite_assert_counts.js` 守）', R157_RK, 'B5 重启键 §1.1 补 R157 段')

# ---------- C1 check_suite_assert_counts.js CASES ----------
CS_ADD = [
 u"  { key: 'check_index_field_alignment', rel: 'tools/check_index_field_alignment.js' }, // 11 条（R157：L1 化石索引 + L2 锚点对齐 + L3 字段真在用 + S1~S3 + C1~C3 反恒真）",
]
insert_after_line(CS, u"key: 'check_list_ux', rel: 'tools/check_list_ux.js'", CS_ADD, 'C1 CASES 追加 check_index_field_alignment')

# ---------- D1 selftest_r85.js A15 白名单登记注释 ----------
D_ADD = [
 u'  // ⚠️ 2026-09-27（round157）**十四次触发** —— 同一时机关卡第 14 次：容量审计修复（索引字段对齐 + 分页取全）。',
 u'  //   ① 索引单源：`common/initDb/collections.js`（`idx_line_card`→`idx_line_row`）—— 已在 `initDb/` 条目内；',
 u'  //   ② 分页取全：单源 `common/dataAdapter.js` 新增 `listAll()`（**已在 `common/` 条目内**），',
 u'  //      消费侧 `getCostCard/` `checkQuota/` `saveCostCard/`（**三者均已在 round129/120/116 白名单内**）切到该入口；',
 u'  //   ③ 派生面：`sync_common` 把新 dataAdapter 派生到全部 42 个函数目录的 `cx_dataAdapter.js`',
 u'  //      （**已在 round154 条目 `/^cloudfunctions\\/[^/]+\\/cx_dataAdapter\\.js$/` 内**）。',
 u'  //   ⇒ 本轮**无需新增白名单条目**（沿用既有），但按纪律把时点与理由记明；',
 u'  //   仍按 round103 的**白名单式**登记，**绝不放宽成 `cloudfunctions/` 全豁免**（那样等于守卫作废）：',
 u'  //   by=WorkBuddy / date=2026-09-27 / reason=round157 容量审计授权（索引字段对齐 + listAll 分页取全）',
]
insert_after_line(R85, u'// round156：出参下发店铺级置顶（pinned_cards / pinned_materials）', D_ADD, 'D1 r85 A15 登记注释')

print(u'')
print(u'总计落盘 %d 处' % len(OK))
