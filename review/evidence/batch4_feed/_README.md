# 批次 4（M1/M2/M3 页面闭环 + 店铺设置）投喂留证 —— 2026-09-16 17:33

## 依据
round19 §3 裁决①（**批次 4 可投喂 = 已解禁**）、§4 裁决②（**先并 23 条 → 提交 → 再投批次 4**）。
本仓 `a73b5fb` = HEAD = `origin/dev`（并入 23 条 + round19 回执 + 索引「唯一」放大证据）**先落地并推完**，工作树干净后才投。

## 动作
- 载荷 = `specs/dev-specs/delivery/批次4_提示词_可直接复制.txt` **原文逐字** + 尾部追加 10 条本轮硬约束
  （页面向：禁改 `cloudfunctions/common/`、禁改批次 1~3 云函数、页面放仓库根 `pages/`、
  禁前端计算、金额 `Math.round(元×100)` 转整数分 number、文案全走 `i18n/terms.js`、归档月只读 /
  软删隐藏+二次确认 / 付费弹窗仅两类触发 / M2 永不弹 / 开关以服务端为准、错误码统一映射、
  不实现支付与后台、必须交「逐页文件清单 + §5 七条验收表 + 新写/调用的边界说明」）。
  载荷共 **11,595 字节**，经**剪贴板 + Ctrl+V** 送进聊天框（不用打字 —— 搜狗输入法会吞字母）。
- 通道：`inscode-desktop-feed`（自检通过：`hwnd=2424854`、剪贴板回读命中）。

## 证据
| 文件 | 说明 |
|---|---|
| `批次4_投喂前_载荷已在输入框.png` | 发送**前**：输入框内含 `# 批次 4 / 8 · M1 / M2 / M3 页面闭环 + 店铺设置` 首行 + 右侧滚动条（确认载荷完整、未丢字，再回车） |
| `批次4_已发送_InsCode开工_t25s.png` | 发送后 **t+25s**：消息气泡已成历史（含「显示更多」）、状态 `运行中`、`正在执行 bash 36s`，InsCode 自述「开始批次 4。这是一大批，先摸清现状：现有页面、`app.json` / `app.js` / `i18n/terms.js`、批次 1~3 云函数接口，再规划页面清单。」⇒ **开工确认** |

## 复核清单（产出回来后逐条对，与 round19 §3 一致）
① 多版本写入真能跑（同 `card_code` 连存两次 → v1/v2 两行并存，撞复合唯一索引即**响亮失败**）；
② 归档月全字段只读；③ 软删列表默认隐藏 + 二次确认；④ 计算下沉（页面不做金额计算）；
⑤ 文案全走 i18n（页面里搜不到硬编码文案）；⑥ 付费弹窗只在「保存超限 / 导出」触发、**M2 永不弹**；
⑦ 店铺开关以服务端 `shop_switch` 为准。
另：**硬约束核验** —— `git diff --stat -- cloudfunctions/common cloudfunctions/calcMonthlyProfit cloudfunctions/calcAmortize` 须为空（批次 0~3 未被改）。

---

## 审批①（首个人工闸口）：新建 8 个云函数目录 + 同步 common 副本 —— 已核并**批准**

## 弹窗原文（逐段滚动读全，非只读可见部分）

```
cd /c/Users/lzj/WorkBuddy/Claw/catering-profit/cloudfunctions
&& for f in calcSandbox getShopContext saveShopSetting
saveLedger getLedger getMonthList saveAsset getAmortSchedule;
do
mkdir -p "$f"                                   ← 该行降部被代码块下沿裁掉，OCR/目视均形近 `-n`
printf '{ "name": "%s", … "wx-server-sdk": "~2.6.3" … }' "$f" > "$f/package.json"
done
cd /c/Users/lzj/WorkBuddy/Claw/catering-profit && node tools/sync_common.js && echo "OK"
```

平台告警为「**这条命令会删除指定路径**／会覆盖写入文件 `$f/package.json`」—— 属 `>` 重定向的**通用启发式告警**，不是真的 `rm`。

## 判定依据（批准前实测，不靠猜）

| 检查 | 结果 |
|---|---|
| ① 8 个新名是否与既有目录重名 | **全不重名**（既有 11 函数：calcAmortize/calcBom/calcMonthlyProfit/detectCycle/getCostCard/getMaterial/initDb/saveCostCard/saveMaterial/smokeTest/syncCostCard）⇒ **无任何现有 `package.json` 被覆盖** |
| ② `>` 的落点 | 只落在 **8 个新目录**内 ⇒ `>` 截断的"覆盖"告警在此为空 |
| ③ `sync_common.js` 会不会动批次 1~3 | **批准前先跑 `--check`（只读）= EXIT 0**，11 个既有目录副本 ≡ 单源 ⇒ 本次 sync 对既有目录**零改动（幂等）** |
| ④ 有无 `rm -rf` / 网络 / 提权 | **无**。仅 `mkdir -p` + `printf >` + 本仓脚本 |
| ⑤ 门禁会不会被"空目录"打红 | **不会** —— `verify_all.js` / `check_requires.js` **动态枚举**，无硬编码函数数 |

## 批准后落盘（实测，非自报）

- `git status --short` → **只有 8 个 `??`（新增目录），没有任何 `M`（修改）** ⇒ 批次 1~3 一行未动；
- `cloudfunctions/` 目录数 **12 → 20**（11 函数 + common → 19 函数 + common）；每个新目录含 **11 个文件**（package.json + 扁平派生 `common.js`/`cx_*.js`，无子目录 —— 合云端扁平范式）；
- `cloudfunctions/calcSandbox/package.json` = `{name:calcSandbox, version:1.0.0, main:index.js, dependencies:{wx-server-sdk:~2.6.3}}` —— 与既有 11 个**同模板**；
- `node tools/sync_common.js --check` → **19 个目录副本均 ≡ 单源，EXIT 0**；
- `node verify_all.js` → **17/17 套件通过，EXIT 0**。

原始输出：`审批1_批准前后实测_20260916.txt`；命令全景：`审批1_新建8函数目录与同步副本_命令全景.png`。

## 本轮新增的**契约缺口**（待裁决，非阻塞）

8 个函数名中 **6 个可在权威契约 `specs/dev-specs/core/10_云函数清单与接口契约.md` 找到**
（`calcSandbox` 明标"对齐批次 4 函数名"；`getMonthList`/`getLedger`/`saveLedger`/`getAmortSchedule`/`saveAsset` 均在该表），
但 **`getShopContext` 与 `saveShopSetting` 全仓零命中**（`grep -r` 覆盖 `*.md/*.js/*.json/*.txt`）。
二者对应批次 4 页面清单第 10 项「**店铺设置页**（库存开关 / 摊销开关 / 店铺名称与备注，写 `shop_switch`）」——
即**规格给了页面、没给端点**，InsCode 只能自拟名。契约表里的 `shopList`/`shopSwitch` 语义是"多店切换器"，**不能顶替**。
⇒ 待裁决：**补进契约表**（倾向）／改名对齐／或合并进既有函数。另 `getShopContext` 与 `auth` 中间件的"首次建档"职责需划清，避免两处都写 `shop`/`shop_entitlement`。
