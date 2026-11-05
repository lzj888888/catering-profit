# R571 部署证据 · manageShop（2026-10-30 18:0x）

## 部署通道烟测（先烟测后放量）
- `_deploy_fns.py smokeTest` → try1 rc=0 用时 20.0s **HIT**（表格行 `smokeTest │ true │ 19 │ '56.4 KB'`）
- 判据 = `_judge_deploy.js` ALL_ROWS_HIT=true / DONE=true（**rc 不作判据**）

## manageShop 部署
- `_deploy_fns.py manageShop` → try1 rc=0 用时 **18.4s HIT**
- 表格行：`manageShop │ true │ 22 │ '68.1 KB'`
- ENV = cloud1-d4gphpoxy337f2a25（现读 initDb/config.json，非记忆字面量）
- 未传 `--port`（R230b：传 --port 会污染 cli 端口记忆；`.ide` 已由 IDE 写成 10896）

## 磁盘对账
- `cloudfunctions/manageShop` 目录实际文件数（排除 node_modules）= **22** ≡ 云端 filesCount 22

## 云端配置回读（`cli cloud functions info`）
```
│ manageShop │ 'Active' │ 20 │ 'Nodejs16.13' │
```
- status=Active；timeout=**20**（非平台默认 3 秒残留）；部署不会改动 timeout（R215c 两轮实证）

## 覆盖内容（R571）
- manageShop validate：create 可选 biz_type（白名单 indicatorRef.BIZ_KEYS，不传=空串不猜）
- service.buildShopDoc 落 biz_type；index.onCreate 透传
- （本函数未改 cloudfunctions/common/**，无需 sync_common）

## 边界
- 部署成功 ≠ 功能可用：待**真机**建第 2 家店选业态点一次（含付费墙路径回归）
