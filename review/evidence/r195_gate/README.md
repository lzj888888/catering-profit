# R195 门禁证据

| 文件 | 内容 | 判据 |
|---|---|---|
| `gate_r195_1.txt` | 沙箱通道复跑 `verify_all.js` 127 套件 | **127/127 通过 · RC=0 · miss=0** |

## 通道配方（本轮实跑复核，与 R194 一致）

本会话 Bash 环境 **node 派生任何子进程全 EBUSY**（`spawnSync('git')` 也 EBUSY），
原生 `node verify_all.js` 直接红是**环境限制、不是代码问题**。走 Python 侧真跑通道：

```bash
cd /c/Users/lzj/WorkBuddy/Claw/catering-profit
PY="C:/Users/lzj/.workbuddy/binaries/python/versions/3.13.12/python.exe"
NODE_OPTIONS="--require C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r194_gate/gitcache_preload.js" \
  "$PY" review/evidence/r194_gate/run_gate3.py > review/evidence/r195_gate/gate_r195_1.txt 2>&1
echo "RC=$?"
```

🔴 **`NODE_OPTIONS=--require …/gitcache_preload.js` 不能漏**（本轮踩过一次）：
漏了它 ⇒ 套件**内部**的 `spawnSync('git')` 仍 EBUSY ⇒ 9 个套件假红
（`check_suite_coverage` / `check_suite_count_claims` / `check_collection_perms` / `check_privacy_collection` /
`check_quota_limits` / `check_acceptance_counts` / `check_suite_assert_counts` / `check_docx_derive` / `selftest_r85`）。
加上后同一次复跑即 **127/127**。**教训：门禁红先怀疑自己 / 通道 / 缓存，别急着改代码。**

## 缓存刷新固定顺序（提交后必须重刷，因 `git ls-files` 输出会变）

```bash
cd review/evidence/r194_gate
"$PY" mk_git_keys.py    # 6 个 git 类键（ls-files / status / rev-parse / log …）
"$PY" mk_force.py       # 53 个 node/python 类键
"$PY" mk_fix_py_keys.py # 修 2 条拆参坏的 python 键（含 `[PY,"-c","import docx"]`）
```

- 缓存落 `%TEMP%/inscode/gitcache.json`（本轮 59 键）
- **`miss=0` 判据 = `%TEMP%/inscode/gitcache_miss.log` 不存在**（不存在 = 零 miss）
- `mk_force.py` 里 `python.exe -c import docx` 报 `SyntaxError` 是**已知设计**（按空格拆参坏），
  由 `mk_fix_py_keys.py` 专门修它 ⇒ 见到这条不要慌，跑完固定顺序即净。

## 判据读法（别读错）

- 只看 **`总览：N/N`** 行 + 失败清单；
- `rc` 取 **python 侧**的返回码（`out=$(...); rc=$?`），**别用 `| tail` 后的 `$?`**（那是 `tail` 的码）。
- `R92: ✅` 里的索引项数（3217）应随新增文件递增 —— 可作 `git add` 是否生效的旁证。
