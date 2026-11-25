// review/evidence/r758_cross_audit/_probe.js —— T1 双写一致性「从严交叉审计」探针
// 运行： node review/evidence/r758_cross_audit/_probe.js
//
// 🔴 不复用上次审计的探针（那是自证）。这次专挑**反面时序**：
//   「本地刚填的新值」vs「云端的旧值」——谁赢？如果旧值赢，老板填的东西就没了。
//
// 2026-11-25 实测抓到真缺口并已修：本地写数据时没推高水位线 ⇒
//   云端旧值 updatedAt=100 > 本地 localAt=0 ⇒ 刚填的 200 元被 8000 分旧值覆盖。

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..');

let pass = 0, failN = 0;
function probe(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  → ' + detail : '')); }
  else { failN++; console.log('  🔴 ' + name + (detail ? '  → ' + detail : '')); }
}
function sec(t) { console.log('\n===== ' + t + ' ====='); }

// ============ A. 源码级：本地写数据时，有没有同步更新「同步水位线」？============
sec('A 水位线（consume_sync_at_）的写入点');
{
  const src = fs.readFileSync(path.join(ROOT, 'subpkg/tools/recon/index.js'), 'utf8');
  const onNs = /onNonsales\(e\)\s*\{[\s\S]*?\n  \}/.exec(src);
  const onMat = /onMatQty\(e\)\s*\{[\s\S]*?\n  \}/.exec(src);
  probe('A-① onNonsales 写本地时推高水位线', !!onNs && onNs[0].indexOf('markLocalNew') >= 0);
  probe('A-② onMatQty 写本地时推高水位线', !!onMat && onMat[0].indexOf('markLocalNew') >= 0);
}

// ============ B. 页面桩：反面时序实测 ============
sec('B 反面时序实测（真跑 onNonsales → syncFromCloud）');
{
  const store = {};
  let cfg = null;
  global.Page = (c) => { cfg = c; };
  global.getApp = () => ({ globalData: { shop_id: 'shop_test' } });
  global.wx = {
    getStorageSync: (k) => (k in store ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = v; },
    removeStorageSync: (k) => { delete store[k]; },
    getStorageInfoSync: () => ({ keys: Object.keys(store) }),
    showToast: () => {}, navigateTo: () => {}, cloud: {},
  };
  require(path.join(ROOT, 'subpkg/tools/recon/index.js'));

  const p = Object.assign({}, cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data));
  p.setData = function (patch) { for (const k in patch) this.data[k] = patch[k]; };
  p.data.months = ['2026-11', '2026-10'];
  p.data.curMonth = '2026-11';

  const keyNs = 'nonsales_2026-11_shop_shop_test';
  const keyAt = 'consume_sync_at_2026-11_shop_shop_test';

  // 桩云端：一个**旧的**值（8000 分，updatedAt=100）
  const storeMod = require(path.join(ROOT, 'utils/consumeStore.js'));
  const orig = storeMod.loadCloud;
  storeMod.loadCloud = async () => ({ v: 1, month: '2026-11', nonsalesFen: 8000, items: [], updatedAt: 100 });

  // 🔴 真实路径：用户填 200 元（内部写本地 + markLocalNew）
  p.onNonsales({ detail: { value: '200' } });
  const watermark = Number(store[keyAt]) || 0;
  probe('B-① 用户填数后水位线被推高（> 云端旧值 t=100）', watermark > 100, String(watermark));
  probe('B-② 本地确实写入 20000 分', store[keyNs] === 20000, String(store[keyNs]));

  // 云端旧值来同步
  let thrown = null;
  try { p.syncFromCloud('2026-11'); } catch (e) { thrown = e; }

  setTimeout(() => {
    console.log('  云端=8000分(t=100) / 本地刚填=20000分(t=' + watermark + ')');
    console.log('  同步后本地 = ' + store[keyNs] + ' 分');
    probe('B-③ 🔴 修复后：本地新值保住（不被云端旧值覆盖）', store[keyNs] === 20000,
      store[keyNs] === 20000 ? '200 元保住 ✅' : '❌ 被旧值 ' + store[keyNs] + ' 覆盖');
    probe('B-④ syncFromCloud 真跑不抛异常', thrown === null, thrown && thrown.message);

    // C. 反恒真：把 markLocalNew 从源码里删掉，A-① 的判据必须变红（证明它不是空转）
    const src = fs.readFileSync(path.join(ROOT, 'subpkg/tools/recon/index.js'), 'utf8');
    const without = src.replace('this.markLocalNew(this.data.curMonth);', '');
    const onMut = /onNonsales\(e\)\s*\{[\s\S]*?\n  \}/.exec(without);
    const a1OnMutant = !!onMut && onMut[0].indexOf('markLocalNew') >= 0;
    probe('C-① 反恒真：删掉 markLocalNew 后 A-① 判据必须变红',
      without !== src && a1OnMutant === false,
      '变异后 A-①=' + a1OnMutant + '（应为 false）');

    // E. 防抖中断（豆包 Q1-2）：页面离开时必须补发挂起的上传
    const hasHide = src.indexOf('onHide()') >= 0 && /onHide\(\)[\s\S]{0,260}pushToCloud/.test(src);
    const hasUnload = src.indexOf('onUnload()') >= 0;
    probe('E-① 页面 onHide/onUnload 补发挂起的防抖上传', hasHide && hasUnload,
      'onHide=' + hasHide + ' / onUnload=' + hasUnload);

    storeMod.loadCloud = orig;
    console.log('\n==== 交叉审计探针：' + pass + ' 通过 / ' + failN + ' 不吻合 ====');
    process.exit(failN === 0 ? 0 : 1);
  }, 300);
}
