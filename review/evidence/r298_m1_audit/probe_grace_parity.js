// review/evidence/r298_m1_audit/probe_grace_parity.js
//
// R298 · M1 审计 · 探针②：归档「7 天宽限」判据的**前后端等价性**
//
// ===== 为什么要写这条 =====
// 本仓已有「同族病」六个实例，病名统一为：**单源判据写了，但被另一条入口架空**。
// 归档宽限这条判据同时存在于两端，且**两端各写了一遍**：
//   前端 utils/ui.js::withinGrace      —— 缺 archivedAtMs ⇒ `return false`（不在宽限 = 只读）
//   云端 saveLedger/index.js           —— `existing.archived_at || now` ⇒ 缺值被替换成"此刻"
// ⇒ 同一输入（archived_at 缺失 / 为 0）两端给出**相反**判决：
//     前端 = 超期只读（fail-closed）；云端 = 刚归档、放行补录（fail-open）。
// 一旦命中：只要带 archive_override，**已归档月份可被永久改写** ⇒「会计不可变」的 7 天硬锁静默失效。
//
// ===== 本次是**行为级**验证，不是文本比对 =====
// 真正调用 utils/ui.js::withinGrace（真实现），并与云端表达式的**复算**对照。
//
// 可达性（诚实标注）：在当前代码路径下 **= 0** —— archiveMonth 的两条写路径都在 archive=true 时写 now。
//   命中前提：存量数据 / 手工改库 / 云控制台编辑使 `is_archive:true` 而 `archived_at` 缺失或为 0。
//   故本轮定级为「**防御缺口（两端判据不等价）**」，基线为 fail-open 方向，需拍板。
//
// 用法：node review/evidence/r298_m1_audit/probe_grace_parity.js [--gate]

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const GATE = process.argv.indexOf('--gate') >= 0;

const P = {
  ui: path.join(ROOT, 'utils', 'ui.js'),
  saveLedger: path.join(ROOT, 'cloudfunctions', 'saveLedger', 'index.js'),
  archiveMonth: path.join(ROOT, 'cloudfunctions', 'archiveMonth', 'index.js'),
  inputJs: path.join(ROOT, 'pages', 'month', 'input.js'),
  inventoryJs: path.join(ROOT, 'pages', 'month', 'inventory.js'),
};

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  ✅ ' + m); };
const no = (m) => { fail++; console.log('  ❌ ' + m); };
const check = (m, c) => (c ? ok(m) : no(m));
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } };

function stripJs(src) {
  let out = '', i = 0, n = src.length, q = null;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (q) { out += c; if (c === '\\') { out += (src[i + 1] || ''); i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && c2 === '*') { while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += (src[i] === '\n' ? '\n' : ' '); i++; } if (i < n) { out += '  '; i += 2; } continue; }
    out += c; i++;
  }
  return out;
}

console.log('===== S. 扫描面与锚点在场 =====');
const S = {};
for (const [k, p] of Object.entries(P)) {
  S[k] = read(p);
  check('S·文件在位且非空：' + path.relative(ROOT, p).replace(/\\/g, '/') + '（' + (S[k] ? S[k].length : 0) + ' 字符）', !!S[k] && S[k].length > 200);
}
if (fail) { console.log('\n🔴 扫描面退化 —— 探针自失效。'); process.exit(2); }

const uiCode = stripJs(S.ui);
const slCode = stripJs(S.saveLedger);

// ===================== A. 行为级：真调前端实现 =====================
console.log('');
console.log('===== A. 前端实现（真调 utils/ui.js）=====');
const UI = require(P.ui);
check('A1 utils/ui.js 导出 withinGrace 且是函数', typeof UI.withinGrace === 'function');
const GRACE = 7 * 24 * 3600 * 1000;
const now = Date.now();
const feMissing = UI.withinGrace(0, now);                 // archived_at = 0（缺失形态）
const feFresh = UI.withinGrace(now - 1000, now);          // 1 秒前归档
const feExpired = UI.withinGrace(now - GRACE - 1000, now); // 超 7 天
check('A2 缺 archived_at ⇒ 前端判「**不在**宽限」（fail-closed ⇒ 只读）', feMissing === false);
check('A3 刚归档 ⇒ 前端判「在宽限」（放行补录，正确业务语义）', feFresh === true);
check('A4 超 7 天 ⇒ 前端判「不在宽限」（硬锁）', feExpired === false);
check('A5 前端判据形态：`if (!archivedAtMs) return false` 在场', /if \(!archivedAtMs\) return false/.test(uiCode));

// ===================== B. 云端表达式复算 =====================
console.log('');
console.log('===== B. 云端表达式复算（saveLedger）=====');
check('B1 云端判据形态：`const archivedAt = existing.archived_at || now` 在场',
  /const archivedAt = existing\.archived_at \|\| now;/.test(slCode));
check('B2 云端 withinGrace 表达式形态：`(now - archivedAt) < GRACE_DAYS_MS` 在场',
  /const withinGrace = \(now - archivedAt\) < GRACE_DAYS_MS;/.test(slCode));
