// tools/check_idempotency.js —— 写操作幂等覆盖守卫（R73）
//
// 为什么需要（R73 的发现）：
//   规范 §10 的接口契约表**逐函数**写明了幂等要求（`saveLedger` / `saveAsset` / `saveMaterial` /
//   `saveCostCard` / `syncCostCard` / `savePlan` 六行的鉴权列标 `+幂等`），喂投包 §181 更给出判据
//   「同一 client_request_id 连发两次 → 只产生一条数据」。但**实测 4/6 未实现**：
//     · saveAsset / saveMaterial：新增分支每次 genId() 后 INSERT ⇒ 重复提交产生**重复资产/原料**
//       （saveAsset 的重复资产会让 saveLedger 读台账算摊销时**翻倍** ⇒ M1 利润算错）。
//     · syncCostCard：把 client_request_id **读进变量却从未使用**（死读），每次都 INSERT 新版本 ⇒ 版本连跳。
//     · saveLedger：按 (shop_id, month) upsert，终态天然幂等，但契约要求的校验确实没写。
//   ⇒ 光靠"读代码时留意"抓不住（这几处都"看起来有幂等"：变量读了、键也写了）。本守卫把它机械化。
//
// 判据来源**不是**本文件里手抄的清单，而是**契约文档本身**（单一事实源）：
//   解析 `10_云函数清单与接口契约.md` 中含 `+幂等` 的行 ⇒ 「必须幂等」集合。
//   ⚠️ fail-closed：解析出的集合少于 5 个（= 文档被改动/表格被重排）⇒ **判红**，不许静默放行。
//
// 五条判据：
//   I1 契约解析：`+幂等` 行必须能解析出 ≥5 个函数名（否则红）。
//   I2 契约覆盖：REQUIRED 每个函数必须存在且含幂等调用；目录不存在者必须登记进 NOT_IMPLEMENTED。
//   I3 顺序不变量：幂等预检必须**早于**首个业务写（否则等于没查——写完才查）。
//   I4 登记同源：走重放形态者必须同时用单源 `shopKey()` 造键（两处各自拼串 ⇒ "登记了却查不到"）。
//   I5 全量登记：凡是①有业务写 或 ②声明了 client_request_id 的函数，都必须「有幂等实现」或「在 EXEMPT 登记」。
//   I6 豁免不腐：EXEMPT / NOT_IMPLEMENTED 里的登记若已不成立（函数不存在、或已实现幂等）⇒ 判红，限期清理。
//
// 运行：
//   node tools/check_idempotency.js          # 校验（exit 0/1）
//   node tools/check_idempotency.js --list   # 只列探测到的写操作函数与幂等状态（维护用，不做断言）

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CF = path.join(ROOT, 'cloudfunctions');
const CONTRACT = path.join(ROOT, 'specs/dev-specs/core/10_云函数清单与接口契约.md');

