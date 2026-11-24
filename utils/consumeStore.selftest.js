// utils/consumeStore.selftest.js —— 核查数据持久化（云存储 JSON）纯函数 + 降级
// 运行： node utils/consumeStore.selftest.js
//
// 🔴 本文件守的是「**坏数据不能让页面白屏**」：云端文件可能被手工改坏、可能是旧版本、可能被截断。
//   所以 parsePayload 必须容错返回 null，而不是抛异常。
// ⚠️ 真实上传/下载要真机验（wx.cloud 在 node 里没有），这里只证「没网/没云时能降级」。

const { cloudPathOf, payloadOf, parsePayload, saveCloud, loadCloud, SCHEMA_VERSION } = require('./consumeStore.js');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? '  (' + detail + ')' : '')); }
}

// ===== 1) 路径生成 =====
{
  check('cloudPathOf 正常：按店按月', cloudPathOf('shop_abc', '2026-11') === 'consume_check/shop_abc/2026-11.json',
    cloudPathOf('shop_abc', '2026-11'));
  // 安全：路径注入必须被清理。`../../etc` 里的 `.` 和 `/` 都被滤掉 ⇒ 剩 `etc`，
  //   路径仍是 `consume_check/etc/...`（**仍在自有前缀下，跳不出去**）。
  //   判据要盯「能不能跳出 consume_check/」，而不是盯「结果里有没有 etc 字样」。
  const evil = cloudPathOf('../../etc', '2026-11');
  check('cloudPathOf 防路径注入（结果必须仍在 consume_check/ 下且无 ..）',
    evil.indexOf('consume_check/') === 0 && evil.indexOf('..') < 0, evil);
  check('cloudPathOf 缺参数 ⇒ 空串（调用方据此不发起请求）',
    cloudPathOf('', '2026-11') === '' && cloudPathOf('shop_a', '') === '');
  check('cloudPathOf 月份里的非数字被清干净', cloudPathOf('s1', '2026-11/../x') === 'consume_check/s1/2026-11.json',
    cloudPathOf('s1', '2026-11/../x'));
}

// ===== 2) 组装 =====
{
  const p = payloadOf('2026-11', 8000.7, [
    { material_id: 'm1', opening_qty: '5', purchase_qty: 95, closing_qty: 8, purchase_amount_fen: 171000 },
    { material_id: '', opening_qty: 1, purchase_qty: 1, closing_qty: 1 },   // 无 id ⇒ 必须被过滤
  ]);
  check('payloadOf 带版本号', p.v === SCHEMA_VERSION);
  check('payloadOf 金额取整（8000.7 → 8001）', p.nonsalesFen === 8001, '=' + p.nonsalesFen);
  check('payloadOf 过滤掉没有 material_id 的行', p.items.length === 1, '=' + p.items.length);
  check('payloadOf 字符串数量转成数字', p.items[0].opening_qty === 5, typeof p.items[0].opening_qty);
  check('payloadOf 金额为负 ⇒ 归零（不允许负采购额）',
    payloadOf('2026-11', -100, []).nonsalesFen === 0);
}

// ===== 3) 解析容错（本模块最要紧的一组）=====
{
  check('parsePayload 空串 ⇒ null', parsePayload('') === null);
  check('parsePayload 非字符串 ⇒ null', parsePayload(null) === null && parsePayload({}) === null);
  check('parsePayload 坏 JSON ⇒ null（不抛）', parsePayload('{坏掉了') === null);
  check('parsePayload 数组 ⇒ null（不是我们要的对象）', parsePayload('[1,2]') === null);
  check('parsePayload 版本不认识 ⇒ null（宁可重填，不拿错结构算钱）',
    parsePayload(JSON.stringify({ v: 999, month: '2026-11' })) === null);

  const ok = parsePayload(JSON.stringify({
    v: 1, month: '2026-11', nonsalesFen: 8000, updatedAt: 1690000000000,
    items: [{ material_id: 'm1', opening_qty: 5, purchase_qty: 95, closing_qty: 8, purchase_amount_fen: 171000 }],
  }));
  check('parsePayload 正常数据解析正确',
    ok && ok.month === '2026-11' && ok.nonsalesFen === 8000 && ok.items.length === 1 && ok.items[0].purchase_qty === 95);
  check('parsePayload 缺 items ⇒ 空数组（不崩）',
    parsePayload(JSON.stringify({ v: 1, month: '2026-11' })).items.length === 0);
  check('parsePayload 字段类型错乱也能兜住（NaN ⇒ 0）',
    parsePayload(JSON.stringify({ v: 1, month: '2026-11', nonsalesFen: 'abc', items: [{ material_id: 'm1', purchase_qty: 'x' }] }))
      .items[0].purchase_qty === 0);
}

