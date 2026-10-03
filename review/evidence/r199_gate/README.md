# R199 门禁归档 —— 底部三入口 tabBar 落地后

> 结论先行：**127/127 通过 · RC=0 · miss=0**（索引 3262 项 · 缓存 59 键 · 耗时 185.2s）
> 本轮 R199 是**真源码改动**（`app.json` 加 tabBar + 6 图标 + 3 处跳转 + 首页 UI）⇒ 门禁本就会受影响，
> 跑它是必须的，不是走过场。**源码改完不跑门禁 = 未完成**。
>
> ⚠️ 本轮门禁**跑了两遍**：第一遍 3260 项 / 181.0s（源码改完时）⇒ 之后补了审计 §7.15、路线单、
> `r199_gate/` 自身两个文件 ⇒ **索引 3262** ⇒ 再跑一遍确认文档改动没踩扫描面。
> 🔴 **入库即须过闸** —— `suite-tracked`（R92）会扫 `git ls-files`，文档也是扫描面。

## 一、判据（三条全过才算合格）

| 判据 | 本轮实测 | 读法 |
|---|---|---|
| 套件通过 | **127/127** | 只认 `总览：127/127 通过` 这一行 |
| 进程码 | **RC=0** | `out=$(...); rc=$?` 抓的才是真码 |
| 缓存 miss | **miss=0** | `%TEMP%/gitcache_miss.log` **不存在**即 0 命中 |

> 🔴 **别拿 `❌` 的个数当失败数**：仓内断言描述里固定有 2 条 `❌` 字面量（`check_*` 的负例说明），
> 那是**被测文本**，不是真 FAIL。真判据 = `总览：N/N` 行 + 失败清单为空。

## 二、通道配方（本轮实际用的）

本会话 node **派生任何子进程全EBUSY** ⇒ 走 Python 侧真跑 + 缓存回放：

```bash
cd /c/Users/lzj/WorkBuddy/Claw/catering-profit
PY="C:/Users/lzj/.workbuddy/binaries/python/versions/3.13.12/python.exe"
out=$(NODE_OPTIONS="--require C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r194_gate/gitcache_preload.js" \
"$PY" review/evidence/r194_gate/run_gate3.py 2>&1); rc=$?
```

- 🔴 **漏传 `NODE_OPTIONS` ⇒ 9 个套件假红**（`check_suite_coverage` / `check_suite_count_claims` /
  `check_collection_perms` / `check_privacy_collection` / `check_quota_limits` / `check_acceptance_counts` /
  `check_suite_assert_counts` / `check_docx_derive` / `selftest_r85`）。**门禁红先怀疑自己/通道/缓存，别先改代码。**

## 三、缓存刷新固定顺序（`git add -A` 之后必跑）

| 序 | 脚本 | 作用 | 本轮 rc |
|---|---|---|---|
| ① | `mk_git_keys.py` | 重建 `git ls-files` 键 | 0 |
| ② | `mk_force.py` | 强制刷新易变键 | 0 |
| ③ | `mk_fix_py_keys.py` | **专修 `python.exe -c import docx` 被拆参产生的坏键**（`check_docx_derive` 靠它） | 0 |

> 🔴 **顺序不能乱、③ 极易漏**。漏了它 → `check_docx_derive` 单套件红，且看起来像真缺陷。
> ⚠️ 本轮实测：`git add -A` 之后索引 3259 → **3262**（`r199_gate/` 两文件入库），缓存键仍是 59，键数不变值变了。

## 四、本轮文件

| 文件 | 内容 |
|---|---|
| `gate_r199_1.txt` | 简版判据两行（suite-tracked 索引项 + 总览） |

简版txt 够用的理由：全集逐条输出（≈29 万字节）已由 `gate_194_*_full.txt` 覆盖。
本轮与 R194–R198 的门禁差异只在本轮改动的源码面（tabBar/图标/跳转），未出现新套件 ⇒ 简版可追平。

## 五、门禁管住了什么（值得记一笔）

本轮源码改动触发了**4 类真守卫**，全都自动绿，说明 tabBar 落地没有踩既有红线：

| 守卫 | 它在管什么 | 本轮表现 |
|---|---|---|
| `check_page_manifest` | 提审 §4 页面清单 ≡ `app.json::pages` | 绿 —— tab 页**没往pages 里加新页**（三页本来就在），所以清单不用改 |
| `check_pack_size` | `packOptions.ignore` vs 实际包体（`code 10` 红线） | 绿 —— 6 张 81×81 图标共**2.4 KB**，对包体无感 |
| i18n 单源守卫 | `miniprogram/i18n/terms.js` ≡ `specs/dev-specs/i18n/terms.js` | 绿 —— 加了 `tipMore` 后已 `cp` 同步，md5 一致 |
| 术语/禁用词守卫 | 可见文案禁用「盈利/赚钱/投资/付费」等 | 绿 —— `tipMore` 文案已避开 |

> 🔴 **这4 条里最值钱的是 i18n 单源**：我只改了 miniprogram 侧就提交的话它会立刻红。
> 这就是「三处文案」纪律存在的意义 —— 机器比人可靠。