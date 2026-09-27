# r160_cloud_20260927 · 云端两项人工项落地证据

对应说明：`review/NOTE_2026-09-27_round160-云端两项人工项落地.md`

环境：dev `cloud1-d4gphpoxy337f2a25`（控制台左上角 `cloud1 · 免费开发环境`）。**无 prod。**
操作方式：键鼠驱动「云开发控制台 v2.0.3」（窗口 rect `(60,0,1860,1034)`，全屏截图坐标即屏幕坐标）。

## 两项任务

| # | 对象 | 改前 | 改后 |
|---|---|---|---|
| ① | `feature_permissions` / `_id=9294ce06ab615ec01babe4d433bcaa1`（`plan_free`）`limits.cost_card` | 5 | **20** |
| ② | `shop_cost_card_line` 索引 `idx_line_card{card_id:1}` | 存在（命中 0） | **已删除** |
| ③ | `shop_cost_card_line` 索引 `idx_line_row{shop_id:1, cost_card_row_id:1}` | 不存在 | **已建成**（非唯一，均升序） |

## 图片索引

| 文件 | 内容 |
|---|---|
| `01_before_plan_free_cost_card_5.png` | 改前 JSON：`limits` 折叠态，`cost_card: 5` |
| `02_edit_field_modal_value_5.png` | 「编辑字段」弹窗：`cost_card = number = 5` |
| `03_value_typed_20.png` | 值输入框已改为 `20`（提交前） |
| `04_after_plan_free_cost_card_20.png` | 提交后面板：`cost_card: 20` |
| `05_roundtrip_reread_20.png` | 往返重查（换查别的 plan 再查回来）⇒ 云端持久化 20 |
| `06_before_index_table_has_idx_line_card.png` | 索引表改前全貌 |
| `07_delete_index_confirm.png` | 删除确认弹窗 |
| `08_after_delete_idx_line_card_gone.png` | 删除后索引表（`idx_line_card` 消失） |
| `09_add_index_form_filled.png` | 建索引表单填好的样子 |
| `10_after_add_idx_line_row.png` | 提交后表内新增 `idx_line_row` |
| `11_final_index_table.png` | 最终索引表放大图（字段组成逐字可读） |
| `12_search_with_quotes_returns_empty.png` | 坑：搜索带引号 ⇒ 静默「没有找到记录」 |
| `13_search_no_quotes_works.png` | 去掉引号 ⇒ 正常返回（与 12 互为对照） |

## 复现要点

1. 工具栏 `∞`（屏幕 (1428,24)）→ 云开发控制台 → 左侧「数据库」。
2. 记录：集合搜索框 (470,274) 输入 `shop_cost_card_line` 之类的**前缀**；记录搜索框 (1570,302) 语法为 **`key == value`（字符串值不加引号）**。
3. 改字段：展开 `limits` → 点行 → 点行尾 ✏️(x≈1368) → 弹窗改「值」→ 确定。
4. 索引：分段页「索引管理」(1239,239) → 行尾「删除」/ 顶部「+ 添加索引」(729,304)。
5. ⚠️ 开工前先清掉压在屏上的模态框（如「模拟器长时间没有响应」），否则点击无效但 md5 仍变。
