// tools/check_asset_kind.js —— 摊销分类链路守卫（R653 · M2）
//
// 李老师要的「加盟费 / 装修摊销 / 管理费」要能分开看。
// 改前**全链路都没有类别字段**（saveAsset / getAmortSchedule / 两个页面 grep 'category' 全 0）
// ⇒ 老板录一笔 30 万装修 + 5 万加盟，摊销表里混成一坨，看不出钱花在哪。
//
// 本守卫盯「五段链路必须全通」—— 少一段就是"存了看不到"或"选了存不下"：
//   terms → 录入页提交 → 校验白名单 → 落库/出参 → 摊销页显示

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let pass = 0; let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); } else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

const T = require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS.amortizePage;
const EDIT_JS = fs.readFileSync(path.join(ROOT, 'subpkg/biz/month/assetEdit.js'), 'utf8');
const EDIT_XML = fs.readFileSync(path.join(ROOT, 'subpkg/biz/month/assetEdit.wxml'), 'utf8');
const AM_JS = fs.readFileSync(path.join(ROOT, 'subpkg/biz/month/amortize.js'), 'utf8');
const AM_XML = fs.readFileSync(path.join(ROOT, 'subpkg/biz/month/amortize.wxml'), 'utf8');
const VALIDATE = require(path.join(ROOT, 'cloudfunctions/saveAsset/validate.js'));

console.log('\n===== K 第一段：类别单源 =====');
ok('K-① terms 里有 5 个类别（装修/加盟费/设备/押金/其他）',
  Array.isArray(T.assetKinds) && T.assetKinds.length === 5,
  (T.assetKinds || []).map((x) => x.name).join('/'));
ok('K-② 每个类别都有 key + name（页面靠 key 存、靠 name 显示）',
  (T.assetKinds || []).every((x) => x.key && x.name));
ok('K-③ 类别词在 terms 单源，页面不硬编码（否则改一处漏一处）',
  !/'装修'/.test(EDIT_JS) && !/'加盟费'/.test(EDIT_JS));

console.log('\n===== K 第二段：录入页真的送得出去 =====');
ok('K-④ 录入页有类别 picker', /bindchange="onKind"/.test(EDIT_XML));
ok('K-⑤ 🔴 保存载荷里带 asset_kind（读了不送＝白读，R298Y 同族病）',
  /asset_kind:\s*this[.]data[.]assetKind/.test(EDIT_JS));
ok('K-⑥ 编辑态能回填（否则一进编辑页分类就丢了）',
  /init[.]assetKind = a[.]asset_kind/.test(EDIT_JS));

console.log('\n===== K 第三段：校验白名单（真跑）=====');
function mk(kind) {
  return VALIDATE.validateInput({
    shop_id: 's1',
    asset: { name: '门头装修', value_fen: 30000000, start_month: '2026-09', total_months: 36, mode: 'amort', asset_kind: kind },
  });
}
const okKind = mk('renovation');
ok('K-⑦ 合法类别原样通过', okKind.error === null || okKind.error === undefined, okKind.error || 'OK');
ok('K-⑧ 合法类别在出参里保留', (okKind.asset || {}).asset_kind === 'renovation', (okKind.asset || {}).asset_kind);
const badKind = mk('乱写的分类');
ok('K-⑨ 🔴 非法类别**不报错**（老板选错分类不该阻止他存钱），但落成空串',
  (badKind.error === null || badKind.error === undefined) && (badKind.asset || {}).asset_kind === '',
  'error=' + badKind.error + ' kind=' + JSON.stringify((badKind.asset || {}).asset_kind));
const noKind = mk(undefined);
ok('K-⑩ 没传类别 ⇒ 空串（老前端/老数据兼容，不崩）',
  (noKind.error === null || noKind.error === undefined) && (noKind.asset || {}).asset_kind === '');

console.log('\n===== K 第四段：落库与出参 =====');
const SAVE = fs.readFileSync(path.join(ROOT, 'cloudfunctions/saveAsset/index.js'), 'utf8');
const GET = fs.readFileSync(path.join(ROOT, 'cloudfunctions/getAmortSchedule/index.js'), 'utf8');
ok('K-⑪ 新增时落库 asset_kind', /asset_kind: a[.]asset_kind \|\| ''/.test(SAVE));
ok('K-⑫ 编辑时也能改类别（一开始归错类是常事）', /patch[.]asset_kind = a[.]asset_kind/.test(SAVE));
ok('K-⑬ getAmortSchedule 出参带 asset_kind（不带的话页面永远显示不出来）',
  /asset_kind: a[.]asset_kind \|\| ''/.test(GET));

console.log('\n===== K 第五段：摊销页显示 =====');
ok('K-⑭ 摊销页把 key 转成中文名（走 terms 单源）',
  /kindNameOf/.test(AM_JS) && /TERMS[.]amortizePage[.]assetKinds/.test(AM_JS));
ok('K-⑮ 🔴 wxml 真的渲染类别标签（存了不显示＝白做）',
  /class="tag kind"[^>]*wx:if="\{\{!g[.]multi && g[.]batches\[0\][.]kindName\}\}"/.test(AM_XML));
ok('K-⑯ 老数据（无类别）不出现空标签',
  /wx:if="\{\{!g[.]multi && g[.]batches\[0\][.]kindName\}\}"/.test(AM_XML));

console.log('\n===== K 边界：类别绝不参与金额 =====');
ok('K-⑰ 🔴 类别只影响展示，validate 出参里金额与类别互不影响',
  okKind.asset.value_fen === 30000000 && badKind.asset.value_fen === 30000000);

console.log('\n===== 结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
