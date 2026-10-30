// tools/check_shop_create_biztype.js —— R571 建店选业态「真送出去了」行为守卫
// 运行： node tools/check_shop_create_biztype.js
//
// 为什么不是 grep：
//   本仓头号病是「写到了 ≠ 送出去了」（R298Y）—— 页面上有 picker、state 里有 index、
//   wxml 绑了 bindchange，都可能「看起来接上了」，而 onCreate 的载荷里没有 biz_type ⇒
//   云端永远建出空业态的店，且**零报错**。
//   ⇒ 本套件用页面桩（node 内真跑 subpkg/tools/shop/switch.js 生产源码）：
//     调真实 onAdd / onEditBiz / onCreate，截获 wx.cloud.callFunction 的**真实载荷**断言。
//   并用变异回灌证明判据有分辨力（删掉载荷里的 biz_type ⇒ 必须转红）。
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PAGE_REL = 'subpkg/tools/shop/switch.js';
const PAGE_ABS = path.join(ROOT, PAGE_REL);

let pass = 0, failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? '  (' + detail + ')' : '')); }
}

// ===== 页面桩：真源码 + 真 handler + 假 wx =====
function loadPage(srcOverride) {
  let cfg = null;
  const calls = [];
  global.Page = (c) => { cfg = c; };
  global.getApp = () => ({ globalData: { shop_id: 'shop_cur' } });
  global.wx = {
    cloud: {
      callFunction: (args) => {
        calls.push(args);
        if (args.name === 'manageShop') {
          return Promise.resolve({ result: { code: 'SUCCESS', data: { op: 'create', shop_id: 'shop_new', name: (args.data && args.data.name) || '' } } });
        }
        if (args.name === 'getShopList') {
          return Promise.resolve({ result: { code: 'SUCCESS', data: { list: [], used: 0, free_limit: 1, hard_limit: 200, hit_free_limit: false, hit_hard_limit: false } } });
        }
        return Promise.resolve({ result: { code: 'SUCCESS', data: {} } });
      },
    },
    showToast() {}, showLoading() {}, hideLoading() {}, showModal() {}, showActionSheet() {},
    setStorageSync() {}, getStorageSync() { return ''; }, removeStorageSync() {},
    navigateTo() {}, navigateBack() {}, switchTab() {},
    getAccountInfoSync() { return { miniProgram: { envVersion: 'develop' } }; },
    stopPullDownRefresh() {},
  };
  const dir = path.dirname(PAGE_ABS);
  const src = srcOverride || fs.readFileSync(PAGE_ABS, 'utf8');
  const mod = { exports: {} };
  const fakeRequire = (p) => require(/^[./]/.test(p) ? path.resolve(dir, p) : p);
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', '__dirname', '__filename', src)(mod, mod.exports, fakeRequire, dir, PAGE_ABS);
  if (!cfg) throw new Error('页面桩失败：未捕获 Page 配置（require 前 Page 未赋值？）');
  const p = Object.assign({}, cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data));
  p.setData = function (patch) { for (const k in patch) this.data[k] = patch[k]; };
  return { p, calls };
}

(async function main() {
  // ===== ① 结构：业态选项 ≡ indicatorRef.BIZ_KEYS 单源 =====
  const { p: p0 } = loadPage();
  const opts = p0.data.bizOpts || [];
  const ref = require(path.join(ROOT, 'cloudfunctions/manageShop/cx_indicatorRef.js'));
  ok('①-1 选项数 = 1（不选）+ BIZ_KEYS 个数', opts.length === ref.BIZ_KEYS.length + 1, '实际=' + opts.length);
  ok('①-2 首项 = 明确「不选」（key 空串，不静默写默认业态）', opts[0] && opts[0].key === '' && !!opts[0].name);
  ok('①-3 其余 key 序列 ≡ indicatorRef.BIZ_KEYS（同名同序，单源不手抄）',
    opts.slice(1).map((x) => x.key).join(',') === ref.BIZ_KEYS.join(','),
    opts.slice(1).map((x) => x.key).join(','));

  // ===== ② 交互：默认不选 / picker 改下标 =====
  const { p: p1 } = loadPage();
  p1.onAdd();
  ok('②-1 onAdd 进入新建态且默认「不选」（editBizIdx=0）', p1.data.mode === 'create' && p1.data.editBizIdx === 0);
  p1.onEditBiz({ detail: { value: '3' } });
  ok('②-2 onEditBiz 真改下标（picker bindchange 形态）', p1.data.editBizIdx === 3);
  p1.onEditCancel();
  ok('②-3 取消后下标归零（下次新建不残留上次选择）', p1.data.editBizIdx === 0 && p1.data.mode === '');

  // ===== ③ 送出去了：真实载荷 =====
  const { p: p2, calls: c2 } = loadPage();
  p2.onAdd();
  p2.onEditName({ detail: { value: '烧烤二店' } });
  p2.onEditBiz({ detail: { value: '3' } });   // bizOpts[3] = hotpot
  await p2.onCreate();
  const call2 = c2.filter((x) => x.name === 'manageShop')[0];
  ok('③-1 onCreate 真调 manageShop / op=create', !!call2 && call2.data.op === 'create' && call2.data.name === '烧烤二店');
  ok('③-2 载荷带 biz_type=hotpot（真送出去，不是只存在 state 里）', !!call2 && call2.data.biz_type === 'hotpot',
    '实际=' + JSON.stringify(call2 && call2.data));

  const { p: p3, calls: c3 } = loadPage();
  p3.onAdd();
  p3.onEditName({ detail: { value: '默认店' } });
  await p3.onCreate();
  const call3 = c3.filter((x) => x.name === 'manageShop')[0];
  ok('③-3 默认「不选」⇒ 载荷 biz_type 为空串（不猜业态）', !!call3 && call3.data.biz_type === '');

  // ===== ④ 分支：达免费上限时新增不进入新建态（付费墙路径不回归）=====
  const { p: p4 } = loadPage();
  p4.data.hitFreeLimit = true;
  p4.onAdd();
  ok('④-1 达免费上限 ⇒ onAdd 不进入新建态（走付费墙，不绕过）', p4.data.mode !== 'create');

  // ===== ⑤ 变异回灌：删掉载荷里的 biz_type ⇒ ③-2 必须转红 =====
  const src = fs.readFileSync(PAGE_ABS, 'utf8');
  const mutSrc = src.replace('op: \'create\', name, biz_type: bizKey, client_request_id:', 'op: \'create\', name, client_request_id:');
  ok('⑤-1 变异体真被改到（锚点在场，否则回灌无意义）', mutSrc !== src);
  const { p: p5, calls: c5 } = loadPage(mutSrc);
  p5.onAdd();
  p5.onEditName({ detail: { value: 'x' } });
  p5.onEditBiz({ detail: { value: '3' } });
  await p5.onCreate();
  const call5 = c5.filter((x) => x.name === 'manageShop')[0];
  ok('⑤-2 删掉载荷 biz_type 后：载荷不再含该键（证明 ③-2 判据非恒真）', !!call5 && !('biz_type' in call5.data));

  console.log('\n==== 建店选业态行为守卫：' + pass + ' 通过 / ' + failN + ' 失败 ====');
  process.exit(failN === 0 ? 0 : 1);
})().catch((e) => {
  console.log('❌ 套件异常：' + ((e && e.stack) || e));
  process.exit(1);
});
