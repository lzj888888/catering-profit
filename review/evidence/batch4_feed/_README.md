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

---

## 审批②（第 2 个人工闸口）：跑 saveLedger 自测 + 批次4 语法自检 —— 已核并**批准**

## 弹窗原文（顶/体/尾逐屏读全）

```
cd <root> && echo "=== saveLedger ==="; node cloudfunctions/saveLedger/selftest.js;
echo "exit=$?"; echo "=== syntax check all batch4 ==="; cat > /tmp/s4.js << 'EOF'
const fs=require('fs'),path=require('path'),vm=require('vm');
const dirs=['calcSandbox','getShopContext','saveShopSetting','saveLedger', …8 个];
let bad=0;
for(const d of dirs){const dir=path.join(process.cwd(),'cloudfunctions',d);
  for(const f of fs.readdirSync(dir)){ if(!f.endsWith('.js'))continue; const p=path.join(dir,f);
    try{ new vm.Script(fs.readFileSync(p,'utf8'),{filename:p}); }
    catch(e){ bad++; console.log('FAIL',d,f,e.message); } } }
console.log(bad===0?'ALL OK':'BAD '+bad); process.exit(bad?1:0);
EOF
node /tmp/s4.js; rm -f /tmp/s4.js
```

**这次是真的有 `rm` 才去读全文的**（告警写「会删除文件 `/tmp/s4.js`」）—— 结论：唯一删除是 `rm -f /tmp/s4.js`，
目标是**它自己刚写的临时文件**；heredoc 体是**语法自检**（`vm.Script` 只编译不执行、不碰数据）；另仅只读跑一次自测。
无网络 / 无提权 / 不写仓库 ⇒ **允许**。

## 批准后实测（含一次"自我打脸"留痕）

- `git status --short` → 仍只有 8 个 `??`（无 `M`）；`git diff --stat` → 空 ⇒ 此刻批次 1~3 未动。
- 独立复跑它的自测：`calcSandbox` **18/18**、`saveLedger` **12/12**（**它自报的 18/18 属实**）。
- ⚠️ **但数分钟后复跑门禁 ⇒ `16/17`（EXIT=1），门禁 A-L 组红**。**我先写下的"17/17"是错的，已在留证文件内自纠、原文未删。**
  - 断裂 = **K11**：`miniprogram/i18n/terms.js` 与 `specs/dev-specs/i18n/terms.js` **双副本漂移**；
  - `git diff --no-index` 两份 ⇒ **49 insertions**：新增 `// ===== 十、批次 4 页面通用文案（补录，避免 wxml 硬编码）=====` 的 `ui: { … }`（≈47 键）；
  - 同窗口 `git status` 出现 6 个 `M`（`app.js`/`app.json`/`app.wxss`/`miniprogram/i18n/terms.js`/`pages/index/index.{js,json,wxml}`）+ 2 个 `??`（`utils/api.js`、`utils/ui.js`）
    ⇒ **InsCode 已正式进入"页面"阶段**，方向正确（文案进 i18n、页面取词），只是**漏同步主副本**；
  - 处置：**不代它改**（同批内它还会继续写 i18n，我改易被覆盖/冲突）⇒ 列复核清单第 ⑧ 条。

## 复核清单（新增第 ⑧ 条）

⑧ **门禁 A-L 恢复全绿** —— 具体 = 把上述 49 行 `ui.*` 块**镜像进主副本 `specs/dev-specs/i18n/terms.js`**（K11 以主副本为准），
或反向以主副本重新派生 `miniprogram/i18n/terms.js`；**并且**批次 4 若新增错误码/i18n 键，`core/09 §1`+`§3` 与 `terms.js` 三处要同增（A/B 类）。

---

## 附：2026-09-16 20:20–20:45 · 余额耗尽导致「响应中断」的排查与修复（WorkBuddy 桌面自动化）

### 现象
批次 4 跑到 `已处理 9m10s` 时中断，界面显示「请求失败，请查看原始报错」：
```
响应中断:为避免重复输出或工具执行,未自动重放;…此错误常见于公司网络或代理环境,
请检查代理/VPN/防火墙设置后重试。详情: error decoding response body:
error reading a body from connection: 远程主机强迫关闭了一个现有的连接。(os error 10054)
```
点「重新发送」后依旧失败（`turn-lifecycle.log` 显示连点 4 次，其中两次 5–6 秒即终结）。

