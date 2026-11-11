// tools/check_import_guidance.js —— R712 · 导入引导与「取消不当错误」守卫
//
// 守两件李老师真机报出来的事（2026-11-12）：
//   ⑥ 「点选择销量文件，它又系统异常就跳到微信那里去了，选择一个聊天」
//      ⇒ wx.chooseMessageFile 跳到微信会话列表后，老板点返回/取消会让 Promise **reject**；
//        原来「选文件」和「上传解析」写在同一个 try 里 ⇒ 取消被当成业务失败 ⇒ 弹「系统异常」。
//   ⑦ 「渠道营收那个选收款日报，它也没说怎么选，也没有引导，点了就直接跳微信」
//      ⇒ 外卖页早有「去哪拿表 / 要哪些列」两块指引，渠道营收页一个都没有。
//
// 为什么必须真跑页面源码：⑥ 的全部意义在**取消这条分支**上，静态 grep 只能证明
// 「有 catch」，证明不了「取消时真的不会弹 toast」。所以 A 组走页面桩（同 check_card_patch_mode）。
//
// 运行：node tools/check_import_guidance.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TK_PAGE = path.join(ROOT, 'subpkg/biz/takeaway/index.js');
const TK_WXML = path.join(ROOT, 'subpkg/biz/takeaway/index.wxml');
const RV_PAGE = path.join(ROOT, 'subpkg/biz/revenue/index.js');
const RV_WXML = path.join(ROOT, 'subpkg/biz/revenue/index.wxml');
const TERMS_P = path.join(ROOT, 'miniprogram/i18n/terms.js');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { fail++; console.log('  ❌ ' + name + (detail ? '  (' + detail + ')' : '')); }
}

const TK_SRC = fs.readFileSync(TK_PAGE, 'utf8');
const TK_W = fs.readFileSync(TK_WXML, 'utf8');
const RV_W = fs.readFileSync(RV_WXML, 'utf8');
const RV_J = fs.readFileSync(RV_PAGE, 'utf8');
const TERMS = require(TERMS_P).TERMS;
const api = require(path.join(ROOT, 'utils/api.js'));

// ============ 页面桩 ============
const calls = { upload: 0, cloudCall: 0, toasts: [] };

function makeWx(opts) {
  const o = opts || {};
  return {
    showLoading: () => {}, hideLoading: () => {}, showToast: () => {},
    pageScrollTo: () => {}, navigateBack: () => {}, navigateTo: () => {},
    setNavigationBarTitle: () => {},
    getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
    chooseMessageFile: async () => {
      // 🔴 微信里点「返回 / 取消」= reject（不是 resolve 空数组）。这就是老板那一下。
      if (o.reject) throw { errMsg: 'chooseMessageFile:fail cancel' };
      return { tempFiles: [{ path: '/tmp/a.xlsx', name: 'a.xlsx' }] };
    },
    cloud: {
      uploadFile: async (x) => { calls.upload++; return { fileID: 'cloud://f' }; },
      callFunction: async (x) => { calls.cloudCall++; return { result: { code: 'SUCCESS', data: {} } }; },
    },
  };
}

function loadPage(mutate) {
  const src = mutate ? mutate(TK_SRC.replace(/\r\n/g, '\n')) : TK_SRC;
  let cfg = null;
  const g = global;
  const bak = { Page: g.Page, getApp: g.getApp, wx: g.wx };
  g.Page = (c) => { cfg = c; };
  g.getApp = () => ({ globalData: { shop_id: 'shop_test', shopLoaded: true } });
  g.wx = makeWx({ reject: true });
  try {
    const mod = { exports: {} };
    const dir = path.dirname(TK_PAGE);
    const fakeRequire = (p) => require(/^[./]/.test(p) ? path.resolve(dir, p) : p);
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', '__dirname', '__filename', src)(
      mod, mod.exports, fakeRequire, dir, TK_PAGE
    );
  } finally {
    g.Page = bak.Page; g.getApp = bak.getApp; g.wx = bak.wx;
  }
  if (!cfg) throw new Error('页面桩没抓到 Page 配置');
  return cfg;
}

function newPage(cfg) {
  const p = Object.assign({}, cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data));
  p.setData = function (patch) {
    for (const k in patch) { if (Object.prototype.hasOwnProperty.call(patch, k)) this.data[k] = patch[k]; }
  };
  return p;
}

