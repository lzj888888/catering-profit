#!/usr/bin/env node
/**
 * tools/check_m2_partial_behavior.js —— R357 · 矩阵分批中断的**行为面**守卫
 *
 * 为什么需要这一层（与静态判据互补）：
 *   `check_m2_matrix.js` 守的是**代码形状**（有内层 try / 真 emit / 真渲染）。
 *   它证明不了「跑起来真是这样」—— 而 R357 修的正是**失败路径**，这条路径在正常数据下永远走不到，
 *   静态判据 + 门禁全绿都可以在行为仍然错误时同时成立。
 *
 * 做法：**原样 require 页面源码**（不是抄一份循环出来测），用 `global.Page` 捕获配置，
 *   桩掉 `wx.cloud.callFunction` 按批次号抛错，再看 `setData` 真正送出了什么。
 *   ⚠️ 抄副本会掩盖「页面根本没接上」这类缺陷（R298Y 教训：读到了 ≠ 送出去了）。
 *
 * 三个场景（共 10 条断言）：
 *   A 第 4 批失败（共 5 批）⇒ 只打 4 次云（失败即停）/ 保留 450 行 / 说明「第 451-600 档没算出来」/
 *                             loading 归零 / 行序仍与档位对齐
 *   B 全部成功              ⇒ 5 批 750 行 / partialText 为空（不误报）
 *   C 第 1 批就失败          ⇒ result 仍为 null（不展示半张表）/ toast 为「网络不可用」/ loading 归零
 *
 * fail-closed：页面源码缺失 / 捕获不到 onGenerate ⇒ 判红，绝不静默跳过。
 *
 * 运行：node tools/check_m2_partial_behavior.js   （由 verify_all.js 的 [m2-partial-behavior] 调用）
 */
'use strict';

const assert = require('assert');

let pass = 0;
const problems = [];

function check(name, fn) {
  try { fn(); pass += 1; console.log('✅', name); }
  catch (e) { problems.push(name + ' → ' + (e && e.message)); console.log('❌', name, '→', (e && e.message)); }
}

// ── 桩：必须在 require 页面源码之前就位 ──
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
        // 模拟云调用底层失败（utils/api.js 会把它归为 NETWORK_ERROR）
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

console.log('\n===== R357 · 矩阵分批中断（第 4 批失败 / 全成功 / 第 1 批失败）=====');

let loaded = false;
try {
  require('../subpkg/tools/sandbox/matrix.js');
  loaded = !!(cfg && cfg.onGenerate);
} catch (e) {
  console.log('❌ 加载页面源码失败：' + (e && e.message));
}
check('前置：能从页面源码捕获 onGenerate（否则本套件等于没测）', () => {
  assert.ok(loaded, cfg ? 'cfg 已捕获但无 onGenerate' : 'require 页面后 Page 未被调用');
});

if (!loaded) {
  console.log('\n===== R357 行为面：' + pass + ' 通过 / ' + problems.length + ' 失败 =====');
  process.exit(1);
}

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

(async () => {
  let p;
  let A;
  try {
    // ── A 第 4 批失败 ──
    reset(4);
    p = newPage();
    await p.onGenerate();
    A = p.data.result || {};
    check('A1 第 4 批失败 ⇒ 只打 4 次云（失败即停，不继续空打）', () => {
      assert.strictEqual(state.calls.length, 4, '实际调用 ' + state.calls.length + ' 次');
    });
    check('A2 前 3 批 450 行保留（不是整表空白）', () => {
      assert.strictEqual(A.count, 450, '实际 ' + A.count + ' 行');
      assert.strictEqual((A.rows || []).length, 450, 'rows 长度 ' + (A.rows || []).length);
    });
    check('A3 页面说明「第 451-600 档没算出来（共 750 档），下表只显示已算出的 450 档」', () => {
      assert.strictEqual(A.partialText, '第 451-600 档没算出来（共 750 档），下表只显示已算出的 450 档');
    });
    check('A4 loading 归零（不会卡在加载中）', () => {
      assert.strictEqual(p.data.loading, false);
    });
    check('A5 行序仍与档位对齐（首行 = 租金 5000 / 人工 3 / 毛利 50）', () => {
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
    check('B1 全成功 ⇒ 5 批 750 行', () => {
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
    check('C2 第 1 批失败 ⇒ 有 toast 且为「网络不可用」这条（原语义不变）', () => {
      assert.ok(state.toasts.length >= 1, '没有 toast');
      assert.ok(/网络不可用/.test(state.toasts[0]), 'toast = ' + state.toasts[0]);
    });
    check('C3 第 1 批失败 ⇒ loading 归零', () => {
      assert.strictEqual(p.data.loading, false);
    });

    // ── D 先成功一次，再改档位重算且第 1 批失败 ──
    //   失效形态（静默错账）：失败分支不碰 result ⇒ 屏幕上留着**上一次**的表，
    //   而老板刚改了租金/目标档位、又看到一句「网络不可用」⇒ 极易把旧数字当成新结果。
    reset(-1);
    p = newPage();
    await p.onGenerate();
    const firstCount = (p.data.result || {}).count;
    check('D0 前置：先成功算过一次（750 行）', () => {
      assert.strictEqual(firstCount, 750, '首次结果 ' + firstCount + ' 行');
    });
    reset(1);
    await p.onGenerate();
    check('D1 重算第 1 批失败 ⇒ 旧表必须清掉（不能把上一次的数当新结果）', () => {
      assert.strictEqual(p.data.result, null, '仍留着上一次的 ' + JSON.stringify({
        count: (p.data.result || {}).count,
        partialText: (p.data.result || {}).partialText,
      }));
    });
    check('D2 重算第 1 批失败 ⇒ 仍有 toast 说明原因', () => {
      assert.ok(state.toasts.length >= 1, '没有 toast');
      assert.ok(/网络不可用/.test(state.toasts[0]), 'toast = ' + state.toasts[0]);
    });

    // ── E 先成功一次，再重算且第 3 批失败 ⇒ 结果是**新**的部分结果，不混旧表 ──
    reset(-1);
    p = newPage();
    // 第二次用更少的档位（300 行 = 2 批），第 2 批失败 ⇒ 应显示 150 行新结果
    await p.onGenerate();
    p.data.dims = {
      rent: [5000, 6000, 7000, 8000, 9000],
      labor: [3, 4, 5, 6, 7, 8],
      margin: [50, 55],
      target: [0, 5000, 10000, 15000, 20000],
    };
    reset(2);
    await p.onGenerate();
    const E = p.data.result || {};
    check('E1 重算中途失败 ⇒ 显示新的部分结果（150 行），不是上一次的 750 行', () => {
      assert.strictEqual(E.count, 150, '实际 ' + E.count + ' 行');
      assert.ok(/第 151-300 档/.test(E.partialText || ''), 'partialText = ' + E.partialText);
    });
  } catch (e) {
    // harness 自身崩了也必须判红（fail-closed），不能让「没跑起来」冒充「通过」
    problems.push('harness 异常：' + (e && e.message));
    console.log('❌ harness 异常：' + (e && e.stack));
  }

  console.log('\n===== R357 行为面：' + pass + ' 通过 / ' + problems.length + ' 失败 =====');
  if (problems.length) {
    problems.forEach((x) => console.log('   ✗ ' + x));
    process.exit(1);
  }
})();
