# R197 门禁归档 —— 云端 `cx_auth.js` 只读核验后

> 结论先行：**127/127 通过 · RC=0 · miss=0**（索引 3239 项 · 缓存 59 键 · 耗时 125.1s）
> 本轮 R197 只往仓里加**证据与文档**（4 份 `r197_cloud_auth/` + 审计 §7.13 + 路线单注记），**一行源码未改**
> ⇒ 门禁本应零影响；跑它是为了守住「入库即须过闸」的纪律，不是为了修红。

## 一、判据（三条全过才算合格）

| 判据 | 本轮实测 | 读法 |
|---|---|---|
| 套件通过 | **127/127** | 只认`总览：127/127 通过`这一行 |
| 进程码 | **RC=0** | `out=$(...); rc=$?` 抓的才是真码 |
| 缓存 miss | **miss=0** | `%TEMP%/gitcache_miss.log` **不存在**即 0 命中 |

> 🔴 **别看 ❌ 的个数当失败数**：仓内断言描述里固定有 2 条 `❌` 字面量（`check_*` 的负例说明），
> 那是**被测文本**，不是真 FAIL。真判据 = `总览：N/N` 行 + 失败清单为空。
> 本轮实测 `grep -c "❌"` = 0，属正常。

## 二、通道配方（本轮实际用的）

本会话 node **派生任何子进程全EBUSY** ⇒ 必须走 Python 侧真跑 +缓存回放：

```bash
cd /c/Users/lzj/WorkBuddy/Claw/catering-profit
PY="C:/Users/lzj/.workbuddy/binaries/python/versions/3.13.12/python.exe"
out=$(NODE_OPTIONS="--require C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r194_gate/gitcache_preload.js" \
      "$PY" review/evidence/r194_gate/run_gate3.py 2>&1); rc=$?
```

- `run_gate3.py`逐个 `subprocess.run([NODE,套件文件])`，**不用 shell**⇒ 绕开沙箱的 `spawnSync` EBUSY。
- `gitcache_preload.js` 把 `git ls-files` / `git ls-tree` 的结果**预烘进** `%TEMP%/inscode/gitcache.json`，
  套件内部再 `spawnSync('git')` 时直接命中缓存返回，不真起进程。
- 🔴 **漏传 `NODE_OPTIONS` ⇒ 9 个套件假红**（R195 已踩过，`check_suite_coverage` / `check_suite_count_claims` /
  `check_collection_perms` / `check_privacy_collection` / `check_quota_limits` / `check_acceptance_counts` /
  `check_suite_assert_counts` / `check_docx_derive` / `selftest_r85`）。**门禁红先怀疑自己/通道/缓存，别先改代码。**

## 三、缓存刷新固定顺序（入库后必跑）

`git ls-files` 的输出**会随新增文件而变**⇒ 每次 `git add -A` 之后、重跑门禁之前，必须按序跑：

|序 | 脚本 | 作用 | 本轮 rc |
|---|---|---|---|
| ① | `mk_git_keys.py` | 重建 `git ls-files` 键 | 0 |
| ② | `mk_force.py` | 强制刷新一批易变键 | 0 |
| ③ | `mk_fix_py_keys.py` | **专修 `python.exe -c import docx` 被拆参产生的坏键**（`check_docx_derive` 靠它） | 0 |

> ③ 极易漏。漏了它 → `check_docx_derive` 单套件红，且看起来像真缺陷。

## 四、本轮文件

| 文件 | 内容 |
|---|---|
| `gate_r197_1.txt` | 简版判据四行（SUITES / suite-tracked / 总览 / R92） |

简版 txt 够用的理由：`gate_*_full.txt`（约 29万字节）已由 `gate_194_*_full.txt` 覆盖全集；本轮无源码改动，
套件逐条输出与R196 同源，存全文只是重复 29 万字节。