# NOTE 2026-09-19 · round45 · R86 收官：42/42 全达标

## 结论

**R86 云函数超时手改全部完成并经终值回读证实**：42/42 与定值表零偏差。
`│ 3 │`（平台默认 3 秒）命中 = **0** —— round44 §⑤ 的「终值回读」判据已履行，上线第一步的 3 秒卡点彻底解除。

| 定值 | 函数 |
|---|---|
| 60s | adminExport、exportData（导出类） |
| 30s | initDb |
| 15s | smokeTest |
| 20s | 其余 38 个 |

## 终值回读证据（我方独立跑，非并发方自述）

- `node` 脚本逐个 `cli cloud functions info --project <repo> -e cloud1-d4gphpoxy337f2a25 --names <fn>`，42 次回读全部命中期望值。
- 权威证据：`review/evidence/r86_timeout_20260919/ground_truth_42.json`（42 条 expect/got/ok）。
- `results.json` 同目录：42/42 ok=true（其中 adminInit / smokeTest / payQueryEntitlement 三个曾误判 ok:false，已按 ground truth 修正并注明「ground_truth_42 复核修正」）。

## 过程要点（钉子户根因，全部实证）

1. **模拟器模态框级联（最大坑）**：IDE 弹「模拟器长时间没有响应」模态框挡死工具栏 → `reopen_console()` 点云开发按钮全部落空 → `[FATAL] 重开失败` 级联跳过 36 函数（batch hh4rHW，52 分钟仅成 6/42）。处置：OCR 定位后点「终止模拟器」杀卡死模拟器；脚本加固 `dismiss_ide_dialog()`（重开前自动检测处置）。
2. **OCR l→I 误读（11 个 version-page-not-loaded 的真因）**：版本页其实已加载，但 OCR 把 `calcAmortize` 读成 `caIcAmortize`（小写 l → 大写 I），子串匹配假阴性。修复：`_norm()` 归一化（l/I/1/| → i）后再匹配（`ocr_has_fn`）。
3. **被遮挡误判冻结**：`probe_alive` 靠 hover 高亮判活，控制台被遮挡时鼠标移到遮挡窗口上 → 误判冻结 → 无谓关窗重开。修复：`ensure_console` 先置顶置前再判 alive。
4. **smokeTest 输入假失败**：值 15 早已输入成功，OCR 读不出聚焦输入框白字数字（截图肉眼可见）。终判以点确定后 CLI 回读为准。
5. **adminInit 回读竞态**：改完立刻回读撞云端同步延迟（got=3，实际已 20）。MISMATCH 应隔时复读再定论。

## 交接收尾

- `REVIEW_2026-09-15_round38-verify.md`、`索引补齐核对单.md` 两个 M 文件为并发方在途改动，本次提交**不夹带**。
- 重启键 §1.1 已追加 round45 段（本节摘要）。
- 工具脚本（工作区 `_gui/`，不入仓库）：`settimeouts.py`（含 dismiss_ide_dialog/_norm/ocr_has_fn/ensure_console 加固）、`readback_final.py`（终值回读）、`fix_results.py`。

## 回执

- [2026-09-19 16:05] R45 已落 · 证据：`readback_final.py`（42× `cli cloud functions info`）→ 42/42 OK、`│ 3 │`=0，`ground_truth_42.json` 落盘 · commit `748f359`（dev）
