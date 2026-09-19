# R86 云函数超时手改 · 留证（2026-09-19 · round45 · WorkBuddy）

**纯读取留证**：本目录所有证据由 `cli cloud functions info`（只读查询）与 GUI 截图产生，未包含任何写操作。

## 权威证据

- `ground_truth_42.json` — **终值回读**：42 个云函数逐个 `cli cloud functions info` 回读 timeout，
  42/42 与定值表零偏差；平台默认 `3 秒` 残留 = **0**。
  定值分布：adminExport=60 / exportData=60 / initDb=30 / smokeTest=15 / 其余 38 个=20。
- `results.json` — 批量改值过程记录（42/42 ok；adminInit / smokeTest / payQueryEntitlement 三个
  过程误判项已按 ground truth 修正并注明）。
- `current_timeouts.json` — 改值前基线快照（39 个=3，仅作对照，**非终值判据**）。

## 关键判据截图

- `evidence_l2I_misread_vp_calcAmortize.png` — 版本页**实际已加载**（可见 $LATEST/最后更新时间/配置按钮），
  但 OCR 把 `calcAmortize` 读成 `caIcAmortize`（小写 l → 大写 I）⇒ 11 个 version-page-not-loaded 的真因。
- `evidence_smokeTest_input15_focused.png` — smokeTest 执行超时输入框**聚焦态白字 15 肉眼可见**，
  OCR 读不出 ⇒ 「输入框未读到 15」是假失败；终判以点确定后 CLI 回读为准。
- `evidence_simulator_modal_dialog.png` — IDE「模拟器长时间没有响应」模态框挡死工具栏
  ⇒ reopen 级联失败 36 函数的根因；点「终止模拟器」后恢复。

## 复现方式

```
"…/微信web开发者工具/cli.bat" cloud functions info --project <repo> -e cloud1-d4gphpoxy337f2a25 --names <fn>
```
逐个回读，timeout 列应等于上表定值；`│ 3 │` 命中数应为 0。

（过程调试截图 1033 张留在工作区 `_gui/`，不入仓库。）
