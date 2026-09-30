# r181d_m316_accept —— M3.16 套餐成本卡验收取证（2026-09-30）

验收对象：InsCode 提交 `f3f768f`（`feat(M3.16): 套餐成本卡（引用型卡）`）。
全量结论见 `review/NOTE_2026-09-30_round181d_M316套餐验收与声明面同步.md`。

## 文件

| 文件 | 作用 |
|---|---|
| `m316_anchor_verify.js` | **独立复算脚本**：直接 `require` 生产引擎（`calcBom/service.js::calcCostCard`）+ `common/comboDerive.js`，自组数据算 A-a/A-b/A-c 三锚点，**不采信** `tools/selftest_m3_combo.js` 的断言 |
| `gate3_full.txt` | 门禁全量 stdout（275 KB）：**116/116 通过**、R92 ✅、0 条 FAIL |
| `mk_git_keys.py` | 只刷 git 类缓存键（真跑 git） |
| `mk_cache3.py` | **只补** `gitcache_miss.log` 里的 miss（不覆盖他人） |
| `mk_force.py` | 带 `NODE_OPTIONS` **强制重刷**全部 node/python 键（防"只跑第一步致假绿"） |
| `mk_fix_py_keys.py` | 补坑：`python.exe -c "import docx"` 不能按空格拆参重跑 |
| `run_gate3.py` | 逐套件驱动 `node <套件>` + 复刻 R66/R69 审计，产出 `gate3_full.txt` |
| `gitcache_preload.js` | `NODE_OPTIONS=--require` 挂载：把缓存的**真跑结果**就地返回，未命中记 miss 并抛错（fail-closed） |
| `commit_r181f/g/h.txt` | 我方三次补齐提交的 message（声明面 / K11 镜像 / S6 豁免） |

## 判据速查

```bash
# 独立复算（不依赖门禁）
node review/evidence/r181d_m316_accept/m316_anchor_verify.js     # → "全部一致 ✅" rc=0

# 门禁（沙箱内需挂缓存）
NODE_OPTIONS="--require C:/Users/lzj/AppData/Local/Temp/inscode/gitcache_preload.js" \
  node tools/check_suite_coverage.js                              # → 10 通过 / 0 失败
node tools/check_m3_engine_parity.js                              # → 22 通过 / 0 失败
node tools/check_suite_count_claims.js                            # → 实算 N = 116
node tools/check_suite_assert_counts.js                           # → A2-selftest_m3_combo 17 ≡ 17
```

## 硬判据（缺一不可）

1. `gitcache_miss.log` **不存在**（miss = 0）—— 否则是"跳过断言的假绿"；
2. `gate3_full.txt` 里 `grep -c "❌ FAIL"` = **0**；
3. 总览行 = **116/116 通过** 且 `R92: ✅`。

## ⚠️ 归档约定

本目录**不得**出现以 `check_` / `verify_` / `selftest_` / `test_` 开头的 `.js` / `.py`，
否则 `tools/check_suite_coverage.js` 的 **S6** 判红（面 B 枚举式白名单，须补 `EXEMPT` 或改名）。
