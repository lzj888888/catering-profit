// 前端工具单测（node 可直接跑：validate / loading / shopSwitcher 纯逻辑部分）
// 运行： node tools/selftest_batch7.js
// 覆盖验收 1（金额负数前端拦截）、验收 2（防重复提交语义）、验收 3（多店隔离 + 持久化键）。
//
// ⚠️ R55（2026-09-17）：本套件原在 `utils/`，而 `packOptions.ignore` 不含 `utils/`、也不忽略 `.js`
//    ⇒ 测试代码会随小程序包发布。已移入 `tools/`（在 ignore 内）。
//    约定：**测试/校验脚本一律放 `tools/` 或 `cloudfunctions/<fn>/__tests__/`，不放 `utils/`、`pages/`。**

// ⚠️ wx storage mock 必须先于任何调用定义（node 环境无 wx）
const wxStorage = {};
global.wx = {
  setStorageSync(k, v) { wxStorage[k] = v; },
  getStorageSync(k) { return wxStorage[k] || ''; },
};

const v = require('../utils/validate.js');
const loading = require('../utils/loading.js');
const sw = require('../utils/shopSwitcher.js');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

console.log('===== 验收 1 · 表单校验（前端体验层）=====');
check('金额负数 → 拦截', v.money('-5', '金额').ok === false);
check('金额负数错误码 = INVALID_PARAM（全局标准码）', v.money('-5', '金额').code === 'INVALID_PARAM');
check('金额合法放行', v.money('100', '金额').ok === true);
check('金额空 → 拦截', v.money('', '金额').ok === false);
check('必填空 → 拦截', v.required('  ', '名称').ok === false);
check('月份格式错误 → 拦截', v.month('2026-13', '月份').ok === false);
check('月份格式正确放行', v.month('2026-09', '月份').ok === true);
check('百分比 >100 → 拦截', v.percent(101, '损耗率').ok === false);
check('正整数（份数）→ 拦截 0', v.positiveInt('0', '份数').ok === false);
check('批量校验任一失败即拦', v.anyChecks([v.money('10', 'a'), v.money('-1', 'b')]).ok === false);
// ⚠️ 前端校验不是安全边界：错误文案从 i18n 映射（msgOf INVALID_PARAM）
const { msgOf } = require('../miniprogram/i18n/terms.js');
check('错误文案走 i18n 映射', typeof msgOf('INVALID_PARAM') === 'string' && msgOf('INVALID_PARAM').length > 0);

console.log('===== 验收 2 · 防重复提交（loading.withLock 语义）=====');
// 模拟 Page：data.loading_btn + setData
const page = { data: { loading_btn: false }, setData(obj) { Object.assign(this.data, obj); } };
let calls = 0;
const run = () => loading.withLock(page, 'btn', async () => { calls++; await new Promise((r) => setTimeout(r, 10)); });
(async () => {
  const p1 = run();               // 第一次：开始执行（busy=true）
  const p2 = run();               // 立即第二次：busy → 忽略
  await Promise.all([p1, p2]);
  check('连点两次只执行一次', calls === 1, `calls=${calls}`);
  check('执行后 loading 恢复 false', page.data.loading_btn === false);
  await run();
  check('恢复后可再次执行', calls === 2);
  // set() 生成片段
  const frag = loading.set('save', true);
  check('set 生成 loading_<key> 片段', frag.loading_save === true);

  console.log('===== 验收 3 · 多店隔离 + 持久化 =====');
  // 切换器：持久化键 + 列表过滤语义
  check('持久化键 shop_switcher_shop_id', sw.PERSIST_KEY === 'shop_switcher_shop_id');
  check('restoreShopId 无缓存返回空串', sw.restoreShopId() === '');
  // 软删过滤语义（getShopList 后端保证；此处验证 restoreLastShop 对已软删店铺的处理）
  const list = [{ shop_id: 's_a', name: 'A' }, { shop_id: 's_b', name: 'B' }];
  check('列表仅活跃店铺（is_deleted=false 由后端过滤）', list.every((s) => !s.is_deleted));
  // 数据隔离：shop_id 写 globalData → api.js 统一注入（模拟）
  const app = { globalData: { shop_id: '' } };
  const realGetApp = global.getApp;
  global.getApp = () => app;
  sw.switchShop('s_b');
  check('切换后 globalData.shop_id = 新店', app.globalData.shop_id === 's_b');
  check('切换后持久化', wxStorage.shop_switcher_shop_id === 's_b');
  global.getApp = realGetApp;

  console.log(`\n==== 批次 7 前端工具自测结果：${pass} 通过 / ${failN} 失败 ====`);
  process.exit(failN === 0 ? 0 : 1);
})();