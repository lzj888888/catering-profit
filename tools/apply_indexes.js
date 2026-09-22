#!/usr/bin/env node
/**
 * tools/apply_indexes.js —— 把「单源索引定义」批量建到微信云开发环境（走官方 HTTP API）。
 *
 * ⚠️ 本文件的存在本身就是一条**结论更正**（2026-09-17 实测）：
 *   在案结论「wx-server-sdk 无 createIndex ⇒ 索引只能靠人在控制台一条条填」**只对了一半**。
 *   - 对的一半：wx-server-sdk@2.6.3 确实没有建索引方法（已双验证：index.js 全包零命中 createIndex；
 *     index.d.ts 里 Collection 只有 add/where/orderBy/get/update/remove/aggregate…，无任何索引方法）。
 *   - 错的一半：**「只能手工」是假的**（**已证伪** · 2026-09-17）。官方 HTTP API 提供
 *       POST https://api.weixin.qq.com/tcb/updateindex?access_token=ACCESS_TOKEN
 *     参数 { env, collection_name, create_indexes:[{name,unique,keys:[{name,direction}]}], drop_indexes:[] }
 *     文档：https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloud/reference-http-api/database/updateIndex
 *   ⇒ 索引可以**脚本化、幂等、可回读校验**地批量创建。
 *
 * 项目纪律在本文件里的落点：
 *   1. 索引清单**只从单源** cloudfunctions/initDb/collections.js 派生（require 它，不复制任何数据）；
 *      本文件内**不写死任何计数**（集合数/索引数/unique 数一律实算后打印）—— 同 R74/R75 处置。
 *   2. 环境 ID 也从单源 initDb/config.json 的 DEV_ENV_ID 读，**不手抄控制台**（历史教训：手抄错一整天）。
 *   3. 回读校验**fail-closed**：分页取全时断言 pager.Total 与实收条数一致，不一致即响亮失败。
 *   4. 默认 dry-run（不联网、不写入）；必须显式 --apply 才真调 API。
 *   5. AppSecret / access_token **永不打印**（打印一律打码），也不写入任何文件。
 *   6. **用后即轮换**（R83）：AppSecret 是**账号级**凭证 —— 重置即旧值失效、换取 access_token
 *      会让**同账号此前签发的 token 全部失效**。⇒ 只在要建索引时取，用完立刻回 mp 后台重置。
 *   7. **回执不回显任何令牌值**（R83）：日志 / 证据 / REVIEW 里只写「已用 --secret-file 传参」，
 *      绝不出现 AppSecret / access_token 的字面值、前几位或长度。
 *   8. **绝不写进云函数环境变量**（R83）：AppSecret 不进 `cloudfunctions/` 各函数的 `config.json`、不进云端
 *      ⚠️ 教训（R122 实证 · 本文件就是现场）：块注释里**永远不要让「通配符星号」紧跟「斜杠」**
 *      （glob 路径、正则、双斜杠都算 —— 这个二字符序列会**提前闭合块注释**）。
 *      本行原就写成那个形态 ⇒ 第 26 行之后整片说明被当成代码 ⇒ 本文件**自 2026-09-17 起
 *      一直编译不过、根本跑不起来**，而全仓 94 个套件全绿（**没有任何套件编译过 .js**）。
 *      2026-09-22 由 R122 `tools/check_js_syntax.js` 抓出并修复。
 *      环境变量、不进仓库 —— 与 `ADMIN_SETUP_TOKEN` 的六条纪律同构。
 *
 * 用法：
 *   node tools/apply_indexes.js                                # dry-run：只打印将要提交的请求
 *   node tools/apply_indexes.js --only user,audit_log          # dry-run 限定集合
 *   node tools/apply_indexes.js --apply --secret-file <文件>   # 真建（AppSecret 从本地文件读）
 *   WX_APPSECRET=xxx node tools/apply_indexes.js --apply       # 真建（AppSecret 从环境变量读）
 *   node tools/apply_indexes.js --apply --only user            # 单集合试水（建议第一次这么跑）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { COLLECTIONS, INDEXES } = require(path.join(ROOT, 'cloudfunctions/initDb/collections.js'));
const { envVariables } = require(path.join(ROOT, 'cloudfunctions/initDb/config.json'));
const projectConfig = require(path.join(ROOT, 'project.config.json'));

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valOf = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
const APPLY = has('--apply');
const ONLY = valOf('--only');
const SECRET_FILE = valOf('--secret-file');
const ENV_ID = valOf('--env') || (envVariables && envVariables.DEV_ENV_ID);
const APPID = projectConfig.appid;

// ---------- 派生（一切计数都实算，不写死） ----------
const ALL_ENTRIES = Object.keys(INDEXES).map((coll) => ({ coll, indexes: INDEXES[coll] }));
const TARGETS = ONLY ? ALL_ENTRIES.filter((e) => ONLY.split(',').map((s) => s.trim()).includes(e.coll)) : ALL_ENTRIES;
const TOTAL_INDEXES = ALL_ENTRIES.reduce((n, e) => n + e.indexes.length, 0);
const TARGET_INDEXES = TARGETS.reduce((n, e) => n + e.indexes.length, 0);
const TOTAL_UNIQUE = ALL_ENTRIES.reduce((n, e) => n + e.indexes.filter((ix) => ix.unique).length, 0);

// ---------- 单源 → API 结构转换（keys 对象 → 数组；方向 number → string "1"/"-1"） ----------
function toApiIndex(ix) {
  const keys = Object.keys(ix.keys).map((field) => ({ name: field, direction: String(ix.keys[field]) }));
  return { name: ix.name, unique: !!ix.unique, keys };
}

// ---------- 前置自检（fail-closed：解析/结构不对就别往下走） ----------
function preflight() {
  const problems = [];
  if (!ENV_ID) problems.push('环境 ID 为空（initDb/config.json 的 DEV_ENV_ID 缺失，且未传 --env）');
  if (!APPID) problems.push('AppID 为空（project.config.json 缺 appid）');
  if (!TARGETS.length) problems.push(`--only 指定的集合一个都没匹配上：${ONLY}`);
  for (const coll of Object.keys(INDEXES)) {
    if (!COLLECTIONS.includes(coll)) problems.push(`索引定义里的集合不在单源 COLLECTIONS 名单内：${coll}`);
  }
  for (const { coll, indexes } of TARGETS) {
    for (const ix of indexes) {
      const f = Object.keys(ix.keys || {});
      if (!ix.name) problems.push(`${coll}: 索引缺 name`);
      if (!f.length) problems.push(`${coll}.${ix.name}: keys 为空`);
      for (const k of f) {
        if (![1, -1, '1', '-1', '2dsphere'].includes(ix.keys[k])) problems.push(`${coll}.${ix.name}.${k}: 方向非法（${ix.keys[k]}）`);
      }
      if (typeof ix.unique !== 'boolean' && ix.unique !== undefined) problems.push(`${coll}.${ix.name}: unique 必须是布尔`);
    }
  }
  return problems;
}

// ---------- HTTP ----------
const mask = (s) => (s ? String(s).slice(0, 4) + '****' + String(s).slice(-2) : '(空)');

async function getAccessToken(secret) {
  const u = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(APPID)}&secret=${encodeURIComponent(secret)}`;
  const r = await fetch(u);
  const j = await r.json();
  if (!j.access_token) throw new Error(`换 access_token 失败：errcode=${j.errcode} errmsg=${j.errmsg}`);
  return j.access_token;
}

async function tcb(token, api, body) {
  const u = `https://api.weixin.qq.com/tcb/${api}?access_token=${encodeURIComponent(token)}`;
  const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

/** 取全部集合信息（fail-closed：分页取全并断言 Total 与实收一致）。 */
async function getCollections(token) {
  const out = [];
  let offset = 0;
  const limit = 100;
  for (let guard = 0; guard < 50; guard++) {
    const j = await tcb(token, 'databasecollectionget', { env: ENV_ID, limit, offset });
    if (j.errcode !== 0) throw new Error(`databasecollectionget 失败：errcode=${j.errcode} errmsg=${j.errmsg}`);
    const batch = j.collections || [];
    out.push(...batch);
    const total = j.pager ? j.pager.Total : undefined;
    if (typeof total !== 'number') throw new Error('databasecollectionget 未返回 pager.Total，分页取全无法自证 ⇒ fail-closed 中止');
    if (out.length >= total) {
      if (out.length !== total) throw new Error(`分页取全不一致：实收 ${out.length} ≠ Total ${total}`);
      return out;
    }
    if (batch.length < limit) throw new Error(`短页提前出现：本页 ${batch.length} < limit ${limit}，但已收 ${out.length} < Total ${total} ⇒ 数据源异常，fail-closed 中止`);
    offset += limit;
  }
  throw new Error('分页超过保护上限（50 页）仍未取全');
}

