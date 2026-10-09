# R253 上云闭环 · 部署取证（2026-10-09 夜）

## 一 为什么这一批要部署

R253（`27d223b` 落地 / `6eb239a` 加严）改动了两个云函数，但**落地后一直没上云**：

| 函数 | R253 改了什么 | 不上云的后果 |
|---|---|---|
| `getDishReview` | M1+M2：**读 `shop_dish_mapping` 映射表**并注入 `lookupCardCode`（菜名→成本卡） | 云端仍是字面比对 ⇒ 平台把菜名改成「【招牌】耙牛肉(小份)」就**整道菜掉进未匹配且不报错** |
| `importSalesBill` | D1~D3：多平台同时命中 ⇒ 返回 `AMBIGUOUS` 哨兵，拒绝代选；并含 **R249 的 `is_deleted:false` 注入** | 多平台签名撞车时闷头按先匹配的跑；且裸写缺 `is_deleted` ⇒ **写入成功但读侧（强制 `is_deleted:false`）读不出来** |

> 对照：R252（`d45a64f`）部署的是 `getSalesBills` / `clearSalesBills` —— **不是这两个**，
> 所以 R253 的成果此前**只在本地、云端是旧的**。

## 二 部署判据（不看 `rc`，只看表格行）

按技能 `miniprogram-cloud-deploy`：`cli.bat` 部署失败也返回 `rc=0` ⇒ **rc 永不作判据**；
唯一判据 = 日志里有没有 `│ <fn> │ true │ N │ 'x KB' │` 行 + `√ deploy cloudfunctions` 完成行。
判据工具 `_judge_deploy.js`（按 latin1 读原始字节，绕开 GBK/UTF-8 之争，也**不拿 `│` 做匹配**）。

```
$ python review/evidence/_deploy_fns.py getDishReview importSalesBill
ENV = cloud1-d4gphpoxy337f2a25   待部署 2 个

[getDishReview]   try1 rc=0 用时=22.1s HIT │ getDishReview   │ true │ 19 │ '49.6 KB' │
[importSalesBill] try1 rc=0 用时=25.4s HIT │ importSalesBill │ true │ 20 │ '62.2 KB' │

===== 部署汇总 =====  2/2 OK
```

两者 `ALL_ROWS_HIT = true` / `DONE = true`，**一次通过、无需重跑**。

## 三 `filesCount` 对账（回磁盘数，不凭记忆）

> 口径：该函数目录下**全部文件**（含 `package.json`/`config.json` 等非 `.js`），排除 `node_modules`。
> 只数 `.js` 会系统性差 1~2 ⇒ 曾把 42/42 全判成假红。

| 函数 | 云端 `filesCount` | 本地磁盘数 | 结论 |
|---|---|---|---|
| `getDishReview` | 19 | **19** | ✅ 一致 |
| `importSalesBill` | 20 | **20** | ✅ 一致 |

## 四 部署后 `info` 回读（`fn_info_after_deploy.txt`）

```
│ getDishReview   │ 'Active' │ 20 │ 'Nodejs16.13' │
│ importSalesBill │ 'Active' │ 20 │ 'Nodejs16.13' │
```

- 两函数均 **`Active`**，`runtime` = `Nodejs16.13`。
- **`timeout` = 20，不是平台默认 3** ⇒ 本轮**无需**手工抬超时
  （对照 R215c：`importSalesBill` 曾残留 3，R215d 已抬到 20；本次回读证明**部署没有把它冲回 3**，
  与「timeout 只随人改、与部署无关」的定论一致）。
- 🔴 **部署面 = 2 个，不是 43 个**：R253 **未改动** `cloudfunctions/common/`
  （`git show --stat 27d223b 6eb239a -- cloudfunctions/common/` ⇒ 命中 **0**）
  ⇒ 不触发「改 common ⇒ 全部 `cx_*.js` 派生 ⇒ 43 个全部署」那条规则。

## 四-bis 真机预览码（`qr_R253.jpg`）

```
$ cli preview --project <仓根> --qr-format image --qr-size 400 -o qr_R253.jpg -i qr_meta_R253.json
√ Using AppID: wx33c110dc57a9c8dc
√ preview
```

| 项 | 值 |
|---|---|
| 文件 | `qr_R253.jpg`（**470×470** 实际像素，47591 字节，JPEG SOI/EOI 完整） |
| md5 | `548b57bacbe8dcbaa2c45ff10714e72a` |
| 包体 | **508.8 KB**（520971 字节，`qr_meta_R253.json`）—— 微信硬上限 2 MB，**余量充足** |
| AppID | `wx33c110dc57a9c8dc` |

> ⚠️ **验码深度如实说明**：本轮**只做了「出码成功 + 图片结构完整 + 尺寸取证 + 目视三定位角在位」**，
> **没有做机器解码**（本机无 `cv2`/`PIL`，不值得为一个只读校验去装 OpenCV）。
> ⇒ 判据强度：**「码生成出来了」= 已证**；**「码能被微信扫开」= 未证**，以真机扫码为准。
> ⚠️ 预览码**有有效期**，过期请重出（技能 `miniprogram-preview-qr`）。

## 五 还没做完的（别把「部署成功」当「功能可用」）

`cli` **没有 `invoke` 子命令** ⇒ 命令行拿不到云函数运行结果。真云功能验证只剩两条路：

1. **真机点一次**（唯一硬判据）：`pages/card` → 工具 → takeaway 第二 tab → 选文件 → 预览 → 确认；
   🔴 源码级前置：`wx.chooseMessageFile` 只能从**微信聊天会话**里挑文件，且 `extension:['xlsx']` ⇒ **不认 `.xls`**。
2. **模拟器 + 逻辑层探针**：`mp.evaluate` 走逻辑层 eval（不依赖 pageMeta）⇒ 可调 `wx.cloud.callFunction`
   取真云事实（R188 已打通）。

**待复验的三条**（对应 #301）：
- **A1 映射接线生效**：造一条 `shop_dish_mapping`（`dish_key='【招牌】耙牛肉(小份)'` → 某 `card_code`）
  ⇒ 复盘时该菜应从 `unmatched` 变 `ranked`。
- **A3 多平台拒绝**：一张同时含淘宝+美团签名的表 ⇒ 不返回任一平台，而是走手选通道报可读错误。
- **R249 复验**：重导同一份淘宝闪购文件 ⇒ `getDishReview` 应**真的出数据**（此前是「落库 354 行却全程空态」）。

## 六 通道备注（本轮实测）

- IDE GUI 进程数 = **0**（未起窗口），但 `cli` 自起 headless server 成功
  （`√ IDE server has started, listening on http://127.0.0.1:10896`）⇒ **本次部署不需要键鼠启 IDE**。
- 未撞 `PROGRAM BLOCKED … reg.exe`（黑名单未拦），也未撞 `wait IDE port timeout`。
- `.ide-status = On` 但 IDE 进程为 0 —— 再次坐实「**On ≠ 服务端口可用**」，判「IDE 起没起」要查进程或看 `server has started` 行。
