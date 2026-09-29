# r181b_gate —— R181b 轮的门禁驱动与全量输出（沙箱等价驱动）

判据 = **`115/115 通过` ＋ `R92 ✅` ＋ `miss = 0`**（`miss=0` 是"没跳过断言"的硬判据，不看它可能是假绿）。

## 文件

| 文件 | 作用 |
|---|---|
| `run_gate3.py` | 主驱动：从 `verify_all.js` 源码**求值**取 `SUITES`（不手抄）→ 真 git 判 R92 → 逐套件 `node <套件>` → 复刻 R66/R69 审计 → 写 `gate3_full.txt` |
| `gitcache_preload.js` | 经 `NODE_OPTIONS=--require` 注入，把缓存的**真实运行结果**就地返回（未命中记 miss 并抛错，fail-closed） |
| `mk_force.py` | 带挂载**强制重刷**全部 `node.exe`/`python.exe` 缓存项（不跳过已存在的 key） |
| `mk_git_keys.py` | 🔴 **本轮新增**：只刷「git 类」键（真跑 git）。**每轮 commit 后必须跑**，否则缓存里是旧事实 |
| `mk_fix_py_keys.py` | 🔴 **本轮新增**：补 `mk_force.py` 跑不了的那条 key —— `python.exe -c import docx`（`mk_force` 按空格拆参 ⇒ `-c import` ⇒ SyntaxError） |
| `check_timeout.py` | R86 复验脚本（`cli.bat cloud functions info --names <42>`）—— **本沙箱内跑不通**，见 `timeout_readback_raw.txt` |
| `timeout_readback_raw.txt` | `cli.bat` 被拦的原始输出（`reg.exe` 程序黑名单 + `wait IDE port timeout`） |
| `gate3_full.txt` | 全量 stdout（273 KB）：115 个套件逐条结果 |

## 运行顺序（照抄）

```bash
cd <仓根> && git commit ...            # 先提交，工作树必须干净（A15 类守卫看"未提交"）
python mk_git_keys.py                  # ① 刷 git 类
python mk_force.py                     # ② 刷 node/python 类（带 NODE_OPTIONS）
python mk_fix_py_keys.py               # ③ 补 ② 跑不动的那条
rm -f gitcache_miss.log
NODE_OPTIONS="--require $PWD/gitcache_preload.js" python run_gate3.py
```

## 本轮结果（2026-09-30 · R181b）

```
SUITES = 115
✅ [suite-tracked] 115 个套件文件全部已入库（R92 · 真 git，索引 2296 项）
总览：115/115 通过   耗时 129.7s（热缓存）
R92: ✅        miss = 0        ❌ FAIL 计数 = 0
```

关键套件实数：

| 套件 | 本轮 | 本轮之前 |
|---|---|---|
| `schema-sync` | **66/0** | 49/17 |
| `suite-count-claims` | **11/0** | 9/2 |
| `collection-perms` | **22/0** | 21/1（P1-① git 扫描面） |
| `list-ux` | **32/0** | 红（`pin` 裸子串假阳性，本轮修） |
| `suite-assert-counts` | 39 条 | 连带红 |
| `batch0 代码自测` | 42 条 | 连带红 |
| `r174-inbound` | 19/0 | — |