// ---------- 主流程 ----------
(async function main() {
  console.log('=== 单源派生 ===');
  console.log(`单源: cloudfunctions/initDb/collections.js`);
  console.log(`环境: ${ENV_ID || '(缺失)'}   AppID: ${APPID || '(缺失)'}`);
  console.log(`集合(实算): 单源 ${COLLECTIONS.length} / 有索引 ${ALL_ENTRIES.length} / 本次目标 ${TARGETS.length}`);
  console.log(`索引(实算): 全部 ${TOTAL_INDEXES} / 本次目标 ${TARGET_INDEXES} / 其中 unique 共 ${TOTAL_UNIQUE}`);
  if (ONLY) console.log(`--only 生效：${TARGETS.map((t) => t.coll).join(', ')}`);

  const problems = preflight();
  if (problems.length) {
    console.log('\n=== 前置自检：不通过（fail-closed） ===');
    problems.forEach((p) => console.log('  ✗ ' + p));
    process.exit(2);
  }
  console.log('前置自检: 通过');

  if (!APPLY) {
    console.log('\n=== DRY-RUN（不联网、不写入） ===');
    for (const { coll, indexes } of TARGETS) {
      console.log(`\n[${coll}] ${indexes.length} 条`);
      for (const ix of indexes) {
        const a = toApiIndex(ix);
        console.log(`  ${a.name}${a.unique ? ' (unique)' : ''} ← ${a.keys.map((k) => `${k.name}:${k.direction}`).join(' + ')}`);
      }
    }
    console.log('\n首条请求体示例:');
    console.log(
      JSON.stringify(
        { env: ENV_ID, collection_name: TARGETS[0].coll, create_indexes: [toApiIndex(TARGETS[0].indexes[0])], drop_indexes: [] },
        null,
        2
      )
    );
    console.log('\n加 --apply 才真建。建议第一次：--apply --only <单集合>');
    return;
  }

  // ---- 真建 ----
  let secret = process.env.WX_APPSECRET || '';
  if (!secret && SECRET_FILE) secret = fs.readFileSync(SECRET_FILE, 'utf8').trim();
  if (!secret) {
    console.log('\n未取到 AppSecret（--secret-file 或 WX_APPSECRET 皆为空）⇒ 无法换 access_token，中止。');
    process.exit(2);
  }
  console.log(`\nAppSecret: ${mask(secret)}（仅用于换 token，不落盘、不打印）`);

  const token = await getAccessToken(secret);
  console.log(`access_token: 取得成功（${mask(token)}）`);
  console.log('⚠️ 小程序 access_token 是全局凭证：本次获取会让此前签发的同账号 token 失效（本项目尚未上线运行，影响可控）。');

  const before = await getCollections(token);
  const beforeMap = new Map(before.map((c) => [c.name, c.index_count]));
  console.log(`\n=== 建前基线（index_count） ===`);
  for (const { coll } of TARGETS) console.log(`  ${coll}: ${beforeMap.has(coll) ? beforeMap.get(coll) : '集合不存在'}`);

  console.log(`\n=== 开始建索引（${TARGET_INDEXES} 条 / ${TARGETS.length} 个集合） ===`);
  const results = [];
  for (const { coll, indexes } of TARGETS) {
    const body = { env: ENV_ID, collection_name: coll, create_indexes: indexes.map(toApiIndex), drop_indexes: [] };
    let j;
    try {
      j = await tcb(token, 'updateindex', body);
    } catch (e) {
      j = { errcode: 'EXCEPTION', errmsg: String(e && e.message) };
    }
    const ok = j.errcode === 0;
    results.push({ coll, n: indexes.length, ok, errcode: j.errcode, errmsg: j.errmsg });
    console.log(`  ${ok ? '✅' : '❌'} ${coll} × ${indexes.length} 条 → errcode=${j.errcode} ${j.errmsg}`);
  }

  console.log('\n=== 回读校验（databasecollectionget） ===');
  const after = await getCollections(token);
  const afterMap = new Map(after.map((c) => [c.name, c.index_count]));
  for (const { coll, n } of results) {
    const b = beforeMap.has(coll) ? beforeMap.get(coll) : 0;
    const a = afterMap.has(coll) ? afterMap.get(coll) : -1;
    const delta = a - b;
    console.log(`  ${coll}: ${b} → ${a}（Δ${delta >= 0 ? '+' : ''}${delta}，本次提交 ${n} 条）`);
  }

  const okN = results.filter((r) => r.ok).length;
  console.log(`\n===== apply_indexes 结果：${okN} 成功 / ${results.length - okN} 失败 =====`);
  process.exit(okN === results.length ? 0 : 1);
})().catch((e) => {
  console.error(`致命错误：${e && e.message}`);
  process.exit(3);
});
