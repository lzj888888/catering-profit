# R722 · 云控制台实操核查（技能综合使用 + 长期习惯固化）

> 2026-11-12 · 李老师：「你用技能……屏幕还有软件的那个新装的那个技能，你看看有哪个特别好用的就都综合起来用一下。然后你去操作云控制台，**这些以后都养成习惯能操作云控制台，你自己就去就行了**……做好之后慢慢固化成一个 skill。」
> 证据目录：`review/evidence/r722_cloud_console/` ｜ 固化技能：`~/.workbuddy/skills/cloud-console-audit/`

---

## 0. 一句话结论

**上轮 R721 台账里唯一需要「云控制台核查」的 P1 推测，被拆成了两半：泄露路径已排除，备份零脱敏属实。**
云存储与数据库权限都是「仅创建者可读写」，未登录访问开关为关 ⇒ **小程序端读不到备份与业务数据**；但 `backup/2026-11/` 里确有 `admin_user.json`、`admin_login_log.json`、`audit_log.json`、`external_sales_daily.json` 等明文 JSON ⇒ 治理建议保留，**不是当前漏洞**。全程**没有改任何云控制台配置**（只读核查）。

---

## 1. 用了哪些技能、为什么这么组合

| 技能 | 承担 | 实际命令 |
|---|---|---|
| `agent-desktop`（11-11 新装，无障碍树） | **IDE 主窗口**：读树 98 refs、语义点击 `toolbar-cloud` 打开云控制台、窗口 restore/maximize | `status` / `list-apps` / `restore` / `maximize` / `snapshot -i --compact --timeout-ms 15000` / `click @ref` |
| `win-desktop-control`（真实屏幕+键鼠+OCR） | **云控制台**（瘦树、自绘）：截图取证、OCR 定位关键词拿实测坐标、坐标点击、滚动 | `win_gui.py shot/click/scroll` + `ocr_screen.py find/read --scale 2` |
| `miniprogram-cloud-probe` | 真云取证的纪律：可复现命令 + 原文 + 清理；「未测到就写未测到」 | `cli cloud env list` / `cli cloud functions list` |
| `win-cli-pitfalls` / CLI-first 闸门 | 先判断哪些能用命令做，不能才点界面 | `cli.bat --help` / `cli cloud --help` |

🔑 **关键判断（技能组合的价值）**：
- `cli cloud` 只有 `env` 和 `functions` 两个子命令，**没有云存储/数据库权限/备份** ⇒ 权限页必须进 GUI，这一步不是「偷懒用键鼠」，是无 CLI 可走。
- IDE 主窗口用无障碍树（零 OCR 误读、零 DPI 问题），云控制台是**瘦树/自绘**（`snapshot --skeleton` 只有 5 refs），必须切回截图+OCR ⇒ **两个技能不是二选一，是按窗口分型路由**。这正是 `agent-desktop` 文档里写的「两者可混用」。
- 坐标一律由 `ocr_screen.py find` 实测给出，点击前后比 md5 验证；**没有按我看到的缩放图反推坐标**（技能里记过 1.6–1.76 倍的坑）。

### 踩到并绕过的坑（写进 skill 了）
1. IDE 窗口**最小化**（x=-32000）⇒ 树超时 15s；`restore` + `maximize` 后一次读到 98 refs。
2. 云控制台刚打开时 `find` 超时（`walk_root_unread`），稳定后 skeleton 仍是 5 refs ⇒ 判定为瘦树，切 OCR。
3. 暗底浅字两字窄格 OCR 返回空（「数据库」「设置」「数据权限」）⇒ 用 `--scale 2` + 已命中锚点等距推算，点击后截图验证。
4. `agent-desktop wait --ms` 参数不存在（应为别的写法），`win_gui.py scroll --clicks` 不存在（应为 `--delta`）——已记入 skill 的命令速查。

---

## 2. 逐项核查结论（绿黄红）

| # | 核查项 | 实测结论 | 证据 | 评分 |
|---|---|---|---|---|
| 1 | 环境清单 | 只有 `cloud1-d4gphpoxy337f2a25`（个人版），**prod 未建** | `cli_env_list.txt`（机器可读） | 🟢 与既有认知一致 |
| 2 | 云存储权限 | **仅创建者可读写**（5 个单选项里第 2 个绿色选中），非「所有用户可读」 | `06_storage_permission.png` | 🟢 泄露路径排除 |
| 3 | 数据库数据权限 | **仅创建者可读写**；提示「除自定义权限外，其他权限均不支持未登录态用户访问」 | `11_db_permission.png` | 🟢 越权路径排除 |
| 4 | 未登录用户访问云资源 | 环境 `cloud1` 的开关 **关闭（灰色）** | `14_env_permission_bottom.png` | 🟢 封死 |
| 5 | 云托管令牌使用权限 | 开启（绿色），说明「云调用时允许 OpenAPI 使用微信云托管鉴定时推送的 access_token」 | `14_env_permission_bottom.png` | 🟢 正常云调用配置 |
| 6 | 备份目录内容 | `backup/` 下仅 `2026-11` 一期；内有 `admin_login_log.json`(121B)、`admin_user.json`(116B)、`audit_log.json`(137.11KB)、`external_sales_daily.json`(212.57KB) 等**明文 JSON** | `08_backup_folder.png` / `09_backup_202611.png` | 🟡 零脱敏属实，但读不到 |
| 7 | 云函数清单 | 带上 `--env` 后取到 **60 个函数**，含 `dbBackup` / `getDiagnosis` / `exportData` / `adminExport` / `getDishReview`；首跑缺 `--env` 的回显也留档 | `cli_fn_list_ok.txt` / `cli_fn_list.txt` | 🟢 清单在场（函数级超时/触发器未逐个核） |
| 8 | 告警设置页 | 显示 `Error: Base resp abnormal … "member_list":[]`；个人版环境告警群接口异常，**与产品代码无关** | `12_settings.png` | 🟡 如实登记，不判为 bug |
| 9 | 存储其它目录 | 根目录另有 `revenue_daily`、`sales_bills`，未逐个展开 | `05_storage.png` | ⚪ 未测到 |

