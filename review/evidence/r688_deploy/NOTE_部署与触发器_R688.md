# R688 · purgeDeletedData 部署取证

日期：2026-11-10 23:0x
环境：`cloud1-d4gphpoxy337f2a25`（dev）

## 一、部署：成功

判据**不看 rc**（cli 部署失败也返回 0），只看 `_judge_deploy.js` 的 `ALL_ROWS_HIT`：

```
[purgeDeletedData] try1 rc=0 用时=10.6s MISS | 首轮常因 IDE 通道未起失败
[purgeDeletedData] try2 rc=0 用时=19.6s HIT
  â purgeDeletedData â true  â 25  â '93.1 KB' â
  完成行 `deploy cloudfunctions` : ✅ 有   ALL_ROWS_HIT = true
---- 1/1 OK ----
```

`filesCount = 25`（该目录实际文件数，含 `package.json` / `config.json` / 22 个 `cx_*.js` / `index.js`），
`packSize = 93.1 KB`。try1 的 MISS 是首轮 IDE 通道未起的常态，重跑即中。

## 二、超时：3 → 20（已生效，权威回读）

新函数默认 `timeout = 3`，而它要处理「最多 20 家店 × 19 张表」，3 秒必然超时。
按 R215d 定式走**控制台 → 版本与配置 → 配置 → 高级配置 → 执行超时**改到 20，
用**剪贴板哨兵**验证输入框真接收了（回读 = `20`，不是目视）：

```
┌──────────────────┬──────────┬─────────┬───────────────┐
│ (index)          │ status   │ timeout │ runtime       │
├──────────────────┼──────────┼─────────┼───────────────┤
│ purgeDeletedData │ 'Active' │ 20      │ 'Nodejs16.13' │
└──────────────────┴──────────┴─────────┴───────────────┘
```

`status='Active'` + `timeout=20` ⇒ 代码与配置都已生效。
（改配置后版本页 `$LATEST` 更新时间从 23:14:10 变为 23:17:38，与本次操作对得上。）

## 三、🔴 定时触发器：**未启用**（唯一未完成项）

`config.json` 里已声明：

```json
{ "triggers": [{ "name": "purgeDeletedDaily", "type": "timer", "config": "0 0 3 * * * *" }] }
```

但按技能 `miniprogram-cloud-deploy` §7 实测记录：

> `config.json::triggers` **随包上传但不会启用**，且 `cli` **无触发器子命令**
> （子命令集仅 `list / info / deploy / inc-deploy / download`）。
> 唯一入口 = IDE 资源管理器里，展开 `<fn>` 目录后，**右键 `config.json` 这个「文件」**
> → 菜单「上传触发器」。

⇒ **代码在云上、配置是 20 秒、但每天 03:00 不会自动跑。**
⇒ 后果：注销承诺「15 天内彻底删除」**仍然没有执行者**。这一项不补，R688 的主要目的就没达成。

### 本次 GUI 尝试记录（下次别重走）

试过且失败的路径，全部如实记下：

| 尝试 | 结果 |
|---|---|
| `agent-desktop snapshot` 读可访问性树 | ❌ `The Chromium tree is still thin` —— nwjs/Electron 需要 `--force-renderer-accessibility` |
| `agent-desktop find --name 存储` | ❌ `TIMEOUT`（观察 407 个节点仍读不出，同样因为树太薄） |
| `Ctrl+Shift+E` / `Ctrl+B` 调侧栏 | ❌ 无反应（IDE 未响应 VS Code 快捷键） |
| 菜单栏「界面」 | ✅ 能点开（菜单项只有 通用/外观/代理/安全/扩展/编辑器/快捷键/项目设置，**没有布局或文件树开关**） |
| 控制台左侧导航点「概览」 | ✅ 生效（说明点击链路正常） |
| 控制台左侧导航点「存储」 | ❌ 多次未命中（该窗口 1920×1034 截图与屏幕坐标比例不是整数，试了 306/316/333 均偏） |
| 底部「页面路径」点开文件 | ❌ 编辑器未出现，文件树也没出来 |

⇒ **IDE 当前处于「只有模拟器、没有文件树与编辑器」的布局**，而调出布局的开关既不响应快捷键、
菜单里也没有。这一层我没能自动化成功，**不假装做到了**。

## 四、补上的那一项（1 次点击即可）

请李老师在已打开的 IDE 里：

1. 左侧「资源管理器」找到 `cloudfunctions/purgeDeletedData/`
2. **右键 `config.json` 这个文件**（不是右键目录）
3. 菜单里点「**上传触发器**」

传完可以这样核对：再右键同一个 `config.json`，如果菜单变成「**删除触发器**」可点，说明传上去了。

## 五、即便触发器没传，也没有"半吊子"风险

- 函数**来源校验**已加：有用户 OPENID 即拒绝（自测 3 条断言覆盖），客户端调不动它
- 未到期数据一律不删（`delete_at` 为 0 或缺字段全部跳过）
- 支持 `dryRun` 干跑预演

⇒ 它是"备好了但还没开机"，不是"开了一半会误伤"。
