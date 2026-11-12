# R723 · R721 台账三条 P0 修复验收

> 2026-11-12 · 李老师「好的，继续」⇒ 按上一轮承诺的 P0 顺序自主推进。
> 守卫：`tools/check_r723_p0_fixes.js`（24 断言）｜ 全量：294/294

---

## 0. 一句话结论

台账里三条 P0（元守卫注释喂绿 / 导出件注销残留 / 对账页抑制提示无回头路）**全部修复并固化为行为守卫**，另顺手修了 P2 的 `globalData` 登出残留。**没动任何算钱口径**。7 条真变异回灌全部干净 `exit=1` 且点名目标断言。

---

## 1. 三条 P0 分别怎么修的（挑毛病结论都兑现了）

### R1-1 元守卫「注释喂绿」
`tools/check_suite_coverage.js` 的 S5「零漏网」把 SUITES 脚本源码**原样拼接**做 `includes(f)` ⇒ 注释里随手写一句 `// 运行：node tools/check_x.js` 就能把没挂 SUITES 的判据算成「已间接引用」。

- 内置**引号感知**剥注释 `stripJsComments()`（与 `check_m2_no_cost_rate.js:63-88` 同款；那个文件末尾 `process.exit` 不能 require，所以内置一份精简实现）。拼接前先剥。
- 新增 `S5-②` 反恒真：注释变体必须判否、字符串字面量里的真实引用（如 `verify_docx.py` 的 `const PY_SRC = '...'`）必须判是；`http://` 不被切坏。
- R721 唱反调 reviewer 提醒的两条都避开了：**没用朴素 `//` 切**（会误伤 URL 与字符串），**没改成只认 `require/execFileSync`**（会误伤 `const PY_SRC` 那种合法间接引用）。
- 断言数 10→11，同步重启键里的断言计数登记 `check_suite_coverage`=11（该登记只能有一处，别在报告里复述标记词）。

### R3-1 导出件明文长期残留
- `utils/exportFile.js` 新增 `EXPORTED_FILES_KEY` 会话清单：`writeFileToSandbox` 成功后只记**文件名**，不记内容；新增 `clearExportedFiles()` 按清单逐个 `unlinkSync`，**逐文件 try/catch**，任何失败都不阻断登出。
- `pages/mine/index.js::doLogout()` 在 `wx.clearStorageSync()` **之前**调清理（清完就读不到清单了）。
- 避开了唱反调 reviewer 指出的三个坑：**没用「文件名前缀」白名单**（导出件以真实店名开头，无统一前缀，会漏删成假修好）；**没在模块加载期调 `wx.getFileSystemManager()`**；**清理在 `clearStorageSync` 之前**。
- 顺带清 `globalData.switches` / `pickMaterial`（台账 R3-5，P2）。
- 新 storage key 已登记进 `check_m3_storage_isolation.js` 的 `SESSION_SCOPE` 类（A-⑤ 横向防漏的设计意图）。

### R2-1 对账页抑制提示无回头路
- **判定移到单源**：`utils/reconDerive.js` 新增 `fixTargetOf(rec, actualReason)`，只给 `menu_no_price`（→ 成本卡补售价）和 `actual_no_data` 且非 `need_detail_income`（→ 月度录入记收入）两条直达入口；其余（覆盖率不足 / 没填在售数 / 改用分项录入 / 通用）一律不给按钮。
- `recon/index.js` 只调单源，`result.fixUrl` / `fixLabel`；`goFix()` 真 `navigateTo`；`wxml` 按钮受 `wx:if="{{result.fixUrl}}"` 门控，新增 `.recon-fix` 样式（字号 28rpx、触控区 88rpx，过 AD 红线）。
- **一处复核发现**：R721 唱反调 reviewer 说「刚输未保存的 `menuDishCount` 跳走会丢」。读源码核实 `recon/index.js` 只有 `onLoad`、**没有 `onShow`**，且用的是 `navigateTo`（压栈不销毁当前页）⇒ 返回不重建、`this.data` 仍在。**判为误报，不加多余的草稿机制**，避免多引一个 storage key。