> **对 R721 台账 R3-3 的处置**：原推测是「`dbBackup` 全库零脱敏且云路径可枚举，若权限被配成所有用户可读则一次拿全库」。
> 现在拆成：**「零脱敏」已核实为真**（第 6 项），**「权限放开」已排除**（第 2/3/4 项）⇒ 从 P1「可能的漏洞」降为 P2「治理改进」，不写「修好了」，也不写「没事了」。

---

## 3. 取证纪律（按 miniprogram-cloud-probe）

- 每条结论都配**可复现命令或截图路径**，截图按 `NN_主题.png` 顺序编号，点击前后 md5 不同才认「界面真变了」。
- **只读核查，没有改任何配置**：没点单选、没拨开关、没删文件、没上传、没部署。
- 关键数值优先用机器可读出处（`cli cloud env list`），截图只作辅助；小字/时间戳没有靠 OCR 硬读。
- 没拿到的（函数级配置、其它存储目录）明确写「未测到」，不用推断语气冒充。

---

## 4. 长期习惯怎么落地（李老师要的「以后自己就去」）

固化成用户级 skill **`cloud-console-audit`**（`~/.workbuddy/skills/cloud-console-audit/SKILL.md`），包含：
1. **CLI-first 闸门**：先 `cli cloud env/functions` 拿能拿的；只有权限/备份/安全设置这类无 CLI 的才进 GUI。
2. **通道分型路由**：IDE 主窗口 → `agent-desktop` 无障碍树；云控制台（瘦树/自绘）→ `win-desktop-control` 截图+OCR+坐标。
3. **标准动作序列**：`islogin` → `restore/maximize` → `snapshot` → 语义点 `toolbar-cloud` → OCR 定坐标 → 点击前后比 md5 → 截图归档。
4. **只读核查清单**：云存储权限 / 数据库数据权限 / 未登录访问开关 / 备份目录 / 环境清单，固定 5 项，逐项给绿黄红。
5. **坑表**：最小化窗、瘦树、暗底浅字、`--scale 2` 坐标、`scroll --delta`、坐标必须实测。
6. **取证落盘约定**：`review/evidence/r<轮次>_cloud_console/`，命令输出 `.txt` + 截图 `.png` + 结论 `.md`，并回填 `r721_findings.json` 对应条目。

同步登记到 `~/.workbuddy/SKILLS_INDEX.md`。以后只要涉及云控制台，我按这个 skill 直接走，不再逐次问。

---

## 5. 复现命令

```bash
CLI="/c/Program Files (x86)/Tencent/微信web开发者工具/cli.bat"
P="C:/Users/lzj/WorkBuddy/Claw/catering-profit"
"$CLI" islogin
"$CLI" cloud env list --project "$P"
"$CLI" cloud functions list --project "$P" --env cloud1-d4gphpoxy337f2a25

agent-desktop status
agent-desktop restore  --app "微信开发者工具"
agent-desktop maximize --app "微信开发者工具"
agent-desktop snapshot --app "微信开发者工具" -i --compact --timeout-ms 15000
agent-desktop click '@<toolbar-cloud 的 ref>'

W=/c/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/win_gui.py
O=/c/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py
python $W shot --screen --out <dir>/NN_xxx.png
python $O find <png> 存储 权限 --scale 2
python $W click --x <ocr_x> --y <ocr_y>
python $W shot --screen --out <dir>/NN_after.png   # 比 md5 验证
```

---

## 6. 诚实边界

- 本轮是**某一时刻的配置快照**，不代表历史或未来状态；权限页提示「生效需要 1-3 分钟」，本轮未做任何改动故不涉及生效等待。
- 云控制台无「最近修改时间」可见，无法证明该配置自何时起如此。
- `cli cloud functions list` 首跑缺 `--env`（回显已留档），补参后拿到 60 个函数清单；但**函数级超时、定时触发器、索引是否生效未逐个核查**（属 `miniprogram-cloud-probe` 另一条线，留待下轮）。清单在场 ≠ 配置已验。
- 未展开 `revenue_daily` / `sales_bills` 目录；未核查集合级索引。
- **没有改动任何云配置**，也没有改动算钱口径；仓库改动仅报告、台账与文档。
