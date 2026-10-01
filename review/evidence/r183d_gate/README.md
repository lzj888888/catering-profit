# R183d · 沙箱下跑门禁（本轮 Bash 环境 node 禁派生子进程）· 取证

> 目录用途：本轮（R183 第三笔 doc 补丁）**原生 `node verify_all.js` 跑不起来**，
> 走技能 `gate-under-sandbox` 的 Python 侧真跑通道。本目录是**驱动脚本 + 输出留档**。

## 一 定性：先跑 30 秒探针（技能 §〇 要求）

`_probe_spawn_r183d.js` 结果（**全部 EBUSY**）：

```
git(bin)    -> ERR:EBUSY      # C:/Program Files/Git/bin/git.exe
git(cmd)    -> ERR:EBUSY      # C:/Program Files/Git/cmd/git.exe
cmd         -> ERR:EBUSY
where       -> ERR:EBUSY
node(self)  -> ERR:EBUSY      # process.execPath —— 连 node 派生自身都拦
```

⇒ 定性 = **沙箱禁 node 派生任何子进程**，**不是代码缺陷**。

⚠️ 同一台机上，**今天 12:4x 之前**原生 `node verify_all.js` 还能跑通（`gate_183_1/2/3.txt` 均为 123/123）；
13:0x 之后转为全 EBUSY ⇒ **这个限制会时有时无**（与技能 §〇 记录一致）。
**每轮开工必须先跑探针定性**，别条件反射地建缓存。

## 二 本目录文件

| 文件 | 说明 |
|---|---|
| `run_gate3.py` | Python 侧驱动：从 `verify_all.js` **求值**取 `SUITES`（不手抄），逐个 `node <套件>`，R66/R69 审计逐条复刻 |
| `gitcache_preload.js` | `NODE_OPTIONS=--require` 注入；把 Python 侧**真跑**出来的结果就地回放；**未命中即记 miss 并抛错**（fail-closed） |
| `mk_git_keys.py` | 只刷 git 类键（真跑 git） |
| `mk_cache3.py` | 读 `gitcache_miss.log`，只补未命中项（不覆盖他人） |
| `mk_force.py` | 强制重刷**全部** node/python 键（不跳过已存在） |
| `mk_fix_py_keys.py` | 修 `mk_force` 按空格拆参跑坏的那条键（坑⑤） |
| `gate_183d_1.txt` | **最终**门禁输出：`总览：123/123 套件通过` · `R92：✅` · 耗时 285.9s |

## 三 执行顺序（技能 §⑥）与实测结果

```
python mk_git_keys.py      # git keys: 6（git status --porcelain 显示本轮 2 个改动文件）
python mk_force.py         # to refresh: 43 → 1 条失败（python.exe -c import docx，坑⑤，待修）
python run_gate3.py        # round1 → 122/123 ❌ [docx-derive] exit=1；miss=7
                           #   ↑ 真因：缓存里 `python.exe -c import docx` rc=1（被 mk_force 拆参跑坏）
                           #     ⇒ D2 判 python-docx 不可用。**实测直跑 python-docx 1.2.0 可用** ⇒ 属缓存污染，非缺陷。
python mk_cache3.py        # 补 7 条 node 键（全部 rc=0）→ cache 56
python mk_force.py         # 重刷 50 条（又跑坏那条 docx 键 —— 顺序使然，见下）
python mk_fix_py_keys.py   # 🔴 必须放最后：把 docx 两条键改成真值（均 rc=0）
python run_gate3.py        # round2 → 123/123 通过 · miss=0 · 耗时 285.9s
```

🔴 **顺序铁律**：`mk_force` 一定会跑坏 `python.exe -c import docx`（把 `-c` 后的代码按空格拆成两个参数）
⇒ **`mk_fix_py_keys.py` 必须排在 `mk_force` 之后、跑门禁之前**。放错顺序的症状是
`D2 python-docx 依赖可用` 转红，而**实际 `import docx` 是好的**（本轮实测 `python-docx 1.2.0`）。

## 四 判据与结论

- **`总览：123/123 套件通过`**（与原生通道今天早些时候得到的三次 123/123 一致）；
- **`R92（套件入库，真 git 判定）：✅`** —— 123 个套件文件全部在 `git ls-files`（索引 2780 项）；
- **`miss = 0`**（`gitcache_miss.log` 未生成 ⇒ 所有被拦子进程均命中真值缓存，无跳过断言的假绿）；
- ⚠️ `docx-derive` 的红**是缓存污染的红**，不是"门禁没过"。补齐后同一套件在同一次运行中通过。

## 五 本目录**不**包含什么（如实标注）

- **不含**原生 `node verify_all.js` 的输出 —— 本轮环境跑不了（探针已定性）；原生通道上一轮输出见
  `review/evidence/r183_m331_gap/gate_183_3.txt`。
- **不含** `gitcache.json`（临时缓存，可重建；重建脚本在本目录）。
- **不含**任何改生产代码的动作（本轮只改 `review/` 下两份文档）。
