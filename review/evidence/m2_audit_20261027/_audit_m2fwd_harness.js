// _audit_m2fwd_harness.js —— 只读取证：把 subpkg/tools/sandbox/index.js 的 Page 对象在 node 里加载出来，
// 用假 this.data 驱动 buildPresetParam / 各派生函数（不修改任何业务文件）。
const path = require('path');
const fs = require('fs');

const ROOT = (() => { const fs = require('fs'); const p = require('path');
  let d = __dirname; for (let i = 0; i < 8; i++) { if (fs.existsSync(p.join(d, 'app.json'))) return d; d = p.dirname(d); }
  return __dirname; })();  // R529：归档到 review/evidence/ 后仍能定位仓根（原来写死 __dirname）

const store = {};
global.wx = {
  getStorageSync: (k) => store[k],
  setStorageSync: (k, v) => { store[k] = v; },
  removeStorageSync: (k) => { delete store[k]; },
  showToast() {}, showModal() {}, navigateTo() {}, reLaunch() {}, switchTab() {},
  pageScrollTo() {}, setNavigationBarTitle() {}, stopPullDownRefresh() {},
};
global.getApp = () => ({ globalData: { shopLoaded: true, shop_id: 's_test' } });

let PAGE = null;
global.Page = (obj) => { PAGE = obj; };

const src = fs.readFileSync(path.join(ROOT, 'subpkg/tools/sandbox/index.js'), 'utf8');
// eslint-disable-next-line no-new-func
const fn = new Function('Page', 'wx', 'getApp', 'require', 'module', 'exports', '__dirname', src);
const req = (p) => {
  const abs = path.resolve(path.join(ROOT, 'subpkg/tools/sandbox'), p);
  return require(abs);
};
fn(global.Page, global.wx, global.getApp, req, { exports: {} }, {}, path.join(ROOT, 'subpkg/tools/sandbox'));

if (!PAGE) throw new Error('Page 未捕获');

/** 造一个页面实例：data 深拷贝自 PAGE.data，方法挂上。 */
function makePage(overrides) {
  const inst = Object.assign({}, PAGE);
  inst.data = JSON.parse(JSON.stringify(PAGE.data));
  // setData（同步，支持 'a.b' 路径）
  inst.setData = function (patch, cb) {
    Object.keys(patch).forEach((k) => {
      const parts = k.split('.');
      let cur = this.data;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!cur[parts[i]]) cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = patch[k];
    });
    if (cb) cb();
  };
  Object.assign(inst.data, overrides || {});
  return inst;
}

module.exports = { PAGE, makePage };
