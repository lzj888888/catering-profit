// tools/check_preload_rule.js —— app.json 分包预下载（preloadRule）配置守卫（R469 · 队列 #49）
// 运行： node tools/check_preload_rule.js    （EXIT 0 = 全绿）
//
// 为什么需要这道守卫（漂移是静默的）：
//   `preloadRule` 是"用户进到某个页面时，框架**顺便**把某个分包下下来"的配置。它写错时的表现是：
//     什么都没有发生 —— 不报错、不告警、页面照常能进（只是第一次进去时慢慢等下载）。
//   三种最常见的写错方式，全部属于"改页面路径/加分包时的顺手漏改"，全部静默：
//     · 页面搬家后 key 没跟着改（例：`pages/m3/hub` 被移进 `subpkg/tools`）⇒ 规则永远不触发；
//     · 分包改名后 `packages` 没跟着改（`subpkg/tool` / `subpkg/biz2`）⇒ 预下载永远不执行；
//     · 字段名写错（`package` 单数 / `netWork`）⇒ 微信按未知字段忽略 ⇒ 整条规则失效。
//   2026-10-24 R463 巡检实测：`grep -rn preloadRule` 全仓只命中 `app.json` 与文档，`tools/**` 零引用；
//   R459 曾做过一次合法性校验，但那是一次性 `node -e`，没沉淀成判据 ⇒ 下一个人改配置时无人守。
//   这与"配置当机器键"是同族病：配置项与代码里的路径分居两处，编译期对不上不报错。
//
// 判据分五层（A/B/C/D 为检查面，E 为自失效护栏）：
//   A 页面对照：每个规则的 key 必须是**已声明页面**（主包 pages ∪ 分包 root+page），且形态合法；
//   B 分包对照：每个 `packages` 项必须是**某个分包的 root**；数组非空；规则键名只允许官方两个字段；
//   C 网络条件：`network` 缺省合法（官方默认 all），出现则必须 ∈ {all, wifi}；
//   D 语义有效：规则不得预载 key **自身所在的那个分包**（页面搬进分包后规则变成空转）；
//   E 自失效护栏：扫描面非退化（页面≥20 / 分包≥2 / 规则≥1）+ 四组合成负样本证明 A~D 判据不恒真。
//
// ⚠️ 本文件不用正则（本机会把反斜杠转成斜杠 ⇒ 落盘即语法错），一律 indexOf + slice。
(function () {
  const fs = require('fs');
  const path = require('path');

  const ROOT = path.resolve(__dirname, '..');
  const APP = path.join(ROOT, 'app.json');

  let pass = 0, fail = 0;
  const bad = [];
  function check(name, cond, detail) {
    if (cond) { pass++; console.log('✅ ' + name + (detail ? ' · ' + detail : '')); }
    else { fail++; bad.push(name); console.log('❌ ' + name + (detail ? ' · ' + detail : '')); }
  }

  const ALLOWED_RULE_KEYS = ['packages', 'network'];
  const ALLOWED_NETWORK = ['all', 'wifi'];
  const MIN_PAGES = 20;
  const MIN_PACKAGES = 2;

  // —— 声明面：主包 pages + 分包 root/pages ——
  function collectDeclared(app) {
    const mainPages = Array.isArray(app.pages) ? app.pages.slice() : [];
    const sps = Array.isArray(app.subpackages) ? app.subpackages
      : (Array.isArray(app.subPackages) ? app.subPackages : []);
    const roots = [];
    const subPages = [];
    for (const sp of sps) {
      let root = String((sp && sp.root) || '');
      while (root.length > 0 && root.charAt(root.length - 1) === '/') root = root.slice(0, root.length - 1);
      roots.push(root);
      const pages = (sp && Array.isArray(sp.pages)) ? sp.pages : [];
      for (const p of pages) subPages.push({ root: root, page: root ? root + '/' + p : String(p) });
    }
    const all = new Set(mainPages);
    for (const s of subPages) all.add(s.page);
    return { mainPages: mainPages, roots: roots, subPages: subPages, all: all };
  }

  // —— 判据本体：抽成纯函数，才能用合成样本证明它不恒真 ——
  // 返回 problems：{ leg: 'A'|'B'|'C'|'D', msg }
  function analyze(app) {
    const problems = [];
    const d = collectDeclared(app);
    const rule = app && app.preloadRule;
    if (rule === undefined || rule === null) {
      problems.push({ leg: 'E', msg: 'app.json 里没有 preloadRule（若是有意取消预下载，请在本守卫里登记理由）' });
      return { problems: problems, declared: d, rules: [] };
    }
    if (typeof rule !== 'object' || Array.isArray(rule)) {
      problems.push({ leg: 'A', msg: 'preloadRule 必须是对象（页面路径 → 规则）' });
      return { problems: problems, declared: d, rules: [] };
    }
    const keys = Object.keys(rule);
    // 空对象与"没有 preloadRule"同义：0 条规则时 A~D 全部恒真 ⇒ 必须由 E 显式判红，
    // 否则下一个人把配置整体删掉/清空，门禁照旧全绿。
    if (keys.length === 0) {
      problems.push({ leg: 'E', msg: 'preloadRule 存在但 0 条规则（若是有意取消预下载，请在本守卫里登记理由）' });
    }

    for (const key of keys) {
      const r = rule[key];

      // A-①：key 必须是已声明页面
      if (!d.all.has(key)) {
        problems.push({ leg: 'A', msg: '规则 key "' + key + '" 不是已声明页面（页面搬家/改名后未同步 ⇒ 规则永不触发）' });
      }
      // A-②：key 形态（官方要 pagePath，不带前导 /、不带 .js）
      if (key.charAt(0) === '/' || key.indexOf('.js') >= 0 || key.indexOf('//') >= 0) {
        problems.push({ leg: 'A', msg: '规则 key "' + key + '" 形态不合法（应形如 pages/index/index，不带前导 / 与 .js）' });
      }

      if (!r || typeof r !== 'object' || Array.isArray(r)) {
        problems.push({ leg: 'B', msg: '规则 "' + key + '" 的取值必须是对象' });
        continue;
      }

      // B-③：字段名只允许官方两个 —— 写错（package 单数 / netWork）会被静默忽略
      const rk = Object.keys(r);
      for (const k of rk) {
        if (ALLOWED_RULE_KEYS.indexOf(k) < 0) {
          problems.push({ leg: 'B', msg: '规则 "' + key + '" 有未知字段 "' + k + '"（官方只认 packages / network ⇒ 写错即静默失效）' });
        }
      }
      if (rk.indexOf('packages') < 0) {
        problems.push({ leg: 'B', msg: '规则 "' + key + '" 缺 packages（这条规则什么都不会下载）' });
      }

      // B-②：packages 必须是非空字符串数组
      const pk = r.packages;
      if (pk !== undefined) {
        if (!Array.isArray(pk) || pk.length === 0) {
          problems.push({ leg: 'B', msg: '规则 "' + key + '" 的 packages 必须是非空数组' });
        } else {
          const seen = {};
          for (const item of pk) {
            if (typeof item !== 'string' || item.length === 0) {
              problems.push({ leg: 'B', msg: '规则 "' + key + '" 的 packages 含非字符串项' });
              continue;
            }
            // B-①：必须是某个分包的 root
            if (d.roots.indexOf(item) < 0) {
              problems.push({ leg: 'B', msg: '规则 "' + key + '" 预载 "' + item + '"，但它不是任何分包的 root（分包改名后未同步 ⇒ 永不预下载）' });
            }
            if (seen[item]) {
              problems.push({ leg: 'B', msg: '规则 "' + key + '" 重复预载 "' + item + '"' });
            }
            seen[item] = true;
          }
        }
      }

      // C-①：network 缺省合法（默认 all），出现则必须在白名单内
      if (r.network !== undefined && ALLOWED_NETWORK.indexOf(r.network) < 0) {
        problems.push({ leg: 'C', msg: '规则 "' + key + '" 的 network="' + String(r.network) + '"，官方只认 all / wifi（写错即静默按默认值走）' });
      }

      // D-①：不得预载 key 自己所在的分包（页面搬进分包后，这条规则变成空转）
      const own = d.subPages.filter(function (s) { return s.page === key; });
      if (own.length > 0 && Array.isArray(pk) && pk.indexOf(own[0].root) >= 0) {
        problems.push({ leg: 'D', msg: '规则 "' + key + '" 预载了自己所在的分包 "' + own[0].root + '"（进该页时分包本来就得下载 ⇒ 规则空转，疑似页面搬家后未复核）' });
      }
    }
    return { problems: problems, declared: d, rules: keys };
  }

  function legsOf(res, leg) {
    return res.problems.filter(function (p) { return p.leg === leg; });
  }
  function describe(list) {
    return list.map(function (p) { return p.msg; }).join(' ; ');
  }

  // —— 真读 app.json（解析失败即 fail-closed）——
  let app = null;
  try {
    app = JSON.parse(fs.readFileSync(APP, 'utf8'));
  } catch (e) {
    console.log('❌ 读不到或解析不了 app.json：' + e.message);
    process.exit(1);
  }

  const res = analyze(app);
  const d = res.declared;

  console.log('\n===== A · 页面对照（key 是不是真页面）=====');
  const aBad = legsOf(res, 'A');
  check('A-① 每条规则的 key 都是已声明页面（主包 ' + d.mainPages.length + ' 页 + 分包 ' + d.subPages.length + ' 页）',
    aBad.filter(function (p) { return p.msg.indexOf('不是已声明页面') >= 0; }).length === 0,
    aBad.length ? describe(aBad) : res.rules.length + ' 条规则：' + res.rules.join(' / '));
  check('A-② key 形态合法（不带前导 /、不带 .js）',
    aBad.filter(function (p) { return p.msg.indexOf('形态不合法') >= 0; }).length === 0,
    aBad.filter(function (p) { return p.msg.indexOf('形态不合法') >= 0; }).length === 0 ? '形态全部合法' : describe(aBad));

  console.log('\n===== B · 分包对照（packages 是不是真分包）=====');
  const bBad = legsOf(res, 'B');
  check('B-① 每个 packages 项都是某个分包的 root（现 ' + d.roots.length + ' 个分包：' + d.roots.join(' / ') + '）',
    bBad.filter(function (p) { return p.msg.indexOf('不是任何分包的 root') >= 0; }).length === 0,
    bBad.length ? describe(bBad) : '全部命中');
  check('B-② 每条规则的 packages 都是非空字符串数组、无重复项',
    bBad.filter(function (p) { return p.msg.indexOf('非空数组') >= 0 || p.msg.indexOf('非字符串') >= 0 || p.msg.indexOf('重复预载') >= 0; }).length === 0,
    bBad.length ? describe(bBad) : '全部合法');
  check('B-③ 规则字段名只允许官方两个（packages / network），且必须含 packages',
    bBad.filter(function (p) { return p.msg.indexOf('未知字段') >= 0 || p.msg.indexOf('缺 packages') >= 0; }).length === 0,
    bBad.length ? describe(bBad) : '键名全部合法');

  console.log('\n===== C · 网络条件 =====');
  const cBad = legsOf(res, 'C');
  check('C-① network 缺省合法（官方默认 all），出现时必须 ∈ {all, wifi}',
    cBad.length === 0, cBad.length ? describe(cBad) : '无非法取值');

  console.log('\n===== D · 语义有效（不得预载自己所在的包）=====');
  const dBad = legsOf(res, 'D');
  check('D-① 没有「预载自己所在分包」的空转规则（页面搬进分包后的典型残留）',
    dBad.length === 0, dBad.length ? describe(dBad) : '无空转规则');

  console.log('\n===== E · 自失效护栏（证明上面的判据不是恒真）=====');
  const pageTotal = d.all.size;
  const ruleCount = res.rules.length;
  check('E-① 扫描面非退化：声明页面 ≥ ' + MIN_PAGES + ' 且分包 ≥ ' + MIN_PACKAGES + ' 且规则 ≥ 1',
    pageTotal >= MIN_PAGES && d.roots.length >= MIN_PACKAGES && ruleCount >= 1,
    '页面 ' + pageTotal + ' / 分包 ' + d.roots.length + ' / 规则 ' + ruleCount);
  check('E-② 配置真被读到（规则数与 app.json 实读一致，防路径写错导致恒绿）',
    ruleCount === Object.keys(app.preloadRule || {}).length && ruleCount > 0,
    '读到 ' + ruleCount + ' 条');

  const clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  const negKey = clone(app);
  const firstKey = res.rules[0];
  negKey.preloadRule['pages/__not_exist__/index'] = negKey.preloadRule[firstKey];
  delete negKey.preloadRule[firstKey];
  const negKeyRes = analyze(negKey);
  check('E-③ 合成负样本：把 key 改成不存在的页面 ⇒ A-① 必须转红（判据非恒真）',
    legsOf(negKeyRes, 'A').some(function (p) { return p.msg.indexOf('不是已声明页面') >= 0; }),
    'neg A 命中 ' + legsOf(negKeyRes, 'A').length + ' 条');

  const negPack = clone(app);
  const negKey2 = Object.keys(negPack.preloadRule)[0];
  negPack.preloadRule[negKey2].packages = ['subpkg/__not_exist__'];
  const negPackRes = analyze(negPack);
  check('E-④ 合成负样本：把包名改成不存在的分包 ⇒ B-① 必须转红',
    legsOf(negPackRes, 'B').some(function (p) { return p.msg.indexOf('不是任何分包的 root') >= 0; }),
    'neg B 命中 ' + legsOf(negPackRes, 'B').length + ' 条');

  const negNet = clone(app);
  const negKey3 = Object.keys(negNet.preloadRule)[0];
  negNet.preloadRule[negKey3].network = '3g';
  const negNetRes = analyze(negNet);
  check('E-⑤ 合成负样本：network 写 "3g" ⇒ C-① 必须转红（官方只认 all / wifi，写错静默按默认）',
    legsOf(negNetRes, 'C').length > 0, 'neg C 命中 ' + legsOf(negNetRes, 'C').length + ' 条');

  // 合成一条"页面已搬进分包、规则没撤"的自包预载
  const rootForSelf = d.roots[0];
  const selfPage = d.subPages.filter(function (s) { return s.root === rootForSelf; })[0];
  if (selfPage) {
    const negSelf = clone(app);
    negSelf.preloadRule[selfPage.page] = { network: 'wifi', packages: [rootForSelf] };
    const negSelfRes = analyze(negSelf);
    check('E-⑥ 合成负样本：分包页预载自己所在的分包 ⇒ D-① 必须转红',
      legsOf(negSelfRes, 'D').length > 0, 'neg D 命中 ' + legsOf(negSelfRes, 'D').length + ' 条');
  } else {
    check('E-⑥ 合成负样本：分包页预载自己所在的分包 ⇒ D-① 必须转红', false,
      '取不到分包页样本（' + rootForSelf + ' 下无页面）⇒ 该判据无法验证');
  }

  const negEmpty = clone(app);
  negEmpty.preloadRule = {};
  const negEmptyRes = analyze(negEmpty);
  // ⚠️ 这里**只**认 negEmptyRes —— 首版写成 `negEmptyRes.length > 0 || res.length > 0`，
  //    那样真配置一旦有问题就恒真，等于这条护栏自己没被验证。
  check('E-⑦ 合成负样本：规则全删空 ⇒ 不得静默全绿（"0 条规则"必须显式判红，避免下一个人删配置无人知）',
    negEmptyRes.problems.length > 0,
    '空规则问题数 ' + negEmptyRes.problems.length);

  console.log('\n===== preloadRule 配置守卫结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
  if (fail) bad.forEach(function (b) { console.log('   ❌ ' + b); });
  process.exit(fail === 0 ? 0 : 1);
})();
