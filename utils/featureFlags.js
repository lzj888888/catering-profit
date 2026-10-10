// utils/featureFlags.js —— 产品级开关 **单源**（feature gate）
//
// 为什么单独建这个文件（不是随手写个常量）：
//   本仓反复踩过「同一件事在多处写死 ⇒ 静默漂移」的病（平台枚举三副本、术语三处、
//   引擎五副本…见 PITFALLS §26/§27）。开关尤其危险：**半开半关**会造出
//   「入口没了但功能还在写」「入口在但功能被藏」这类自相矛盾的状态，而且**都不报错**。
//   ⇒ 一处声明、其余引用；由 `tools/check_bill_import_gate.js` 钉死。
//
// 约定：true = 开放；false = 暂停展示（**藏入口，不删代码**）
'use strict';

// ===== 外卖「账单导入」=====
// 李老师 2026-10-10 决定暂停展示。理由两条（原话）：
//   ① 减少出错机会（京东口径未证 / 账期归月只淘宝实测 / 真机从未点过）
//   ② 导入后还要填很多费用数字，对商家太重
// 详见 `review/NOTE_2026-10-10_外卖账单导入_暂停展示衔接备忘.md`。
//
// 🔴 关闭它只影响 **外卖账单（订单级）** 这一条路：
//    云函数 `importSalesBill` / `getSalesBills` / `clearSalesBills`、
//    集合 `external_sales_daily` 与已导入数据、守卫 `check_salesbills` **全部原样保留**。
//
// 🔴 **不影响** 同页的「商品销量」导入（菜品销售统计 / 套餐明细 / **外卖商品销量**）——
//    那三种形态是**堂食单品 / 套餐 / 外卖单品复盘**的输入，正是本轮要重点做的，
//    且它们与账单**同出一个云函数与同一个页面 tab**（云函数按表头自动判形态）。
//    ⇒ 藏"整个 tab"会连带砍掉外卖单品复盘的输入通道。故本开关**只作用于账单**。
//
// 恢复 = 把这里改回 true，并同步 `cloudfunctions/importSalesBill/service.js` 的
//     `BILL_IMPORT_ENABLED`（两处取值必须一致，守卫做同源比对）。
const BILL_IMPORT_ENABLED = false;

module.exports = { BILL_IMPORT_ENABLED };