### 根因（来自应用自己的遥测，不是猜）
上游与套餐写在 `inscode.db` 的 `turn_telemetry` 表里：

| turn | 起始 | 时长 | stop_reason | taotoken_plan | error |
|---|---|---|---|---|---|
| 3 | 19:42:26 | 539s | **ProviderError** | **free** | 连接被上游掐断，**无 HTTP 状态码** |
| 2 | 08:46:20 | 19506s | Stopped | free | — |
| 1 | 07:07:06 | 2340s | Stopped | free | — |

- `provider_host = https://api.taotoken.net/coding/v1`（淘Token）。
- 会话 `sessions.provider = taotoken/free` —— **钉死在免费套餐**，而免费套餐额度已耗尽。
- 充值 50 元后 `~/.config/inscode/taotoken.json` 于 19:20 新增 `pros[0]`（`api_key` + **29 个模型**），
  但 **会话没有跟着切** ⇒ 补发仍走旧套餐 ⇒ 再次被掐断。

### 修复动作（应用内 UI，非改文件）
1. `Ctrl+M` 打开模型切换器（工具栏底部模型芯片的快捷键，实测可用）。
2. 选择器里是**两组**，标题必须看清：
   - **`TaoToken 个人套餐`**：只有 1 个模型 = 免费套餐（当时在用）
   - **`TaoToken 个人余额`**：29 个模型 = **按充值余额计费**
3. 选中「个人余额」组的 `deepseek-v4-flash`（模型不变、只换计费通道，最省）。
4. 核实：`sessions.provider` 由 `taotoken/free` → **`taotoken/pro`**；
   `ui_preferences.last_model_selection` = `{model: deepseek-v4-flash, tier: pro, slot: pro}` ⇒ **新会话也会走余额套餐**。

### 顺带解决的两个卡点
- **僵尸租约**：切换后点「重新发送」报 `lease_rejected`（旧轮租约没释放），界面卡在「上一轮回复还在进行中」且按钮点了无反应。
  → **重启 InsCode**（`WM_CLOSE` 干净退出，无弹窗）后僵尸态清除，被中断的轮次自动续跑。
- **审批挂起**：`approval_audit` 显示有一个 `write_file` 审批在 20:31:29 挂起（等 72s 后被批准）；
  期间输入框发送会被提示「请先处理上方审批」。⇒ 长轮次中**审批是主要阻塞点**，需及时处理。

### 结果
修复后同一会话立刻恢复：`session-stream.log` 实时增量输出，交付侧的「已编辑 N 个文件」计数
**19 → 27 → 40 → 42** 持续增长（截图 `批次4_充值后切换个人余额套餐_恢复运行_20260916.png`），未再出现 `ProviderError`。

### 备忘（下次直接用）
- 入口：模型芯片（输入框右下）`Ctrl+M`；左下角**齿轮 = 设置**；界面缩小时底部工具条才不会被任务栏遮住。
- 「个人套餐」vs「个人余额」是**两个不同的计费通道**，名字像但含义完全不同 —— 选错等于没充值。
- 该应用本名是 **AtomCode/AtomGit 系**（`~/.config/inscode/` 下为 `config.toml` + `taotoken.json` + `inscode.db`），
  配置与遥测都在这里，排查问题时优先读 `turn_telemetry` / `approval_audit` / `logs/turn-lifecycle.log`。

---

## 附：2026-09-16 21:00 · 批次 4 终态确认与独立复核（结论：**已交付，已提交**）

### ① 怎么确认「它已经干完了」（补记上一段读不出结论的原因）
之前试图从 `sessions.body` 取最后一条 assistant 回复时得到 `assistant 消息数 0`，是**过滤条件写错**导致的假象：
该库 `messages[].role` 的值是**首字母大写**的 `Assistant` / `User` / `Tool` / `System`，
不是小写的 `assistant`（只读的函数签名Immediately——40 条以内的判断可以先确认角色大小写）。
正确写法：`[m for m in msgs if m.get('role')=='Assistant' and (m.get('text') or '').strip()]` → 非空 143 条。

