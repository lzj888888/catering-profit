# R724h · 模拟器走查（8 页）+ 抓到一个真 UI 矛盾

> 2026-11-12 深夜 · 李老师说「你先走你的，或者你自己走下真机」⇒ 我自己把模拟器通道打通了。
> 守卫：`tools/check_hub_paytag.js`（6 断言）｜ 全量：**302/302**
> 证据：`review/evidence/r724h_simulator/`（9 张截图 + 2 份机器数据）

---

## 0. 一句话结论

模拟器通道打通（不用扫码：开发者工具已登录，`islogin=true`）。8 页走查 **7/7 成功**，抓到一个**静态守卫永远看不出来的真问题**：

> **M3 枢纽的四张卡片（外卖 / 团购 / 复盘 / 对账）硬编码着「需开通」标签，而当前阶段 `PAYWALL_ENABLED=false` / 云端 `FREE_ACCESS=true`（功能全开）。点进去就能用，标签却说需要开通——老板不敢点。** 已修，并回模拟器复验。

---

## 1. 通道怎么通的（可复现）

```
cli islogin --port 10896                 → {"login":true}   ← 不用扫码
cli close  --project <根>                → 清干净
cli open   --project <根>
cli auto   --project <根> --auto-port 9420 --trust-project
等待 90s（预热），再 connect（每步都要 route 校验）
```

三个实测坑，都记下来：

1. **反复 connect 会把通道弄坏**：我连了 7 次之后 `evaluate(1+1)` 都超时。技能里「一条连接内跑完」是硬纪律。
2. **`wx.reLaunch` 到分包页会静默失败**：我第一版写了 `fail: () => {}`，结果 `03-recon` / `05-material` 的 `route` 还是 `pages/index/index`——**读到的是上一页的数据**。差点得出「对账页没数据」的错结论。必须**校验 route 是否等于预期**。
3. **云请求比 5 秒慢**：等 5s 截图全是「加载中…」，等 11s 才有内容。

---

## 2. 八页走查结果（机器数据）

| 页 | route | 关键状态 |
|---|---|---|
| 首页 | `pages/index/index` | 店铺 `Abc`；`hasProfit=true`；标签「**估算利润**」；`51900.00` |
| 外卖计算 | `subpkg/biz/takeaway/index` | `loading=false`；52 个 data 键；无结果（冷启动） |
| 对账复盘 | `subpkg/tools/recon/index` | `hasResult=true`；底部红字「请先填写「本月在售菜品数」，才能算覆盖率」 |
| M3 枢纽 | `pages/m3/hub` | `t` 42 个键 |
| 原料库 | `subpkg/biz/material/index` | **`all=0`（空库）**；`catOptions=1` |
| 摊销 | `subpkg/biz/month/amortize` | `assets=0`；`totalYuan='0.00'`；`amortizeOn=false` |
| 资产编辑 | `subpkg/biz/month/assetEdit` | `kind=lump`；`mode=new`；`t` **34 个键齐全**（守卫断言过丢键会少 33 个） |
| AI 授权 | `subpkg/biz/ai/consent` | `granted=false`；徽标「还没开启」；按钮「同意并开启」 |

---

## 3. 抓到的真问题（R3-6，P1，已修）

### 现象

M3 枢纽四张卡片下面都有一行小字「**需开通**」。

### 但

- `utils/featureFlags.js:57` → `PAYWALL_ENABLED = false`
- `cloudfunctions/common/payFlags.js` → `FREE_ACCESS = true`（「不把用户挡在功能外」）
- `hub.js` 的 `goTakeaway` / `goGroupon` / `goReview` / `goRecon` **全是直接 `navigateTo`，没有任何拦截**

⇒ 功能真的能用，标签在**说谎**。

### 根因

`hub.js` 里 `payTag: TERMS.hub.payTag`——**无条件硬编码**；wxml 四处 `<text class="hub-pay">{{t.payTag}}</text>` 也没有 `wx:if`。

### 为什么静态守卫看不出来

「需开通」这个字符串确实在 wxml 里，**它本来就是产品需要的词**（付费墙开启时才该出现）。单看源码永远是对的。**只有把页面真跑起来读 `data.t.payTag`，才知道当前开关下它不该出现。**

### 修法

```js
const { PAYWALL_ENABLED } = require('../../utils/featureFlags.js');
// ...
payTag: PAYWALL_ENABLED ? TERMS.hub.payTag : '',
```

wxml 四处加 `wx:if="{{t.payTag}}"`（否则空串会渲染一个空 span，卡片高度不一致）。

**没有删除这个标签**——付费墙真开启时它会自动回来。守卫 `H-②` 专门证明这一点。

### 复验

模拟器重跑：`payTag` 变空串，截图确认四张卡无标签、高度一致（`04-hub.png` → `04-hub-after.png`）。

> ⚠️ 这条是我的判断：把「需开通」定为 bug 而非有意设计。依据是键名就叫 `payTag`（付费小字），同组还有「导出需开通 / 外卖需开通」等付费墙文案。**若您本来就想用这个标签做「预约意向」提示，告诉我，改回去只需一行。**

---

## 4. 另外两条被实证的设计

**R2-6（外卖页 4 个说明块）— 确认属实**
首屏从上到下：灰块「现金视角」+ 橙块「佣金计算基数」+ 橙块「顾客支付口径」+ 橙块「包材填写说明」，占掉约 1/3 屏，「平台参数」整个被推到首屏之外。老板要滑一屏才看得到真正要填的东西。

**R717（对账页定位句）— 确认成立**
首屏第一段就是「拿你月度账里记的收入，跟成本卡一道菜一道菜推出来的毛利率比一比：看差几个点、差多少钱，以及可能差在哪。」——**在第一个输入框之前**。底部红字「请先填写「本月在售菜品数」」也**没有方位词**，与 R717 的修法一致。

---

## 5. 边界（如实）

- 这是**模拟器**，不是真机。真机上的字号、触控区、键盘顶起、滚动惯性都还没验。
- dev 云环境**原料库和摊销资产都是空的**，所以「跨店串数据」「月份隔离」这两条**今晚没验成**——没有数据就验不出来。明天您扫码后可以配合造两套数据。
- 首页显示「估算利润 51900.00」而摊销页 `totalYuan=0.00`：两个页面读的不是同一口径（首页是利润、摊销页是当月投入合计），**不是矛盾**，但我没有进一步核对。

---

## 6. 台账与计数

- 新增 **R3-6**（P1，fixed）：M3 枢纽硬编码「需开通」。
- 台账 **20 条**：fixed 14 / deferred 6。
- 套件 **301 → 302**。
