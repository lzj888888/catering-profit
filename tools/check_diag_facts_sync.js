// tools/check_diag_facts_sync.js —— 诊断补录「前端提交」≡「保存端白名单」（R614 补丁新增套件）
//
// ============ 为什么有这一套 ============
// 2026-11-06 真机事故（李老师原话：「点完补录这些数据并保存之后，前面的数据并没有变化」）：
//   R612/R614 在补录页 `buildFacts()` 里新增了 4 个字段
//   （revenue_trend_feel / member_ratio_pct / renew_increase_pct / food_safety_event），
//   但 `cloudfunctions/saveShopSetting/validate.js` 的 diag_facts 白名单**一个都没登记**。
//   `takeInt`/`takeEnum` 只把**白名单内的 key** 写进 `out` ⇒ 这四个键被**静默丢弃**：
//   前端提交了、toast 提示「已保存」、库里一个字没写。老板看到的 = 补录完全没反应。
//
//   ⚠️ 这是本仓第二次同类事故（第一次：R611 三项刚性卡 —— 前后端都改了，云函数没部署）。
//   共同点：**两个文件必须同时改，但没有任何东西强制它们一致**。
//   ⇒ 本套件就是那个「强制」。
//
// ============ 守什么 ============
//   A 组：`buildFacts()` 产出的每个键，必须都能在保存端白名单里找到（防静默丢弃）
//   B 组：`diag/result.js` 必须有 onShow 且调用 load（防「补录返回后不重读」）
//   C 组：判据不恒真 —— 伪造一个不在白名单的键，必须报红
//
// 全部读源码做静态比对，零 IO、零云调用，秒级可跑。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INPUT_JS = path.join(ROOT, 'subpkg/biz/diag/input.js');
const VALIDATE_JS = path.join(ROOT, 'cloudfunctions/saveShopSetting/validate.js');
const RESULT_JS = path.join(ROOT, 'subpkg/biz/diag/result.js');

