# R209 · 月份选择器「只能停在本月」根因与修复（2026-10-04）

> 起因：李老师真机反馈「月度盈利核算选月份，只能选本月，选择以前月份会提示填写错误」，并追问「这个是要求这样的吗？」。
> 结论先说：**不是产品限制，是真 bug**。后端对历史月份从来不设卡。

---

## 一、根因（实跑定位，非肉眼推断）

`<picker mode="selector">` 的 `e.detail.value` 是**选中项下标（数字）**，不是选项本身的值。

```
pages/month/index.js（旧）
  onMonthChange(e) {
    const month = e.detail.value;      // ← 拿到的是 0 / 1 / 2
    this.loadMonth(month);             // ← getLedger 收到 month = 1
  }
```

链路：`getLedger/validate.js` 判 `typeof src.month !== 'string'` ⇒ `INVALID_PARAM`
⇒ 前端 `api.toastError` 弹 `ERR.INVALID_PARAM`「**填写有误，请检查后重试**」。

**为什么看起来像「只能选本月」**：本月那一次是 `bootstrap()` 直接用 `ui.nowMonth()` 字符串拉出来的，
压根没走 picker ⇒ 只有它正常；用户**点任意一个月份**（含本月）都会报错。

探针（归档在 `review/evidence/r209_gate/scripts/_probe_month.js`）实跑结论：

| # | 判据 | 结果 |
|---|---|---|
| ① | picker selector 出参是数字下标 | PASS（value=1） |
| ② | 现实现往下传的是 `1` 而不是 `2026-09` | PASS |
| ③ | 后端对该值判 `INVALID_PARAM`（= 前端「填写有误」） | PASS（error=INVALID_PARAM） |
| ④ | 同一入口传正确字符串则放行 | PASS（'2026-09' → error=null） |

⇒ `ROOT CAUSE CONFIRMED`。

🟦 **附带事实**：全站 17 处 `picker mode="selector"`，**只有这一处走漏**；其余 16 处（recon 月历、
card 三个筛选、material 分类、takeaway 承担方、result 业态/城市等）本来就是
`Number(e.detail.value)` 取数组元素。所以是单点退化，不是全局写法问题。

---

## 二、修复

| 文件 | 改动 |
|---|---|
| `pages/month/index.js` | `onMonthChange` 改为 `const i = Number(e.detail.value); const month = this.data.months[i];`；加「重复选择 / 越界」early return（不发无效请求）；`setData` 同步 `monthIndex` |
| `pages/month/index.wxml` | picker `value` 由 WXML 内联表达式 `{{months.indexOf(curMonth)}}` 改为变量 `{{monthIndex}}`（与 recon 页写法对齐，不依赖解析器白名单） |
| `pages/month/index.js` | `data` 增 `monthIndex: 0`；`bootstrap` 里按 `months.indexOf(cur)` 赋初值 |

---

## 三、新增守卫 `tools/check_month_picker.js`（第 134 个套件，18 条）

> 为什么必须配守卫：这是**静默类**缺陷——既不报错也不崩，改回去没人会发现（与 R207/R208 同族）。

| 组 | 判据要点 |
|---|---|
| S 护栏 4 | 目标文件在位 / 剥注释达长度下界 / handler 可抽出 / 全仓 `.wxml` 扫描面 ≥20（防扫空恒绿） |
| A **实跑** 5 | 把 `onMonthChange` 函数体**抠出来用伪造 Page 上下文调用**（判行为不判字面）：传出必须是 `months[i]` 字符串、类型 string、重复不选不请求、越界不请求、高亮跟随 `monthIndex` |
| B **实跑** 4 | `require` 生产 `cloudfunctions/getLedger/validate.js`：历史月 `2026-09` 放行（**证明不是产品限制**）、数字拒、`2026-13` 拒、`202609` 拒 |
| C 全仓回归 3 | 17 处 selector picker 的 handler 一律必须用下标取数组 + 扫描面 ≥10 + 月历页锚点在扫描面内 |
| D UI 一致 2 | wxml 用 `monthIndex` 变量、`js` 声明 `monthIndex` 初值 |