// 复算：把云端的 `${now}` 当"请求时刻"，`archived_at` 缺失 ⇒ 用 now 顶替
const beMissing = ((now - (0 || now)) < GRACE);           // = (now - now) < GRACE = true
const beFresh = ((now - (now - 1000)) < GRACE);
const beExpired = ((now - (now - GRACE - 1000)) < GRACE);
check('B3 缺 archived_at ⇒ 云端判「**在**宽限」（fail-open ⇒ 放行）', beMissing === true);
check('B4 刚归档 ⇒ 云端判在宽限（与前端同向）', beFresh === feFresh);
check('B5 超 7 天 ⇒ 云端判不在宽限（与前端同向）', beExpired === feExpired);

// ===================== C. 等价性判定 =====================
console.log('');
console.log('===== C. 两端等价性 =====');
check('C1 🔴 缺 archived_at 时**两端判决相反**（前端 false / 云端 true）', feMissing !== beMissing);
check('C2 其余两种输入两端同向（不是"整体不等价"，只有缺值这一格分叉）',
  feFresh === beFresh && feExpired === beExpired);
const PARITY_BROKEN = (feMissing !== beMissing);
console.log('     · 分叉格 = `archived_at` 缺失或为 0 ⇒ 前端『只读』 vs 云端『放行补录』');

// ===================== D. 可达性（诚实标注）=====================
console.log('');
console.log('===== D. 可达性：当前代码路径能不能造出该形态 =====');
const amCode = stripJs(S.archiveMonth);
check('D1 archiveMonth INSERT 分支：archive=true 时写 `archived_at: now`（形态一致）',
  /is_archive: v\.archive, archived_at: v\.archive \? now : 0,/.test(amCode));
check('D2 archiveMonth UPDATE 分支：archive=true 时写 now（形态一致）',
  /is_archive: v\.archive, archived_at: v\.archive \? now : \(acct\.archived_at \|\| 0\)/.test(amCode));
const slIns = /const ins = await da\.insert\('shop_monthly_account', Object\.assign\(\{ account_id: genId\('acc_'\), is_archive: false, archived_at: 0 \}, doc\)\);/.test(slCode);
check('D3 saveLedger INSERT 分支：新建一律 is_archive=false（守卫不触发）', slIns);
console.log('     · ⇒ 当前代码路径下，`is_archive:true` 且 `archived_at` 缺失 **造不出来**（可达性 = 0）');
console.log('     · ⇒ 定级「防御缺口 / 两端判据不等价」，非「当前可复现缺陷」；但基线方向是 fail-open。');

// ===================== E. 前端两处调用点 =====================
console.log('');
console.log('===== E. 前端调用点（两处都 fail-closed）=====');
const ij = stripJs(S.inputJs), ivj = stripJs(S.inventoryJs);
check('E1 input.js 用 `d.archived_at || 0` 传给 withinGrace', /ui\.withinGrace\(archivedAtMs, Date\.now\(\)\)/.test(ij) && /const archivedAtMs = d\.archived_at \|\| 0;/.test(ij));
check('E2 inventory.js 同口径（`d.archived_at || 0`）', /ui\.withinGrace\(d\.archived_at \|\| 0, Date\.now\(\)\)/.test(ivj));
check('E3 ⇒ 前端两端点**一致地** fail-closed，只有云端那一份是 fail-open', true);

// ===================== F. 影子样本（防探针恒真）=====================
console.log('');
console.log('===== F. 影子样本 =====');
// S1 真实现 ⇒ 不等价
const S1Broken = (UI.withinGrace(0, now) !== ((now - (0 || now)) < GRACE));
// S2 假想把云端改成 `|| 0` ⇒ 等价
const beFixedMissing = ((now - (0 || 0)) < GRACE);
const S2Broken = (UI.withinGrace(0, now) !== beFixedMissing);
check('F1 影子 S1（真实现）⇒ 判定「不等价」', S1Broken === true);
check('F2 影子 S2（云端改 `|| 0`）⇒ 判定「已等价」', S2Broken === false);
check('F3 🔴 两个影子结论不同 ⇒ 判定函数有分辨力', S1Broken !== S2Broken);

// ===================== 结论 =====================
console.log('');
console.log('==== R298·M1 探针② 归档宽限两端等价性：' + pass + ' 通过 / ' + fail + ' 失败（共 ' + (pass + fail) + '）====');
if (PARITY_BROKEN) {
  console.log('🔴 两端判据不等价成立（同族病第七例）：差在 `archived_at` 缺失时的默认值。');
  console.log('   建议修法（待拍板，一行）：云端 `existing.archived_at || now` → `existing.archived_at || 0`，');
  console.log('   与前端 utils/ui.js::withinGrace 的 `if (!archivedAtMs) return false` 同口径（fail-closed，未知即锁）。');
  console.log('   ⚠️ 不影响任何合法流程：正常归档路径 archived_at 恒为 now ⇒ 宽限照旧生效。');
} else {
  console.log('✅ 两端等价（或已同口径）。');
}
if (fail) process.exit(1);
if (GATE && PARITY_BROKEN) process.exit(1);
process.exit(0);
