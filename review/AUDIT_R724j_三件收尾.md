# R724j · 三件收尾（A 清残留 / B 外卖页收敛 / C 补桩）

> 2026-11-13 凌晨 · 李老师说「走ABC」⇒ 按 A → B → C 依次做完。
> 全量：**303/303**　台账：**21 条（fixed 16 / deferred 5）**

---

## A · R3-7 历史残留 key —— 核查后**不用改代码**

### 我先前的判断是错的

昨晚登记 R3-7 时我写「在登出流程里并列加一步清这三个 key」。今天动手前查了 `doLogout`：

```js
exportFile.clearExportedFiles();   // 先删导出文件（文件不在 storage 里）
wx.clearStorageSync();             // 然后全清 storage
```

`clearStorageSync()` 是**全清**，三个历史 key 早就在覆盖范围内。**我登记时没查 doLogout 就下了结论。**

### 那真正值得补的是什么

「全清」这件事**此前没有任何断言**。历史上真出现过「改成按 key 逐个删」的写法——一旦有人这么改，三个历史 key 和导出清单 key 都会漏，而门禁照绿。

补了两条（`tools/check_r723_p0_fixes.js`）：

- **B-⑦** 前提：登出前 store 里确有 4 个 key（1 个导出清单 + 3 个历史残留），否则 B-⑧ 是空跑恒真
- **B-⑧** 登出后 `store.size === 0`

**真变异验证**：把 `wx.clearStorageSync()` 改成 `wx.removeStorageSync('shop_switcher_shop_id')`（模拟「只删当前认识的 key」）⇒ B-⑧ 转红并列出 4 个残留：

```
剩余=["r723_exported_files","m3_dish_cats","sandbox_draft_v1","takeout_mode_shop_mu6j87v1itrs_2026-09"]
```

整体 `exit=1`。已还原。

> 这条待办的价值不在「清 key」，在「守住全清语义」。

---

## B · R2-6 外卖页 4 个橙块 —— 只降视觉重量

### 三条备选方案都被否掉

| 方案 | 为什么不行 |
|---|---|
| 合并前两条文案 | `check_takeaway_semantics` 的 **B-④ 是位置断言**（`dishPriceNote` 必须在填份数之前），合并/下移直接破坏 R715 定的语义 |
| 改成折叠 | 本来就整段跳过的人不会去点开折叠，等于把信息藏得更深 |
| 缩短文案 | 只省 1 行，效果有限 |

**真正压人的是色块密度**（4 个浅黄块连成一片），不是字数。

### 改法

```css
/* 改前 */
.base-note { background:#fdf6ec; border-radius:10rpx; padding:10rpx 16rpx; color:#b45309; }
/* 改后 */
.base-note { background:transparent; border-radius:0; padding:2rpx 0 2rpx 16rpx;
             border-left:4rpx solid #f0c680; color:#a16207; font-size:28rpx; }
```

**一个字没改、一个位置没动**，只把「4 个色块」变成「4 行带竖线的说明」。

### 效果（截图对比）

- 改前 `02-takeaway.png`：4 个黄块连成一片，「平台参数」被推出首屏
- 改后 `02-takeaway-after.png`：4 行带竖线说明，**「平台参数」+「佣金方式」现在首屏可见**

### 守住

`check_takeaway_semantics.js` 新增 4 条：

- S-① 规则可解析（解析不出宁红不猜）
- **S-② 不得回退成不透明色块**（真变异：改回 `#fdf6ec` ⇒ 转红 exit=1）
- S-③ 必须保留左竖线（否则纯裸文字和正文混在一起）
- S-④ 字号 ≥28rpx（AD 红线，不能靠缩小字号省地方）

> 踩到一个自己的坑：S-② 第一版用 `(?!transparent)` 前瞻，`\s*` 会回溯到空格前，前瞻落在空格上 ⇒ `background: transparent` 被误判成色块。改成「提取值再比」才对。

---

## C · R1-8 补桩：店铺设置页（14 断言）

`subpkg/tools/shop/setting.js` 只有 71 行，但有一处**跨页互踩**的雷：

> 2026-09-20 把「库存 / 摊销」两个核算开关**迁出**本页，改到月度录入页。
> `saveShopSetting` 的语义是「未传字段 = 不动库」⇒ 本页 `onSave` **绝不能传 `switches`**。
> 一旦有人图省事把 `switches` 一起传（哪怕 `{}` 或从 globalData 读的旧值），
> 就会把老板刚选的核算方式**静默冲掉**，而界面照提示「已保存」——零报错、跨页、极难归因。

| 组 | 条数 | 覆盖 |
|---|---|---|
| A 读回 | 4 | 回填 + 同步全局 / 字段缺失不渲染 undefined / 失败提示 |
| B 保存载荷 | 6 | **不含 switches** / name+remark 正确 / 幂等键 `ss_*` / 保存后重拉 / 成功提示走 terms / 失败不弹成功 |
| C 生命周期 | 2 | onShow 每次重拉 / 下拉刷新真停 |
| M 变异 | 2 | 顺带传 switches / 保存后不重拉 —— 均 exit=1 点名 |

---

## 台账与计数

| | 之前 | 现在 |
|---|---|---|
| 总条数 | 21 | 21 |
| fixed | 14 | **16** |
| deferred | 7 | **5** |
| 套件 | 302 | **303** |

剩余 deferred 5 条：R1-3（P2）、R1-6（P2）、R3-2（P1 导出防转发）、R3-3（P2）、R1-8（P1 补桩剩 3 页）。

---

## 边界

- B 是**样式改动**，只验了模拟器截图，**真机上的对比度和观感仍需您确认**——尤其文字颜色从 `#b45309` 调亮到 `#a16207`，我用左竖线补可识别性，但这是我一个人判断的。
- C 全在 L2 桩层。