**自踩坑（记取）**：首版收尾行写成「总览：18/18 全部通过」⇒ 被 R69「输出必须走完收尾」判红
（正则要求末行含「N 通过」）。已改为标准形态 `===== 月份选择器守卫结果：18 通过 / 0 失败 =====`。

---

## 四、变异回灌 3/3（md5 字节级还原已校验）

| 变异 | 改法 | 实际转红 |
|---|---|---|
| M1 | 改回 `const month = e.detail.value` | A-①②③④⑤ + C-② |
| M2 | 去掉 early return | A-③ + A-④ |
| M3 | setData 去掉 `monthIndex` | A-⑤ |

脚本：`review/evidence/r209_gate/scripts/_mut_r209.py`（起点/终点 md5 一致）。

---

## 五、六处同步 + 门禁

- `verify_all.js`：SUITES 新增 `['month-picker', 'tools/check_month_picker.js']`、头注 133→134、守卫说明段补 R209 段
- `tools/check_suite_assert_counts.js`：CASES 加 `check_month_picker` = 18
- 重启键 `specs/dev-specs/★知识存储点_2026-09-10.md`：§1.1 入口行、断言数声明行（四十六者→四十七者）、
  「套件数会漂」行、演进链尾部（补第 134 条）
- 🔴 **文档改写踩坑**：用单行 Python `replace` 追加演进链时，新串里**漏带原锚点自身**，把
  `M6→D-①D-③）` 吞掉了 ⇒ 靠 `git show HEAD:` 取原文比对才发现并补回（`_fix_r209_doc.py`）。
  教训：**replace 追加务必显式包含锚点原文；改完必须回读比对，不能只信脚本返回的成功。**

门禁：`134/134 通过，R92 ✅`（证据目录 `review/evidence/r209_gate/`，全文 `gate4_full.txt`）

---

## 六、本轮环境侧发现（值得记取，非代码缺陷）

1. **执行形态会影响套件成败**：同一份 ENV、同一份 preload，用**单个 python 进程连派生 134 个 node**
   时，依赖 `spawnSync git/python` 的 9 个套件稳定红（EBUSY）；而**每个套件放进独立 python 进程**驱动，
   全部绿。三次对照+最小复现证据：`gate_1/2/3.txt`、`flaky_1.txt`、`min_1.txt`、`_probe_env.py`。
   ⇒ 新驱动 `review/evidence/r209_gate/run_gate4.py`（每套件独立进程），判据逐条等价于 `run_gate3.py`。
2. **preload 缺键 ⇒ 假红**：`check_suite_assert_counts` 内部 spawn 新套件，沙箱 preload 未缓存该键
   ⇒ 报「声明 18 ≠ 实跑 undefined」。缓存值必须**真跑**写入（`_mk_add_key.py`），不许手写常量。
3. **托管 venv 缺 `python-docx`** ⇒ `docx-derive` 套件红。已 `pip install python-docx`（只装隔离 venv），
   并刷新 `python.exe -c import docx` / `python.exe tools/verify_docx.py` 两条缓存键 ⇒ 该套件 6 通过/0 失败。

---

## 七、李老师第 2 问：店铺删除（复核结论）

**代码侧早在 R208 就改掉了**：`decideDelete` 已放开为 `allowed: active >= 1`（最后一家也能删），
`getShopContext` 用 `listIncludingDeleted` 探测历史店铺做早退（删空不死锁），
`pages/shop/switch.wxml` 已把「⋯」菜单摊成行内**「改名」「删除」**两个显式按钮，且两个云函数均已部署上云。

⇒ 李老师看到的「三个点 + 至少保留一家」是**旧包**（本次已出新码，`qr_r209_x2.png`）。
⇒ 「新建就要花钱」这条链路也已不成立：删除后 `used` 归 0，免费额度刚好够再建 1 家。

**待定夺（未改，等你拍板）**：
- 删除是**软删**：别的数据还在库里，但对该账号不可见。对「只有一个店的老板」来说「删店」是个重动作。
  是否需要：① 删除前提示该店的账套数量/月份数（给个后果量级）；② 或改成更符合老板诉求的
  「**重置这家店的数据**」（保留店铺，只清月度账套）；③ 或在删店确认里补一句「该店的数据会一并隐藏」。
