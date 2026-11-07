# R615 部署回执 · importSalesBill

- 环境：dev `cloud1-d4gphpoxy337f2a25` ｜ 一次一个、带 `-r`
- 日志：`deploy_importSalesBill_1.log`（原始表格行 `│ importSalesBill │ true │ 26 │ '120.5 KB' │`）
- 独立判据：`node review/evidence/_judge_deploy.js _m3/deploy_logs/deploy_importSalesBill_1.log importSalesBill`
  ⇒ **ALL_ROWS_HIT = true / DONE = true**（不采信 rc；cli 部署失败也返回 rc=0）
- 云端 `cli cloud functions info` 回读：`status='Active' / timeout=20 / runtime='Nodejs16.13'`
- 🔴 **runtime 版本是必查项**：本轮用了 `new TextDecoder('gbk')`，若 Node 16 不支持会静默降级回乱码。
  已用 `npx node@16.13.0` 实跑同版本验证：`TextDecoder('gbk') 可用 = true`，
  整链 3 组 10 行 270.00 元（证据 `review/evidence/r615_encoding/node16_end2end.log`）。
- 本函数消费 `service.js`（改了编码嗅探）；`utils/billParse.js` 是解析逻辑同源但对文案不读文件，
  全仓 `XLSX.read` 已 grep 确认**只有 service.js 一处**（唯一入口）。
- 交付话术：**已上云，待真机导一次美团表验证**（部署成功 ≠ 功能可用）。
