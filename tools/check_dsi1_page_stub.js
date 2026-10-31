#!/usr/bin/env node
// tools/check_dsi1_page_stub.js —— R585（第 226 套件）
//
// 用途：证明「云函数回了 DSI-1 的预览数据后，导入页把它组装成什么」。
//   这一层桩的是 Page / wx / getApp，但**页面源码是真的跑**（不复制逻辑），
//   所以 onChooseFile 里的分支、setData 的字段名、金额分转元全都被真执行。
//
// 为什么需要它：DSI-1 的 preview **没有 totals**（结构是 rowCount/dayFrom/byChannel），
//   若落进账单 else 分支就会 `p.totals.amountFen` 抛 TypeError、被 catch 吞成一句 toast。
//   这条只能靠"真跑页面代码 + 真实形状的响应"才验得到，静态判据看不出来。
//
// 运行：node tools/check_dsi1_page_stub.js
//
// 为什么进得了门禁：它只依赖 node 与仓库内源码（不装任何三方包），秒级完成。
//   ⚠️ 它**不能**替代模拟器/真机：验的是"数据怎么组装成界面"，不是"界面长得好不好看"
//   （尺寸/拥挤/换行只有真机能看，我读不了图，见 R570 的 123rpx 教训）。

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const D = require(path.join(ROOT, 'cloudfunctions/importSalesBill/dsi1.js'));

let pass = 0, failN = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
};

// ---- 用真实解析器产出"云函数会回的那份 preview"（结构必定与线上同构）----
const H = ['日期', '渠道', '平台', '商品名称', '销量', '销售额', '备注'];
const ROWS = [
  H,
  ['2026-09-07', '堂食', '', '重庆小面', 12, 216, ''],
  ['2026-09-07', '堂食', '', '卤牛肉', 1.5, 135, '称重'],
  ['2026-09-07', '外卖', '美团', '重庆小面', 5, 95, ''],
  ['2026-09-07', '外卖', '淘宝闪购', '重庆小面', 3, 57, ''],
  ['2026-09-08', '堂食', '', '重庆小面', 10, 180, ''],
  ['2026-09-08', '外卖', '美团', '重庆小面', -1, -19, '退单'],
];
const parsed = D.parse(ROWS);
if (!parsed.ok) { console.log('❌ 造数失败：' + parsed.error); process.exit(1); }
const s = parsed.summary;
const PREVIEW_RESP = {
  shop_id: 'shop1', shape: 'dsi1_standard', platform: '',
  preview: {
    rowCount: s.rowCount, dayFrom: s.dayFrom, dayTo: s.dayTo, dayCount: s.dayCount,
    dishCount: s.dishCount, totalQty: s.totalQty, totalAmountFen: s.totalAmountFen,
    byChannel: s.byChannel, nonInt: s.nonInt, refunds: s.refunds, noteNoPackFee: s.noteNoPackFee,
  },
};
const CONFIRM_RESP = {
  shop_id: 'shop1', shape: 'dsi1_standard', written: s.rowCount,
  groups: [{ platform: 'pos', bizDate: '2026-09-07', count: 3 },
           { platform: 'meituan', bizDate: '2026-09-07', count: 1 }],
};

// ---- 桩 ----
let nextResp = PREVIEW_RESP;
const calls = [];
global.wx = {
  chooseMessageFile: async () => ({ tempFiles: [{ path: 'C:/tmp/fake.xlsx', name: 'dsi1.xlsx' }] }),
  cloud: {
    uploadFile: async () => ({ fileID: 'cloud://fake/dsi1.xlsx' }),
    callFunction: async (o) => { calls.push(o.data); return { result: { code: 'SUCCESS', data: nextResp } }; },
  },
  showLoading() {}, hideLoading() {}, showToast() {}, showModal() {},
  getStorageSync: () => '', setStorageSync() {},
  getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
  navigateTo() {},
};
global.getApp = () => ({ globalData: { shop_id: 'shop1' } });

let cfg = null;
global.Page = (c) => { cfg = c; };
require(path.join(ROOT, 'subpkg/biz/takeaway/index.js'));
if (!cfg) { console.log('❌ 页面未被 Page() 注册'); process.exit(1); }

const page = Object.assign({}, cfg);
page.data = JSON.parse(JSON.stringify(cfg.data));
page.setData = function (o) { Object.assign(this.data, o); };

(async () => {
  console.log('[R585] 导入页 DSI-1 预览组装（桩 Page/wx，真跑页面源码）\n');

  // ---- 预览 ----
  await page.onChooseFile();
  const pv = page.data.importPreview;
  check('P-① 预览态生成（DSI-1 不再落进账单分支抛 TypeError）', !!pv);
  if (pv) {
    // 明细 6 行（216+135+95+57+180−19）· 2 天 · 2 个商品（重庆小面/卤牛肉）
    check('P-② 行数/天数/商品数', pv.rowCount === 6 && pv.dayCount === 2 && pv.dishCount === 2,
      'row=' + pv.rowCount + ' day=' + pv.dayCount + ' dish=' + pv.dishCount);
    check('P-③ 合计 664.00 元（216+135+95+57+180−19，退款已抵）', pv.amountYuan === '664.00',
      pv.amountYuan);
    check('P-④ 🔴 分渠道是**数组**且 3 项（不是单个合计）', Array.isArray(pv.channels) && pv.channels.length === 3,
      Array.isArray(pv.channels) ? pv.channels.map(c => c.name + '=' + c.amountYuan).join(' | ') : typeof pv.channels);
    if (Array.isArray(pv.channels)) {
      check('P-⑤ 渠道名走 platformLabel（pos→堂食，不是英文 pos）',
        pv.channels.some((c) => c.name === '堂食'),
        pv.channels.map(c => c.name).join(','));
      check('P-⑥ 堂食排第一（排序在 JS 做完）', pv.channels[0].name === '堂食', pv.channels[0].name);
    }
    check('P-⑦ 称重说明被拼出来（1 行小数）', /1 行/.test(page.data.importDsiNonIntText || ''),
      page.data.importDsiNonIntText);
    check('P-⑧ 退款说明被拼出来（1 行退款）', /1 行/.test(page.data.importDsiRefundsText || ''),
      page.data.importDsiRefundsText);
    check('P-⑨ 打包费说明常显（S1 不含打包费）', !!page.data.importDsiNoPackText);
    check('P-⑩ 不得残留账单分支的 monthsText/amountYuan 混用', pv.monthsText === undefined);
  }

  // ---- 确认导入 ----
  nextResp = CONFIRM_RESP;
  page.data.importFileID = 'cloud://fake/dsi1.xlsx';
  page.data.importShape = 'dsi1_standard';
  await page.onConfirmImport();
  check('C-① 确认后调用云函数带 confirm:true', calls.some((c) => c && c.confirm === true),
    JSON.stringify(calls[calls.length - 1]));
  check('C-② 成功回执说清「几行 + 哪几个渠道」', /已导入 6 行/.test(page.data.importDoneText || '')
    && /堂食/.test(page.data.importDoneText || ''), page.data.importDoneText);
  check('C-③ 预览态已清空、importDone=true', page.data.importPreview === null && page.data.importDone === true);

  console.log('\n' + (failN ? '❌ ' + failN + ' 失败 / ' : '✅ ') + pass + ' 通过');
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.log('ERR', (e && e.stack) || e); process.exit(1); });
