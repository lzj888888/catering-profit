# round78 双向变异回灌（R110 收入渠道字典口径守卫）
# 铁律：① 变异前本轮改动必须已入 index（git diff 为空）② 还原一律 git checkout -- <file>
import subprocess, shutil, os, sys, io, time

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
GUARD = 'tools/check_income_channel_seed.js'
TERMS = 'miniprogram/i18n/terms.js'
CF = 'cloudfunctions/initDb/collections.js'
PROTO = 'specs/dev-specs/prototype/init_db.js'
DECL = 'specs/dev-specs/core/13_上线前查缺补漏_决策与待办总览.md'
OTHER = 'specs/dev-specs/core/04_核对清单.md'
MARK = '收入渠道字典口径（唯一声明处）'

def rd(p):
    return io.open(os.path.join(ROOT, p), encoding='utf-8', newline='').read()

def wr(p, t):
    io.open(os.path.join(ROOT, p), 'w', encoding='utf-8', newline='').write(t)

def restore(p):
    subprocess.run(['git', 'checkout', '--', p], cwd=ROOT, check=True)

def run_guard():
    r = subprocess.run(['node', GUARD], cwd=ROOT, capture_output=True)
    return r.returncode

results = []

def mutate(mid, path, frm, to, expect_red, note):
    src = rd(path)
    if frm not in src:
        results.append((mid, 'MUTATION_NOT_APPLIED', expect_red, note))
        print(f'{mid}: NOT_APPLIED 锚点未命中 {path}')
        return
    wr(path, src.replace(frm, to, 1))
    rc = run_guard()
    got_red = (rc != 0)
    verdict = 'OK' if got_red == expect_red else 'MISMATCH'
    results.append((mid, 'RED' if got_red else 'GREEN', expect_red, note))
    print(f'{mid}: {verdict} 实际={"RED" if got_red else "GREEN"} 期望={"RED" if expect_red else "GREEN"} | {note}')
    restore(path)

# ---------- 抓错向 ----------
mutate('M1', TERMS,
       "items: ['现金收款', '微信扫码收款', '支付宝收款', '银行卡/POS刷卡', '储值卡消费', '个人/单位挂账消费', '团购/代金券核销'],",
       "items: ['现金收款', '微信扫码收款', '支付宝收款', '银行卡/POS刷卡', '储值卡消费', '个人/单位挂账消费', '团购/代金券核销', '幽灵渠道'],",
       True, '前端堂食加一项（未在册）⇒ C4-① 红')

mutate('M2', CF,
       "{ item_key: 'income_dine_cash',       item_name: '现金',         category: 'dine_in',  sort_order: 10, enabled: true, is_system: true },",
       "{ item_key: 'income_dine_cash',       item_name: '现金收',       category: 'dine_in',  sort_order: 10, enabled: true, is_system: true },",
       True, '云函数种子改名（不在册 + 副本不一致）⇒ C4-②/C2-① 红')

mutate('M3', PROTO,
       "{ item_key: 'income_dine_wepay',      item_name: '微信支付宝',   category: 'dine_in',  sort_order: 20, enabled: true, is_system: true },",
       "{ item_key: 'income_dine_wepay',      item_name: '微信支付宝2',  category: 'dine_in',  sort_order: 20, enabled: true, is_system: true },",
       True, '原型副本漂移 ⇒ C2-① 红')

mutate('M4', TERMS,
       "items: ['废品变卖', '预制菜零售'],",
       "items: ['废品变卖', '预制菜零售改'],",
       True, '其他业务收入前端改名 ⇒ C3-① 红')

mutate('M5', DECL,
       '## 🔢 ' + MARK,
       '## 🔢 收入渠道字典口径',
       True, '删唯一声明处标记 ⇒ C6-① 红（fail-closed）')

mutate('M6', DECL,
       '- **前端独有**：现金收款、微信扫码收款、支付宝收款、银行卡/POS刷卡、储值卡消费、个人/单位挂账消费、团购/代金券核销',
       '- **前端独有**：现金收款、微信扫码收款、支付宝收款、银行卡/POS刷卡、储值卡消费、个人/单位挂账消费、团购/代金券核销、幽灵渠道',
       True, '在册多写一个不存在项 ⇒ C4-③ 僵尸防腐红')

# ---------- 不错杀向 ----------
mutate('M7', DECL,
       '决策：DEFERRED by 李老师（待裁定）date 2026-09-21 reason 前端 7 项是',
       '决策：DEFERRED（by 李老师 · date 2026-09-21 · reason 前端 7 项是',
       False, '在册决策行换措辞 ⇒ 仍绿（不错杀）')

mutate('M8', DECL,
       '- **后端独有**：现金、微信支付宝、储值消费、团购券核销、企业挂账消费',
       '- **后端独有**：企业挂账消费、团购券核销、储值消费、微信支付宝、现金',
       False, '在册后端列表换顺序 ⇒ 仍绿（集合比对不看顺序）')

mutate('M9', TERMS,
       "items: ['美团外卖', '淘宝闪购', '京东外卖', '其他外卖'],",
       "items: ['美团外卖', '淘宝闪购', '京东外卖', '其他外卖', '新平台X'],",
       False, '外卖（弱面）加平台 ⇒ 仍绿（只明示不判红）')

# M10：单源扩散（往 04 追加标记行）
src = rd(OTHER)
if MARK in src:
    print('M10: NOT_APPLIED 04 已含标记')
    results.append(('M10', 'MUTATION_NOT_APPLIED', True, '单源扩散'))
else:
    line_end = '\r\n' if '\r\n' in src else '\n'
    wr(OTHER, src + line_end + '> 参考 ' + MARK + ' 见 core/13' + line_end)
    rc = run_guard()
    got_red = rc != 0
    verdict = 'OK' if got_red == (True) else 'MISMATCH'
    results.append(('M10', 'RED' if got_red else 'GREEN', True, '单源扩散 ⇒ C8-① 红'))
    print(f'M10: {verdict} 实际={"RED" if got_red else "GREEN"} 期望=RED | 单源扩散 ⇒ C8-① 红')
    restore(OTHER)

print('\n===== 变异回灌汇总 =====')
bad = 0
for mid, got, exp, note in results:
    exp_s = 'RED' if exp else 'GREEN'
    flag = '' if got == exp_s else '  <<<< MISMATCH'
    if got != exp_s:
        bad += 1
    print(f'{mid}: 实际 {got} / 期望 {exp_s}{flag} | {note}')
print(f'异常 {bad} 组 / 共 {len(results)} 组')
