# R181o · 真机预览码出不来：根因「源码包超限」+ 修复 + 回归

> 一句话结论：**出码失败的根因不是 IDE / 登录 / 自动化通道，而是仓库里 `_m3/`（116.1 MB 截图堆）没进 `packOptions.ignore`，
> 被当小程序源码打包上传 ⇒ 服务端拒收（`code 10 · source size 118969KB exceed max limit 2MB`）。
> 补一条 ignore 后入包 **116.86 MB → 0.76 MB**，出码一次成功。**

## 一 症状（先记清楚，别再误判）

`cli preview` 在修复前**连跑 6 次全败**，且**每次都死在同一处**：

| 阶段 | 结果 |
|---|---|
| 起 headless server | ✅ `√ IDE server has started, listening on http://127.0.0.1:39721` |
| 取 AppID | ✅ `√ Using AppID: wx33c110dc57a9c8dc` |
| **上传** | ❌ `× Uploading` ⇒ 无产出 |

⚠️ 这与历史记录的两种失败**都不同**：以前是 `× wait IDE port timeout`（server 起不来）。
本次 server 正常、AppID 正常 ⇒ **`× Uploading` 是独立的一类失败**，要单独排查。

## 二 真因：拿脚本把完整报错捞出来

`_qr_retry.py` 只打印含关键词的行，详细错误被丢。写 `_r181o_diag_preview.py` 跑**一次** preview、
把 stdout/stderr **全量**落盘 ⇒ 一次命中（`probe_diag_preview_code10.log`）：

```
[error] {
  code: 10,
  message: 'Error: 错误 Error: 源码包超出最大限制,source size 118969KB exceed max limit 2MB [20261001 09:42:58]'
  ...
}
```

`118969 KB ≈ 116.2 MB`，超 2 MB 上限 **59 倍**。

## 三 体积定位（`_r181o_packcalc.py`，按 ignore 规则实算）

| 层 | 体积 | 是否被 ignore |
|---|---|---|
| `review/` | 207.16 MB | ✅ 已 ignore |
| **`_m3/`** | **116.42 MB** | ❌ **未 ignore** ← 元凶 |
| `cloudfunctions/` | 3.80 MB | ✅ |
| `pages/` + `utils/` + `miniprogram/` | 0.60 MB | 需要（应打包） |

`_m3/` 内部：**747 个文件 / 115.83 MB 是 .png**（round179 起的调试截图堆，`db` / `wm` / `dbai` / `cb` 四个子目录）。

🔴🔴 **关键教训：`.gitignore` ≠ 微信打包 ignore。**
`_m3/` 早在 `.gitignore:32`（round179 补）里被忽略、**未进 git** —— 但微信开发者工具**不读 .gitignore**，
它只认 `project.config.json::packOptions.ignore` ⇒ 本地磁盘上有什么就打什么。

## 四 修复（一行，可逆、零删除）

`project.config.json` → `packOptions.ignore` 补一条：

```json
{ "type": "folder", "value": "_m3" },
```

（放在 `review` 之后；列表 12 → 14 条。R37 那次立的「打包防线」本就该覆盖这类临时目录，只是漏了它。）

**未删除、未移动任何文件** —— `_m3/` 原样留在磁盘，只是不进包。

## 五 回归证明

| 项 | 结果 | 证据 |
|---|---|---|
| 入包体积 | **116.86 MB → 0.76 MB**（< 2 MB ✅） | `probe_packcalc_after.txt` |
| 出码 | **一次成功**（`√ preview`，59.5 s），TOTAL **358.1 KB / 366698 B** | `probe_qr_retry_R181o2.log` |
| 码可扫 | 解出 `https://mp.weixin.qq.com/a/~~xU5X-h-gWyw~QWE-LkhLO_Ma1j5xxDrPiA~~` | `probe_qr_verify.txt` |
| 实印尺寸 | 317 / 250 / 199 px **三档全解出**（余量 −37% 仍可解） | `probe_qr_printsize.txt` |
| 门禁 | **122/122 · RC=0 · 真 FAIL=0** | `gate_181o_1.txt` |
| 交付 | 对话图（x2）+ 打印 1 页（实测 `实打 1 页`）+ 桌面 jpg | 见下方 meta |

码留档：`qr_R181o2.jpg`（470×470，md5 `f72ad8ab59a9c6c737dfe2f9aaacb048`）· 元数据 `qr_meta_R181o2.json`
（出码 2026-10-01 09:50:07，失效约 10:15:07，HEAD `21f0e35`）。

## 六 顺带确认的工具事实

1. ✅ **IDE 窗口最小化（`237x39`）时 `MoveWindow` 无效** —— 必须先 `ShowWindow(SW_RESTORE=9)`。
   已给 `_r181n_win.py` 补 `restore` 子命令（`resize` 里也先还原）。
2. ✅ **`_m3/` 这类"进 .gitignore 的调试目录"要同时进 `packOptions.ignore`** —— 两者互不代管。

## 七 未做 / 存疑

- **未动 `_m3/` 本身**（不删不移）。它是历史取证材料，清理需李老师单独授权。
- 仍在未忽略列表里但**体积不影响出码**的小项（合计 < 1 MB）：`_bak_r70/`（0.074 MB）、根目录若干 `_mut_r*.py`、
  `admin-h5/`（0.016 MB）。**本轮只治病灶**，这些小项留待仓库整理时一并处置。
- 修复**只改了打包配置**，**未改任何业务代码**。
