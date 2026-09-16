# 批次 7 投喂 · 审批复核留证

## 0. 本轮概览

- 投喂时间：2026-09-17 01:24（InsCode 会话 `831bd65c-70cb-4600-8fb6-7ebe07886768`）
- 投喂载荷：`批次7_提示词_可直接复制.txt` + 起点确认 + 6 条额外硬约束（共 3738 字）
- 起点：批次 0~6 已验收入库；工作区干净；`origin/dev` 领先 0
  - 批次 6 交付 `a77ebc0`；其后 `61dd359`（round21 复核）/ `052308e`（R43+R44）/ `e18c442`（R41a+R42）
  - **本轮以 `e18c442` 为起点**
- 投喂核验：`sessions.body` 末条 User 文本 3738 字，首 `# 批次 7 / 8 …`、尾 `…给「预期 / 实际 / 是否通过」表`，**未截断**

## 1. 审批 ①（id=19）· 监工转人工 → 人工批准

### 1.1 监工为何转人工

`needs_human.json` 判定 `decision=human`，理由：

> 命令引用了仓库外路径：`['/c/Users/Izj/WorkBuddy/CIaw/catering-profit&&gitIog', '/c/Users/Izj/WorkBuddy/C1aw/.../cIoudfunction...', ...]`

**这是 OCR 字形误报**：`lzj` 被认成 `Izj`、`Claw` 被认成 `CIaw`/`C1aw`、`l` 被认成 `I`。
三条“仓库外路径”逐一还原后**全部在仓库内**，监工的白名单匹配因此落空 → 保守转人工（行为正确）。

### 1.2 卡片命令还原

```bash
cd /c/Users/lzj/WorkBuddy/Claw/catering-profit/cloudfunctions \
&& for f in getShopList exportData exportStatus deleteAccount; do
     mkdir -p "$f"
     printf '{\n  "name": "%s",\n  "version": "1.0.0",\n  "main": "index.js",\n  "dependencies": { "wx-server-sdk": "latest" }\n}\n' "$f" > "$f/package.json"
   done
&& node -e "console.log('4 dirs created')"
```

### 1.3 批准前只读预检（SOP ③）

| 检查 | 命令 / 依据 | 实际 | 判定 |
|---|---|---|---|
| 重名检查（是否覆盖既有） | `for f in getShopList exportData exportStatus deleteAccount; do [ -e cloudfunctions/$f ] …` | 4 个**全部不存在** → 新建 | ✅ 无内容可丢 |
| 是否调本仓脚本 | 通读命令 | 仅 `node -e "console.log(...)"`，无 `sync_common` 等 | ✅ 无幂等风险 |
| 函数名是否符合本批规格 | `grep` 交付包批次 7 章节 | `getShopList`=§2.3/2.7 多店铺切换；`exportData`/`exportStatus`=§2.4 异步导出+进度；`deleteAccount`=§2.11 账号注销 | ✅ 与规格一一对应 |

### 1.4 安全红线逐条过筛

| 红线 | 是否命中 | 说明 |
|---|---|---|
| `rm` / `rmdir` / `del` / `mv` / `cp` | ❌ 未命中 | 命令中无删除/移动类动词（`deleteAccount` 是**目录名**，非 `del`） |
| `git clean` / `reset` / `checkout` / `push` / `commit` | ❌ 未命中 | 无 |
| `truncate` / `dd` / `drop table` / `delete from` | ❌ 未命中 | 无 |
| `taskkill` / 装包 / 网络下载 | ❌ 未命中 | 无 `pip/npm install`、无 `curl/wget` |
| 读写仓库外路径 | ❌ 未命中 | 全部在 `catering-profit/cloudfunctions/` 内（监工告警系 OCR 误报，见 1.1） |
| 删除或整体覆盖既有文件 | ❌ 未命中 | 目标 4 目录均为新建 |
| `node -e` 含 `rmSync`/`unlinkSync`/`child_process` | ❌ 未命中 | 仅 `console.log` |

平台弹窗那句「这条命令会删除指定路径，删除后不可恢复」是 `>` 截断重定向的**通用启发式告警**（SKILL 已记录的误报形态）。

### 1.5 判定与执行

- **判定：安全，批准。**
- 执行：`inscode_patrol.py --approve 918 864` → `{"ok": true, "clicked_window_xy": [918, 864], "clicked_screen_xy": [978, 869]}`
- **未点击**「拒绝并停止任务」，**未点击**「本会话不再询问（直到完全访问）」——权限提权留给用户本人决定。

## 2. 批准后复核（SOP ⑤）

| 项 | 预期 | 实际 | 通过 |
|---|---|---|---|
| `approval_audit` 最新行 | `state=approved_once` | id=20 `state=approved_once`，`resolved_by=user`，`wait_ms=265342`（挂起 ≈4.4 分钟） | ✅ |
| 目标产物出现 | 4 个目录建成 | `cloudfunctions/{getShopList,exportData,exportStatus,deleteAccount}` 均已创建 | ✅ |
| `session-stream.log` 继续前进 | mtime 重新往前走 | 01:27:29 → 01:33:56，size 3451599 → 3454164 | ✅ |
| `inflight_turn` | 1（在飞） | 1 | ✅ |
| 后续审批 | 自动放行 | id=21/22 `resolved_by=permission_mode`，`wait_ms=1426`（非监工代点） | ✅ |

`git status` 复核：批准生效瞬间未见对既有文件的 `M` 改动（新增函数仍在新目录内）。

## 3. 留证清单

| 文件 | 内容 |
|---|---|
| `批次7_已发送_InsCode开工_20260917.png` | 投喂后 20s，输入框清空、会话开始应答 |
| `审批1_弹窗_20260917.png` | 审批弹窗原帧（监工截取） |
| `审批1_巡检查看_20260917.png` | 巡检脚本多帧拼接查看 |
| `审批1_监工转人工_20260917.json` | 监工 `needs_human.json` 原文（含 OCR 全文与判定理由） |
| `审批1_批准后_InsCode推进_20260917.png` | 批准后 InsCode 继续出字 |

## 4. 备注（监工元数据小瑕疵）

`needs_human.json` 的 `batch` 字段记为 `6`，但卡片正文与 `sessions.body` 末条 User 文本均为**批次 7**。
该字段取自当时尚未清理的过期 `batch_done.flag`（turn_id=5，批次 6 遗留）。本轮已删除该过期 flag，
下批起 `batch` 字段将指向正确批次。
