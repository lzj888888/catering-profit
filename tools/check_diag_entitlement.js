#!/usr/bin/env node
// tools/check_diag_entitlement.js —— 深度诊断权益判定守卫（R3-4 / R724c）
//
// 为什么需要它：`cloudfunctions/common/diagnosisEntitlement.js` 的头注写着
//   「由 tools/check_diag_entitlement.js 的 S-③ 断言『所有 enabled 订阅档都含 diag_unlimited』」，
//   但**这个文件长期不存在**（全仓 20 处副本都这么写）。注释承诺了一道保护，代码里从来没有。
//   同族病：R721 的「注释说守了、实际没守」。
//
// 更要紧的是这一页的**接线现状**：
//   `canRunDiagnosis` 把缓存去重 / 限流 / 订阅 / 单次额度 / fail-closed 全写好了（238 行），
//   但 `getDiagnosis/index.js` **一次都没调用它** ⇒ 深度诊断当前是完全免费的。
//   这**不是 bug**：`common/payFlags.js` 的 FREE_ACCESS = true（提审期、未接虚拟支付，
//   语义就是「不把用户挡在功能外」，与 M1/M2/M3 的既有付费墙同一开关）。
//   真正的风险是**将来**：等 FREE_ACCESS 翻成 false，诊断会成为唯一漏网的付费品，
//   而且**不会有任何报错**——M1/M2/M3 都接在 hasFeature 上，唯独诊断走旁路。
//
//   ⇒ 本守卫的立场：不擅自接线（那会改变当前产品行为），而是把
//     「FREE_ACCESS=false 时诊断必须接线」变成**机器判据**。
//     现在绿 = 当前阶段合规；翻开关那一刻自动红 = 逼人接，不可能忘。
//
// 判据分组：
//   A 判定本体（judgeDiagnosis 六分支的顺序与边界，纯函数直跑）
//   B fail-closed（canRunDiagnosis 读库失败 / 额度并发被抢，db 桩真跑）
//   S 档位前提（从 SEED_PLANS 实算，不手抄：enabled 且非单次诊断的档必须 diag_unlimited）
//   W 接线一致性（FREE_ACCESS 真值 ↔ 入口是否调用 canRunDiagnosis）
//   R 副本漂移（限流常量在单源与云端副本之间必须一致）
//   D 变异回灌（每条关键判据都有分辨力证明）
//
// 运行：node tools/check_diag_entitlement.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const COMMON_DIR = path.join(ROOT, 'cloudfunctions/common');
const FN_DIR = path.join(ROOT, 'cloudfunctions/getDiagnosis');
const SRC = path.join(COMMON_DIR, 'diagnosisEntitlement.js');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');

// 云端真身 = 函数目录内的扁平副本（云端实际执行的就是它，不是 common/ 单源）
const D = require(path.join(FN_DIR, 'cx_diagnosisEntitlement.js'));
const judge = D.judgeDiagnosis;

