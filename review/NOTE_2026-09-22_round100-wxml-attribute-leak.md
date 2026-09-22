# round100 回执 —— 月度录入页「金额行渲染出属性文本」P0 修复 + R123 WXML 结构守卫

- 日期：2026-09-22（21:10 ~ 21:45）
- 触发：李老师真机截图（开发版「月度录入」页）
- 结果：**P0 已修** + **新增守卫 R123**（套件 95 → **96**）；门禁 **96/96 RC=0**；变异回灌 **7/7**
- 相关提交：见本批次 C1（代码）/ C2（文档）

---

## §0 一句话结论

真机上那串「英文」不是文案问题、也不是 i18n 漏翻 —— 它是 **WXML 标签在属性集合中间被 `/>` 收掉了**，
后续属性行失去归属、退化成**文本节点**；而 **WXML 的文本节点仍会插值 `{{}}`**，所以屏上显示的是
**求值后**的属性值（`data-gidx="0"`、`disabled="false"`），看起来就像一段英文报错。
**同一支插入脚本、同一轮**（round97 T1）也把 `pages/month/input.js` 的 require 拆成两条（那是 round99 的 P0，由 R122 记）

---

## §1 现场

真机（开发版）→ 月度录入 → 「运营费用 / 人工费用」：
- 每一行「金额（元）」右侧，输入框之后**整片渲染出属性串**；
- 表现：`data-kind="expense"` / `data-gidx="0"` / `data-ridx="0"` / `bindinput="onSubAmount"`
  / `disabled="false"` / `adjust-position="true"` / `cursor-spacing="20"` / `/>`；
- 覆盖面：**该模板按细项行循环**，所以「租金」「水电」「工资绩效」…每行都出现 ⇒ 视觉上"很多处"，
  但**源码只有一处**（全仓扫描确认，见 §4）。

---

## §2 根因（源码级）

修复前 `pages/month/input.wxml` 第 253-256 行：

```wxml
253|        <input class="val-input" type="digit" confirm-type="done" value="{{r.amountYuan}}"
254|          data-kind="expense" data-gidx="{{gi}}" data-ridx="{{ri}}" bindinput="onSubAmount" disabled="{{readOnly}}"  adjust-position="{{true}}" cursor-spacing="20" />
255|          data-kind="expense" data-gidx="{{gi}}" data-ridx="{{ri}}" bindinput="onSubAmount"
256|          disabled="{{readOnly || (twMkByPlatActive && gi === twMkRowGi && ri === twMkRowRi)}}"  adjust-position="{{true}}" cursor-spacing="20" />
```

- 第 254 行**已经用 `/>` 把 `<input>` 收掉了**（且它的 `disabled` 只有 `{{readOnly}}`，是**旧版**）；
- 第 255-256 行是 **R85 的新版属性集合**（`disabled` 含营销分平台互斥），却**没有开标签** ⇒ 成了裸文本；
- ⇒ 真机渲染 = 一个空输入框（254 行那个）+ 一大段英文文本（255-256 行）。

**怎么来的**：round97 T1 为 R85 补「营销项在分平台模式下，佣金行由平台小计回填 ⇒ 该行转只读」时，
脚本**追加**属性而**不是替换**原有属性 ⇒ 新旧两套并存、旧的那条自带 `/>` 把标签提前收掉。
（**同一脚本、同一轮**还拆坏了同页 `input.js` 的 require 解构 —— round99 的 P0 / R122）

---

## §3 为什么屏上是「求值后」的值（这是最容易误判的一点）

WXML 的**文本节点会插值**。所以裸出去的 `data-gidx="{{gi}}"` 在真机上显示为 `data-gidx="0"`，
`disabled="{{readOnly}}"` 显示为 `disabled="false"`。

⇒ 若按「屏上是 `data-gidx="0"`」去源码里搜 `data-gidx="0"`，**永远搜不到**（源码里是 `{{gi}}`）。
**正确做法是读那个 `.wxml`、看结构**，而不是把屏上文字当线索去 grep。

---

## §4 处置

### 4.1 修复（1 处删除）

删除第 254 行（旧版、自带 `/>`），让第 253 行的开标签与 255/256 的 R85 属性集合合成**一个完整 `<input>`**：