---

## 2. 两个「修完反而红」的守卫，都是真纪律

| 守卫 | 红在哪 | 处置 |
|---|---|---|
| `selftest_m3_recon` | `R298X-⑩`「reason→文案判定只许在单源」：我首版在页面内联了 `'menu_no_price'` 等字面量 | 把分叉移进 `reconDerive.fixTargetOf`，页面正文零 reason 字面量 ⇒ 33/33 |
| `check_auto_queue` | `N-③/N-④/N-⑥` NEXT 撞车：代码注释已用 `R723`，但 `NEXT` 还停在 723 | 进位到 **724** ⇒ 28/28 |

这两条不是「把守卫改松」，是**按既有纪律改设计**，正好演示了 R721 方案里「全量门禁会替我发现自己漏掉的东西」。

---

## 3. 新守卫：行为取证，不是源码形状

`tools/check_r723_p0_fixes.js`（24 断言）：
- **A 元守卫**：`new Function` 真抽出生产 `stripJsComments` 执行，喂注释变体/字符串字面量/`http://` 三类样本。
- **B 注销**：页面桩真跑 `doLogout()`，用调用日志取证「清理先于 `clearStorageSync`」「2 个含店名的文件都被 unlink」「第 2 个 unlink 抛异常仍 `switchTab`」「globalData 清干净」。
- **C 对账**：真跑 `fixTargetOf` 六种 reason + 页面桩真跑 `goFix()`（带/不带 `fixUrl` 两种），并核对目标路由已在 `app.json` 注册。
- **D 变异**：内存构造「改回旧写法」的样本，判据必须给相反答案。

### 真变异回灌（落盘改坏产品源码，跑完恢复）
7 条全部 `exit=1` 且点名：拼接改回原样 / 删反恒真断言 / 去掉清理 / 清理挪到清缓存之后 / 覆盖率不足也放行 / 按钮去门控 / 删 `goFix` handler。

> **一处如实登记的踩点**：M7（删 `goFix`）首跑是 **`exit=2` FATAL** —— 删掉 handler 后 C-⑧ 页面桩真跑抛 TypeError，属于 `mutation-backfill` 铁律里的「**崩溃红 ≠ 真抓到**」。已改守卫让 handler 缺失时优雅判红，重跑 7/7 全部干净 `exit=1` 点名，不把崩溃当通过。

### 守卫自身首跑也踩了 3 条假红（都是我写错，不是产品问题）
`setTimeout` 桩在 `loadMine()` 里被提前恢复 ⇒ 登出的 1200ms 定时器赶不上断言（B-③/B-⑤）；`app.json` 路由不带前导斜杠而我拿带斜杠的比（C-⑤）。逐条查明后修正，24/24 全绿。

---

## 4. 诚实评分与剩余待办

| 面 | 评分 | 说明 |
|---|---|---|
| 三条 P0 修复 | 🟢 | 行为守卫 + 7 条干净变异 |
| 不碰算钱口径 | 🟢 | 本轮零改动计算层 |
| 数据安全（本地残留） | 🟢 | 导出件注销清理已落地；R722 云端权限本来就是「仅创建者可读写」 |
| 桩型覆盖率 | 🔴 | 仍约 14%，长期欠账，见 R721 方案 |
| 真机 | 🟡 | 本轮全在 node 桩 / 纯函数 / 源码形状层，未上真机 |

**台账剩余 P1/P2**（都有 `priority` + `next_action`，守卫天天盯）：`material/batch|pick|ai/consent` 零桩、导出按钮叫「打印」但只产 Excel、`cardShort` 承诺排行、外卖 4 个橙块、备份零脱敏治理（R722 已从 P1 降 P2）、`getDiagnosis` 付费闸门、`dbBackup`/告警设置的控制台项。下一轮按台账继续。

---

## 5. 复现

```bash
node tools/check_r723_p0_fixes.js     # 24 断言
node tools/selftest_m3_recon.js       # 33 断言（reason 单源纪律）
node tools/check_auto_queue.js        # 28 断言（NEXT 不撞车）
node verify_all.js                    # 294/294
```
