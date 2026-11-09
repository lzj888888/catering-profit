// tools/check_month_scope.js —— 月报「业态 / 地区」切换守卫（R648）
//
// 背景：李老师报过「M1 行业下拉框不切换」（round115，当时怀疑是 `_id` 没修）。
// 这类 bug 的典型形态是**存读口径不一致**：
//   页面存 `{_id: 3}` → 云端按 `biz_type` 读 → 读回拿不到 → 下拉框跳回默认 ⇒ 看着"点了没反应"。
//
// 本守卫把「选谁 → 存谁 → 读回显示谁」这条口径链**逐环对齐验证**，
// 且直接 require 真实页面源码跑 handler，不抄副本。

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0; let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); } else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

const TERMS = require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS;
const BIZ = TERMS.m2.bizTypes;
const CITY = TERMS.m2.cityTiers;

// ---- 装载页面（桩掉 wx / getApp / api 的云调用，截获发出的参数）----
const sent = [];
function loadPage() {
  let cfg = null;
  global.Page = (c) => { cfg = c; };
  global.getApp = () => ({ globalData: { shop_id: 'shop_test' } });
  const store = {};
  global.wx = {
    getStorageSync: (k) => store[k] || '', setStorageSync: (k, v) => { store[k] = v; },
    removeStorageSync: (k) => { delete store[k]; },
    showToast: () => {}, showModal: () => {}, showLoading: () => {}, hideLoading: () => {},
    navigateTo: () => {}, navigateBack: () => {}, redirectTo: () => {}, switchTab: () => {},
    vibrateShort: () => {}, getSystemInfoSync: () => ({ windowWidth: 375 }),
    setNavigationBarTitle: () => {}, pageScrollTo: () => {},
    reportAnalytics: () => {}, setClipboardData: () => {},
    cloud: { callFunction: async ({ name, data }) => { sent.push({ name, data }); return { result: { code: 'SUCCESS', data: {} } }; } },
  };
  delete require.cache[require.resolve(path.join(ROOT, 'subpkg/biz/month/result.js'))];
  require(path.join(ROOT, 'subpkg/biz/month/result.js'));
  return cfg;
}
function mkPage() {
  const cfg = loadPage();
  const p = Object.assign({}, cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data));
  p.setData = function (patch) { for (const k in patch) this.data[k] = patch[k]; };
  p.load = async () => {};          // 重拉留到单独断言，避免拉真数据
  return p;
}

console.log('\n===== S 存：点下拉框到底送了什么 =====');
const p = mkPage();
// 选第 3 个业态（火锅烧烤）—— 若代码里存的是下标或 _id，这里就会露馅
p.onBiz({ detail: { value: 2 } });
const bizCall = sent.find((c) => c.name === 'saveShopSetting' && c.data && c.data.biz_type !== undefined);
ok('S-① 点业态 ⇒ 调用 saveShopSetting 且带 biz_type', !!bizCall, bizCall ? JSON.stringify(bizCall.data) : '未发出');
ok('S-② 🔴 存的是 **key 字符串**（火锅烧烤 ⇒ hotpot），不是下标 2、也不是 _id',
  !!bizCall && bizCall.data.biz_type === BIZ[2].key, bizCall ? 'biz_type=' + bizCall.data.biz_type + '（期望 ' + BIZ[2].key + '）' : '未发出');
ok('S-③ 存的 key 在 bizTypes 里真实存在（不是拼错的自造值）',
  !!bizCall && BIZ.some((x) => x.key === bizCall.data.biz_type));

sent.length = 0;
p.onCity({ detail: { value: 0 } });
const cityCall = sent.find((c) => c.name === 'saveShopSetting' && c.data && c.data.city_tier !== undefined);
ok('S-④ 点地区 ⇒ 存的是 city_tier 的 key（一线 ⇒ tier1）',
  !!cityCall && cityCall.data.city_tier === CITY[0].key, cityCall ? 'city_tier=' + cityCall.data.city_tier : '未发出');

console.log('\n===== S 读：库里存的值能不能读回成正确显示 =====');
// 逐一轮询：每个业态 key 存进去，scopeView 必须读回**它自己**
let roundTripOk = true; let badCase = '';
BIZ.forEach((b) => {
  const v = p.scopeView({ biz_type: b.key, city_tier: CITY[0].key });
  if (v.bizIdx !== BIZ.findIndex((x) => x.key === b.key) || v.bizText !== b.name) {
    roundTripOk = false; badCase = b.key + ' → ' + v.bizText;
  }
});
ok('S-⑤ 🔴 每个业态都能存读闭环（存 hotpot ⇒ 读回仍是火锅烧烤，不跳回默认）',
  roundTripOk, roundTripOk ? BIZ.length + ' 个业态全部闭环' : '首个失败：' + badCase);

let cityOk = true;
CITY.forEach((c) => {
  const v = p.scopeView({ biz_type: BIZ[0].key, city_tier: c.key });
  if (v.cityIdx !== CITY.findIndex((x) => x.key === c.key) || v.cityText !== c.name) cityOk = false;
});
ok('S-⑥ 每个地区都能存读闭环', cityOk, CITY.length + ' 个地区');

console.log('\n===== S 兜底与一致性 =====');
const dflt = p.scopeView({});
ok('S-⑦ 库里没设过 ⇒ 回落「中式正餐」（与后端 bandOf 兜底同口径，不是跳成第一个）',
  dflt.bizText === BIZ[1].name, dflt.bizText);
const unk = p.scopeView({ biz_type: 'not_exist_key' });
ok('S-⑧ 库里存了个陌生值 ⇒ 回落默认，不崩、不显示空白',
  unk.bizText === BIZ[1].name, unk.bizText);

// 存读口径必须**同名字段**：页面送 biz_type，读回也按 biz_type 比
const SRC = require('fs').readFileSync(path.join(ROOT, 'subpkg/biz/month/result.js'), 'utf8');
ok('S-⑨ 🔴 存读同名字段（送 biz_type / city_tier，读回也按这两个键比）',
  /biz_type:\s*TERMS[.]m2[.]bizTypes/.test(SRC) && /x[.]key === \(scope && scope[.]biz_type\)/.test(SRC)
  && /city_tier:\s*TERMS[.]m2[.]cityTiers/.test(SRC));
ok('S-⑩ 页面**不存 _id / 下标**（这正是 round115 的病根）',
  !/biz_type:\s*Number\(e[.]detail[.]value\)/.test(SRC) && !/_id:\s*TERMS[.]m2[.]bizTypes/.test(SRC));

// 后端必须收这两个字段，否则前端存了也白存
const SAVE = require('fs').readFileSync(path.join(ROOT, 'cloudfunctions/saveShopSetting/index.js'), 'utf8');
ok('S-⑪ 云端真的收 biz_type / city_tier（前端存了云端不认＝静默丢失）',
  /v[.]biz_type !== undefined/.test(SAVE) && /v[.]city_tier !== undefined/.test(SAVE));

console.log('\n===== 结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