(async () => {
  console.log('[R3-4] 深度诊断权益判定守卫');

  // =====================================================
  // A · 判定本体：六分支顺序不能换
  // =====================================================
  sec('A · judgeDiagnosis 六分支（顺序错 = 静默放错人或挡住买过的人）');

  const bad = judge({ argsOk: false, cache: { pay_source: 'subscription' }, hourCount: 0, dayCount: 0, paid: true, creditsLeft: 9 });
  check('A-① 参数非法 ⇒ 拒，且**先于**缓存与付费（有缓存也不放行）',
    bad.allowed === false && bad.reason === 'bad_args', JSON.stringify(bad));

  const cached = judge({ argsOk: true, cache: { pay_source: 'subscription' }, hourCount: 99, dayCount: 99, paid: false, creditsLeft: 0 });
  check('A-② 🔴 缓存命中 ⇒ 放行且不扣额度，**不看付费与限流**（已出的报告永久可看，定稿硬底线）',
    cached.allowed === true && cached.reason === 'cache_hit' && cached.useCache === true && cached.consumeCredit === false,
    JSON.stringify(cached));

  const paidButLimited = judge({ argsOk: true, cache: null, hourCount: 5, dayCount: 0, paid: true, creditsLeft: 0 });
  check('A-③ 🔴 限流**先于**付费：付费用户刷脚本同样被拦（保护算力，不是保护收入）',
    paidButLimited.allowed === false && paidButLimited.reason === 'rate_limited', JSON.stringify(paidButLimited));

  const dayLimited = judge({ argsOk: true, cache: null, hourCount: 0, dayCount: 30, paid: true, creditsLeft: 0 });
  check('A-④ 日限流 30 次边界同样生效', dayLimited.allowed === false && dayLimited.reason === 'rate_limited');

  const paid = judge({ argsOk: true, cache: null, hourCount: 0, dayCount: 0, paid: true, creditsLeft: 0 });
  check('A-⑤ 订阅期内 ⇒ 放行，paySource=subscription，**不扣单次额度**',
    paid.allowed === true && paid.paySource === 'subscription' && paid.consumeCredit === false, JSON.stringify(paid));

  const credit = judge({ argsOk: true, cache: null, hourCount: 0, dayCount: 0, paid: false, creditsLeft: 1 });
  check('A-⑥ 无订阅但有单次额度 ⇒ 放行并标记 consumeCredit（由调用方原子扣减）',
    credit.allowed === true && credit.paySource === 'single' && credit.consumeCredit === true, JSON.stringify(credit));

  const none = judge({ argsOk: true, cache: null, hourCount: 0, dayCount: 0, paid: false, creditsLeft: 0 });
  check('A-⑦ 无订阅无额度 ⇒ need_pay（拒的是深度诊断，不是免费简诊）',
    none.allowed === false && none.reason === 'need_pay', JSON.stringify(none));

  check('A-⑧ 限流常量与文档口径一致（5/小时、30/天）',
    D.LIMIT_PER_HOUR === 5 && D.LIMIT_PER_DAY === 30,
    'hour=' + D.LIMIT_PER_HOUR + ' day=' + D.LIMIT_PER_DAY);

  // =====================================================
  // B · fail-closed：读不到就拒，绝不「读失败当没限制」
  // =====================================================
  sec('B · canRunDiagnosis 的 fail-closed（读失败 ⇒ 拒；并发被抢 ⇒ 如实拒）');

  function mkDb(o) {
    const opt = o || {};
    // 桩必须**按表名区分**：D-4 只让报告表读失败，其余表照常返回，
    // 否则变异后会在读权益时抛错 —— 那是「崩溃红」，不是「断言真抓到」。
    function mkQ(name) {
      const q = {
        where() { return q; }, orderBy() { return q; }, limit() { return q; },
        async get() {
          if (opt.reportThrows && name === 'shop_diagnosis_report') throw new Error('stub: 报告表不可读');
          const isReport = name === 'shop_diagnosis_report';
          return { data: (isReport && opt.reportHit) ? [opt.reportHit] : [] };
        },
        async count() {
          if (opt.countThrows) throw new Error('stub: 计数失败');
          return { total: opt.countTotal || 0 };
        },
        async update() { return { stats: { updated: opt.updateN == null ? 1 : opt.updateN } }; },
      };
      return q;
    }
    return {
      collection(name) { return mkQ(name); },
      command: { gte: (v) => ({ $gte: v }), inc: (v) => ({ $inc: v }) },
    };
  }
  const BASE = { userId: 'u1', shopId: 's1', diagType: 'close', snapshotHash: 'snap-1', now: 1000 };

  const r1 = await D.canRunDiagnosis(mkDb({ reportThrows: true }), BASE);
  check('B-① 🔴 报告表读失败 ⇒ store_error 且拒绝（不能当成「没缓存」继续往下，否则限流与额度全失效）',
    r1.allowed === false && r1.reason === 'store_error', JSON.stringify(r1));

  const r2 = await D.canRunDiagnosis(mkDb({ countThrows: true }), BASE);
  check('B-② 限流计数失败 ⇒ store_error 且拒绝', r2.allowed === false && r2.reason === 'store_error', JSON.stringify(r2));

  const r3 = await D.canRunDiagnosis(mkDb({ updateN: 0 }), BASE);
  check('B-③ 🔴 单次额度并发被抢（条件更新影响 0 行）⇒ 如实拒 need_pay，不假设成功',
    r3.allowed === false && r3.reason === 'need_pay', JSON.stringify(r3));

  const hit = { created_at: 1000, pay_source: 'subscription', report_id: 'rep1' };
  const r4 = await D.canRunDiagnosis(mkDb({ reportHit: hit }), BASE);
  check('B-④ 24h 内同指纹命中 ⇒ 走缓存，不重算不扣额度，并带回报告',
    r4.allowed === true && r4.useCache === true && !!r4.cacheReport && r4.consumeCredit === undefined
    && r4.cacheReport.report_id === 'rep1', JSON.stringify({ allowed: r4.allowed, useCache: r4.useCache }));

  const r5 = await D.canRunDiagnosis(mkDb({}), Object.assign({}, BASE, { userId: '' }));
  check('B-⑤ 参数不全 ⇒ bad_args（fail-closed，不猜用户）', r5.allowed === false && r5.reason === 'bad_args');

  // =====================================================
  // S · 档位前提：从 SEED_PLANS 实算，不手抄
  // =====================================================
  sec('S · 档位前提（「订阅期内不限次诊断」这条推导依赖的配置事实）');
  const collections = require(path.join(ROOT, 'cloudfunctions/initDb/collections.js'));
  const PLANS = collections.SEED_PLANS || [];

  function badSubPlans(plans) {
    // 「订阅档」= 启用的、且不是单次诊断额度档
    return plans.filter((p) => p.enabled && p.grants !== 'diag_credit' && p.diag_unlimited !== true);
  }
  const badSubs = badSubPlans(PLANS);
  check('S-① 🔴 所有 enabled 订阅档都必须 diag_unlimited:true（否则「isPaid ⇒ 不限次」推导当场变错）',
    badSubs.length === 0,
    '违规=' + JSON.stringify(badSubs.map((p) => p.plan_id)) + ' 订阅档数=' + PLANS.filter((p) => p.enabled && p.grants !== 'diag_credit').length);

  const single = PLANS.filter((p) => p.grants === 'diag_credit');
  check('S-② 单次诊断档语义成立：diag_unlimited=false 且 diag_credits ≥ 1（否则「单次」名不副实）',
    single.length >= 1 && single.every((p) => p.diag_unlimited === false && Number(p.diag_credits || 0) >= 1),
    single.map((p) => p.plan_id + ':credits=' + p.diag_credits + '/unlimited=' + p.diag_unlimited).join(',') || '无单次档');

  check('S-③ 反恒真：把一个订阅档改成 diag_unlimited:false 必须被 S-① 判出',
    badSubPlans(PLANS.map((p) => (p.enabled && p.grants !== 'diag_credit'
      ? Object.assign({}, p, { diag_unlimited: false }) : p))).length > 0);

  // =====================================================
  // W · 接线一致性（本守卫的核心：翻开关时不可能忘）
  // =====================================================
  sec('W · 接线一致性（FREE_ACCESS ↔ 入口是否调用 canRunDiagnosis）');
  const IDX = path.join(FN_DIR, 'index.js');
  const idxSrc = fs.readFileSync(IDX, 'utf8');
  const flagsSrc = fs.readFileSync(path.join(COMMON_DIR, 'payFlags.js'), 'utf8');
  const mFree = /const FREE_ACCESS = (true|false);/.exec(flagsSrc);
  const FREE_ACCESS = mFree ? mFree[1] === 'true' : null;
  check('W-① 能从单源解析出 FREE_ACCESS（解析不出 = 判据失效，宁红不猜）',
    FREE_ACCESS !== null, 'FREE_ACCESS=' + FREE_ACCESS);

  const callsGate = /canRunDiagnosis\s*\(/.test(idxSrc);
  // 判据函数独立出来，便于用「假如翻成 false」直接验证它的分辨力
  function wiringVerdict(hasCall, freeAccess, src) {
    if (freeAccess === false) return hasCall ? 'ok' : 'must_wire';
    if (hasCall) return 'ok';
    // FREE_ACCESS=true 且未接线：允许，但入口必须写明「为什么现在不接、什么时候必须接」
    const explained = /FREE_ACCESS/.test(src) && /(未接|暂不接|不接线|待接)/.test(src);
    return explained ? 'ok_noted' : 'unexplained';
  }
  const v = wiringVerdict(callsGate, FREE_ACCESS, idxSrc);
  check('W-② 当前阶段接线状态合规（FREE_ACCESS=true 可暂不接，但入口必须写明原因与恢复条件）',
    v === 'ok' || v === 'ok_noted', 'verdict=' + v + ' 入口调用=' + callsGate);

  check('W-③ 🔴 分辨力证明：假如 FREE_ACCESS 翻成 false，同一份入口必须被判「必须接线」',
    wiringVerdict(callsGate, false, idxSrc) === (callsGate ? 'ok' : 'must_wire'),
    '当前 verdict=' + wiringVerdict(callsGate, false, idxSrc));

  check('W-④ 反恒真：入口明明没接线、又没写原因 ⇒ 必须判 unexplained（不让「忘了接」伪装成「故意不接」）',
    wiringVerdict(false, true, '// 这里什么说明都没有') === 'unexplained');

  // =====================================================
  // R · 副本漂移：云端跑的是副本，改单源忘同步 = 线上还是旧限流
  // =====================================================
  sec('R · 单源 ↔ 云端副本 常量漂移');
  const singleSrc = fs.readFileSync(SRC, 'utf8');
  const copySrc = fs.readFileSync(path.join(FN_DIR, 'cx_diagnosisEntitlement.js'), 'utf8');
  const consts = ['CACHE_WINDOW_MS', 'LIMIT_PER_HOUR', 'LIMIT_PER_DAY', 'REPORT_MAX_CHARS', 'REPORT_MAX_CHARTS'];
  function grab(src, name) {
    const m = new RegExp('const ' + name + ' = ([^;]+);').exec(src);
    return m ? m[1].trim() : null;
  }
  const drift = consts.filter((c) => grab(singleSrc, c) !== grab(copySrc, c));
  check('R-① 五个常量在单源与云端副本之间逐字一致（改单源忘跑 sync ⇒ 线上仍是旧值且零报错）',
    drift.length === 0, drift.length ? '漂移=' + drift.join(',') : consts.length + ' 个一致');

  // =====================================================
  // D · 变异回灌
  // =====================================================
  sec('D · 变异回灌（改坏关键判据，对应断言必须真的转红）');

  async function mutJudge(from, to, label, runFn) {
    if (srcIndexOf(DSRC_ORIG, from) < 0) { console.log('  ❌ ' + label + ' 锚点漂移：' + from); failN++; return; }
    const mutated = DSRC_ORIG.replace(from, to);
    if (mutated === DSRC_ORIG) { console.log('  ❌ ' + label + ' 变异未生效'); failN++; return; }
    let md = null;
    try {
      // 用真实副本的依赖环境加载变异源码（cx_entitlement 在同目录）
      const Module = require('module');
      const tmpPath = path.join(FN_DIR, '__mut_diag_entitlement.js');
      fs.writeFileSync(tmpPath, mutated, 'utf8');
      try { md = require(tmpPath); } finally { delete require.cache[require.resolve(tmpPath)]; fs.unlinkSync(tmpPath); }
    } catch (e) {
      console.log('  ❌ ' + label + ' 变异后加载失败（FATAL）：' + (e && e.message)); failN++; return;
    }
    let degraded = false, detail = '';
    try { const r = await runFn(md); degraded = !!r.degraded; detail = r.detail || ''; }
    catch (e) { degraded = true; detail = '变异后抛错：' + ((e && e.message) || e); }
    check(label + ' ⇒ 检出退化', degraded, detail);
  }
  const DSRC_ORIG = copySrc;   // 对「云端真身」做变异，才有意义
  function srcIndexOf(s, sub) { return s.indexOf(sub); }

  // D-1 缓存也要看付费（把「报告永久可看」这条硬底线推翻）
  await mutJudge("if (i.cache) return res(true, 'cache_hit'", "if (i.cache && i.paid) return res(true, 'cache_hit'",
    'D-1 缓存改为必须付费才可见（订阅到期后打不开自己买过的报告）', (md) => {
      const r = md.judgeDiagnosis({ argsOk: true, cache: { pay_source: 'subscription' }, hourCount: 0, dayCount: 0, paid: false, creditsLeft: 0 });
      return { degraded: r.allowed !== true, detail: JSON.stringify(r) };
    });

  // D-2 限流挪到付费之后
  await mutJudge("if (hour >= LIMIT_PER_HOUR || day >= LIMIT_PER_DAY) return res(false, 'rate_limited', '', false, false);",
    "if (i.paid) return res(true, 'ok', 'subscription', false, false);\n  if (hour >= LIMIT_PER_HOUR || day >= LIMIT_PER_DAY) return res(false, 'rate_limited', '', false, false);",
    'D-2 限流挪到付费之后（付费用户可无限刷）', (md) => {
      const r = md.judgeDiagnosis({ argsOk: true, cache: null, hourCount: 99, dayCount: 99, paid: true, creditsLeft: 0 });
      return { degraded: r.allowed === true, detail: JSON.stringify(r) };
    });

  // D-3 单次额度不扣（白拿）
  await mutJudge("if (Number(i.creditsLeft || 0) > 0) return res(true, 'ok', 'single', false, true);",
    "if (Number(i.creditsLeft || 0) > 0) return res(true, 'ok', 'single', false, false);",
    'D-3 单次额度不标记消费（买一次可无限用）', (md) => {
      const r = md.judgeDiagnosis({ argsOk: true, cache: null, hourCount: 0, dayCount: 0, paid: false, creditsLeft: 1 });
      return { degraded: r.consumeCredit !== true, detail: JSON.stringify(r) };
    });

  // D-4 读失败当成没缓存（放行）—— 这条必须真跑异步，恒真断言不算数
  await mutJudge("    return Object.assign(base, { reason: 'store_error' });\n  }\n\n  // ---- 读：限流计数",
    "    cache = null;\n  }\n\n  // ---- 读：限流计数",
    'D-4 报告表读失败当成「没缓存」继续往下（限流形同虚设）', async (md) => {
      const r = await md.canRunDiagnosis(mkDb({ reportThrows: true }), BASE);
      return { degraded: r.reason !== 'store_error', detail: 'reason=' + r.reason + ' allowed=' + r.allowed };
    });

  console.log('\n' + (failN ? '❌ ' + failN + ' 失败 / ' : '✅ ') + pass + ' 通过');
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.log('ERR', (e && e.stack) || e); process.exit(1); });