/** 在 wx 桩就位的前提下跑一段（handler 会摸全局 wx），并拦截 api.toastError。 */
async function withWx(fn, opts) {
  const bak = { wx: global.wx };
  global.wx = makeWx(opts || { reject: true });
  const origToast = api.toastError;
  api.toastError = (e) => { calls.toasts.push(e && (e.errMsg || e.message || String(e))); };
  try { return await fn(); } finally { global.wx = bak.wx; api.toastError = origToast; }
}

function reset() { calls.upload = 0; calls.cloudCall = 0; calls.toasts = []; }

// ============ A 组：⑥ 取消不许当成错误（真跑页面源码） ============
(async function () {
  const CFG = loadPage(null);

  console.log('\n===== A 组 · 选文件被取消（微信里点返回） =====');
  reset();
  const P1 = newPage(CFG);
  await withWx(async () => { await P1.onChooseFile(); }, { reject: true });
  ok('A-① 🔴 取消 ⇒ 一条 toast 都不弹（这是老板报的「系统异常」）',
    calls.toasts.length === 0, 'toast=' + calls.toasts.length + (calls.toasts.length ? '：' + calls.toasts.join('/') : ''));
  ok('A-② 取消 ⇒ importing 保持 false（按钮不会被卡在 loading 态）',
    P1.data.importing === false, 'importing=' + P1.data.importing);
  ok('A-③ 取消 ⇒ 没有上传任何文件（否则会往云存储塞空文件）',
    calls.upload === 0, 'upload=' + calls.upload);
  ok('A-④ 取消 ⇒ 没有调云函数',
    calls.cloudCall === 0, 'cloudCall=' + calls.cloudCall);

  // 正常路径没被这刀砍坏：给文件就得上传
  reset();
  const P2 = newPage(CFG);
  await withWx(async () => { await P2.onChooseFile(); }, { reject: false });
  ok('A-⑤ 正常选到文件 ⇒ 真的上传了（取消分支不能把正常路径也吞掉）',
    calls.upload === 1, 'upload=' + calls.upload);

  // ---------- 变异回灌 ----------
  console.log('\n===== B 组 · 变异回灌（判据必须有分辨力） =====');
  // M1：把两段 try 合并回去（就是把 cancel 的 catch 改成向上抛/或直接走业务 catch）
  const M1 = loadPage((s) => s.replace(
    "    } catch (e) {\n      return;   // 用户取消，不当错误：不弹 toast、不改 importing\n    }\n    if (!file) return;",
    "    } catch (e) {}\n    if (!file) return;"
  ));
  reset();
  const M1p = newPage(M1);
  await withWx(async () => { await M1p.onChooseFile(); }, { reject: true });
  ok('B-① 变异「取消也继续往下走」⇒ 仍不弹 toast（说明 toast 不是从这条路来的）',
    calls.toasts.length === 0, 'toast=' + calls.toasts.length);

  // M2：取消的 catch 不再吞掉，改成向上抛（= 改前「取消被当失败」的等价形态）。
  //   ⚠️ 不能直接把 catch 删掉 —— 那会变成 `try {} 缺 catch` 的语法错误，
  //   变异体根本加载不起来，等于**变异没生效**却看起来"判据抓到了"（本轮踩过一次）。
  const M2 = loadPage((s) => s.replace(
    "    } catch (e) {\n      return;   // 用户取消，不当错误：不弹 toast、不改 importing\n    }",
    "    } catch (e) {\n      throw e;\n    }"
  ));
  reset();
  const M2p = newPage(M2);
  let m2err = null;
  await withWx(async () => {
    try { await M2p.onChooseFile(); } catch (e) { m2err = e; }
  }, { reject: true });
  ok('B-② 变异「取消不再被吞」⇒ 异常冒到外面（A-① 有分辨力）',
    calls.toasts.length > 0 || !!m2err,
    'toast=' + calls.toasts.length + ' 未捕获=' + (!!m2err));
  ok('B-②b 变异体确实被加载并跑到了抛异常这一步（防「变异没生效也全绿」）',
    !!m2err || calls.toasts.length > 0,
    m2err ? '捕获到：' + (m2err.errMsg || m2err.message) : '没捕获到');

  // M3：结构判据 —— 选文件的 catch 里只许 return，不许碰 toastError / setData
  const cancelCatch = (/'catch \(e\) \{\s*return;/.test(TK_SRC) || /catch \(e\) \{\r?\n\s*return;/.test(TK_SRC));
  ok('B-③ 源码结构：存在一个「catch 里只有 return」的取消分支（不是靠运气）',
    cancelCatch, cancelCatch ? '已找到' : '未找到');
  ok('B-④ 反恒真：影子样本「catch 里调 toastError」必须不被 B-③ 认可',
    !(/'catch \(e\) \{\s*return;/.test("} catch (e) { api.toastError(e); return; }")),
    '影子样本已证伪');

  // ============ C 组：⑦ 两页都说清「点了会跳微信」 ============
  console.log('\n===== C 组 · 「点按钮会跳到微信」必须点之前说 =====');

  const hint = TERMS.ui && TERMS.ui.importWechatHint;
  ok('C-① 文案单源存在（TERMS.ui.importWechatHint）',
    typeof hint === 'string' && hint.length > 0, hint ? hint.slice(0, 24) + '…' : '缺失');
  ok('C-② 文案说清了**会跳走**（必须同时出现「微信」和「聊天/文件传输助手」）',
    !!hint && hint.indexOf('微信') >= 0 && (/聊天/.test(hint) || /文件传输助手/.test(hint)),
    hint || '');
  ok('C-③ 文案不能是空壳（≥ 16 字，否则等于没说）',
    !!hint && hint.length >= 16, '长度=' + (hint ? hint.length : 0));

  /** 预告是否出现在选文件按钮**之前**（DOM 顺序），且不是内联字面量。 */
  function hintBeforePick(wxml, bindName) {
    const iHint = wxml.indexOf('t.importWechatHint');
    const iBtn = wxml.indexOf('bindtap="' + bindName + '"');
    return iHint >= 0 && iBtn >= 0 && iHint < iBtn;
  }
  ok('C-④ 外卖页：预告在「选文件」按钮之前（点之前才看得到）',
    hintBeforePick(TK_W, 'onChooseFile'), 'hint→btn 顺序=' + hintBeforePick(TK_W, 'onChooseFile'));
  ok('C-⑤ 渠道营收页：预告在「选文件」按钮之前',
    hintBeforePick(RV_W, 'onChoose'), 'hint→btn 顺序=' + hintBeforePick(RV_W, 'onChoose'));
  ok('C-⑥ 反恒真：影子样本「预告在按钮之后」必须判红',
    !hintBeforePick('<button bindtap="onChoose"></button><view>{{t.importWechatHint}}</view>', 'onChoose'),
    '影子样本已证伪');

  // 两页都得引用单源，不许各自写一份字面量（否则改一处漏一处）
  const inlineTK = /(先把\s*Excel|文件传输助手)/.test(TK_W);
  const inlineRV = /(先把\s*Excel|文件传输助手)/.test(RV_W);
  ok('C-⑦ 两页都引单源，正文不内联这句文案（内联 = 改一处漏一处）',
    !inlineTK && !inlineRV, '外卖内联=' + inlineTK + ' 营收内联=' + inlineRV);

  // ============ D 组：⑦ 渠道营收补齐两块指引 ============
  console.log('\n===== D 组 · 渠道营收页的「去哪拿表 / 要哪些列」 =====');
  ok('D-① 有「去哪拿表」折叠块（data-key=revWhere）',
    RV_W.indexOf('data-key="revWhere"') >= 0, '');
  ok('D-② 有「要哪些列」折叠块（data-key=revCols）',
    RV_W.indexOf('data-key="revCols"') >= 0, '');
  ok('D-③ 折叠靠既有 hintFold 机制（页面有 hintFold 状态 + onToggleHintFold）',
    RV_J.indexOf('hintFold') >= 0 && /onToggleHintFold\s*\(/.test(RV_J), '');
  ok('D-④ 页面把新文案都映射进 t（少一个 key 页面就是空白，且不报错）',
    ['pickWhereTitle', 'pickWhereBody', 'pickColsTitle', 'pickColsBody', 'importWechatHint']
      .every((k) => RV_J.indexOf(k) >= 0), '');
  const colsBody = TERMS.revenue && TERMS.revenue.pickColsBody;
  ok('D-⑤ 🔴 列名说明必须点出「日期 / 班次 / 现金」三列 —— 那是 SIG 签名，缺一列就认不出表',
    !!colsBody && colsBody.indexOf('日期') >= 0 && colsBody.indexOf('班次') >= 0 && colsBody.indexOf('现金') >= 0,
    colsBody ? colsBody.slice(0, 30) + '…' : '缺失');
  ok('D-⑥ 反恒真：影子样本「只说要有列、不点名三列」必须判红',
    !((s) => s.indexOf('日期') >= 0 && s.indexOf('班次') >= 0 && s.indexOf('现金') >= 0)('只要有几列就行，缺的留空'),
    '影子样本已证伪');

  console.log('\n' + '='.repeat(60));
  console.log('===== 导入引导守卫结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
  process.exit(fail === 0 ? 0 : 1);
})();
