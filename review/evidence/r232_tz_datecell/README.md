# R232 · Excel 日期单元格失准（C-11）可复现取证

## 结论一句话

Node 里 `new Date(1899, 11, 30)` 落在 **GMT+0805**（1899 年中国是 LMT 地方平时，比 +0800 少约 5′43″），
而 SheetJS 正是用它做 basedate ⇒ 算出的整天时间戳落在 **23:54:17** 而非午夜
⇒ `fmtCell` 取日历日时**系统性早一天**。

**拿真实营业日闭环实测：现状 0/4 正确，修后 4/4 正确。**

## 复现

```bash
# 1. Node 侧闭环验证（现状 vs 修后）
C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe fixcheck_datecell.js

# 2. 形态 C 日期列类型（证明当前样例未触发该分支）
C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe ctype_formc_datecol.py
```

## 期望输出

```
serial | 期望        | 现状(本地)   | 修后(UTC+round)
46278 | 2026-09-13 | 2026-09-12 ❌   | 2026-09-13 ✅
46272 | 2026-09-07 | 2026-09-06 ❌   | 2026-09-07 ✅
46296 | 2026-10-01 | 2026-09-30 ❌   | 2026-10-01 ✅
46250 | 2026-08-16 | 2026-08-15 ❌   | 2026-08-16 ✅

现状正确 0/4     修后正确 4/4
```

```
日期列: {'str': 354}
R2: number_format='General'  is_date=False
```

## 为什么现在还没炸

两张样例表的日期**都不是真日期单元格**：
- 形态 A：日期在 R2 参数行里，是**纯文本长串**的一部分
- 形态 C：第 1 列 `日期` 实测 `type=str` × 354 行、`number_format='General'`、`is_date=False`

⇒ `fmtCell` 的 `instanceof Date` 分支**从未被触发**。
**但 Excel 导出的日期列默认是真日期格式** ⇒ 换一张表就可能触发，届时整表 `biz_date` 错位一天且零报错。

## 🔴 守卫写法纪律（本轮最重要的一条）

禁止用「扫描 `getFullYear()` / `getMonth()` 字面并判红」这类守卫 —— 它会**把正确的实现改成错的**：

| 数据来源 | 正确读法 |
|---|---|
| `created_at`（`nowUtc()`，真 UTC 时间戳） | **必须** `getUTC*` |
| SheetJS `cellDates` 的 Date（本地构造） | **必须** `get*`（改成 `getUTC*` 反而更错） |

⇒ **判行为不判字面**（同族病第 N 例）。
