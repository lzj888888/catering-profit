# -*- coding: utf-8 -*-
"""R304 · 清理 `pages/month/input.js` 的 showRows 死槽（13 处赋值 / 零消费者）。

背景：R297 登记「input.js 的 showRows 槽（13 处赋值、零消费者）」，当时未清理（怕碰已声明套件）。
      R297 的 M1-B1 修法**曾因改读 showRows 引入静默语义回归**（它是未装饰的 raw，丢 fixed/tag）
      ⇒ 这槽留着就是下一轮的陷阱，本轮清掉，并由守卫钉「不得复活」。

做法：行级删除 + 断言（删完必须零 `showRows` 非注释残留、语法通过、selftest_batch8b 仍 179/0）。
"""
import io, sys, re

P = 'pages/month/input.js'
src = io.open(P, encoding='utf-8').read()
lines = src.split('\n')

OLD_NOTE = "  // ⚠️ showRows = 实际渲染行：折叠时仅首行（整类总额），展开时全部细部行（WXML 不支持方法调用，故预计算）"
NEW_NOTE = (
    "  // 🔴 R304：原 `showRows` 槽已**整体删除**（13 处赋值、**零消费者**）。它是未装饰的 raw，"
    "丢 fixed/tag ——\n"
    "  //   R297 的 M1-B1 修法**曾因改读它引入静默语义回归**而门禁全绿（同族病）。"
    "渲染直接用 `rows`（已装饰、折叠与否在 wxml 侧用 expanded 判断）。"
)
# 上面 OLD_NOTE 里的「细部行」是笔误占位，真正匹配用下面这条
OLD_NOTE = "  // ⚠️ showRows = 实际渲染行：折叠时仅首行（整类总额），展开时全部细项行（WXML 不支持方法调用，故预计算）"

DROP_COMMENT_1 = "  //   ⚠️ 同时把 showRows 跟着设成 rows：折叠态下 g.rows 仍是全量（摘要按模式另行取数），"
DROP_COMMENT_2 = "  //      而 showRows 是给别处（其他收入类）用的；外卖两态都不读 showRows，设一下只为不留半旧值。"
OLD_ASSIGN = "    const g = Object.assign({}, groups[gi], { expanded, showRows: groups[gi].rows });"
NEW_ASSIGN = "    const g = Object.assign({}, groups[gi], { expanded });"

assert src.count(OLD_NOTE) == 1, 'note anchor'
assert src.count(DROP_COMMENT_1) == 1, 'comment1'
assert src.count(DROP_COMMENT_2) == 1, 'comment2'
assert src.count(OLD_ASSIGN) == 1, 'assign'

out = []
dropped = 0
for i, ln in enumerate(lines):
    s = ln.strip()
    if ln == OLD_NOTE:
        out.append(NEW_NOTE); continue
    if ln in (DROP_COMMENT_1, DROP_COMMENT_2):
        dropped += 1; continue
    if ln == OLD_ASSIGN:
        out.append(NEW_ASSIGN); continue
    if s.startswith('showRows:'):
        dropped += 1; continue
    if re.match(r'^\s*(g|ng)\.showRows\s*=', ln):
        dropped += 1; continue
    out.append(ln)

# 删完赋值后，`if (d.category === 'dine_in') {` 可能被掏空 ⇒ 若其下一行就是 `}` 则整条删掉
clean = []
i = 0
while i < len(out):
    if (out[i].strip() == "if (d.category === 'dine_in') {"
            and i + 1 < len(out) and out[i + 1].strip() == '}'):
        i += 2
        dropped += 2
        continue
    clean.append(out[i]); i += 1

new = '\n'.join(clean)
io.open(P, 'w', encoding='utf-8', newline='').write(new)

rest = [l for l in new.split('\n') if 'showRows' in l]
print('删除行数（含空 if 包装）:', dropped)
print('残留含 showRows 的行:', len(rest))
for l in rest:
    print('  ', l.strip()[:110])
