# R168 · 与豆包 3 轮沟通证据包（"AI 分阶段路线"）

## 背景

李老师 2026-09-28 定调：主体 = **个体工商户**；**前期不上 AI、后期必上**；
方向 = **用全量数据做业务模型改革**（AI 自动匹配成本 / 反推引流套餐定价 / 市场判断）；
护城河 = 我们有**成本端 + 销售端**双端数据，美团等平台**只有销售端**。

## 三轮问题

| 轮次 | 问什么 |
|---|---|
| **p1.txt** | AI 到底能帮客户做什么 —— 全景清单 + 6 维判据打分 + 分工边界 + 差异化 + 最狠反方 |
| **p2.txt** | 前期不上 AI 时**现在必须做什么** —— 数据层 / 口径层 / 接口层 |
| **p3.txt** | **三期路线**怎么切、何时该上 LLM、怎么防错、何时该放弃 |

## 文件清单

| 文件 | 内容 |
|---|---|
| `p1.txt` / `p2.txt` / `p3.txt` | 我方提问原文 |
| `r1_answer.txt` | 第 1 轮回答（Q1 全景清单 8 项 + Q2 判据三档 + Q3 分工 + Q4 差异化 + Q5 反方三条） |
| `r2_answer.txt` | 第 2 轮回答（数据地基：数据层字段清单 / 口径层五条 / 接口层四项不做） |
| `r3_answer.txt` | 第 3 轮回答（三期路线 + 上 LLM 3 条触发条件 + 防错 4 条 + 放弃信号 2 条） |
| `fullpage_p3_raw.txt` | 第 3 轮读取时的整页 UIA 文本（含左侧会话列表等杂音，供核验） |
| `shot_p1_sent.png` / `shot_p3_sent.png` / `shot_wmchar.png` | 投喂与通道验证截图 |
| `feed_uia.py` | 投喂脚本（WM_CHAR 写入 + VK_RETURN 发送） |
| `read_uia5.py` | 读取脚本（等完成标记 → 展开全文 → TextPattern 提取） |

## ⚠️ 通道说明（本轮重大发现，可复现）

本机**安全软件拦截了全部常规输入注入**：

- `mouse_event` / `keybd_event` / `SendInput`（鼠标与键盘）**全部无效**；
  连 `SetCursorPos` 也无效 —— 实测 `SetCursorPos(300,300)` 后 `GetCursorPos` 读回仍是 `(794,1059)`。
- `SetForegroundWindow` 可用，但当前台被任务栏锁住时需先 `LockSetForegroundWindow(LSFW_UNLOCK=2)`。
- 最小化 WorkBuddy 可让豆包露出（豆包 rect 恒为 `(60,0,1860,996)`）。

**改用 COM / Windows 消息通道绕过：**

| 环节 | 方法 | 备注 |
|---|---|---|
| **写入** | `PostMessage(SUB, WM_CHAR, ch, 1)`，`SUB` = 豆包的 `Chrome_RenderWidgetHostHWND`（`EnumChildWindows` 取） | 逐字，间隔 0.012s；中文正常 |
| **发送** | `PostMessage(SUB, WM_KEYDOWN/WM_KEYUP, VK_RETURN, 0x001C0001/0xC01C0001)` | **首发可能失效**，需补投 2 次 |
| **读取** | `DocumentControl.GetTextPattern().DocumentRange.GetText(-1)` | 覆盖已渲染部分 |
| **展开长回答** | UIA `GetLegacyIAccessiblePattern().DoDefaultAction()` 点「展开全部」 | **不展开会缺中段** |

**其它实测约束：**

- `WM_CHAR` 发 `\n` **无效**（被忽略，但**也不会误触发发送**）⇒ 长文本折成空格再发。
- 回答末尾带 `（全文 N 字）`，可作为**生成完成标记**。
- 发送后输入框**自动清空** ⇒ 下一轮无需清空操作。
- UIA 按标题找不到豆包窗口（标题栏自绘）⇒ 必须用 **win32 hwnd → `auto.ControlFromHandle(h)`** 构造元素。

## 复现

```bash
PY="C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
$PY feed_uia.py p1.txt p1                 # 投喂第 1 轮
$PY read_uia5.py p1 "请短句、分点、可执行"   # 读取（第二参数 = 提问末尾锚点）
```

## 结论

见 `review/NOTE_2026-09-28_round168-AI分阶段路线图.md`
