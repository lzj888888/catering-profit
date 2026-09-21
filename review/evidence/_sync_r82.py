# round82：同步重启键「套件数会漂」定义行的两处数字（坑㉕：行首 + 链尾缺一不可）
# 字节级改写，不引入行尾变化
import io, sys
P = r'specs/dev-specs/★知识存储点_2026-09-10.md'
raw = open(P, 'rb').read()
crlf = raw.count(b'\r\n')
lf = raw.count(b'\n')
print('BEFORE CRLF', crlf, 'LF', lf)

txt = raw.decode('utf-8')

# ① 行首「现 **85**」→「现 **86**」
old_head = '- **套件数会漂**：`verify_all.js` 增删套件后必须同步头部注释里的数量（现 **85**；'
new_head = '- **套件数会漂**：`verify_all.js` 增删套件后必须同步头部注释里的数量（现 **86**；'
assert txt.count(old_head) == 1, ('head anchor count', txt.count(old_head))
txt = txt.replace(old_head, new_head, 1)

# ② 链尾追加 86（不写口径标记词，避免坑⑮ 自指；也不写「N 次/分钟」避免进入 A5 声明面）
old_tail = '裸扫「N 条红线」会误杀本行演进链里的历史值 ⇒ 走语义标记 + 锚点就近）**。⚠️ **本重启键里「套件数」已写死两处'
assert txt.count(old_tail) == 1, ('tail anchor count', txt.count(old_tail))
add = ('裸扫「N 条红线」会误杀本行演进链里的历史值 ⇒ 走语义标记 + 锚点就近）** → '
       '**86（round82：新增 `tools/check_rate_limit_params.js`，RATE_LIMITED 触发阈值守卫，R113 —— '
       '该阈值写在这份统一错误码表里（对外契约），代码单源 `common/rateLimit.js` 的两个常量连同 42 份扁平副本 '
       '实扫零漂移，而 `tools/`+`prototype/` 对常量名零引用 ⇒ 改阈值而文档不跟，门禁全绿无人报警；'
       '与 round67 权限矩阵、round70 鉴权强度同属「防护性边界」；裸扫数字会误杀窗口表达式与字号等合法口径 '
       '⇒ 走语义标记 + 锚点就近）**。⚠️ **本重启键里「套件数」已写死两处')
new_tail = ('裸扫「N 条红线」会误杀本行演进链里的历史值 ⇒ 走语义标记 + 锚点就近）** → '
            '**86（round82：新增 `tools/check_rate_limit_params.js`，RATE_LIMITED 触发阈值守卫，R113 —— '
            '该阈值写在这份统一错误码表里（对外契约），代码单源 `common/rateLimit.js` 的两个常量连同 42 份扁平副本 '
            '实扫零漂移，而 `tools/`+`prototype/` 对常量名零引用 ⇒ 改阈值而文档不跟，门禁全绿无人报警；'
            '与 round67 权限矩阵、round70 鉴权强度同属「防护性边界」；裸扫数字会误杀窗口表达式与字号等合法口径 '
            '⇒ 走语义标记 + 锚点就近）**。⚠️ **本重启键里「套件数」已写死两处')
txt = txt.replace(old_tail, new_tail, 1)

open(P, 'wb').write(txt.encode('utf-8'))
raw2 = open(P, 'rb').read()
print('AFTER  CRLF', raw2.count(b'\r\n'), 'LF', raw2.count(b'\n'))
print('OK')
