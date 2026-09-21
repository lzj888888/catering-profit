"""round88：重启键「套件数」两处同步（坑㉕：行首 现**N** + 演进链末节；坑㉗：链尾须按串定位）。
🔴 坑㉝（本轮踩）：`open(P,'wb')` 会**先截断文件**，若 write(...) 的实参表达式抛异常 ⇒ 文件被清空。
   ⇒ 定式：**先把最终字节算成一个变量，再单次 open/write**，绝不在 write() 里做可能抛错的字符串运算。
"""
import os

P = r'specs/dev-specs/★知识存储点_2026-09-10.md'
raw = open(P, 'rb').read()
CRLF = raw.count(b'\r\n') * 2 > raw.count(b'\n')
t = raw.decode('utf-8').replace('\r\n', '\n')

n_head = t.count('（现 **89**；')
t = t.replace('（现 **89**；', '（现 **90**；')

lines = t.split('\n')
idx = [i for i, l in enumerate(lines) if '**89（round8' in l]
TAIL = (' → **90（round88：新增 `tools/check_free_shop_limit.js`，免费店铺数口径穿透守卫 —— '
        '「M1 免费 1 个账套」在代码侧有两个互不引用的硬编码点（`checkQuota::FREE_LIMIT.shop` 与 '
        '`getShopList::FREE_SHOP_LIMIT`），R102 的 `SRC_REL` 写死 checkQuota ⇒ 第二点零守卫；'
        '根因＝round66 第 10 例只把 checkQuota 钉住、未发现还有第二个平行硬编码点）**')
for i in idx:
    lines[i] = lines[i].rstrip() + TAIL
t = '\n'.join(lines)

if CRLF:
    t = t.replace('\r\n', '\n').replace('\n', '\r\n')

# ✅ 先算完，再一次写（坑㉝）
data = t.encode('utf-8')
tmp = P + '.r88tmp'
with open(tmp, 'wb') as f:
    f.write(data)
os.replace(tmp, P)          # 原子替换，中途失败也不会破坏原文件

chk = open(P, 'rb').read()
print('head 现**89** replaced =', n_head, '| chain-tail idx =', idx)
print('bytes', len(chk), '| CRLF =', chk.count(b'\r\n') == chk.count(b'\n'))
print('has 现**90** =', '（现 **90**；'.encode('utf-8') in chk)
print('has 90（round88 =', '90（round88'.encode('utf-8') in chk)
print('residual 现**89** =', '（现 **89**；'.encode('utf-8') in chk)
