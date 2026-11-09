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

console.log('\n===== R 撞配额弹窗（会审 R636 段2：不做事后剥夺）=====');
const TPAY = require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS.pay;
const PAYWALL = fs.readFileSync(path.join(ROOT, 'utils/paywall.js'), 'utf8');

// 🔴 改前文案只说「暂不支持继续新增」—— 老板第一反应是「我原来那 20 道菜是不是没了」。
//   而事实上一道都没少、能看能改。**必须先安他的心，再谈升级。**
ok('R-① 菜品配额文案必须说清「已建的那些都还在」',
  /都还在/.test(TPAY.freeLimitCardBody), TPAY.freeLimitCardBody.slice(0, 40) + '…');
ok('R-② 通用配额文案同样要说「已填的内容还在」',
  /都还在/.test(TPAY.freeLimitGeneric), TPAY.freeLimitGeneric.slice(0, 40) + '…');
ok('R-③ 文案要说清「能正常查看和修改」（否则等于告诉老板东西被锁了）',
  /查看和修改/.test(TPAY.freeLimitCardBody) && /查看和修改/.test(TPAY.freeLimitGeneric));
// 🔴 R645 教训：我一度加了「了解升级」第二出口（走客服会话），被 check_paywall_coverage 的
//   L9-③ 当场拦下 —— 付费闸门是**关闭态**（私域开通阶段），出口文案不得含
//   价格/支付/开通/客服/续费/升级 类词：闸门在但话诱导＝白关。已回退。
//   ⇒ 判据改成**反向**：这几条文案里不许出现任何诱导词。
const INDUCE = ['价格', '支付', '开通', '客服', '续费', '升级'];
const hitWords = (t) => INDUCE.filter((w) => String(t || '').indexOf(w) >= 0);
ok('R-④ 🔴 关闭态下撞配额文案**不得含**诱导词（价格/支付/开通/客服/续费/升级）',
  hitWords(TPAY.freeLimitCardBody).length === 0 && hitWords(TPAY.freeLimitGeneric).length === 0,
  '命中：' + (hitWords(TPAY.freeLimitCardBody).concat(hitWords(TPAY.freeLimitGeneric)).join('/') || '无'));
ok('R-⑤ 撞配额弹窗保持单一出口（showCancel:false）—— 关闭态不给任何付费入口',
  /showCancel:[ ]*false/.test(PAYWALL));
// 🔴 R647（李老师 2026-11-09 拍板）：**免费档不给完整导出** ——「不能全给他白嫖」。
//   会审 R636 段2 原稿里写过「可导出或升级」，但导出本身是付费能力（exportData 走 FEATURE_LOCKED）。
//   若在撞配额弹窗里承诺"可导出"，等于给了一个我们并不打算兑现的出口：
//   老板照着点 → 弹付费墙 → **比不承诺更伤人**。
//   ⇒ 判据：这几条文案**不得出现导出/下载/Excel 类字样**。
ok('R-⑦ 🔴 撞配额文案不得承诺「可以导出」（导出是付费能力，承诺了兑现不了更伤人）',
  !/导出|下载|Excel|表格/.test(TPAY.freeLimitCardBody) && !/导出|下载|Excel|表格/.test(TPAY.freeLimitGeneric),
  '检查：' + [TPAY.freeLimitCardBody, TPAY.freeLimitGeneric].filter((x) => /导出|下载|Excel|表格/.test(x)).length + ' 条命中');

ok('R-⑥ 文案走 terms 单源（页面/paywall 不许硬编码中文）',
  !!TPAY.freeLimitCardBody && !!TPAY.freeLimitGeneric);

console.log('\n===== 结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