```wxml
        <input class="val-input" type="digit" confirm-type="done" value="{{r.amountYuan}}"
          data-kind="expense" data-gidx="{{gi}}" data-ridx="{{ri}}" bindinput="onSubAmount"
          disabled="{{readOnly || (twMkByPlatActive && gi === twMkRowGi && ri === twMkRowRi)}}"  adjust-position="{{true}}" cursor-spacing="20" />
```

- **R85 语义零改动**（互斥 disabled 完整保留，修复脚本内含断言强制）；
- 文件：374 → 373 行；20519 → 20351 字符；`data-kind="expense"` 计数 7 → 6；
- 备份 `_gui/_bak_input_wxml_r100.wxml`（md5 `f6650e8faed00fdcd27d4512a452c3ec`）。

> ⚠️ 修复脚本首跑**主动 ABORT**且未写文件：我的结构自校验用 `new_raw.index('<input class="val-input" …')`
> 取片段，**命中了收入侧同 class 的输入框**（自校验取错对象，`PITFALLS §1` 同族）⇒ 改为按**删除点邻域**取片段。

### 4.2 新增守卫 R123（`tools/check_wxml_structure.js`）

**缺口**：95 个套件里**没有任何一条读 `.wxml`** —— R122 只覆盖 `.js`，前端页面结构此前零机器判据。

两条判据 + 一条下界护栏：

| 判据 | 内容 | 能抓什么 |
|---|---|---|
| **A 裸属性行** | 某非空行形如 `attr="…"`，而**上一非空行以 `>` 或 `/>` 结尾** ⇒ 该属性无归属 | 本次事故的**直接形态**，字面点名到行 |
| **B 标签配平** | 骨架化后单趟 tag 栈：`<name …>` 未自闭合入栈 / `<name …/>` 不入栈 / `</name>` 弹栈比名 | 标签未闭合 / 错配 / 缺 `>` |
| 护栏 | 文件数 ≥ 10 **且**四个锚点页面（含事故现场）必须命中 | 扫描面被悄悄写窄（假绿） |

实现要点：
- **骨架化**抹 `{{…}}`、`<!--…-->`，替换为**等长空格但保留 `\n`** ⇒ 报出的行号与源文件一致、不漂移；
  抹 `{{…}}` 是必须的：否则 `data-kind="{{gi}}"` 的引号会干扰属性行识别，`{{a > b}}` 还会伪造「上一行以 `>` 结尾」；
- **标签名识别**：`<` 后不得是空白、标签名须以字母起头 ⇒ 正文里的 `价格 < 100` 不会被当标签。

### 4.3 三处同步（改 SUITES 后的人工面）

1. `verify_all.js` 头注「串联：**96** 个套件」+ R123 条目（R59 会自校验）；
2. `verify_all.js` `SUITES` 追加 `['wxml-struct', 'tools/check_wxml_structure.js']`；
3. `★知识存储点_2026-09-10.md` 两处（§1.1 一键校验入口行 + 「套件数会漂」行）95 → 96 + R123 条目。

另：`tools/check_suite_assert_counts.js` 的受守集合纳入 `check_wxml_structure`（声明行 `=2`，「十二者」→「十三者」）。
**为什么必须纳入**：它是本仓**唯一有两个独立判据**的守卫 —— 删掉其中一条 ⇒ 实跑通过数 2 → 1、**仍 > 0**
⇒ A0-② 的「通过数为 0」下界抓不到，**只有 A2「声明 ≡ 实跑」能发现**。
（对照：R122 `check_js_syntax` 只有单一判据，删掉即 pass = 0，A0-② 会当场转红 ⇒ 不必另立声明。）

---

## §5 证据

### 5.1 门禁

- `review/evidence/gate_96_r100.txt`（3133 行）：**总览 96/96 套件通过、0 FAIL、RC=0**（3m08s）
- 关键项：`suite-count` ✅ / `suite-tracked` ✅ / `suite-coverage` 10/9 ✅ /
  `suite-assert-counts` **21 条**（20 → 21，新增 `check_wxml_structure` 那条 A2）✅ /
  `wxml-struct` ✅ 2 条 / `js-syntax` ✅

### 5.2 变异回灌（7/7，全程 md5 逐字节还原）

