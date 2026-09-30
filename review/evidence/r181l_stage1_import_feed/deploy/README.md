# `importSalesBill` 部署取证（2026-10-01 R181m）

## 结论

✅ **已上云**（dev 环境 `cloud1-d4gphpoxy337f2a25`）。本函数是**本项目首个带非 `wx-server-sdk` 依赖**的云函数
（`xlsx ^0.18.5`）⇒ 部署必须带 `-r`（`--remote-npm-install`，云端安装依赖）。

## 硬判据（按技能 `miniprogram-cloud-deploy` 铁律：**`rc` 永不作判据**）

| 判据 | 实测值 | 出处 |
|---|---|---|
| 表格行 `success` | **`true`** | `deploy_importSalesBill_2.log` |
| `filesCount` | **18** | 与磁盘实扫 **18**（排除 `node_modules`）**完全一致** |
| `packSize` | `'42.8 KB'` | **不含 `xlsx`**（该依赖几百 KB）⇒ 走的是**云端安装**，符合预期 |
| 完成行 | `√ deploy cloudfunctions` | 同上 |
| 更新语义 | `√ [importSalesBill] cloudfunction importSalesBill exists in the cloud, will update it` | 同上 |
| IDE 通道 | `√ IDE server has started, listening on http://127.0.0.1:39721` | 同上 |

原始表格（`deploy_importSalesBill_2.log` 末段）：

```
┌─────────────────┬─────────┬────────────┬───────────┐
│ (index)         │ success │ filesCount │ packSize  │
├─────────────────┼─────────┼────────────┼───────────┤
│ importSalesBill │ true    │ 18         │ '42.8 KB' │
└─────────────────┴─────────┴────────────┴───────────┘
```

## 首轮失败是常态，不是故障

| 轮次 | 耗时 | 判定 | 说明 |
|---|---|---|---|
| `try1` | 31.1s | **MISS** | 首轮 IDE 通道未起（技能 §0.6 已登记该现象） |
| `try2` | 30.0s | **HIT** | 重跑后 cli 自起 IDE server ⇒ 成功 |

🔴 **两次 `rc` 都是 `0`** ⇒ 再次独立印证「`rc` 永不作判据」这条铁律。

## 命令

```bash
python review/evidence/_deploy_fns.py importSalesBill
# 内部实调：
#   cmd /c "<cli.bat>" cloud functions deploy --project <REPO> -e <现读 DEV_ENV_ID> --names importSalesBill -r
```

- 环境 ID **现读** `cloudfunctions/initDb/config.json::envVariables.DEV_ENV_ID`（未抄记忆字面量）。
- 判据交由 `review/evidence/_judge_deploy.js`（读原始字节走 `latin1`，**只匹配 ASCII**，绝不用 `│` U+2502 匹配 —— cli 输出是 GBK，表格线会 mojibake）。
- ⚠️ 本次部署在**非沙箱**模式下执行：沙箱内 `cli.bat` 会因 `reg.exe` 命中程序黑名单而拿不到 IDE 端口（技能 §9 已登记）。

## 双向对账（独立第二证据）

除部署日志外，另跑了 `cli cloud functions list -e <DEV_ENV_ID>` 做**本地 ≡ 云端**对账：

| 项 | 数 |
|---|---|
| 本地 `cloudfunctions/` 顶层目录 − 非函数目录（`common`/`_adminCore`） | **43** |
| 云端函数 | **43** |
| `diff` | **零差异 ✅** |

⇒ 三方一致：**规范声明（`core/10` 全集 43） ≡ 本地目录 ≡ 云端实际**。详见 `local_vs_cloud.txt`。

## ⚠️ 未验的部分（如实标注，不夸大）

1. **「部署成功」≠「功能可用」**（技能 §6）⇒ 仍需**真机点一次**：选账单文件 → 看预览（识别到 N 行 / 归月到 M 月 / 合计 ¥X）→ 确认 → 查 `external_sales_daily` 是否落行。
2. **`xlsx` 是否真在云端装上 —— 本地无法验证**：`cli` 无 `invoke` 子命令（技能 §7），命令行拿不到运行结果。
   若真机报 `Cannot find module 'xlsx'` ⇒ 说明云端安装未生效，需在**云开发控制台**对该函数重试「云端安装依赖」。
3. 本批次**未改动 `common/`** ⇒ 无需 `sync_common`，也无需连带重部署其它函数。