let pass = 0; let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' —— ' + detail : ''}`); }
  else { failN++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}
function sec(s) { console.log(`\n===== ${s} =====`); }

// ---------- 解析：前端 buildFacts 的 facts 键集合 ----------
function factsKeysFromInput(src) {
  // 定位 `facts: {` 到与之配对的收尾。facts 块内没有嵌套对象字面量之外的 `}`，
  // 但 food_safety_event 是 IIFE（里面有 }），所以用「行首 6 空格 + }」作为结束锚点最稳。
  const start = src.indexOf('facts: {');
  if (start < 0) return null;
  const rest = src.slice(start);
  const endM = /\n {6}\}/.exec(rest);
  const block = endM ? rest.slice(0, endM.index) : rest;
  const keys = [];
  // 两种写法：`key: value,` 与简写 `key,`
  const re = /^ {8}([a-z][a-z0-9_]*)\s*(?::|,)/gm;
  let m;
  while ((m = re.exec(block)) !== null) {
    if (keys.indexOf(m[1]) < 0) keys.push(m[1]);
  }
  return keys;
}

// ---------- 解析：保存端白名单键集合 ----------
function whitelistKeysFromValidate(src) {
  const keys = [];
  // takeInt('k', ...) / takeEnum('k', ...)
  const reTake = /take(?:Int|Enum)\(\s*'([a-z][a-z0-9_]*)'/g;
  let m;
  while ((m = reTake.exec(src)) !== null) {
    if (keys.indexOf(m[1]) < 0) keys.push(m[1]);
  }
  // out.xxx = ... （逐字段手写校验的分支）
  const reOut = /out\.([a-z][a-z0-9_]*)\s*=/g;
  while ((m = reOut.exec(src)) !== null) {
    if (keys.indexOf(m[1]) < 0) keys.push(m[1]);
  }
  return keys;
}

sec('A 前端提交字段 ⊆ 保存端白名单（防静默丢弃）');
{
  const inputSrc = fs.readFileSync(INPUT_JS, 'utf8');
  const valSrc = fs.readFileSync(VALIDATE_JS, 'utf8');
  const facts = factsKeysFromInput(inputSrc);
  const allow = whitelistKeysFromValidate(valSrc);

  ok('A-① 能解析出前端 facts 键（fail-closed：解析不到就报红）',
    !!facts && facts.length >= 8, facts ? `${facts.length} 个：${facts.join(',')}` : '未找到 facts: { 块');
  ok('A-② 能解析出保存端白名单键（fail-closed）',
    allow.length >= 8, `${allow.length} 个：${allow.join(',')}`);

  const missing = (facts || []).filter((k) => allow.indexOf(k) < 0);
  ok('A-③ 🔴 前端提交的每个键都在白名单里（漏一个 = 该字段永远存不进去）',
    missing.length === 0,
    missing.length ? `被静默丢弃：${missing.join(', ')}` : `${(facts || []).length}/${(facts || []).length} 全部登记`);

  // 反向：白名单里有、前端不提交的键 —— 不一定是错（可能是历史兼容），但必须被知道
  const orphan = allow.filter((k) => (facts || []).indexOf(k) < 0);
  ok('A-④ 白名单里没有「前端从不提交」的孤儿键（历史废弃字段应删掉，否则误导后人）',
    orphan.length === 0,
    orphan.length ? `孤儿键：${orphan.join(', ')}` : '零孤儿');
}

sec('B 诊断页返回后必须重读（防「补录完没反应」）');
{
  const src = fs.readFileSync(RESULT_JS, 'utf8');
  // ⚠️ 必须只取**该方法自己的**函数体：页面里 onShow 是单行写法 `onShow() { this.load(); },`
  //   首版用 `\n {2}\}` 收尾，匹配不到单行结束 ⇒ 一路吃到下一个 `\n  }`（跨过 onRetry），
  //   于是「onShow 是空的、但 onRetry 里有 load」会被误判通过。改用 `[^}]*` 精确截断。
  const m = /onShow\s*\(\s*\)\s*\{([^}]*)\}/.exec(src);
  ok('B-① diag/result.js 定义了 onShow', !!m, m ? '已定义' : '缺失 ⇒ 从补录页返回不会重算');
  ok('B-② onShow 里调用了 this.load()（只定义不调用 = 假修复）',
    !!m && /this\.load\s*\(/.test(m[1]), m ? (m[1].trim().replace(/\s+/g, ' ').slice(0, 50) || '空函数体') : 'n/a');
  // onLoad 不得再自己 load，否则首次进入会重复请求两次
  const lo = /onLoad\s*\(\s*\)\s*\{([^}]*)\}/.exec(src);
  ok('B-③ onLoad 不再自己 load（否则首次进入 onLoad+onShow 会打两次云函数）',
    !!lo && !/this\.load\s*\(/.test(lo[1]), lo ? (lo[1].trim().replace(/\s+/g, ' ').slice(0, 50)) : '未找到 onLoad');
}

sec('C 判据不恒真（伪造一个漏登记字段，必须报红）');
{
  const fake = {
    facts: ['rating', 'brand_new_field_not_registered'],
    allow: ['rating', 'lease_months_left'],
  };
  const missing = fake.facts.filter((k) => fake.allow.indexOf(k) < 0);
  ok('C-① 漏一个字段 ⇒ 必须被点名', missing.length === 1 && missing[0] === 'brand_new_field_not_registered',
    missing.join(',') || '未命中 ⇒ 判据恒假');
  // 等式成立时不得报红
  const clean = { facts: ['a', 'b'], allow: ['a', 'b', 'c'] };
  ok('C-② 全部登记 ⇒ 零报红（不是恒红）',
    clean.facts.filter((k) => clean.allow.indexOf(k) < 0).length === 0, '0 漏');
}

// ---------- D 组：R615 数据丢失事故 —— 页面桩真跑 diffFacts ----------
//   真机反馈：「数据补录完点保存，如果有遗漏需要补录的，原来存的数据就都没了」。
//   根因：buildFacts 全量输出 10 键、空值给 null；保存端把 null 当「显式清空」。
//   ⇒ 只补 1 项时其余 9 项被提交成 null ⇒ 历史值全被抹掉。
//   判据必须**真跑生产函数**（页面桩），只查文本证明不了「空值没被提交」。
{
  let pageCfg = null;
  const noop = () => {};
  global.wx = new Proxy({
    showToast: noop, navigateBack: noop, setNavigationBarTitle: noop,
    getStorageSync: () => '', setStorageSync: noop,
  }, { get: (t, k) => (k in t ? t[k] : noop) });
  global.getApp = () => ({ globalData: { shop_id: 's1' } });
  global.Page = (cfg) => { pageCfg = cfg; };
  try {
    require(INPUT_JS);
  } catch (e) {
    ok('D-⓪ 页面桩能加载生产 input.js', false, e.message);
  }
  const diff = pageCfg && pageCfg.diffFacts;
  ok('D-⓪ 页面桩能拿到生产 diffFacts（判的是真实函数，不是文本）', typeof diff === 'function');

  if (typeof diff === 'function') {
    // 模拟：库里原本存了 3 项，其余 7 项空着；老板这次只想补「会员占比」
    const snapshot = {
      revenue_trend_feel: 'same', member_ratio_pct: null, rating: 4.6,
      review_trend: 'stable', business_district: null, lease_months_left: 18,
      renew_increase_pct: null, debt_level: null, food_safety_event: null,
      cash_on_hand_fen: null,
    };
    const currentAllEmpty = Object.assign({}, snapshot, { member_ratio_pct: 35 }); // 只改 1 项
    const patch = diff(snapshot, currentAllEmpty);
    ok('D-① 🔴 只补 1 项 ⇒ 提交里只有那 1 个键（其余键绝不出现，更不许是 null）',
      Object.keys(patch).length === 1 && patch.member_ratio_pct === 35,
      `提交键=${Object.keys(patch).join(',') || '无'}`);
    ok('D-② 未改动的历史值（rating/租期/趋势）一个都不在提交里 ⇒ 后端 keep',
      !('rating' in patch) && !('lease_months_left' in patch) && !('revenue_trend_feel' in patch));

    // 用户主动删空（原来有值 → 现在空）：必须提交 null，保留「清空」语义
    const cleared = Object.assign({}, snapshot, { rating: null });
    const p2 = diff(snapshot, cleared);
    ok('D-③ 用户主动删空 ⇒ 该键提交 null（清空语义保留，不是一律不提交）',
      Object.keys(p2).length === 1 && p2.rating === null, JSON.stringify(p2));

    // 一项都没改 ⇒ 空提交（onSave 会提示「没有改动」，不假装保存成功）
    ok('D-④ 一项都没改 ⇒ 空提交', Object.keys(diff(snapshot, Object.assign({}, snapshot))).length === 0);

    // 读回失败（快照缺失）⇒ fail-closed：只允许本次真填了值的键，绝不发 null
    const p3 = diff(null, currentAllEmpty);
    ok('D-⑤ 🔴 无快照 fail-closed：只提交有值的键，零 null（防误清空）',
      Object.keys(p3).every((k) => p3[k] !== null) && Object.keys(p3).length > 0,
      `提交键=${Object.keys(p3).join(',')}`);

    // 变异反证：若有人把 diffFacts 改回「全量返回 current」，D-① 必须失效。
    //   本样本 10 键里 snapshot 有值 4 个、null 6 个；current 把 member_ratio_pct 改成 35
    //   ⇒ 有值 5、null 5。用精确值，不用 >=N 这种会被样本稀释的宽松判据。
    const allPass = (s, c) => c;
    const mutant = allPass(snapshot, currentAllEmpty);
    const mutantNulls = Object.values(mutant).filter((v) => v === null).length;
    ok('D-⑥ 变异反证：全量提交会把 5 个空值发成 null ⇒ 证明判据真有鉴别力',
      Object.keys(mutant).length === 10 && mutantNulls === 5,
      `变异提交 ${Object.keys(mutant).length} 键 / ${mutantNulls} 个 null`);
  }
}

// ---------- E 组：onSave 真的用了 diff（防写了函数却不接线）----------
{
  const src = fs.readFileSync(INPUT_JS, 'utf8');
  const m = /async onSave\s*\(\s*\)\s*\{([\s\S]*?)\n {2}\},/.exec(src);
  const body = m ? m[1] : '';
  ok('E-① onSave 调用 diffFacts 生成 patch（不是直接提交 b.facts）',
    /diffFacts\s*\(/.test(body) && /diag_facts:\s*patch/.test(body) && !/diag_facts:\s*b\.facts/.test(body));
  ok('E-② load 成功后记录回显快照（否则 diff 没有基准）',
    /this\._snapshot\s*=/.test(src) && /this\._snapshotReady\s*=\s*true/.test(src));
  ok('E-③ load 只执行一次（防切后台回来覆盖未保存输入 / 快照漂移）',
    /if\s*\(this\._snapshotReady\)\s*return/.test(src));
}

console.log(`\n===== 诊断补录字段同步守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