| 组 | 变异 | 期望 | 实测 |
|---|---|---|---|
| A | **M1** 在金额 `<input>` 属性集合中间插 `/>`（复现原病灶） | 红 | rc=1，输出含「裸属性行」✅ |
| A | **M2** 删一处 `</view>` | 红 | rc=1，含「未闭合」✅ |
| A | **M3** 一处 `</view>` → `</text>` | 红 | rc=1，含「错配」✅ |
| A | **M4** `MIN_FILES` = 999 | 红 | rc=1，含「疑似扫描面被写窄」✅ |
| A | **M5** 锚点指向不存在文件 | 红 | rc=1，含「未命中锚点」✅ |
| B | **N1** 扫描面内放**合法**多行标签 | 绿 | rc=0 ✅（证明判据 A 的**前件**必要） |
| B | **N2** `review/` 放坏 wxml | 绿 | rc=0 ✅ |

- 还原基准（跑前记录，跑后一致）：`pages/month/input.wxml` `4920df24…` /
  `pages/month/result.wxml` `7d6560fa…` / `tools/check_wxml_structure.js` `50bca1ec…`
- 探针文件均无残留（`pages/_mut_r100_probe_ok.wxml`、`review/_mut_r100_probe_bad.wxml` 均 False）

> ⚠️ 回灌首跑 M1 锚点 count=0 被**静默跳过**：`input.wxml` 是**纯 CRLF**（372 CRLF / 0 裸 LF），
> 我的锚点写死了 `\n`。⇒ 教训：CRLF 文件的跨行锚点必须写 `\r\n`（已写进 `PITFALLS §1`）。

### 5.3 出码（真机判据）

- `cli preview` → **`√ preview`、RC=0**
- 包体 **191170 B**（修复前 191325 B，**少 155 B**）
- 二维码：`_gui/qr_now.jpg`（2026-09-22 21:33 出，21:58 失效）

---

## §6 同族病灶（本轮把「一次插入伤两层」补全）

| 层 | 事故 | 守卫 | 何时补 |
|---|---|---|---|
| **JS 语法** | `pages/month/input.js` require 解构被拆成两条 ⇒ 出码 `code 10`、小程序起不来 | **R122** `tools/check_js_syntax.js`（vm.Script 编译 675 个 `.js`） | round99 |
| **WXML 结构** | `pages/month/input.wxml` 金额 `<input>` 被提前 `/>` 收掉 ⇒ 属性变成文本渲染 | **R123**（本次） | round100 |

⇒ 两次事故**同一支脚本、同一轮**（round97 T1）。教训已落 `review/README.md §7` 第 27/28 条。

---

## §7 未闭合 / 遗留

1. **前端 `.wxss` 无结构类守卫**：R123 只覆盖 `.wxml`（标签结构）。样式层已有 R115（主题色）与 R119（金额框同行），
   但「`.wxss` 里的选择器是否引用不存在的 class」仍无人守 —— 要不要补，待定。
2. **`pages/month/result.wxml` 未做同类回归**：本轮只确认它那 1 处 `data-kind="expense"` 是**合法单行标签**
   （已核，见 §4）；但同页是否还有别的结构隐患，只由 R123 的常规扫描覆盖（当前 0 命中）。
3. **round97 插入脚本伤过的面是否已穷尽**：目前已知 **2 个文件**（`input.js` / `input.wxml`）。
   已按「修一处 grep 查全同类」全仓扫过：`.js` 由 R122 兜（675 文件全绿）、`.wxml` 由 R123 兜（0 命中）。
   ⇒ 但**其他文件类型**（`.wxss` / `.json` / 云函数配置）未做同批排查，属已知空档。
4. **`_gui/` 与 `review/evidence/` 下累计约 40 个历轮临时脚本**：仍待李老师点头清理。

---

## §8 复现方式

```bash
cd <repo>
node tools/check_wxml_structure.js        # 守卫（应 rc=0）
node verify_all.js                        # 全量门禁（应 96/96）
python <工作区>/_gui/_mut_r100.py          # 变异回灌（应 7/7）
```

- 手工复核修复点：`pages/month/input.wxml` 搜 `bindinput="onSubAmount"` ——
  **该标签必须是一个完整 `<input … />`**，其属性行**不得**出现在 `/>` 之后。