// ===================== 注册表（人工面，逐条写理由）=====================
// I5 用：**有业务写**但契约未要求幂等、且经逐条核验确实不需要的函数。
// ⚠️ 每条都必须给出「为什么重复执行无害」的**机制**理由，不许写"不重要"这种空话 ——
//    I6 会盯着每条登记是否仍然成立（函数已删 或 已有幂等实现 ⇒ 判红限期清理）。
const EXEMPT_WRITE = new Map([
  // ——— 覆盖式写：重复执行终态相同（天然幂等）———
  ['saveShopSetting', '写 shop 名称/备注 + upsert shop_switch 开关值，全部是**覆盖式赋终值**（enabled: kv.enabled）'
    + '⇒ 重复提交终态相同；shop_switch 的 .add 分支仅在行不存在时走，重放时已存在 ⇒ 走 update。契约 §7 未标 +幂等'],
  ['archiveMonth', '只翻转 is_archive 标记（true/false），覆盖式赋终值 ⇒ 重复归档终态相同；'
    + '不会重复插入（第 45 行的 insert 仅在当月账套不存在时走，重放时已存在 ⇒ 走 update）。契约未标 +幂等'],
  ['getShopContext', '读函数，唯一写是「无店铺时自动建档」（if (!shop) 守卫）⇒ **顺序调用天然幂等**（第二次已查到店铺，不再 insert）；'
    + '⚠️ 并发下两个请求可能同时看到"无店铺" ⇒ 双建，属 check-then-act 竞态，与 resolveAuth 自动建档同源（该逻辑现存两处，属既有形态，未在本轮扩大改动面）'],
  ['adminRevokeToken', '把指定管理员的**全部会话删光**（覆盖式终态）⇒ 重复吊销终态相同；契约 §6 未把 +幂等 标在这一行'],
  ['adminLogout', '吊销**当前** token（从会话集合删除）⇒ 重复执行终态相同（已删即 no-op）；'
    + '且第二次请求因 token 已失效会被 adminAuth 挡在门外，本身到不了写路径'],
  ['adminRefreshToken', '**有意非幂等**：每次刷新都要签发**新** token 并立即使旧 token 失效 —— '
    + '若按 client_request_id 重放首次结果，会返回一个"旧 token 已失效"的陈旧 token，反而破坏语义'],

  // ——— 平台/回调类：幂等键不是 client_request_id（契约另有明定）———
  ['payCallback', '契约 §5 明定幂等键 = **全局 transaction_id**（微信支付订单号），非 client_request_id 体系：'
    + 'handleCallback 先 `where({transaction_id: txn})` 查重、命中即返回成功不重复发权益（对应 ORDER_DUPLICATE）。'
    + '本守卫的 5 种形态不覆盖它 ⇒ 登记于此；**换键是契约决定，勿"统一"成 client_request_id**'],
  ['payCreateOrder', '契约 §5 鉴权列 = `user`（未标 +幂等）：重复提交只多一条 status=pending 的流水，'
    + '**不发放任何权益**（权益只由 payCallback 按 transaction_id 发放）⇒ 无数据放大；前端另有 withLock 防连点'],
  ['payRenew', '同上（续费=再建一条 pending 订单）；expire_at 的累加由 payCallback 按 transaction_id 幂等完成'],

  // ——— 环境隔离 / 探针 / 引导：本就不该在 prod 跑 ———
  ['initDb', '仅 dev 生效（env 门禁 + blocked 闸），且灌种子前先查集合是否已初始化 ⇒ 重复执行不产生第二条种子；'
    + 'prod 25 个集合由人工在控制台建，本函数不参与'],
  ['smokeTest', '探针函数：只读写自建的 PROBE 探针集合（探测完自删），**不碰任何业务集合**；仅 dev 手工触发'],
  ['adminInit', '首超管引导（一次性）：靠「已存在首个 super 即拒（ADMIN_ALREADY_INIT）」做天然闸门，'
    + '而非 client_request_id；且仅 dev / 首次运行的 env 门禁下可用'],
  ['adminLogin', '登录是**审计/会话类追加写**：每次登录都该在 admin_login_log 留一条记录（审计语义要求逐次留痕），'
    + 'admin_user 上只更新 last_login_at / 失败计数 ⇒ 重复登录是正常语义，被幂等拦反而是错的'],
]);

// I7 用：源码里给 audit_log 写了**非空** idempotency_key、却从不查重的函数。
// 这类"装饰性幂等键"最危险 —— 看代码像有幂等，实则永不生效（R72 同族）。
const EXEMPT_KEY = new Map([
  ['adminExport', '导出是**只读**动作、无数据变更；after_data 只存 {scope,format,from,to,count}、**不存导出内容** '
    + '⇒ 命中也没有文件可重放；契约 §6 该行鉴权列 = `adminAuth+角色`，未标 +幂等。'
    + '故该 key 仅作**追溯标记**（同一 crid 重复导出会在 audit 留多行，可追溯），不作幂等闸门。'
    + '将来若要做真幂等，须先改 after_data 形态（存 file_url 或结果引用）'],
]);

// 契约已预留、但函数目录尚未交付者。不登记 ⇒ I2 判红。
const NOT_IMPLEMENTED = new Map([
  ['savePlan', '契约 §4 已预留入参含 client_request_id（M2 方案保存/复制），但批次 4 只交付了 calcSandbox，'
    + '函数目录尚不存在 ⇒ 未来实现时**必须自带幂等**，否则本守卫立刻转红'],
]);