另外两个确认跑完的硬指标：
- `logs/turn-lifecycle.log` 尾行 `20:43:21 turn_terminal complete ... plan=pro`（不再是 ProviderError）
- `inflight_turn` 表 0 行 + `session-stream.log` mtime 停止增长 ⇒ 已进入空闲，等待下一句。

### ② 独立复核（我自己跑的，不是采信模型自述）
| 复核项 | 手段 | 结果 |
|---|---|---|
| 全量门禁 | `node verify_all.js` | ✅ **21/21 套件通过**（含 batch4 ×4 selftest） |
| common 单源派生 | `tools/sync_common.js --check` | ✅ 21 个云函数目录扁平副本 ≡ `cloudfunctions/common/` |
| 依赖可解析 | `tools/check_requires.js` | ✅ 309 个 .js / 639 条 require（相对 616）全通过 |
| **K11 i18n 双副本** | `md5sum` + `diff` | ✅ **MD5 一致 `398f9bd4…`，diff 0 行**（此前是断裂红灯，现转绿） |
| 硬约束保护 | `git status` M 计数 | ✅ `cloudfunctions/common/`、`initDb/`、批次 1~3 云函数 **全部 0 改动** |
| 金额复算 | 手算 | ✅ 9160 − 3476.67 = 5683.33 ✔；347667分=3476.67元；333345分=3333.45元；975分=9.75元 |
| 契约缺口关闭 | 存在性检查 | ✅ `getShopContext`/`saveShopSetting` 等此前**全仓零命中**的缺口已建成并登记进 verify_all |
| 页面注册 | `app.json` | ✅ 11 页全存在；`pages/dish/dish` 已按说明移除（违反 AD-9 且无入口） |

### ③ 一处「模型说 0 命中、我扫出命中」的差异（已排雷，非问题）
模型声称「WXML 硬编码扫描 0 命中」，但我扫 `pages/` 得到 6 个文件共 30 余处中文。
逐行核对后确认**全部落在 HTML 注释 `<!-- … -->` 内**（如 `<!-- 双利润 -->`、`<!-- 核算模式 -->`），属开发注释而非用户可见文案。
用 `sed 's/<!--[^>]*-->//g'` 剔除注释后再扫 → **用户可见中文 0 命中**，模型的结论成立。
⇒ 教训：自己的扫描脚本要把注释排除掉，否则每次都会误报一轮。

### ④ 提交与推送
`529c0f8 feat(batch4): M1/M2/M3 页面闭环交付（8 页面 + 10 云函数 + i18n 双副本同步）`
共 196 个文件（12 M + 184 新增），已 push 到 `origin/dev`（`c78b952..529c0f8`），工作区干净。
按纪律**未用 `git add -A`**，而是逐个路径显式 add；提交前已确认被云服务实例"在飞"状态已结束。

### ⑤ 遗留（非阻塞，需真机）
iOS / 安卓真机验证四项：**键盘遮挡、小数键盘收起、侧滑返回、深色模式** —— 本地无法代跑。
代码层已落实（深色 media query、字号≥28rpx、按钮≥88rpx、`type="digit"`、`confirm-type="done"`、输入防抖、onHide 草稿）。

### ⑥ 下一步：批次 5
`specs/dev-specs/delivery/inscode喂投包_8批_自包含完整版.md` L570–663 定义了**批次 5 / 8 · 付费全流程**
（弹窗触发 + 订单 + 续费 + 提醒 + 失败处理 + iOS 降级），共 6 条验收标准。
注意两个前置约束（投喂前必须先跟用户对齐）：
- **§2.6 当前阶段（私域）**：`enable_real_payment=false`，支付入口隐藏或提示「联系客服开通」，
  权益由后台 `source=manual` 发放；**前端展示逻辑完全一致**（仍只读 `expire_at`），执照下来改配置即可，前端一行不改。
- **§2.5 iOS 合规**：iOS 不展示 19.9 自动订阅（苹果 IAP 抽成），仅放一次性套餐；
  不可用只能引导安卓/鸿蒙端，**禁止 H5 购买页兜底**（违反微信运营规范 5.13）。
