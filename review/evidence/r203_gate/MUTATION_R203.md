# R203 变异回灌证据 · check_uri_codec_pairs.js

本轮变异**未走脚本自动化**（`mut_r203.py` 写 `pages/metrics/impact.js` 被本机安全中心规则拦截，
`PermissionError: [Errno 13]`），改用受控编辑通道**逐条手工变异 + 逐条还原**。
每条都先确认锚点命中数 `== 1`，跑完守卫立刻还原并复跑基线。

## 基线

```
node tools/check_uri_codec_pairs.js  →  [uri-codec] 12 通过 / 0 失败   RC=0
```

## 组 A：退回真实旧 bug（期望「有效红 + 点名目标断言」）

| # | 变异内容 | 结果 | 守卫红在哪 |
|---|---|---|---|
| A1 | `onLoad` 把 `material_name: decodeParam(q && q.name)` 退回 `(q && q.name) \|\| ''` | rc=1 / 11 通过 1 失败 | **C-③**（点名） |
| A2 | `decodeParam` 内把 `decodeURIComponent(out)` 换成 `String(out)`（只剩透传，等于没解码） | rc=1 | **A-③ + A-④ + C-②** |
| A3 | `decodeParam` 函数体改成立即返回入参，另留一个不会被调用的死函数承载字符串 | rc=1 / 9 通过 3 失败 | **A-③ + A-④ + C-②** |

> A2 的守卫输出是**实测抓到的**（脚本在还原步被拦、文件停在变异态，随即手工跑守卫取得）：
> ```
> ❌ A-③ 至少 1 个页面具备解码能力（实际 0）
> ❌ A-④ pages/material/index.js:220 编码跳转 → 目标页 pages/metrics/impact.js 必须解码
> ❌ C-② impact.js 确实解了 URL 参数名（decodeURIComponent 在位）
> ```

## 组 B：等价改写（期望「保持绿」，证明判**行为**不判**字面**）

| # | 变异内容 | 结果 |
|---|---|---|
| B1 | 删掉 `decodeParam`，改成**内联 IIFE** `try { decodeURIComponent(...) } catch` —— 换名字、换形态，行为等价 | rc=0 / **12 通过 0 失败** ✅ 保持绿 |
| B2 | 解码循环上限 `i < 2` → `i < 3`（行为等价） | rc=0 / **12 通过 0 失败** ✅ 保持绿 |

## 还原核对

三条组 A + 两条组 B 全部还原后：
```
node tools/check_uri_codec_pairs.js  →  [uri-codec] 12 通过 / 0 失败   RC=0
sed -n '17,27p;47,49p' pages/metrics/impact.js  →  与改动前逐字一致
```

## 结论

**组 A 3/3 有效红（且全部点名到目标断言，不是崩溃红）· 组 B 2/2 保持绿 · 还原基线全绿。**

## 🔴 本轮新增可复用坑

**变异脚本写仓库源码文件可能被本机安全中心规则拦**（`PermissionError: [Errno 13]`，
报错形如 `Blocked by Security Center rules: write <路径> (rule: <路径>)`）。
- 现象：`mutate` 成功、`restore` 被拦 ⇒ **文件停在变异态**，若不检查就会把变异体提交上去。
- 正解：① 变异/还原一律走**受控编辑通道**（Edit 工具）逐条做，每条跑完立刻还原；
  ② 若已用脚本，**跑完第一件事是回读源码 + 复跑基线**确认还原，再继续别的事。