// ===================== 工具函数 =====================
// 去注释（保留换行数，便于定位）：块注释按字长替换成空格、行注释裁掉
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
}

// 业务写（**不含**审计写）：写 audit_log 是"留痕"、本就该发生在业务写之后，故不参与顺序判定
const WRITE_TOKENS = ['\\.add\\s*\\(', '\\.update\\s*\\(', '\\.insert\\s*\\(', '\\.remove\\s*\\(', '\\.upsert\\s*\\('];
function findBusinessWrites(clean) {
  const hits = [];
  for (const tok of WRITE_TOKENS) {
    const re = new RegExp(tok, 'g');
    let m;
    while ((m = re.exec(clean))) {
      const before = clean.slice(Math.max(0, m.index - 200), m.index);
      // 只看「当前语句」前缀：回退到最近的 ; 或 } 之后
      const stmt = before.slice(Math.max(before.lastIndexOf(';'), before.lastIndexOf('}')) + 1);
      // 必须是库/适配器接收者 —— 借此排除 Set/Map 的 .add()/.set()（已实测：checkQuota 的 codes.add、exportData 的 latest.set 都是误报源）
      if (/db\.collection\s*\(/.test(stmt) || /\bda\b/.test(stmt) || /\bdoc\s*\(/.test(stmt)) hits.push(m.index);
    }
  }
  return hits.sort((a, b) => a - b);
}

// 单源 `common/idempotency.js` 的五种落地形态：
//   重放形态  findPriorResult(...)      —— 用户侧写操作（命中即返回首次结果）
//   拒绝形态  checkIdempotent(...)      —— 管理员写操作（命中即拒 ADMIN_OP_IDEMPOTENT）
//   注入形态  checkIdempotent: (key)=>… —— 控制器把单源函数注入 service 层
const IDEM_REPLAY = /idempotency\.findPriorResult\s*\(/;
const IDEM_REJECT = /idempotency\.checkIdempotent\s*\(|checkIdempotent\s*:/;
const IDEM_SHOPKEY = /idempotency\.shopKey\s*\(/;

function listFunctions() {
  return fs.readdirSync(CF, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => n !== 'common' && fs.existsSync(path.join(CF, n, 'index.js')))
    .sort();
}

function inspect(fn) {
  const raw = fs.readFileSync(path.join(CF, fn, 'index.js'), 'utf8');
  const clean = stripComments(raw);
  const writes = findBusinessWrites(clean);
  const replay = IDEM_REPLAY.test(clean);
  const reject = IDEM_REJECT.test(clean);
  const shopKey = IDEM_SHOPKEY.test(clean);
  // 注入形态（`checkIdempotent: (key) => …` 作为**对象键**传给 service 层）：
  //   ⚠️ 此时 index.js 里的写操作都包在 deps **闭包**里 —— 它们是"文本在前、执行在后"
  //   （闭包定义处早于 checkIdempotent 那一行，但真正执行发生在 service 调完 checkIdempotent 之后）。
  //   ⇒ 注入形态的"预检早于写"判据必须落在 service.js，不能在 index.js 按文本位置判（会假红，实测 3 例）。
  const injected = /checkIdempotent\s*:/.test(clean);
  const idemIdx = (() => {
    const a = clean.search(IDEM_REPLAY);
    const b = clean.search(IDEM_REJECT);
    const cands = [a, b].filter((x) => x >= 0);
    return cands.length ? Math.min(...cands) : -1;
  })();
  return {
    fn, clean, replay, reject, shopKey, injected,
    writes, idemIdx,
    hasIdem: replay || reject,
    hasCrid: /client_request_id|clientRequestId/.test(clean),
  };
}

// ===================== 契约解析 =====================
function parseRequired() {
  const text = fs.readFileSync(CONTRACT, 'utf8');
  const out = [];
  text.split(/\r?\n/).forEach((ln, i) => {
    if (!ln.includes('+幂等')) return;
    const m = /^\|\s*`([A-Za-z][A-Za-z0-9_]*)`\s*\|/.exec(ln);
    if (m) out.push({ fn: m[1], line: i + 1 });
  });
  return out;
}

// ===================== --list（维护用）=====================
if (process.argv[2] === '--list') {
  const req = parseRequired().map((r) => r.fn);
  console.log(`契约「+幂等」行解析出 ${req.length} 个：${req.join(', ')}`);
  console.log('');
  for (const fn of listFunctions()) {
    const s = inspect(fn);
    if (!s.writes.length && !s.hasCrid) continue;
    const mark = s.hasIdem ? (s.replay ? '重放' : '拒绝') : '——  ';
    console.log(`${fn.padEnd(24)} writes=${String(s.writes.length).padEnd(3)} crid=${s.hasCrid ? 'Y' : 'n'} idem=${mark}`
      + ` req=${req.indexOf(fn) >= 0 ? 'Y' : 'n'}`);
  }
  process.exit(0);
}

// ===================== 断言 =====================
let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

const REQUIRED = parseRequired();
const REQUIRED_SET = new Set(REQUIRED.map((r) => r.fn));
const all = listFunctions();
const info = new Map(all.map((fn) => [fn, inspect(fn)]));

console.log('===== I1 契约解析（fail-closed：解析不到就红）=====');
check('契约表解析出「+幂等」函数 ≥5 个', REQUIRED.length >= 5, `解析到 ${REQUIRED.length} 个：${[...REQUIRED_SET].join(', ')}`);
check('契约解析含全部 5 个已交付函数', ['saveLedger', 'saveAsset', 'saveMaterial', 'saveCostCard', 'syncCostCard']
  .every((f) => REQUIRED_SET.has(f)), `缺：${['saveLedger', 'saveAsset', 'saveMaterial', 'saveCostCard', 'syncCostCard'].filter((f) => !REQUIRED_SET.has(f)).join('、') || '无'}`);

console.log('');
console.log('===== I2 契约覆盖（要求幂等的函数必须真在查重）=====');
for (const { fn, line } of REQUIRED) {
  const s = info.get(fn);
  if (!s) {
    check(`${fn} 未交付但已登记 NOT_IMPLEMENTED（契约 L${line}）`, NOT_IMPLEMENTED.has(fn),
      NOT_IMPLEMENTED.has(fn) ? '已登记' : '目录不存在且未登记 ⇒ 必须补实现或登记');
    continue;
  }
  check(`${fn} 含幂等预检（契约 L${line} 标 +幂等）`, s.hasIdem,
    s.replay ? '重放形态 findPriorResult' : (s.reject ? '拒绝形态 checkIdempotent' : '未检出任何幂等调用'));
}

console.log('');
console.log('===== I3 顺序不变量（预检必须早于首个业务写）=====');
// 分流（实测教训）：内联形态在 index.js 按**文本位置**判（文本序=执行序）；
//   注入形态必须在 service.js 判 —— index.js 里的写都包在 deps 闭包里，按文本位置判会假红 3 例。
// 「写型依赖调用」= `deps.<name>(` 中既非 checkIdempotent、也非 writeAudit（留痕本就在写之后）、
//   也非 read*（读不影响顺序）。
const DEPS_EFFECT = /deps\.(?!checkIdempotent\b|writeAudit\b|read\w*)\w+\s*\(/;
for (const fn of all) {
  const s = info.get(fn);
  if (!s.hasIdem) continue;
  if (s.injected) {
    const sp = path.join(CF, fn, 'service.js');
    check(`${fn} 注入形态的顺序判据落在 service.js`, fs.existsSync(sp),
      fs.existsSync(sp) ? '存在' : 'index.js 用注入形态但 service.js 缺失 ⇒ 无法判顺序，须人工核');
    if (!fs.existsSync(sp)) continue;
    const sclean = stripComments(fs.readFileSync(sp, 'utf8'));
    const chk = sclean.search(/deps\.checkIdempotent\s*\(/);
    const wr = sclean.search(DEPS_EFFECT);
    check(`${fn} 幂等预检早于首个写型依赖调用`, chk >= 0 && (wr < 0 || chk < wr),
      `预检@${chk} vs 首写@${wr}`);
  } else {
    if (!s.writes.length) continue;
    check(`${fn} 幂等预检早于首个业务写`, s.idemIdx >= 0 && s.idemIdx < s.writes[0],
      `预检@${s.idemIdx} vs 首个业务写@${s.writes[0]}`);
  }
}

console.log('');
console.log('===== I4 登记同源（重放形态必须复用单源 shopKey）=====');
for (const fn of all) {
  const s = info.get(fn);
  if (!s.replay) continue;
  check(`${fn} 查重键与登记键同源（用单源 shopKey）`, s.shopKey,
    s.shopKey ? '' : '自己拼了键字符串 ⇒ 两处不一致会静默失效');
}

// 取 `idempotency_key:` 的右值；用于 I7 判「非空（= 本该被查重的）键」
function hasNonEmptyIdemKey(clean) {
  const re = /idempotency_key\s*:\s*([^\n,}]*)/g;
  let m;
  while ((m = re.exec(clean))) {
    const rhs = m[1].trim();
    if (rhs !== '' && !/^(''|""|``)$/.test(rhs)) return true;
  }
  return false;
}

console.log('');
console.log('===== I5 全量登记（有业务写的函数必须有幂等或登记豁免）=====');
for (const fn of all) {
  const s = info.get(fn);
  if (!s.writes.length) continue;   // 只读函数（含仅回显 crid 的 17 个计算/查询类）不在此约束内
  if (s.hasIdem) continue;
  const why = EXEMPT_WRITE.get(fn);
  check(`${fn} 无幂等实现但已登记豁免（含理由）`, typeof why === 'string' && why.length >= 8,
    why ? '已登记' : `writes=${s.writes.length} crid=${s.hasCrid ? 'Y' : 'n'} ⇒ 要么补幂等、要么在 EXEMPT_WRITE 写明理由`);
}

console.log('');
console.log('===== I6 豁免不腐（登记必须仍然成立）=====');
for (const [fn, why] of EXEMPT_WRITE) {
  const s = info.get(fn);
  check(`EXEMPT_WRITE[${fn}] 仍然成立`, !!s && !s.hasIdem && s.writes.length > 0,
    !s ? '函数已不存在 ⇒ 请删除该登记'
      : (s.hasIdem ? '已有幂等实现 ⇒ 请删除该登记（否则护栏名存实亡）'
        : (!s.writes.length ? '已不检出业务写 ⇒ 请删除该登记' : `理由：${String(why).slice(0, 26)}…`)));
}

console.log('');
console.log('===== I7 装饰性幂等键（写了非空 key 却从不查重 ⇒ 该 key 永不生效）=====');
// 背景：adminExport 往 audit_log 写了 `adm_export_<crid>` 却从不查 —— 看代码像有幂等、实则装饰（R72 同族）。
for (const fn of all) {
  const s = info.get(fn);
  if (!hasNonEmptyIdemKey(s.clean)) continue;
  if (s.hasIdem) continue;
  const why = EXEMPT_KEY.get(fn);
  check(`${fn} 写了非空 idempotency_key 却无查重 ⇒ 已登记理由`, typeof why === 'string' && why.length >= 8,
    why ? '已登记' : '装饰性幂等键 ⇒ 要么补查重、要么在 EXEMPT_KEY 写明理由');
}
for (const [fn, why] of EXEMPT_KEY) {
  const s = info.get(fn);
  check(`EXEMPT_KEY[${fn}] 仍然成立`, !!s && !s.hasIdem,
    !s ? '函数已不存在 ⇒ 请删除该登记' : (s.hasIdem ? '已有幂等实现 ⇒ 请删除该登记' : `理由：${String(why).slice(0, 26)}…`));
}

for (const [fn] of NOT_IMPLEMENTED) {
  check(`NOT_IMPLEMENTED[${fn}] 仍然成立`, !info.has(fn),
    info.has(fn) ? '函数已交付 ⇒ 请移出该登记并确认其幂等' : '仍未交付');
}

console.log(`\n===== 幂等覆盖守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
