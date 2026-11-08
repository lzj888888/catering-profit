// tools/check_revenue_manual.js —— 手填汇总守卫（R620，第 250 套件）
//
// 这个入口是为"不会做 Excel 的老板"开的。它最容易坏在两个地方：
//   ① **口径分叉** —— 手填另写一套营收算法，和 Excel 那条路算出两个数；
//   ② **假的好消息** —— 手填没有日明细、没有"表里营业收入"可对账，
//      却被显示成"整月 30 天齐全""对账零差异"。
// 所以这里既判结构，也**真跑一遍**手工转表 + 解析，看数对不对。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const P = (rel) => path.join(ROOT, rel);

let pass = 0;
let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? ' ｜ ' + detail : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? ' ｜ ' + detail : '')); }
}
function sec(t) { console.log('\n===== ' + t + ' ====='); }
// 判源码关键词前先剥注释（R619 的教训：判据被自己注释击中过两次）
function stripComments(s) {
  return String(s).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const APP = JSON.parse(fs.readFileSync(P('app.json'), 'utf8'));
const PAGE = fs.readFileSync(P('subpkg/biz/revenue/manual/index.js'), 'utf8');
const WXML = fs.readFileSync(P('subpkg/biz/revenue/manual/index.wxml'), 'utf8');
const WXSS = fs.readFileSync(P('subpkg/biz/revenue/manual/index.wxss'), 'utf8');
const MAIN = fs.readFileSync(P('subpkg/biz/revenue/index.js'), 'utf8');
const MAINWXML = fs.readFileSync(P('subpkg/biz/revenue/index.wxml'), 'utf8');
const FN = fs.readFileSync(P('cloudfunctions/importSalesBill/index.js'), 'utf8');
const R = require(P('cloudfunctions/importSalesBill/revenueDailyParse.js'));
const TERMS = require(P('miniprogram/i18n/terms.js')).TERMS;
const MT = TERMS.revenueManual || {};

// ============ A 结构 ============
sec('A 结构（页面注册与分工）');

ok('A-① manual 页已在 app.json 的 subpkg/biz 分包里注册',
  (APP.subpackages || []).some((p) => p.root === 'subpkg/biz'
    && p.pages.indexOf('revenue/manual/index') >= 0));

ok('A-② 四个文件齐（js / wxml / wxss / json）',
  ['.js', '.wxml', '.wxss', '.json']
    .every((ext) => fs.existsSync(P('subpkg/biz/revenue/manual/index' + ext))));

// 手填页绝不能依赖 Excel —— 它存在的全部理由就是"老板没有表"
ok('A-③ 手填页不依赖 Excel 选文件；拍照只是可选参考，没拍也必须能存',
  stripComments(PAGE).indexOf('chooseMessageFile') < 0
  && (() => {
    const s = stripComments(PAGE);
    const i = s.indexOf('onSave()');
    const seg = i >= 0 ? s.slice(i, i + 900) : '';
    return !/photo/.test(seg);
  })());

ok('A-④ 营收页有并列的手填入口（不是藏在角落的小字）',
  MAINWXML.indexOf('goManual') > 0 && MAIN.indexOf('goManual()') > 0
  && String(TERMS.revenue.manualEntry || '').length > 0,
  TERMS.revenue.manualEntry);

ok('A-⑤ 从手填页返回后会自动重读库（刚填的必须立刻出现，不能让老板以为没存上）',
  /onShow\(\)[\s\S]{0,160}loadStored\(\)/.test(MAIN));

// ============ B 口径（真跑）============
sec('B 口径（真跑手工转表 → 解析）');

const built = R.manualToRows({ cash: 1000, scan: 5000, waimaiMeituan: 800 }, '2026-09');

ok('B-① 表单字段全部落在解析器认得的列名上（前端不能自造列名绕过口径）',
  built.header.slice(2).every((h) => Object.keys(R.COL_MAP).indexOf(h) >= 0),
  built.header.slice(2).join(','));

ok('B-② 空表填 0 项时 filled=0（云端据此拒收，不落空数据）',
  R.manualToRows({}, '2026-09').filled === 0);

ok('B-③ 日期取当月最后一天（手填是整月汇总）',
  R.manualToRows({ cash: 1 }, '2026-09').rows[1][0] === '2026-09-30'
  && R.manualToRows({ cash: 1 }, '2026-02').rows[1][0] === '2026-02-28'
  && R.manualToRows({ cash: 1 }, '2028-02').rows[1][0] === '2028-02-29',
  R.manualToRows({ cash: 1 }, '2026-09').rows[1][0]);

const out = R.parseRevenueDaily(built.rows);
ok('B-④ 🔴 手填走**同一个** parseRevenueDaily，营收口径与 Excel 完全一致',
  out.ok === true && out.revenueM1.totalYuan === 6800
  && out.revenueM1.dineInYuan === 6000 && out.revenueM1.takeawayYuan === 800,
  '营收=' + out.revenueM1.totalYuan + ' 堂食=' + out.revenueM1.dineInYuan
  + ' 外卖=' + out.revenueM1.takeawayYuan);

ok('B-⑤ 现金流入口径也对（现金+充值+扫码+还款，充值不计营收）',
  out.cashInflow.totalYuan === 6000);

// 充值必须**不进**营收 —— 这是全项目最重要的一条口径，手填这条路也不能例外
const outTop = R.parseRevenueDaily(R.manualToRows({ cash: 100, recharge: 9999 }, '2026-09').rows);
ok('B-⑥ 🔴 手填充值 9999 ⇒ 营收一分不涨、现金流入跟着涨（与 Excel 同一条红线）',
  outTop.revenueM1.totalYuan === 100 && outTop.cashInflow.totalYuan === 10099,
  '营收=' + outTop.revenueM1.totalYuan + ' 现金流入=' + outTop.cashInflow.totalYuan);

ok('B-⑦ 手填不复写营收算法（云端不得自己加总 revenueM1）',
  stripComments(FN).indexOf('revenueM1.totalYuan =') < 0
  && stripComments(FN).indexOf('RevenueDaily.manualToRows') > 0);

ok('B-⑧ 🔴 手填的 coverage 必须标 manual 且 dayCount=0（不能显示成「整月齐全」）',
  /manual:\s*true/.test(FN) && /dayCount:\s*0/.test(FN),
  'manual标记=' + /manual:\s*true/.test(FN));

ok('B-⑨ 🔴 手填没有「表里营业收入」可对账 ⇒ pass 必须置 null，不能显示「零差异」',
  /cashInflow\.pass\s*=\s*null/.test(FN));

ok('B-⑩ 手填结果带 source=manual（来源可见，不能冒充平台原始凭证）',
  /source:\s*'manual'/.test(FN) && /source:\s*ctx\.source/.test(
    fs.readFileSync(P('cloudfunctions/importSalesBill/revenueStore.js'), 'utf8')));

// ============ C 老板能力面 ============
sec('C 老板能力面（他能不能填得出来）');

const ALL_ITEMS = (() => {
  // 从页面源码里抠出所有 item 的 hint 字段名，逐个数
  const m = PAGE.match(/hint:\s*T\.(h[A-Za-z]+)/g) || [];
  return m.map((x) => x.replace(/hint:\s*T\./, ''));
})();

ok('C-① 每个输入项都配了「去哪看」提示（没有提示 = 他填不出来 = 等于没这个功能）',
  ALL_ITEMS.length >= 11 && ALL_ITEMS.every((k) => typeof MT[k] === 'string' && MT[k].length >= 4),
  ALL_ITEMS.length + ' 项：' + ALL_ITEMS.slice(0, 4).join(','));

ok('C-② 全部选填：页面没有任何「必填」拦截（逼他填全等于劝退）',
  stripComments(PAGE).indexOf('必填') < 0 && stripComments(WXML).indexOf('required') < 0);

ok('C-③ 一个数没填时明确拒绝，并说人话',
  String(MT.emptyTip || '').indexOf('至少填一项') > 0);

ok('C-④ 充值与赊账那组默认收起（多数人答不上来，但不能藏起来让他不知道有这项）',
  /collapse:\s*true/.test(PAGE) && String(MT.gCreditHint || '').indexOf('留空') > 0,
  MT.gCredit);

// 术语黑名单：老板看不懂的词一个都不许出现在这个页面的文案里
const JARGON = ['权责发生制', '收付实现制', '现金流入', '应收应付', '冲销', '借方', '贷方', 'M1', '口径'];
const jargonHit = JARGON.filter((w) => JSON.stringify(MT).indexOf(w) >= 0);
ok('C-⑤ 🔴 这个页面的文案里没有任何会计术语（老板看不懂就等于没写）',
  jargonHit.length === 0, jargonHit.length ? '命中：' + jargonHit.join(',') : '零命中');

ok('C-⑥ 字号守 AD-G1（页面不得出现 < 28rpx 的字号 —— 店主多半在店里、光线不好）',
  (() => {
    const nums = (WXSS.match(/font-size:\s*(\d+)rpx/g) || []).map((x) => parseInt(x.replace(/\D/g, ''), 10));
    return nums.length > 0 && nums.every((n) => n >= 28);
  })(), (WXSS.match(/font-size:\s*\d+rpx/g) || []).length + ' 处字号');

ok('C-⑦ 触控高度 ≥ 88rpx（AD-G2：手上有油也能点中）',
  /min-height:\s*88rpx/.test(WXSS) && /height:\s*88rpx/.test(WXSS));

// ============ D 落库 ============
sec('D 落库（与 Excel 同一张表、同一套幂等）');

ok('D-① 手填也走 RevenueStore.commit（不另开一条写库路径）',
  /RevenueStore\.commit/.test(FN) && /action === 'revenue_save_manual'/.test(FN));

// 🔴 R621 事故回归：这条断言原来写成「含 JSON.stringify(vals) **或** 含 fields」——
//   第一个分支正好就是**错误写法**，等于坏掉才算绿。结果 R620 线上手填保存一按就崩
//   （vals 早被删了，ReferenceError），而 node --check 查不出来（引用错误不是语法错误）。
//   现在改成：必须走后者的纯函数 manualKey，且手填分支里不许再出现 vals 这个词。
const manualSeg = (() => {
  const s = stripComments(FN);
  const a = s.indexOf("action === 'revenue_save_manual'");
  const b = s.indexOf("action === 'revenue_get'");
  return a >= 0 ? s.slice(a, b > a ? b : a + 4000) : '';
})();
ok('D-② 手填的幂等指纹由 fields 经纯函数 manualKey 生成（同样的数重复存 = 幂等）',
  /fileMd5:\s*RevenueDaily\.manualKey\(/.test(manualSeg) && /\bvals\b/.test(manualSeg) === false,
  'manualKey=' + /RevenueDaily\.manualKey\(/.test(manualSeg) + ' 残留vals=' + (/\bvals\b/.test(manualSeg)));

ok('D-②b 🔴 手填分支不得引用不存在的变量（R620 线上崩溃点：vals 未定义 ⇒ 保存必失败）',
  !/\bvals\b/.test(manualSeg) && !/\bJSON\.stringify\(vals\)/.test(FN),
  '出现 vals=' + /\bvals\b/.test(manualSeg));

ok('D-③ 手填换月/换数同样要确认（不静默覆盖已有的数）',
  /confirm:\s*input\.confirm === true/.test(FN));

ok('D-④ 手填分支在「下载文件」之前（手填没有文件，放后面会因缺 fileID 失败）',
  (() => {
    const s = stripComments(FN);
    const a = s.indexOf("action === 'revenue_save_manual'");
    const b = s.indexOf('cloud.downloadFile');
    return a > 0 && b > 0 && a < b;
  })());

// ============ E 分次填 + 上月参考（R621）============
sec('E 分次填与"照上月改"（填表能力弱的老板不可能一次填全）');

// E-① manualKey：顺序无关 / 值敏感 / 换店换月要区分
const K1 = R.manualKey('s1', '2026-09', { cash: 100, scan: 5000 });
const K2 = R.manualKey('s1', '2026-09', { scan: 5000, cash: 100 });
const K3 = R.manualKey('s1', '2026-09', { scan: 5000, cash: 101 });
const K4 = R.manualKey('s2', '2026-09', { cash: 100, scan: 5000 });
const K5 = R.manualKey('s1', '2026-10', { cash: 100, scan: 5000 });
ok('E-① 幂等键与表单顺序无关（顺序变了不该多出一条）', K1 === K2, K1 + ' / ' + K2);
ok('E-② 幂等键对数值敏感（改一个数就是新版本，要走确认）', K1 !== K3);
ok('E-③ 幂等键区分店铺与月份（换店换月不会互相冒充）', K1 !== K4 && K1 !== K5);

// E-④ merge：第二次只填外卖，不能让上次的现金消失
const MG = R.mergeFields({ cash: 1000, scan: 5000 }, { waimaiMeituan: 800 });
ok('E-④ 分次填：这次只填外卖 ⇒ 上次的现金/扫码原样保留', MG.cash === 1000 && MG.scan === 5000 && MG.waimaiMeituan === 800,
  JSON.stringify(MG));
ok('E-⑤ 分次填：填同一个键 ⇒ 新值覆盖旧值（老板改数是正常需求）',
  R.mergeFields({ cash: 1000 }, { cash: 1200 }).cash === 1200);
ok('E-⑥ 分次填：显式填 0 ⇒ 覆盖成 0（想清零得有路可走）',
  R.mergeFields({ cash: 1000 }, { cash: 0 }).cash === 0);
ok('E-⑦ 本次一项没填（全空）⇒ 结果等于旧值，不会把数据抹成空',
  JSON.stringify(R.mergeFields({ cash: 1000 }, {})) === JSON.stringify({ cash: 1000 }));

// E-⑧ 云端真的用了合并：先读同月手填批次，再 merge
ok('E-⑧ 手填保存前先读同月已有手填批次，并 mergeFields 合并（不是整体替换）',
  /RevenueStore\.getActive/.test(manualSeg) && /manual_fields/.test(manualSeg)
  && /RevenueDaily\.mergeFields\(/.test(manualSeg)
  && /'manual'/.test(manualSeg));

// E-⑨ 合并只在「同月已有手填」时做；同月是 Excel 的仍走确认替换（不能悄悄拼成混合数）
ok('E-⑨ 只有同月已有**手填**才合并（同月是 Excel 仍要确认替换，不拼混合数）',
  /prev\.source === 'manual'/.test(manualSeg));

// E-⑩⑪ 上月参考 / 本月预填 的数据来源
ok('E-⑩ 读库回传 manual_fields（页面要靠它做预填与上月参考）',
  /manual_fields/.test(FN) && /manual_fields/.test(fs.readFileSync(P('cloudfunctions/importSalesBill/revenueStore.js'), 'utf8')));

// E-⑫ 换月必须清掉上个月的预填/参考（串月是最难发现的错）
const onMonthSeg = (() => {
  const s = stripComments(PAGE);
  const a = s.indexOf('onMonthChange');
  return a >= 0 ? s.slice(a, a + 700) : '';
})();
ok('E-⑫ 换月清空预填与参考值（防止把 9 月的数当成 10 月的）',
  /val:\s*''/.test(onMonthSeg) && /ph:\s*''/.test(onMonthSeg),
  'onMonthChange 段长=' + onMonthSeg.length);

// E-⑬⑭ 只报事实、不冒充：参考值走灰色 placeholder，不预填进输入框
ok('E-⑬ 上月参考走 placeholder（灰色提示），不写进 value —— 避免被当成真数存进去',
  /placeholder="\{\{it\.ph \|\| '0\.00'\}\}"/.test(WXML) && /it\.val/.test(WXML));
ok('E-⑭ 页面明确告诉老板"灰色是上个月的数，不是这个月的"（一句话防串月）',
  typeof MT.refPh === 'string' && /上月/.test(MT.refPh) && /上个月/.test(String(MT.refTip || ''))
  && /不是这个月/.test(String(MT.refTip || '')),
  'refPh=' + MT.refPh + ' refTip=' + String(MT.refTip || '').slice(0, 12));

ok('E-⑪ 取上月用 prevMonth（1 月减成「0 月」的坑已有断言）',
  /prevMonth\(month\)/.test(PAGE) && /mo - 2/.test(PAGE),
  'prevMonth=' + /prevMonth\(month\)/.test(PAGE));

// E-⑮ 填完当场回显金额（否则他只看到"存好了"，不知道填对没）
ok('E-⑮ 保存成功回显"经营营收 ¥X"（填完就知道对不对）',
  /savedTotalTpl/.test(PAGE) && typeof MT.savedTotalTpl === 'string' && /\{x\}/.test(String(MT.savedTotalTpl)));

// ============ G 拍照当参考（R622）============
// 这一功能的价值全在「不做识别」上：不调云、不上传、不落库 ⇒ 零成本、零隐私外泄、抄错是他自己认。
// 所以判据的重点是**守住这条边界**，而不是判"能不能识别"。
sec('G 拍照当参考（不上传、不识别、不落库）');

const photoSeg = (() => {
  const s = stripComments(PAGE);
  const a = s.indexOf('onPickPhoto');
  const b = s.indexOf('onToggleGroup');
  return a >= 0 ? s.slice(a, b > a ? b : a + 1200) : '';
})();

ok('G-① 有拍照入口（can chooseMedia 选图，且相机与相册两条路都给）',
  /wx\.chooseMedia/.test(photoSeg) && /mediaType:\s*\['image'\]/.test(photoSeg)
  && /sourceType:\s*\[[^\]]*'camera'/.test(photoSeg) && /sourceType:\s*\[[^\]]*'album'/.test(photoSeg));

ok('G-② 🔴 照片**不上传**：拍照与保存流程里不出现任何上云调用',
  !/uploadFile/.test(photoSeg) && !/cloud\./.test(photoSeg) && !/api\.call/.test(photoSeg)
  && !/uploadFile/.test(stripComments(PAGE).slice(stripComments(PAGE).indexOf('onSave'))),
  '拍照段长=' + photoSeg.length);

ok('G-③ 🔴 保存参数只有月份和数值（照片路径绝不能跟着提交）',
  (() => {
    const s = stripComments(PAGE);
    const i = s.indexOf('revenue_save_manual');
    const seg = i >= 0 ? s.slice(i, i + 400) : '';
    return /input:\s*\{\s*month:/.test(seg) && /fields/.test(seg) && !/photo/.test(seg);
  })());

ok('G-④ 🔴 界面明说"不上传、不识别"（不写清楚，老板会以为我们把他账单传走了）',
  /不上传/.test(String(MT.photoTip || '')) && /不识别/.test(String(MT.photoTip || '')),
  String(MT.photoTip || '').slice(0, 18));

ok('G-⑤ 不承诺"自动识别/自动填"（没做的能力不许写，假承诺比没有更伤）',
  !/自动识别|自动填|智能识别/.test(String(MT.photoTip || '') + String(MT.photoBtn || '')));

ok('G-⑥ 点照片能放大看（店里光线差、单据字小）',
  /wx\.previewImage/.test(photoSeg) && /bindtap="onPreviewPhoto"/.test(WXML));

ok('G-⑦ 拍的照能去掉（不让他被一张错图一直挂着）',
  /onRemovePhoto/.test(PAGE) && /bindtap="onRemovePhoto"/.test(WXML) && typeof MT.photoRemove === 'string');

ok('G-⑧ 照片显示区够大（≥300rpx 高），不是缩略图',
  /\.mn-photo-img\s*\{[^}]*height:\s*(\d+)rpx/.test(WXSS)
  && Number((WXSS.match(/\.mn-photo-img\s*\{[^}]*height:\s*(\d+)rpx/) || [0, 0])[1]) >= 300);

// ============ F 真跑手填分支（R621）============
// 🔴 静态扫描抓不住「引用了不存在的变量」这类错：R620 的 vals 就是这么上线的，
//   node --check 也不报（引用错误不是语法错误）。所以这里把**云端分支原文**抠出来，
//   用桩 db / 桩 Store 在 node 里真跑一遍 —— 跑得通才算没崩。
sec('F 真跑云端手填分支（桩 db 执行 index.js 原文，不是扫字符串）');

function extractBranch(src, marker) {
  const s = stripComments(src);
  const at = s.indexOf(marker);
  if (at < 0) return '';
  const open = s.indexOf('{', at);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return s.slice(open + 1, i); }
  }
  return '';
}

const BRANCH = extractBranch(FN, "action === 'revenue_save_manual'");

function makeStubStore(prev) {
  const calls = [];
  return {
    calls,
    RevenueStore: {
      getActive: async () => prev,
      commit: async (ctx) => {
        calls.push(ctx);
        return { ok: true, mode: prev ? 'replaced' : 'created', batch_id: 'b1', diff: null };
      },
    },
  };
}

function makeDeps() {
  return {
    fail: (code, msg) => ({ __fail: msg, code }),
    ok: (x) => Object.assign({ __ok: true }, x),
    ERROR_CODES: { INVALID_PARAM: 1001 },
  };
}

async function runBranch(event, prev) {
  const store = makeStubStore(prev);
  const d = makeDeps();
  // 参数名与 index.js 里的自由变量**逐个对齐**，否则真跑会报"未定义"（这本身就是判据价值）
  const fn = new Function('db', 'userId', 'shopId', 'event',
    'RevenueStore', 'RevenueDaily', 'fail', 'ok', 'ERROR_CODES',
    'return (async () => {' + BRANCH + '\nreturn { __untouched: true };\n})();');
  const out = await fn({}, 'u1', 's1', event, store.RevenueStore, R, d.fail, d.ok, d.ERROR_CODES)
    .catch((e) => ({ __throw: String(e && e.message || e) }));
  return { out, calls: store.calls };
}

(async () => {
  ok('F-① 手填分支能从 index.js 抠出来（结构没被改写）', BRANCH.length > 200, '段长=' + BRANCH.length);

  // F-② 首次填：两个数
  const r1 = await runBranch({ action: 'revenue_save_manual', input: { month: '2026-09', fields: { cash: 1000, scan: 5000 } } });
  ok('F-② 🔴 首次手填能跑通并落库（R620 这里会 ReferenceError：vals 未定义）',
    !!(r1.out && r1.out.revenue_manual) && r1.calls.length === 1,
    '营收=' + (r1.out && r1.out.revenue_manual && r1.out.revenue_manual.revenueM1.totalYuan));

  // F-③ 分次填：本月已存 cash=1000，这次只填外卖 800 ⇒ 现金必须还在
  const prev = { source: 'manual', manual_fields: { cash: 1000 }, result: {} };
  const r2 = await runBranch(
    { action: 'revenue_save_manual', input: { month: '2026-09', fields: { waimaiMeituan: 800 } } }, prev);
  const mf = r2.calls[0] && r2.calls[0].manualFields;
  ok('F-③ 🔴 真跑分次填：只填外卖 800 ⇒ 上次的现金 1000 仍在（不是整体替换）',
    !!mf && mf.cash === 1000 && mf.waimaiMeituan === 800, JSON.stringify(mf));
  ok('F-④ 真跑：合并后营收 = 堂食 1000 + 外卖 800 = 1800',
    r2.out.revenue_manual.revenueM1.totalYuan === 1800,
    String(r2.out.revenue_manual.revenueM1.totalYuan));
  ok('F-⑤ 真跑：回传 merged 统计（页面要告诉老板"补了几项、沿用几项"）',
    r2.out.merged && r2.out.merged.added === 1 && r2.out.merged.kept === 1, JSON.stringify(r2.out.merged));

  // F-⑥ 幂等键由合并后的数生成：同样的输入两次 ⇒ 同一个键
  const r3 = await runBranch({ action: 'revenue_save_manual', input: { month: '2026-09', fields: { cash: 1000, scan: 5000 } } });
  ok('F-⑥ 真跑：同样的数两次 ⇒ 幂等键一致（不会多出一条）',
    r3.calls[0].fileMd5 === r1.calls[0].fileMd5 && r1.calls[0].fileMd5.indexOf('manual:s1:2026-09:') === 0,
    r1.calls[0].fileMd5);

  // F-⑦ 一项没填 ⇒ 拒绝，且不落库
  const r4 = await runBranch({ action: 'revenue_save_manual', input: { month: '2026-09', fields: {} } });
  ok('F-⑦ 一项没填 ⇒ 明确拒绝且不写库（不落空记录）',
    !!r4.out.__fail && r4.calls.length === 0, JSON.stringify(r4.out).slice(0, 40));

  // F-⑧ 月份格式错 ⇒ 拒绝
  const r5 = await runBranch({ action: 'revenue_save_manual', input: { month: '2026/09', fields: { cash: 1 } } });
  ok('F-⑧ 月份格式不对 ⇒ 拒绝（不猜他要记哪个月）', !!r5.out.__fail && r5.calls.length === 0);

  // F-⑨ 同月是 Excel ⇒ 不合并（走确认替换，不拼混合数）
  const r6 = await runBranch(
    { action: 'revenue_save_manual', input: { month: '2026-09', fields: { cash: 500 } } },
    { source: 'excel', manual_fields: { scan: 9999 }, result: {} });
  ok('F-⑨ 真跑：同月是 Excel ⇒ 不合并（不会把 Excel 的字段拼进手填）',
    !!r6.calls[0] && r6.calls[0].manualFields.cash === 500 && r6.calls[0].manualFields.scan === undefined,
    JSON.stringify(r6.calls[0] && r6.calls[0].manualFields));

  console.log('\n===== 手填汇总守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
  process.exit(failN === 0 ? 0 : 1);
})();
