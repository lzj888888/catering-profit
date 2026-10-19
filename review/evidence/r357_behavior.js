/**
 * r357_behavior.js —— R357 行为面验证（不是静态 grep，而是**加载真实页面源码跑一遍**）
 *
 * 做法：把 pages/sandbox/matrix.js 原样 require 进来（global.Page 捕获配置），
 *   用桩替掉 wx.cloud.callFunction：前 N-1 批正常返回、第 N 批抛错，
 *   然后直接看 setData 送出的 result 里到底有什么。
 *
 * 三个用例：
 *   A 第 4 批失败（共 5 批） ⇒ 保留前 3 批 450 行 + 说明「第 451-600 档没算出来」
 *   B 全部成功               ⇒ 750 行，partialText 为空
 *   C 第 1 批失败            ⇒ 不展示半张表（保持原语义：toast 退出，result 不动）
 */
'use strict';

const assert = require('assert');

let cfg = null;
global.Page = (c) => { cfg = c; };
global.getApp = () => ({ globalData: { shop_id: 'shop_test' } });

const state = { calls: [], toasts: [], failAt: -1 };

const ROW = {
  target_monthly_fen: 1000000,
  break_even_monthly_fen: 800000,
  break_even_daily_fen: 26667,
  target_daily_fen: 33333,
  fixed_ex_amort_fen: 500000,
  fixed_total_fen: 600000,
  payback_months: 12,
  red_alert: false,
};

global.wx = {
  cloud: {
    callFunction(opt) {
      const n = state.calls.length + 1;
      const part = (opt && opt.data && opt.data.clean_array) || [];
      state.calls.push({ n: n, size: part.length });
      if (n === state.failAt) {
        // 模拟云调用底层失败（api.js 会把它归为 NETWORK_ERROR）
        const err = new Error('mock');
        err.errMsg = 'cloud.callFunction:fail mock batch ' + n;
        throw err;
      }
      return Promise.resolve({
        result: {
          code: 'SUCCESS',
          data: { rows: part.map(() => Object.assign({}, ROW)), rejected: [] },
        },
      });
    },
  },
  showToast(o) { state.toasts.push((o && o.title) || ''); },
  navigateBack() {}, navigateTo() {}, redirectTo() {}, reLaunch() {},
  getWindowInfo() { return { windowWidth: 375, windowHeight: 700 }; },
  getSystemInfoSync() { return { windowWidth: 375, windowHeight: 700 }; },
  getStorageSync() { return ''; },
  setStorageSync() {},
};

require('../../pages/sandbox/matrix.js');
assert(cfg && cfg.onGenerate, '没能从页面源码捕获 onGenerate');

function newPage() {
  const p = {};
  for (const k of Object.keys(cfg)) p[k] = cfg[k];
  p.data = JSON.parse(JSON.stringify(cfg.data));
  p.setData = function (patch) { Object.assign(this.data, patch); };
  // 750 行 = 5 批 × 150（5 租金 × 6 人工 × 5 毛利 × 5 目标）
  p.data.dims = {
    rent: [5000, 6000, 7000, 8000, 9000],
    labor: [3, 4, 5, 6, 7, 8],
    margin: [50, 55, 60, 65, 70],
    target: [0, 5000, 10000, 15000, 20000],
  };
  p.data.advOpen = true;
  p.data.loading = false;
  p.data.result = null;
  return p;
}

function reset(failAt) {
  state.calls = [];
  state.toasts = [];
  state.failAt = failAt;
}

const results = [];
function check(name, fn) {
  try { fn(); results.push({ name: name, ok: true }); console.log('✅', name); }
  catch (e) { results.push({ name: name, ok: false, err: e.message }); console.log('❌', name, '→', e.message); }
}

(async () => {
  // ── A 第 4 批失败 ──
  reset(4);
  let p = newPage();
  await p.onGenerate();
  const A = p.data.result || {};
  check('A1 第 4 批失败 ⇒ 只打了 4 次云（失败即停，不继续空打）', () => {
    assert.strictEqual(state.calls.length, 4, '实际调用 ' + state.calls.length + ' 次');
  });
  check('A2 前 3 批 450 行保留下来（不是整表空白）', () => {
    assert.strictEqual(A.count, 450, '实际 ' + A.count + ' 行');
    assert.strictEqual((A.rows || []).length, 450, 'rows 长度 ' + (A.rows || []).length);
  });
  check('A3 页面说明是「第 451-600 档没算出来（共 750 档）」', () => {
    assert.strictEqual(A.partialText, '第 451-600 档没算出来（共 750 档），下表只显示已算出的 450 档');
  });
  check('A4 loading 归零（不会卡在加载中）', () => {
    assert.strictEqual(p.data.loading, false);
  });
  check('A5 行序仍与档位对齐（第 1 行 = 租金 5000 / 人工 3 / 毛利 50）', () => {
    const r0 = A.rows[0];
    assert.strictEqual(r0.rent, 5000);
    assert.strictEqual(r0.labor, 3);
    assert.strictEqual(r0.marginPct, 50);
  });

  // ── B 全部成功 ──
  reset(-1);
  p = newPage();
  await p.onGenerate();
  const B = p.data.result || {};
  check('B1 全成功 ⇒ 5 批、750 行', () => {
    assert.strictEqual(state.calls.length, 5, '调用 ' + state.calls.length + ' 次');
    assert.strictEqual(B.count, 750, '实际 ' + B.count + ' 行');
  });
  check('B2 全成功 ⇒ partialText 为空（不误报「没算出来」）', () => {
    assert.strictEqual(B.partialText, '');
  });

  // ── C 第 1 批就失败 ──
  reset(1);
  p = newPage();
  await p.onGenerate();
  check('C1 第 1 批失败 ⇒ 不展示半张表（result 仍为 null）', () => {
    assert.strictEqual(p.data.result, null);
  });
  check('C2 第 1 批失败 ⇒ 有 toast 且是「网络不可用」这条（原语义不变）', () => {
    assert.ok(state.toasts.length >= 1, '没有 toast');
    assert.ok(/网络不可用/.test(state.toasts[0]), 'toast = ' + state.toasts[0]);
  });
  check('C3 第 1 批失败 ⇒ loading 归零', () => {
    assert.strictEqual(p.data.loading, false);
  });

  const bad = results.filter((r) => !r.ok);
  console.log('\n=== ' + (results.length - bad.length) + '/' + results.length + ' 通过 ===');
  if (bad.length) {
    bad.forEach((b) => console.log('  ✗', b.name, '|', b.err));
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => { console.error('harness 崩了:', e && e.stack || e); process.exit(2); });
