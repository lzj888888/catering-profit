# -*- coding: utf-8 -*-
"""round89：verify_all.js 挂 SUITES（90→91）+ 重启键三处套件数同步（坑㉞/㉗）+ 演进链追加。
字节级操作，tmp + os.replace 原子替换（坑㉝：绝不 open(P,'wb') 直接写）。"""
import os, shutil

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'

def atomic_write(path, data):
    tmp = path + '.tmp_r89'
    with open(tmp, 'wb') as f:
        f.write(data)
    os.replace(tmp, path)

def crlf_keep(text):
    return text.encode('utf-8')

# ---------- ① verify_all.js ----------
va = os.path.join(ROOT, 'verify_all.js')
raw = open(va, 'rb').read()
crlf_all = raw.count(b'\r\n') == raw.count(b'\n')
t = raw.decode('utf-8')
NL = '\r\n' if crlf_all else '\n'

# ①-1 头注套件数
n1 = t.count('// 串联：90 个套件')
t = t.replace('// 串联：90 个套件', '// 串联：91 个套件')

# ①-2 SUITES 新增项
anchor = "  ['free-shop-limit', 'tools/check_free_shop_limit.js'],"
assert anchor in t, 'SUITES anchor not found'
block = (NL
         + "  // ===== R118 归档补录宽限期口径穿透守卫（同族病第 22 例，round89）：「归档后 7 天内可补录、超过 7 天硬锁」" + NL
         + "  //       是 core/13 §3 已锁死决策 + 用户可见承诺 + 写操作拦截边界，实扫却有四类互不引用的落点" + NL
         + "  //       （计算常量 GRACE_DAYS_MS / 服务端错误文案 / 前端 i18n 四条 / 决策声明），" + NL
         + "  //       `tools/` 对该常量零引用 ⇒ 改任一侧门禁全绿无人报警（承诺与拦截分叉）。" + NL
         + "  ['archive-grace',        'tools/check_archive_grace.js'],")
t = t.replace(anchor, anchor + block, 1)
atomic_write(va, crlf_keep(t))

b = open(va, 'rb').read()
print('verify_all.js: head=%d SUITES_added=%s CRLF=%d/%d EQU=%s'
      % (n1, "['archive-grace'" in b.decode('utf-8'), b.count(b'\r\n'), b.count(b'\n'), b.count(b'\r\n') == b.count(b'\n')))

# ---------- ② 重启键三处 ----------
kb = os.path.join(ROOT, 'specs', 'dev-specs', '★知识存储点_2026-09-10.md')
raw2 = open(kb, 'rb').read()
crlf2 = raw2.count(b'\r\n') == raw2.count(b'\n')
t2 = raw2.decode('utf-8')
NL2 = '\r\n' if crlf2 else '\n'

c1 = t2.count('串 **90** 个套件')
t2 = t2.replace('串 **90** 个套件', '串 **91** 个套件')                    # 第 1 处：§1.1 入口行
c2 = t2.count('（现 **90**')
t2 = t2.replace('（现 **90**', '（现 **91**')                              # 第 2 处：会漂行行首

# 第 3 处：演进链末节 —— 按坑㉗ 直接搜上轮串，不按行号推算
old_chain = '**90（round88：'
assert old_chain in t2, 'chain anchor not found'
idx = t2.find(old_chain)
# 找到该节结束的 `**`（从 idx 起第一个 '）**' 之后）
end = t2.find('）**', idx)
assert end > 0, 'chain tail not found'
tail_pos = end + len('）**')
new_chain = (NL2 + ' → **91（round89：新增 `tools/check_archive_grace.js`，归档补录宽限期口径穿透守卫 —— '
             '「归档后 7 天内可补录、超过 7 天硬锁」在代码侧有四类互不引用落点（计算常量 `GRACE_DAYS_MS` / '
             '服务端错误文案 / 前端 i18n 四条 / 决策声明），`tools/` 对该常量零引用；'
             'R118 穿透校验三处文案与声明 ≡ 单源）**')
t2 = t2[:tail_pos] + new_chain + t2[tail_pos:]
atomic_write(kb, crlf_keep(t2))

b2 = open(kb, 'rb').read()
print('重启键: 入口行=%d 会漂行首=%d 演进链追加=%s CRLF=%d/%d EQU=%s'
      % (c1, c2, 'round89' in b2.decode('utf-8'), b2.count(b'\r\n'), b2.count(b'\n'),
         b2.count(b'\r\n') == b2.count(b'\n')))
print('size=%d (原 %d)' % (len(b2), len(raw2)))
