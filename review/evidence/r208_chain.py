# -*- coding: utf-8 -*-
"""R208 演进链尾部追加（*后面按-Step接在 R207 那条之后*）"""
import io, sys

K = 'specs/dev-specs/★知识存储点_2026-09-10.md'
s = io.open(K, encoding='utf-8').read()

ANCHOR = 'M4 拆 tabular-nums→D-①）****'
n = s.count(ANCHOR)
print('anchor count =', n)
if n != 1:
    print('!! abort'); sys.exit(1)

ADD = (' → **133（R208：新增 `tools/check_shop_lifecycle.js`，店铺生命周期守卫 —— '
       '起因＝李老师反馈「店铺现在只能改名，删除要新建才可以，新建又提示已达免费上限」。'
       '三条实锤：① 🔴 `decideDelete` 要求「删完还必须剩 ≥1 家」⇒ **免费档（限 1 家）永远删不掉**，'
       '与本仓 `deleteConfirm` 承诺的「不再占用店铺额度」直接矛盾；且档位错阶——想换店得先有第 2 家，'
       '而第 2 家已被付费墙拦住 ⇒ 免费用户除了改店名什么都做不了。'
       '旧注释给的理由「删光了就没店可建」是错的：**软删不占配额**，删完 used 1→0 刚好够再建 1 家，'
       '真正把用户锁死的反而是那条禁止本身 ⇒ 放开为 active>=1。'
       '② 🔴🔴 只放开 ① 会立刻引爆：`getShopContext` 的无条件 autoProvision 用**确定性** '
       '`_id=defaultShopId(userId)` 插入，而软删**不物理删文档** ⇒ 同键再插必撞 ⇒ 回读为空 ⇒ '
       '`fail(\'店铺初始化失败\')` ⇒ **用户此后每一个页面都报错**。'
       '⇒ 必须先 `listIncludingDeleted` 探测历史店铺，`if (everHad)` 早退返回 `no_shop:true` '
       '（区分「从未建店的新用户」与「主动删空的老用户」），由前端引导新建。'
       '③ 入口藏进行尾「⋯」actionSheet ⇒ **李老师本人都没找到删除**，还以为只能改名 ⇒ 摊成行内按钮。'
       '判据 29 条（S 护栏 4 / A 配额语义 5——**实跑 decideDelete 判行为不判字面** / B 不死锁 6 / '
       'C 入口不藏 10 / D 文案对齐 4）；变异回灌 6/6 全部点名目标断言：'
       'M1→A-② / M2→B-④ / M3→C-①②③③b / M4→C-⑥ / M5→C-⑧ / M6→D-①D-③）')

s = s.replace(ANCHOR, ANCHOR + ADD)
io.open(K, 'w', encoding='utf-8').write(s)
print('appended, new len =', len(io.open(K, encoding='utf-8').read()))
