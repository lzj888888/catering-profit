# 微信云开发 · 云函数「重发部署」通道（实测 2026-09-18）

> 配套：`examples/cloudbase_smoketest/`（跑探针）、`examples/cloudbase_index/`（建索引）、`SKILL.md` 硬教训 24。
> 实战战绩：一次跑通「重发 `smokeTest` + 重跑探针」，把「线上部署件落后于仓库」这条隐患**闭合**
> （控制台最后更新时间 `09-15 08:47:38` → `09-18 02:29:24`；返回 JSON 从"字段不存在"变成 `commonShape:"flat-file(common.js)"`）。

## 为什么需要它

`cli cloud functions` **没有 `invoke`**（不能触发函数，触发只能走控制台 GUI），
**但有 `deploy` / `inc-deploy` / `list` / `info` / `download`** ⇒
**「重发线上件」可以完全脚本化，不必登控制台手点上传**。

典型场景：线上件的代码落后于仓库（改了仓库没重发）⇒ 执行单上的判据**读不到字段**，判据不可判读。

## 通道选择（先证后跑，这一步决定"零凭据"还是"落主账号密钥"）

| 通道 | 结论 |
|---|---|
| ❌ 腾讯云 `@cloudbase/cli`（`tcb`） | `tcb login` 走 **device-flow**：需人工在浏览器点授权（**授权页在本机渲染空白**），且授权后是**主账号级凭据落到 `~/.cloudbase/`** ⇒ 违反最小权限，**不用** |
| ✅ **微信开发者工具自带 CLI** | `cli islogin` → `{"login":true}` ⇒ **复用 IDE 已登录会话，零新凭据、零授权页** |

```bash
CLI="C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat"
"$CLI" islogin                      # 先证：{"login":true}
```
> IDE HTTP server 由 CLI 自行拉起（`√ IDE server has started, listening on http://127.0.0.1:<port>`）。
> ⚠️ 若 IDE 已用别的端口起过 server，需先退出 IDE（或干脆别开 IDE，让 CLI 自己拉）。

## 部署命令（照抄）

```bash
# ① 环境隔离前置：--env 的值绝不写死，从单源现读
ENV=$(python -c "import json;print(json.load(open(r'<repo>/cloudfunctions/initDb/config.json'))['envVariables']['DEV_ENV_ID'])")

# ② 上传前必跑（云函数包内禁用子目录，否则云端 MODULE_NOT_FOUND）
python <repo>/tools/sync_common.js

# ③ 部署（-r = 云端装依赖）
"$CLI" cloud functions deploy --project <repo> --env "$ENV" --names smokeTest -r
```

- `-r`（remote npm install）**旁证**：部署后跑一次探针，`fsDiag.root` 里会出现 `node_modules`。
- 成功输出形如 `success=true / filesCount=12 / packSize=14.0 KB`。

## 三个坑（都实测踩过）

1. 🔴 **判"是否真的更新了"不能只看 `info`**：`cli cloud functions info` 只有
   `status / timeout / runtime`，**不含更新时间** ⇒ 单靠它**证不了"已更新"**。
   必须另取**控制台函数列表的「最后更新时间」**（截图留证）。
2. 🔴 **首次部署常撞并发错**（`Creating/Updating`）⇒ **等 1 分钟，原命令重跑即过**。
3. ⚠️ **想证明"包内容真的变了"，两次包体要能区分**：本轮部署 ①`14.0KB` → ②`14.5KB`
   （第二次含代码修正）⇒ 包体差异本身就是"内容确实变了"的旁证。

## 硬约束

1. **先证环境不是 prod**，再执行任何 deploy（控制台/CLI 的操作不受代码里的 `!/prod/` 门禁保护）。
2. `--env` 的值**从单源读**，不要在命令行里手打（手打=第四份副本，且门禁是相等比较，两边同错照样放行）。
3. 部署属于**云侧变更**：只重发自己已验证过的件；**不要**顺便改超时/内存/环境变量——那类改动要么走控制台由人确认，要么先问。
4. **回执只写结论值**（如最后更新时间、`filesCount`），**不回显任何令牌**。

## 待办（本轮未做，属"云侧配置变更"）

- `smokeTest` 的 `timeout` 实测为 **3s**，冷启动（约 560ms）+ 全量探针（约 10 次串行 DB 往返）**必撞超时**
  ⇒ 当前只能"重跑一次"绕过；要根治须**在控制台把超时调到 ≥10s**（手点，需人确认）。
