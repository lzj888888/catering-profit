# R684 · 上线前全量云函数部署（队列 #125）

## 结论
- **58 个函数全部部署到 dev**（`cloud1-d4gphpoxy337f2a25`），逐个留 `success=true` 表格行。
- 本地 58 ≡ 云端 59（云端多 `cleanupSmokeCards`，本地无，属历史遗留，不影响上线）。
- 回读：**58/58 `Active`**。
- 🔴 **发现 6 个函数 `timeout = 3`（平台默认，从未被抬过）** —— 见下节。

## 部署过程
| 批次 | 数量 | 结果 | 用时 |
|---|---|---|---|
| 烟测 | 1（smokeTest） | 1/1 | 21s |
| 第一批 | 30 | 30/30 | 8m47s |
| 第二批 | 27 | 26/27（`revokeAiConsent` 中段 MISS） | 9m42s |
| 补跑 | 1（revokeAiConsent） | 1/1 | 17s |

- 判据一律 `_judge_deploy.js` 的 `ALL_ROWS_HIT`，**不看 `rc`**（技能 §0.5：cli 失败也返回 rc=0）。
- `revokeAiConsent` 首轮 MISS 属技能 §3.1 记录的"中段失败自愈"现象，单独重跑即成功，**未重启 IDE**。
- 全部带 `-r`（不覆盖云端依赖）、一次一个、未传 `--port`（技能 §3.2：传了会污染端口记忆）。

## 🔴 遗留：6 个函数超时仍是 3 秒
`ensureCollections` · `getAiConsent` · `getDiagnosis` · `grantAiConsent` · `revokeAiConsent` · `verifyTangshi`

- 危害：`getDiagnosis` 要读多集合 + 跑 11 项引擎，**3 秒必然超时** ⇒ 诊断页在真机上会直接失败。
  这与 R215c 的 `importSalesBill`/`manageShop` 是同一类（首次部署后没人抬过）。
- 为什么不能由我改：技能 §9 实证三条路全堵 ——
  ① `config.json` 写 `"timeout": N` 随包上传但**不生效**；
  ② `cli` **没有**改配置的子命令（只有 list/info/deploy/inc-deploy/download）；
  ③ 云开发 HTTP API **没有**该端点。
  ⇒ **唯一入口 = 云开发控制台 → 云函数 → 该函数 → 版本与配置 → 高级配置 → 执行超时**。
- 目标值：与其余函数一致 **20**（`initDb`=30、`adminExport`/`exportData`/`dbBackup`=60、`smokeTest`=15 维持不动）。
- 改完复核：`cli cloud functions info --names <fn> -e <env>` 读 `timeout` 列，**别信控制台"成功"绿字**。

## 证据文件
- `cloud_list.txt` —— 云端函数清单原文
- `timeout_readback.json` —— 58 个函数 status + timeout 逐条回读
- `batch1_28fn.log` / `batch2_27fn.log` —— 两批部署机读日志
