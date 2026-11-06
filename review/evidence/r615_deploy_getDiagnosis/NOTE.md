# R615 部署回执 · getDiagnosis

- 时间：2026-11-06 21:0x ｜ 环境：dev `cloud1-d4gphpoxy337f2a25` ｜ 一次一个、带 `-r`
- 日志：`deploy_getDiagnosis_1.log`（原始表格行 `│ getDiagnosis │ true │ 26 │ '94.5 KB' │`）
- 独立判据：`node review/evidence/_judge_deploy.js <log> getDiagnosis` ⇒ **ALL_ROWS_HIT = true / DONE = true**
  （不采信 rc；cli 部署失败也返回 rc=0）
- 包变大佐证新代码真上去：上轮 25 files / 85.6 KB ⇒ 本轮 **26 files / 94.5 KB**（新增 `actions.js`）
- 云端 `cli cloud functions info` 回读：`status='Active' / timeout=3 / runtime=Nodejs16.13`
  （timeout 3 秒够用，R614 真机 elapsedMs=41ms 已证；#129 已关闭）
- 部署前额外验证：用**云端扁平 `getDiagnosis/common.js`** 真 require `actions.js`，
  确认 `diagnosisEngine` 子对象被导出、处方能产出（防技能 §6.1「自测 A 路、云端 B 路」盲区）。
- 改了 `common/diagnosisEngine.js` ⇒ `sync_common.js` 已重生成 56 份 `cx_*` 副本；
  但**真正消费诊断引擎的只有 getDiagnosis**（其余 55 个函数里的副本零调用，
  R613 审计「引擎此前全仓零调用」结论未变）⇒ 本轮只部署这一个，#125 上线前再做全量核查。
- 交付话术：**已上云，待真机点一次验证**（部署成功 ≠ 功能可用）。
