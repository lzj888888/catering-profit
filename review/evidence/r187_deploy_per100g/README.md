# R187 · M3.31「每100g」上云部署 —— **通道被封，未完成**（如实留档）

> 时间：2026-10-01 夜 · 目的：把 R185 已验收的 `specDerive.js`（新增 `per100g` 规格）推上云端。
> **结论：未部署成**。本目录留的是「范围已确认 + 脚本已就绪 + 通道被封的证据」。

---

## 一 本轮**做成了**什么

| # | 事项 | 判据 |
|---|---|---|
| 1 | **部署范围确认 = 43 个函数**（不是猜的） | `cx_index.js`（公共桥接层）在**每个**函数目录都 `require('./cx_specDerive')` ⇒ 43 个**全部**会加载该模块 ⇒ **范围缩不了**。见 §三 |
| 2 | 派生副本 ≡ 单源 | `node tools/sync_common.js --check` ⇒ `✅ 43 个云函数目录的扁平副本均 ≡ cloudfunctions/common/ 单源派生`，rc=0 |
| 3 | 环境 ID 现读（不抄记忆） | `cloudfunctions/initDb/config.json::envVariables.DEV_ENV_ID = cloud1-d4gphpoxy337f2a25` |
| 4 | 部署器改向本目录（不往 `_m3/` 再塞文件） | `_deploy_fns.py` 的 `OUT`/`JUDGE` 已改指 `review/evidence/r187_deploy_per100g/` |
| 5 | 新编号先查占用 | `grep -rn "R187\|r187"` ⇒ **空**（R186 已用、R187 未用） |

---

## 二 🔴 本轮**没做成**什么：部署通道被封

### 事实链

1. 按技能先做**单函数烟测**（`_deploy_fns.py smokeTest`），带 `dangerouslyDisableSandbox: true`；
2. Python 与 `cli.bat` **都正常起来了**，两次尝试各跑 45.8s / 66.5s，合计 **112s**；
3. 判据器两轮均 `MISS`：日志**没有** `success=true` 行、**没有**完成行 `deploy cloudfunctions`（`ALL_ROWS_HIT=false`）；
4. 命令返回的安全策略原文：

```
PROGRAM BLOCKED BY SECURITY POLICY - The sandbox prevented a program on the configured Program Blacklist from starting:
  - reg.exe (C:\WINDOWS\System32\reg.exe)
  - WMIC.exe (C:\WINDOWS\system32\wbem\WMIC.exe)
This block cannot be approved or bypassed from the current command.
Do NOT retry this program, launch it through another shell or script, or attempt an equivalent workaround.
```

5. 另查：微信开发者工具 **IDE 进程不在**（`Get-Process` 匹配 `wechatwebdevtools|nwjs|weapp` ⇒ `NO_IDE_PROCESS`）⇒ GUI 代操这条路当前也走不了。

### 定性

- **不是代码问题、不是环境问题（IDE 端口之类）**，是 `cli.bat` 内部必须调 `reg.exe` 读端口配置，而 `reg.exe` 在**安全中心程序黑名单**；
- 🔴 **这一层不归沙箱开关管** —— 本次 Bash 已标 `dangerouslyDisableSandbox: true`，仍然被拦；
- **同一天上午 R181m 用同样姿势是成功的** ⇒ 属「**时有时无**」型阻塞（与「沙箱禁 node 派生子进程」同类）；
- 提示明确禁止重试 / 换 shell / 脚本代调 ⇒ **我没有绕过，也没有连跑 43 个**（那会白跑 20 分钟）。

### 放行需用户做一件事（三选一）

| 方案 | 操作 |
|---|---|
| **A（根治）** | 安全中心 → 命令安全 → 程序黑名单 → 移除 `reg.exe` / `WMIC.exe` |
| B | 用户开微信开发者工具 → 我方键鼠接手 GUI 部署（43 次，很慢，不推荐） |
| C | 用户在**云开发控制台**手动上传（43 次，最不推荐） |

放行后**一条命令即可**（脚本已就绪）：

```bash
python review/evidence/r187_deploy_per100g/_deploy_fns.py \
  adminExport adminGrantEntitlement adminInit adminLogin adminLogout adminManualOrder \
  adminOrderList adminQueryUser adminRefreshToken adminRefundMark adminRevokeToken \
  archiveMonth calcAmortize calcBom calcMonthlyProfit calcSandbox checkQuota deleteAccount \
  detectCycle exportData getAmortSchedule getCardVersions getCostCard getLedger getMaterial \
  getMonthList getShopContext getShopList importSalesBill initDb payCallback payCreateOrder \
  payExpireNotify payOrderList payQueryEntitlement payRenew saveAsset saveCostCard \
  saveLedger saveMaterial saveShopSetting smokeTest syncCostCard
```

---

## 三 范围判据（为什么是 43 个，而不是"只部署用到它的那几个"）

直觉是「只部署真正调用 `specDerive` 的函数」，但实测：

```bash
grep -rl "cx_specDerive" --include="*.js" cloudfunctions/ \
  | grep -v "/common/" | grep -v "cx_specDerive.js$" | sed 's|cloudfunctions/||;s|/.*||' | sort -u | wc -l
# ⇒ 43
```

证据示例（`cloudfunctions/adminExport/cx_index.js:54-61`）：

```js
  specDerive: require('./cx_specDerive'),
  LINE_KINDS: require('./cx_specDerive').LINE_KINDS,
  SPEC_PRESETS: require('./cx_specDerive').SPEC_PRESETS,
  deriveSpec: require('./cx_specDerive').deriveSpec,
  ...
```

⇒ 每个函数目录的 `cx_index.js` 都会把 `SPEC_PRESETS` 挂上公共对象，**43 个全是真实面**。

---

## 四 顺带核实（排除"第二个隐藏前置"）

担心阶段② M3.33 落库用的集合/索引没建 ⇒ 查了，**都是齐的**：

| 项 | 结果 |
|---|---|
| `external_sales_daily` | ✅ 在 `cloudfunctions/initDb/collections.js`（27 集合之一） |
| `shop_dish_mapping` | ✅ 同上 |
| 两者索引 | ✅ 有定义，且 `tools/selftest_r174_inbound.js` 在校验（A3/B3 断言） |

⇒ **阶段② 的地基不缺**，只差真实样例来定「表结构解析」。

---

## 五 本目录文件

| 文件 | 说明 |
|---|---|
| `_deploy_fns.py` | 部署器副本（已把 `OUT`/`JUDGE` 改指本目录；一次一个、必带 `-r`、失败自动重跑一次） |
| `_judge_deploy.js` | 判据器副本（latin1 读原始字节，只匹配 ASCII，**绝不比 `│`**） |
| `logs/` | 烟测日志（`deploy_smokeTest_1.log` / `_2.log`） |
| `README.md` | 本文件 |

---

## 六 技能已同步订正

`~/.workbuddy/skills/miniprogram-cloud-deploy/SKILL.md` §9：

- ⚠️ **「非沙箱跑 `cli.bat` 就放行」被证伪** —— 同日上午成功、当晚同姿势被拦 ⇒ **时有时无型**；
- 🔴 **新增通道优先级第 0 步：先单函数烟测（`smokeTest`）**，烟测 `MISS` 立刻停手，别连跑 20 分钟；
- 🔴 **新增范围判据**：改 `common/` 单源后范围是 **43 个**，因为 `cx_index.js` 在每个目录都 `require` —— **别想当然缩范围**。
