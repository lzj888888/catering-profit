# REVIEW 2026-09-18 · round38 · 上线前适配项（AD）静态走查缺口清单

## 0. 一句话结论

按 `specs/dev-specs/` 里的 AD-1~AD-26 上线前适配项逐条静态扫描，**代码里确认存在 8 类缺口**，其中
**字号 < 28rpx（19 条）** 与 **触控高度 < 88rpx（6 处）** 是面最广的两类；
另有一批「**关键词在文档里出现、代码里 0 实现**」的项（热更新/头像昵称/震动/场景值/键盘顶起/onUnload/离线提示），
以及 **1 个「定义了但从未调用」的死代码**（`utils/api.js:53 debounce`）。

> ⚠️ 本文**只做静态扫描（grep）**，不做运行时验证。凡是"0 实现"结论，均已排除 `specs/` 与 `review/`
> 内的文档引用后再计数（原始对照见证据文件）——**文档里写了 ≠ 代码里有**，这正是本轮要抓的漂移。

## 1. 证据文件

| 文件 | 内容 |
|---|---|
| `review/evidence/ad_gap_20260918/raw_scan.txt` | 关键词「含文档」vs「仅代码」双计数对照 |
| `review/evidence/ad_gap_20260918/wxss_metrics.txt` | 19 条小字号、触控高度、23 个数字输入分布 |

复现命令（仓库根）：

```bash
# 双计数对照：先全仓计数，再剔除 specs/ review/ 后计数
grep -rn -- "vibrateShort" --include=*.js --include=*.wxml --include=*.json . \
  | grep -v node_modules | wc -l                       # 含文档
# 同上再 | grep -v '^./specs/' | grep -v '^./review/'>  # 仅代码

# 字号 / 触控高度
grep -rnE "font-size:\s*([0-9]|1[0-9]|2[0-7])(\.[0-9]+)?rpx" app.wxss pages/
grep -rnE "(min-)?height:\s*([0-9]{1,2}|8[0-7])rpx"     app.wxss pages/
```

## 2. 缺口清单（按影响面排序）

### G1 · 字号 < 28rpx —— 19 条（🔴 面最广）
微信可读性下限经验值 28rpx；低于此值在中低端机 / 长辈模式下极易看不清。

| 文件 | 条数 | 具体 |
|---|---|---|
| `app.wxss` | 8 | `.label` 24、`.sub` 22、`.meta` 22、`.profit` 24、`.tag` 24、`.muted` 26、`.hint` 26、`.archived-bar` 26 |
| `pages/month/input.wxss` | 5 | `.g-toggle` 26、`.fg-title` 26、`.fg-toggle` 26、`.fg-line` 24、`.scope` 22 |
| `pages/month/amortize.wxss` | 3 | `.batch-title` 26、`.bh-txt` 24、`.bh-arrow` 24 |
| `pages/month/result.wxss` | 2 | `.drill-caret` 24、`.drill-sub` 26 |
| `pages/month/inventory.wxss` | 1 | `.lbl-col .muted` 24 |

⚠️ 注意 `.scope`（22rpx）就是 8c 新加的**填表引导口径说明文字**——引导文字自己却用了最小号，属于"重要内容最难读"。

### G2 · 触控高度 < 88rpx —— 6 处
微信建议触控目标 ≥ 88rpx（约 44px）。

| 位置 | 值 | 说明 |
|---|---|---|
| `app.wxss:31` `.btn-small` | 64rpx | 通用小按钮，全站复用 |
| `pages/month/input.wxss:13` `.btn-small.del` | 56rpx | 删除按钮，最易误触 |
| `pages/card/edit.wxml:29` 内联 | 56rpx | 删除行 × 按钮 |
| `pages/card/edit.wxml:36/58` 内联 | 72rpx | addLine / reverseCalc |
| `pages/card/edit.wxss:7` `.picker` | 60rpx | 选择器 |
| `pages/month/amortize.wxss:3` `.picker-val` | 60rpx | 日期选择器（摊销起始月） |

