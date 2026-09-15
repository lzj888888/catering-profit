# R37 · `packOptions.ignore` 生效性「直接证据」（2026-09-16）

> 本目录是 `REVIEW_2026-09-15_round12-verify.md` **§10 执行回执**的证据。
> 结论一句话：**`packOptions.ignore` 的 `folder: specs` 规则已加载生效 —— 有直接证据，不是推理。**

## 为什么需要这次验证

`代码包 9 KB`（真机预览面板）**不能**证明 `packOptions.ignore` 生效：
`ignoreDevUnusedFiles: true`（工具自己写进 `project.private.config.json` 的私有设置）会把无依赖文件一并过滤，
两条机制效果重叠 —— 9 KB 在"ignore 生效"和"ignore 未生效"两种情况下**都会出现**。

## 方法：哨兵法（可逆）

让目标文件**不可能**被 `ignoreDevUnusedFiles` 过滤（它必须是"被使用文件"），
再让它**只可能**被 `packOptions.ignore` 挡住。

1. 在 `specs/dev-specs/prototype/`（命中 `folder: specs`）放 `_sentinel_r13.js`，**410,230 bytes = 400.6 KB**
   合法 JS（大块注释 + `module.exports`）。选 `.js` 是因为它**不在** suffix 忽略列表里，只有 folder 规则能挡。
2. `app.js` 顶部临时插 `require('./specs/dev-specs/prototype/_sentinel_r13.js');` ⇒ 成为"被使用文件"。
3. 点「预览」。

## 证据链

| 文件 | 内容 |
|---|---|
| `01_哨兵版_编译报错_module未定义.png` | 哨兵版预览：console 出现 `MiniProgramError` |
| `02_错误原文_放大3x.png` | 该错误区放大 3×，供 OCR/人眼读原文 |
| `03_还原后_代码包9KB_正常.png` | 还原后重新预览：`编译提示 183 ▸ 代码包 9 ▸`，无 Error、模拟器正常 |
| `app.js.还原基线` | 哨兵实验前的 `app.js` 备份（用于还原） |
| `ocr_locate.py` / `ocr_word.py` | 读屏 OCR 定位脚本（模型无图像输入时的取证工具） |

**错误原文**（OCR 逐字读出，未改写）：

```
@<Error: MiniProgramError
Error: module 'specs/dev-specs/prototype/_sentinel_r13.js' is not defined, require args is
'specs/dev-specs/prototype/_sentinel_r13.js'
  at … WAAutoService.js
  at … WASubContext.js
  at … /_dev_/appservice/getmainpackagebundle.js…:239:1
```

⇒ 磁盘上确实有那个 400.6 KB 文件，包里却没有它 ⇒ **ignore 生效**。
（若 ignore 未加载：包体会变成 ~400 KB 且预览正常 —— 现象完全不同。）

## 还原（已逐项核过）

- 删除哨兵（`ls` 确认 No such file）
- `app.js` 从 `app.js.还原基线` 还原：`node --check` OK、`git diff --stat` 空
- `git status --short` 空（工作树干净）
- 还原后再预览：9 KB、无 Error

## 复用提示

- 同法可验 `review` / `cloudfunctions` / `tools` / `web-preview` / `.inscode`（folder 型）。
- suffix 型（`.md` 等）**不能**照搬：`.md` 无法被 `require`。需改走"图片 + wxml 引用"变体。
- **代价**：会故意制造一次编译错误；务必先备份、后还原、还原后复验。
