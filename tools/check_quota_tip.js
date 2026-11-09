// tools/check_quota_tip.js —— 「还能建 N 张」提示守卫（R643 · 会审 R636 段1）
//
// 会审结论：「第 18 条：提示『还能建 2 张』」。
// 改前老板到第 21 张被拒时才第一次知道有额度这回事 —— **事后剥夺是最差的一档体验**。
//
// 本守卫用 page-stub **真跑** `afterSaved(name, quota)`，验三种档位各自显示什么，
// 而不是 grep 一下「有没有这句话」。

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0; let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); } else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

function loadPage() {
  let cfg = null;
  global.Page = (c) => { cfg = c; };
  global.getApp = () => ({ globalData: { shop_id: 'shop_test' } });
  global.wx = {
    getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
    showToast: () => {}, showModal: () => {}, showLoading: () => {}, hideLoading: () => {},
    navigateTo: () => {}, navigateBack: () => {}, redirectTo: () => {}, switchTab: () => {},
    vibrateShort: () => {}, getSystemInfoSync: () => ({ windowWidth: 375 }),
    setNavigationBarTitle: () => {}, pageScrollTo: () => {},
    cloud: { callFunction: async () => ({ result: { code: 'SUCCESS', data: {} } }) },
  };
  delete require.cache[require.resolve(path.join(ROOT, 'subpkg/biz/card/edit.js'))];
  require(path.join(ROOT, 'subpkg/biz/card/edit.js'));
  return cfg;
}

function mkPage() {
  const cfg = loadPage();
  const p = Object.assign({}, cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data));
  p.setData = function (patch) { for (const k in patch) this.data[k] = patch[k]; };
  return p;
}

console.log('\n===== Q 撞配额提示（真跑 afterSaved）=====');
const T = require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS.card;

// Q-① 还剩 2 张（会审点名的场景）
const p1 = mkPage();
p1.afterSaved('酱爆鸭', { used: 18, limit: 20, remain: 2, is_paid: false });
ok('Q-① 还剩 2 张 ⇒ 明说「还能建 2 张」',
  /2/.test(p1.data.quotaTip) && p1.data.quotaTip.indexOf('还能建') >= 0, p1.data.quotaTip);

// Q-② 只剩 1 张（语气要更紧一些，不能还是"还能建 1 张"这种被动语态）
const p2 = mkPage();
p2.afterSaved('宫保鸡丁', { used: 19, limit: 20, remain: 1, is_paid: false });
ok('Q-② 只剩 1 张 ⇒ 用「只剩最后 1 张」的紧迫说法', p2.data.quotaTip === T.quotaLastOne, p2.data.quotaTip);

// Q-③ 已用完（这张存进去了，但下一道会卡）—— 必须**当场说清**，不能等他下一道被拒
const p3 = mkPage();
p3.afterSaved('鱼香肉丝', { used: 20, limit: 20, remain: 0, is_paid: false });
ok('Q-③ 已用完 ⇒ 说清「已用完」且指明「这道已存好」', p3.data.quotaTip === T.quotaUsedUp, p3.data.quotaTip);

// Q-④ 付费用户不提示（付了钱还念叨额度 = 骚扰）
const p4 = mkPage();
p4.afterSaved('麻婆豆腐', { used: 200, limit: 200, remain: 1500, is_paid: true });
ok('Q-④ 付费用户不显示额度提示', p4.data.quotaTip === '', 'quotaTip=' + JSON.stringify(p4.data.quotaTip));

// Q-⑤ 编辑已有卡（云端 quota=null，不占额度）⇒ 不提示
const p5 = mkPage();
p5.afterSaved('回锅肉', null);
ok('Q-⑤ 编辑态（quota=null）不提示', p5.data.quotaTip === '', 'quotaTip=' + JSON.stringify(p5.data.quotaTip));

// Q-⑥ 保存成功后仍正常清空菜名等字段（配额提示不得干扰连续录入）
ok('Q-⑥ 连续录入仍正常：菜名已清空、savedName 已记录', p1.data.name === '' && p1.data.savedName === '酱爆鸭',
  'name=' + JSON.stringify(p1.data.name) + ' savedName=' + p1.data.savedName);

// Q-⑦ 页面真的渲染这个提示（写了不接 = 白写）
const fs = require('fs');
const WXML = fs.readFileSync(path.join(ROOT, 'subpkg/biz/card/edit.wxml'), 'utf8');
ok('Q-⑦ 保存条真的渲染 quotaTip（不接等于白写）',
  /class="quota-tip"[^>]*wx:if="\{\{quotaTip\}\}"[^>]*>\{\{quotaTip\}\}/.test(WXML));

// Q-⑧ 云端出参真的带 quota（否则前端永远空）
const SAVE_I = fs.readFileSync(path.join(ROOT, 'cloudfunctions/saveCostCard/index.js'), 'utf8');
ok('Q-⑧ 云端保存出参带 quota（含 remain / is_paid）',
  /quota: quotaOut/.test(SAVE_I) && /remain: Math\.max/.test(SAVE_I) && /is_paid: !!paidForQuota/.test(SAVE_I));

// Q-⑨ 余量口径：保存**后**的 used = activeCount + 1（少算 1 会让老板以为还剩 1 张）
ok('Q-⑨ 余量按「保存后」算（activeCount+1），不是保存前',
  /const usedAfter = activeCount \+ 1/.test(SAVE_I) && /remain: Math\.max\(0, \(Number\(limits\.cost_card\) \|\| 0\) - usedAfter\)/.test(SAVE_I));

// Q-⑩ 文案走单源 terms（页面不许自己拼）
ok('Q-⑩ 三档文案都在 terms 单源里', !!T.quotaRemainTpl && !!T.quotaLastOne && !!T.quotaUsedUp);

// Q-⑪ 反恒真：把 quota 提示逻辑删掉，前面必须转红
const EDIT = fs.readFileSync(path.join(ROOT, 'subpkg/biz/card/edit.js'), 'utf8');
ok('Q-⑪ 反恒真：afterSaved 里确有按 remain 分档的判断',
  /r <= 0 \? TERMS\.card\.quotaUsedUp/.test(EDIT) && /r === 1 \? TERMS\.card\.quotaLastOne/.test(EDIT));

console.log('\n===== 结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