> 扫描同时命中 `height:20rpx/40rpx` 等若干条 —— 这些是**占位空白 view**，不是触控目标，不计入缺口。

### G3 · 数字输入未防键盘遮挡 —— `adjust-position` 代码内 0 命中 / 23 个数字输入
输入框被软键盘顶住看不见是录入类小程序最高频的体验事故。23 个 `type="digit"|"number"` 分布：
`pages/sandbox/index.wxml` 9、`pages/card/edit.wxml` 6、`pages/month/input.wxml` 3、
`pages/month/inventory.wxml` 3、`pages/month/amortize.wxml` 2。
`adjust-position` 默认虽为 true，但**在 `cursor-spacing` 未配 / 页面有 `position:fixed` 底栏时仍会遮挡** ⇒ 需显式声明。

### G4 · 热更新 `getUpdateManager` 0 命中
发新版后用户端不会自动更新；小程序冷启动会拉到旧包。需在 onLaunch 里检测并 applyUpdate。

### G5 · 头像昵称填写 `chooseAvatar` 0 命中（且旧 `getUserProfile` 也 0）
说明「我的」页目前**没有任何**头像/昵称获取能力。若产品要求展示用户头像昵称，需走 `chooseAvatar` + nickname `type="nickname"`（旧接口已收回）。

### G6 · 关键操作反馈 `vibrateShort` 0 命中
删除资产、提交账本等不可逆操作无触觉反馈（可低优先）。

### G7 · 场景值 `options.scene` 0 命中
无法区分"扫码进 / 分享进 / 搜索进"，也就没法做来源归因与差异化落地（配合后续投放必需）。

### G8 · 页面卸载清理 `onUnload` 0 命中 + 离线提示 0 命中
`onUnload` 缺失 ⇒ 定时器/监听若未清理会泄漏；`onNetworkStatusChange` / `getNetworkType` 均 0 ⇒ **断网时无任何提示**，用户会以为是白屏或卡死。

## 3. 附带发现（非缺口，但需知悉）

- **死代码**：`utils/api.js:53` 定义了 `debounce(fn, wait)`，但**全仓 0 处调用** ⇒ 防重复提交实际未生效（AD-6 形同未做）。
- **已做对的部分**（扫描为证，勿重复提）：
  - 下拉刷新：11+ 个页面 `enablePullDownRefresh: true` + `onPullDownRefresh` 且均 `stopPullDownRefresh()`；
  - 草稿暂存：`pages/month/input.js:78`、`pages/month/inventory.js:58`（`wx.setStorageSync`）+ `utils/shopSwitcher.js:28` 店铺持久化；
  - 暗色模式：`app.wxss` 有 `@media (prefers-color-scheme: dark)`；
  - 日期控件：`mode="date"` 仅 `pages/month/amortize.wxml:95/106` 两处，**无手工填月残留**。

## 4. 边界与未覆盖（不得据此宣称"已验"）

- 本轮**全部为静态 grep**，**没有一项经过运行时/模拟器验证**。
- 「0 命中」只证明**该关键词不存在**；若实现用了等价写法（如封装在 `utils/` 里用别的 API 名），本扫描看不见 ⇒ 送快马修之前**需由写码方确认是否真缺**。
- 触控高度只扫了 `*.wxss` 与内联 `style`；`wxml` 里通过 class 组合产生的实际高度未算。

## 5. 下一步

1. 待 42 个云函数逐个重部署完成 + 行为探针确认全部 BIZ（非空壳）后，**重新走查 14 页**，
   用真实数据再判一遍（避免把"空壳导致页面空"误判成"功能缺失"）。
2. 上表 G1–G8 整理成投喂包交**快马 inscode** 改码（写码归快马；我只登记与复核）。
3. 改完后**回灌验证**：重跑本文 §1 的复现命令，19 条字号 / 6 处触控高度须归零。