// ===== 4) 降级：没有 wx.cloud 时不崩、不阻塞页面 =====
(async () => {
  // node 环境本来就没有 wx
  const s = await saveCloud('shop_a', '2026-11', payloadOf('2026-11', 0, []));
  check('无 wx 环境：saveCloud 返回 ok=false 而不是抛',
    s && s.ok === false && typeof s.reason === 'string', s && s.reason);
  const l = await loadCloud('shop_a', '2026-11');
  check('无 wx 环境：loadCloud 返回 null（页面降级用本地）', l === null);

  // 桩一个会失败的 wx.cloud：仍然不许抛
  global.wx = {
    env: { USER_DATA_PATH: '/tmp' },
    getFileSystemManager: () => ({ writeFileSync: () => {}, unlinkSync: () => {}, readFileSync: () => '' }),
    cloud: {
      uploadFile: () => Promise.reject(new Error('network down')),
      getTempFileURL: () => Promise.reject(new Error('network down')),
    },
    downloadFile: () => {},
  };
  const s2 = await saveCloud('shop_a', '2026-11', payloadOf('2026-11', 0, []));
  check('云端上传失败：saveCloud 返回 ok=false（不抛、不打扰老板）', s2.ok === false, s2.reason);
  const l2 = await loadCloud('shop_a', '2026-11');
  check('云端下载失败：loadCloud 返回 null', l2 === null);
  delete global.wx;

  // ===== 5) 🔴 页面接线断言：数据必须真的上云，不能只写本地 =====
  //   这几条守的是「功能被悄悄改回纯本地」——那种改动页面照跑、门禁照绿，
  //   只有老板换手机时才发现数据没了。
  {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'subpkg/tools/recon/index.js'), 'utf8');

    check('接线：对账页 require 了 consumeStore',
      /require\(['"][^'"]*consumeStore\.js['"]\)/.test(src));
    check('接线：init 里调用 syncFromCloud（进页面就同步一次）',
      /syncFromCloud\(cur\)/.test(src));
    check('接线：填非销售耗用后 schedulePush（防抖上传）',
      /onNonsales\(e\)\s*\{[\s\S]{0,800}?schedulePush\(/.test(src));
    check('接线：填原料盘点后 schedulePush', /this\.schedulePush\(month\)/.test(src));
    check('接线：上传按店隔离（走 ss.currentShopId）',
      /pushToCloud\(month\)\s*\{[\s\S]{0,300}?ss\.currentShopId\(\)/.test(src));
    // 🔴 关键：上传不能放在 `if (!raw) return` 后面，否则没缓存时数据就不存了
    const mQty = /onMatQty\(e\)\s*\{[\s\S]*?\n  \}/.exec(src);
    check('接线：schedulePush 在 `if (!raw) return` 之前（上传与渲染解绑）',
      !!mQty && mQty[0].indexOf('schedulePush') < mQty[0].indexOf('if (!raw) return'),
      mQty ? ('push@' + mQty[0].indexOf('schedulePush') + ' / return@' + mQty[0].indexOf('if (!raw) return')) : '未找到 onMatQty');
    // 反恒真：若把 schedulePush 从 onMatQty 删掉，上面那条必须红（此处直接验判据有分辨力）
    const broken = src.replace(/    this\.schedulePush\(month\);\n/, '');
    check('反恒真：删掉 schedulePush 后判据会失效（证明不是空转）',
      broken.indexOf('this.schedulePush(month)') < 0, '变异已定位');
  }

  // ⚠️ 这条必须放在汇总行**之前** —— 门禁 R69 要求末行是「N 通过 / M 失败」，
  //   汇总行后面再打印任何东西都会被判"输出未走完收尾"（初版就是这样红的）。
  console.log('⚠️ 真实上传/下载（wx.cloud.uploadFile / getTempFileURL）只能在真机验，node 里无 wx.cloud。');
  console.log('\n==== 核查数据持久化自测：' + pass + ' 通过 / ' + failN + ' 失败 ====');
  process.exit(failN === 0 ? 0 : 1);
})();
