// tools/check_card_find.js —— R629 成本卡「100 张怎么找」（第 252 套件）
//
// 一个店 100 多张成本卡时，老板不是"没有查询功能"，而是**找不到**：
//   ① 搜索只认菜名 —— 他记得"牛肉类"，记不住"番茄牛腩"；
//   ② 排序以「置顶在前」为先，可 `onPin` 早就写好了、**wxml 里从没绑过** ⇒ 置顶永远是空的，
//      这个"救排序"的功能是死的。
// 这一组守的就是这两件事，外加一个前提事实：100 张**不会**被截断（上限 1000 + skip 循环取全）。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const P = (rel) => path.join(ROOT, rel);
let pass = 0, failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? ' ｜ ' + detail : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? ' ｜ ' + detail : '')); }
}
function sec(t) { console.log('\n===== ' + t + ' ====='); }
function stripComments(s) {
  return String(s).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const JS = fs.readFileSync(P('subpkg/biz/card/index.js'), 'utf8');
const WXML = fs.readFileSync(P('subpkg/biz/card/index.wxml'), 'utf8');
const ADAPTER = fs.readFileSync(P('cloudfunctions/common/dataAdapter.js'), 'utf8');
const T = require(P('miniprogram/i18n/terms.js')).TERMS.card;

// ============ A 置顶入口（写好了必须能用）============
sec('A 置顶入口（功能写好了却没绑 = 死的）');

ok('A-① `onPin` 存在（置顶逻辑在）', /\n  async onPin\(/.test(JS));
ok('A-② 🔴 wxml 里真的绑了 onPin（本轮修复点：以前只有 tag 没有绑定）',
  /onPin/.test(WXML) && /data-code="\{\{item\.card_code\}\}"/.test(WXML));
ok('A-③ 🔴 用 catchtap 而不是 bindtap（否则点置顶会冒泡进编辑页，把人带走）',
  /catchtap="onPin"/.test(WXML) && !/bindtap="onPin"/.test(WXML));
ok('A-④ 未置顶时也有**可见**的入口（不是"置顶了才看得见"）',
  /\{\{item\.pinned \? 'tag-pin' : 'tag-pin-off'\}\}/.test(WXML)
  && typeof T.pinAction === 'string' && T.pinAction.length >= 2);
ok('A-⑤ 置顶态与未置顶态文案不同（同一个标签要能看出当前状态）',
  T.pinTag !== T.pinAction && typeof T.unpinAction === 'string');
ok('A-⑥ 乐观更新 + 失败回滚（界面不能停在"看起来成功"）',
  /const backup = \(this\.data\.pinned \|\| \[\]\)\.slice\(\)/.test(JS) && /catch[\s\S]{0,200}setData\(\{ pinned: backup \}\)/.test(JS));

// ============ B 搜索面 ============
sec('B 搜索面（记不住菜名也得搜得到）');
const FILTER = (() => {
  const s = stripComments(JS);
  const a = s.indexOf('applyFilter()');
  const b = s.indexOf('sortList(', a);
  return s.slice(a, b > a ? b : a + 1600);
})();
// 🔴 必须只看 haystack **那一行**：applyFilter 段里本来就有 `c.category !== cat`（分类筛选），
//   拿整段判 `c.category` 会被那行满足 ⇒ 搜索退化成"只认菜名"也照样绿（本轮真踩到，变异10 没命中）。
const HAY = (FILTER.match(/const hay\s*=\s*([^;]+);/) || [])[1] || '';
ok('B-① 搜索命中「名称」', /c\.name/.test(HAY), HAY.slice(0, 60));
ok('B-② 🔴 搜索命中「分类」（记得"牛肉类"就该搜得到）', /c\.category/.test(HAY));
ok('B-③ 🔴 搜索命中「标签」', /c\.tags/.test(HAY));
ok('B-④ 三个字段拼成一个 haystack 再匹配（不是各判各的"与"，那会越搜越空）',
  HAY.length > 0 && /indexOf\(kw\)/.test(FILTER));
ok('B-⑤ 搜索与其它筛选仍是"与"关系（分类/标签/毛利档照旧生效）',
  /if \(cat && c\.category !== cat\) return false;/.test(FILTER) && /matchBand/.test(FILTER));

// ============ C 前提事实：100 张不会被截断 ============
sec('C 前提（100 张卡不会因为上限而"消失"）');
ok('C-① 列表上限 ≥ 500（100 张远未触顶）',
  (() => { const m = /LIST_LIMIT\s*=\s*(\d+)/.exec(ADAPTER); return !!m && Number(m[1]) >= 500; })(),
  'LIST_LIMIT=' + ((/LIST_LIMIT\s*=\s*(\d+)/.exec(ADAPTER) || [])[1] || '?'));
ok('C-② 有 skip 循环取全（不是取一页就算完）',
  /for \(let skip = 0;/.test(ADAPTER) && /rows\.length < LIST_LIMIT/.test(ADAPTER));

console.log('\n===== 成本卡查找守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
