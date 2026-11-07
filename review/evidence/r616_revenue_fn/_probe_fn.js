// R616 桩探针：真跑 importSalesBill 的「营收日报表」分支
//   目的：验证分流顺序、返回结构、以及「不落库」这条硬约束。
//   桩掉 wx-server-sdk（云端 SDK）与 ./common（鉴权/DB），解析链路用真代码。
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const FN = path.join(ROOT, 'cloudfunctions/importSalesBill');

// 用真 xlsx 把文件读成 buffer（云存储里就是这样的二进制）
const REAL_FILE = process.env.RF || path.join(ROOT, 'review/evidence/r615_wechat_real/owner_revenue_daily_202609_v5.xlsx');
const BUFFER = fs.readFileSync(REAL_FILE);

let downloadCalled = 0;
const _load = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'wx-server-sdk') {
    return {
      DYNAMIC_CURRENT_ENV: 'env',
      init: () => {},
      database: () => ({ collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ data: [] }) }) }) }) }),
      getWXContext: () => ({ OPENID: 'o_test', APPID: 'wx_test' }),
      downloadFile: async () => { downloadCalled++; return { fileContent: BUFFER }; },
    };
  }
  if (req === './common') {
    return {
      ERROR_CODES: { SUCCESS: 0, INVALID_PARAM: 'ERR.INVALID_PARAM', FORBIDDEN: 'ERR.FORBIDDEN' },
      ok: (d) => ({ code: 0, msg: 'ok', data: d || {} }),
      fail: (c, m) => ({ code: c, msg: m || c, data: {} }),
      resolveAuth: async () => ({ user: { id: 'u_test' } }),
      assertShopOwner: async () => ({}),
      utilTime: { nowUtc: () => '2026-11-07T08:00:00Z' },
      dataAdapter: { makeAdapter: () => ({ listAll: async () => ({ data: [] }) }) },
    };
  }
  return _load.call(this, req, parent, isMain);
};

const fn = require(path.join(FN, 'index.js'));

(async () => {
  console.log('=== 文件 ===', path.basename(REAL_FILE), BUFFER.length, 'bytes');
  const res = await fn.main({ shop_id: 's1', fileID: 'cloud://x/y.xlsx' });
  console.log('=== 云函数返回 code =', res.code, 'msg =', res.msg);
  console.log('=== downloadFile 调用次数 =', downloadCalled);
  const rd = res.data && res.data.revenue_daily;
  if (!rd) {
    console.log('❌ 没有 revenue_daily 分支输出；data 顶层键 =', Object.keys(res.data || {}));
    process.exit(1);
  }
  console.log('\n----- A 现金流入（对账口径）-----');
  console.log('  公式 =', rd.cashInflow.formula);
  console.log('  合计 =', rd.cashInflow.totalYuan, '元 /', rd.cashInflow.totalFen, '分');
  console.log('  表里那列 =', rd.cashInflow.declaredYuan, '| 对账 pass =', rd.cashInflow.pass, '| 校验', rd.cashInflow.checkedShifts, '行');
  console.log('  purpose =', rd.cashInflow.purpose);
  console.log('\n----- B 经营营收（M1 权责制）-----');
  console.log('  公式 =', rd.revenueM1.formula);
  console.log('  堂食 =', rd.revenueM1.dineInYuan, '| 外卖 =', rd.revenueM1.takeawayYuan);
  console.log('  **营收 =', rd.revenueM1.totalYuan, '元 /', rd.revenueM1.totalFen, '分**');
  console.log('  未确认项 =', rd.revenueM1.pendingOtherYuan);
  console.log('\n----- C 差额桥 -----');
  console.log('  差额 =', rd.bridge.diffYuan, '(', rd.bridge.diffPct, '% ) | 恒等式 =', rd.bridge.identityOk);
  console.log('  老板多算 =', rd.bridge.bossOver.map((x) => x.label.slice(0, 8) + ' ' + x.yuan).join(' / '), '=', rd.bridge.bossOverSum);
  console.log('  M1多算 =', rd.bridge.m1Over.map((x) => x.label.slice(0, 8) + ' ' + x.yuan).join(' / '), '=', rd.bridge.m1OverSum);
  console.log('\n----- 渠道与规模 -----');
  console.log('  渠道 =', JSON.stringify(rd.channelYuan));
  console.log('  班次 =', rd.shiftCount, '| 天数 =', rd.days.length, '| 期 =', rd.days[0] && rd.days[0].date, '→', rd.days[rd.days.length - 1] && rd.days[rd.days.length - 1].date);
  console.log('  日级首两行 =', JSON.stringify(rd.days.slice(0, 2)));

  // ===== 断言 =====
  const D = (a, b) => Math.abs(a - b) < 0.01;
  const checks = [
    ['云函数只下载一次文件', downloadCalled === 1],
    ['走的是营收日报表分支（不是菜品/账单）', !!rd && rd.shape === 'revenue_daily'],
    ['A 现金流入 59,700.80', D(rd.cashInflow.totalYuan, 59700.8)],
    ['A 对账 pass（表里那列与我们反推公式一致）', rd.cashInflow.pass === true],
    ['A 带 purpose=cash_reconciliation（防误当营收）', rd.cashInflow.purpose === 'cash_reconciliation'],
    ['B 营收 64,547.08（M1 权责制）', D(rd.revenueM1.totalYuan, 64547.08)],
    ['B 营收 ≠ 表里那列（没混用）', !D(rd.revenueM1.totalYuan, rd.cashInflow.declaredYuan)],
    ['B 堂食+外卖 = 营收', D(rd.revenueM1.dineInYuan + rd.revenueM1.takeawayYuan, rd.revenueM1.totalYuan)],
    ['C 差额 4,846.28 且恒等式成立', D(rd.bridge.diffYuan, 4846.28) && rd.bridge.identityOk === true],
    ['班次 24 / 天数 13', rd.shiftCount === 24 && rd.days.length === 13],
    ['日级只带 4 个数（date/两个口径/shifts），不泄露明细列', (() => {
      const k = Object.keys(rd.days[0]).sort().join(',');
      return k === 'cashInflowYuan,date,revenueM1Yuan,shifts';
    })()],
    ['回传不含 shifts 原始明细（防整表外泄）', rd.shifts === undefined],
    ['渠道五个键都在', ['grouponMeituan', 'grouponDouyin', 'waimaiMeituan', 'waimaiJd', 'waimaiTaobao'].every((k) => typeof rd.channelYuan[k] === 'number')],
  ];
  console.log('\n===== 断言 =====');
  let bad = 0;
  for (const [name, cond] of checks) {
    console.log((cond ? '✅ ' : '❌ ') + name);
    if (!cond) bad++;
  }
  console.log('\n结果：' + (checks.length - bad) + ' 通过 / ' + bad + ' 失败');
  process.exit(bad === 0 ? 0 : 1);
})();
