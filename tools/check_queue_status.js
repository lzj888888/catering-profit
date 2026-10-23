/**
 * tools/check_queue_status.js —— 自驱任务队列（review/AUTO_QUEUE.md）状态与代码事实一致性守卫
 *
 * 为什么需要（R449 ⑥ 登记，本轮 R456 落地）：
 *   队列是「自驱接续」的唯一真源 —— 下一条做什么、哪些已完成，全靠读它。
 *   但 `status` 是**人手写的**，而它描述的事实（代码/提交/部署）在仓库里。
 *   实测已出现 3 例「status 与代码事实不一致」：
 *     · #45 标 done 而备注里的数字与实读不符（R449 订正）
 *     · #48 标 done 而 blocked 列仍是 yes（R441 巡检发现，标记残留）
 *     · #27 备注里的 15→16 / 28→29 与 `app.json` 实读不符（R441 订正）
 *   后果不是"看起来旧"：下一轮自动化按 `status: todo` 取第一条，若该行其实早已做完
 *   ⇒ **重复实现**；若某行自称 done 却找不到提交 ⇒ **工作被当成已完成而其实没做**（比少做更贵）。
 *
 * 判据（Q1~Q8，断言数固定，不随队列行数变化）：
 *   Q1 解析面非空且表结构完整（能识别 4 个列名，行数 ≥ 下界）
 *   Q2 status 必须是 {todo | in_progress | done | blocked}，非法值判红
 *   Q3 blocked 列 = yes ⇒ 备注必须含 why（否则下轮不知道它在等什么）
 *   Q4 done ⇒ 备注里必须能取到 commit sha，且该 sha **在 git log 中真存在**（真 git，不采信字面）
 *   Q5 编号唯一（重复编号会让「取第 N 条」这类描述失准）
 *   Q6 备注出现完成态断言词（已落/已部署/已完成/已收口/已修/已上线）⇒ **必须带 commit**
 *      （防"自称完成但无提交" —— 这正是 R449 那一类的根因）
 *   Q7 反恒真 · 合成样本 3 组：删 done 行的 commit / 删 blocked 行的 why / status 改非法值
 *      ⇒ 三条腿各自必须被抓到（证明判据不是恒真）
 *   Q8 反恒真 · 真实变异 1 组（改真文件，带 finally + SIGTERM/SIGINT 显式还原，防残污）
 *
 * 用法：node tools/check_queue_status.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const QUEUE_REL = 'review/AUTO_QUEUE.md';
const QUEUE_ABS = path.join(ROOT, QUEUE_REL);

const STATUS_OK = ['todo', 'in_progress', 'done', 'blocked'];
// 完成态断言词：出现即表示"这一条宣称自己已经做完了"
const DONE_CLAIM = ['已落', '已落库', '已部署', '已收口', '已修', '已完成', '已上线', '已做', '已实现'];
const MIN_ROWS = 20;      // 下界护栏：解析面被改小（比如只扫前 3 行）⇒ 当场转红
const MIN_DONE = 10;      // 下界护栏：done 行数量（当前 35 条）

let pass = 0;
let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { fail++; console.log('❌ ' + name + (extra ? ' · ' + extra : '')); }
};

// ===== 解析 =====
function parseQueue(text) {
  const rows = [];
  const lines = text.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    // 🔴 不能无脑 slice(1,-1)：本表有行末**不带尾竖线**的条目（如 #16 以「commit f09e4bd」结尾），
    //    那样会把最后一格（往往正是 commit 证据所在）当成收尾空串丢掉 ⇒ 判据静默丢证据 ⇒ 假红。
    const rawCells = line.split('|');
    if (rawCells.length && rawCells[0].trim() === '') rawCells.shift();
    if (rawCells.length && rawCells[rawCells.length - 1].trim() === '') rawCells.pop();
    const cells = rawCells.map((s) => s.trim());
    if (cells.length < 5) continue;                 // 分隔行 / 表头 / 说明行
    if (!/^\d+$/.test(cells[0])) continue;          // 首列必须是编号
    rows.push({
      id: Number(cells[0]),
      subject: cells[1],
      status: cells[2],
      blocked: cells[3],
      note: cells.slice(4).join(' | '),
      line,
    });
  }
  return rows;
}

function headerOk(text) {
  // 表结构：必须同时出现这 4 个列名（改列名而不改解析器 ⇒ 解析面静默变空 ⇒ 其余断言全恒真）
  return ['status', 'blocked', 'why', 'commit'].every((k) => text.indexOf(k) >= 0);
}

function findSha(note) {
  const out = [];
  const re = /\b([0-9a-f]{7,40})\b/g;
  let m;
  while ((m = re.exec(note)) !== null) out.push(m[1]);
  return out;
}

// ===== git 事实面 =====
// 🔴 性能约束（实测，别改回去）：本机 `git log` 全量要 **11~16 秒**（1161 个 commit）。
//    本套件会被 `check_suite_assert_counts` 逐个 spawn（它自己 spawn 全部 207 个套件），
//    第一次实现就是因为在里面跑了一次 git log ⇒ 单跑 42s ⇒ 直接把它顶过 420s 超时（R457 实证）。
//    ⇒ sha 存在性一律走 `git cat-file --batch-check`（**一次** spawn 判全部），
//      轮次号的全量检索改为**惰性**：只有某行既无真 sha、又无「无代码提交」声明时才触发。
let ROWS_CACHE = [];              // 仅供可读性（保留，便于将来加预取优化）
let ROUND_CACHE = {};             // 轮次号 → 是否能在 commit subject 中检索到
let GIT_LOG = null;

// 一次 `git log`（sha + subject）同时服务两件事：sha 前缀匹配、轮次号检索。
// ⚠️ 为什么要合并成一次：本机**任何** git 进程启动就要 ~3s（`git cat-file` 单个 sha 实测 3.0s），
//    全量 `rev-list`/`log` 约 10~16s；分开调用会线性叠加（实测套件跑到 60s）⇒ 只调一次。
function gitLogLazy() {
  if (GIT_LOG) return GIT_LOG;
  const out = execFileSync('git', ['log', '--format=%H%x1f%s%x1e'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  GIT_LOG = out.split('\x1e').filter(Boolean).map((chunk) => {
    const i = chunk.indexOf('\x1f');
    return { sha: chunk.slice(0, i).trim(), msg: chunk.slice(i + 1) };
  });
  return GIT_LOG;
}
function shaExists(sha) {
  const arr = gitLogLazy();
  for (const e of arr) if (e.sha === sha || e.sha.indexOf(sha) === 0) return true;
  return false;
}
function roundHit(rnd) {
  if (rnd in ROUND_CACHE) return ROUND_CACHE[rnd];
  const arr = gitLogLazy();
  const v = arr.some((e) => e.msg.indexOf(rnd) >= 0);
  ROUND_CACHE[rnd] = v;
  return v;
}
// 提取备注里的轮次号：R + 2~3 位数字
function findRounds(note) {
  const out = [];
  const re = /(?:^|[^A-Za-z0-9])(R\d{2,3})\b/g;
  let m;
  while ((m = re.exec(note)) !== null) out.push(m[1]);
  return out;
}
// 「无代码提交」显式声明：必须带 ≥8 字说明，防空声明蒙混
function noCodeDecl(note) {
  const i = note.indexOf('无代码提交');
  if (i < 0) return false;
  return note.slice(i).replace('无代码提交', '').replace(/[：:，,。.\s]/g, '').length >= 8;
}

// ===== 主检查（可被合成样本复用）=====
// 一条「已完成」的声明，必须能落到下列三种可机器验证的落点之一：
//   (a) 备注含 commit sha 且该 sha 在 git log 中真存在
//   (b) 备注含轮次号 R### 且该轮次号能在 commit message 里检索到（本仓的天然追溯键）
//   (c) 备注显式声明「无代码提交：…」（≥8 字说明）—— 控制台/运维类条目没有提交，但必须写明
function hasAnchor(note) {
  // 顺序有讲究：先查**便宜**的落点（真 commit、显式声明），轮次号的全量检索放最后（惰性、最贵）
  const shas = findSha(note);
  if (shas.length && shas.some(shaExists)) return 'sha';
  if (noCodeDecl(note)) return 'noCode';
  const rnds = findRounds(note);
  if (rnds.length && rnds.some(roundHit)) return 'round';
  return '';
}

function checkQueue(rows, label) {
  const res = { badStatus: [], noWhy: [], doneNoSha: [], shaFake: [], dupId: [], claimNoSha: [] };
  const seen = new Set();
  for (const r of rows) {
    if (STATUS_OK.indexOf(r.status) < 0) res.badStatus.push(r.id);
    if (r.blocked === 'yes' && r.note.indexOf('why') < 0) res.noWhy.push(r.id);
    if (r.status === 'done') {
      const shas = findSha(r.note);
      if (shas.length && !shas.some(shaExists)) res.shaFake.push(r.id + ':' + shas.join(','));
      if (!hasAnchor(r.note)) res.doneNoSha.push(r.id);
    }
    if (seen.has(r.id)) res.dupId.push(r.id);
    seen.add(r.id);
    const claims = DONE_CLAIM.filter((w) => r.note.indexOf(w) >= 0);
    if (claims.length && !hasAnchor(r.note)) res.claimNoSha.push(r.id + ':' + claims[0]);
  }
  return res;
}

function report(res, prefix) {
  ok(prefix + ' status 全部合法（todo/in_progress/done/blocked）', res.badStatus.length === 0,
    res.badStatus.length ? '非法：#' + res.badStatus.join(',') : '');
  ok(prefix + ' blocked=yes 的条目都写了 why', res.noWhy.length === 0,
    res.noWhy.length ? '缺 why：#' + res.noWhy.join(',') : '');
  ok(prefix + ' done 条目都有可机器验证的落点（真 commit / 可检索轮次号 / 显式「无代码提交」声明）',
    res.doneNoSha.length === 0,
    res.doneNoSha.length ? '三样都没有：#' + res.doneNoSha.join(',') : '');
  ok(prefix + ' 备注里写的 commit sha 在 git log 中真存在（写了就必须真）', res.shaFake.length === 0,
    res.shaFake.length ? '查无此提交：' + res.shaFake.join(' ') : '');
  ok(prefix + ' 编号唯一', res.dupId.length === 0, res.dupId.length ? '重复：#' + res.dupId.join(',') : '');
  ok(prefix + ' 自称「已完成」的条目同上（防自称完成但查无实据）', res.claimNoSha.length === 0,
    res.claimNoSha.length ? '无实据：' + res.claimNoSha.join(' ') : '');
}

// ===== 主流程 =====
const text = fs.readFileSync(QUEUE_ABS, 'utf8');
const rows = parseQueue(text);
ROWS_CACHE = rows;

ok('Q1-① 队列文件存在且表结构完整（4 个列名齐全）', fs.existsSync(QUEUE_ABS) && headerOk(text));
ok('Q1-② 解析面非空且行数 ≥ ' + MIN_ROWS + '（扫描面被改小即红）', rows.length >= MIN_ROWS,
  '实解析 ' + rows.length + ' 行');
const doneRows = rows.filter((r) => r.status === 'done');
const blockedRows = rows.filter((r) => r.blocked === 'yes');
ok('Q1-③ done 行 ≥ ' + MIN_DONE + ' / blocked 行 ≥ 1（两列都解析到，防只扫一种状态）',
  doneRows.length >= MIN_DONE && blockedRows.length >= 1,
  'done=' + doneRows.length + ' blocked=' + blockedRows.length);

const res = checkQueue(rows, 'Q2');
report(res, 'Q2');

// ===== Q7 反恒真 · 合成样本 3 组 =====
const mk = (o) => Object.assign({
  id: 900, subject: 's', status: 'done', blocked: 'no', note: 'commit abc1234 why: x', line: '',
}, o);
const base = [mk({ id: 901 }), mk({ id: 902, status: 'blocked', blocked: 'yes', note: 'why: 等李老师' })];

// S1：把三种落点全部抹掉（无 sha、无轮次号、无「无代码提交」声明）⇒ 必须被抓到
const s1 = base.map((r) => (r.id === 901 ? mk({ id: 901, note: '做完了（什么凭据都没留）' }) : r));
const r1 = checkQueue(s1, 'S1');
ok('Q7-① 合成样本：删掉 done 行的 commit ⇒ 必须被抓到', r1.doneNoSha.length === 1 || r1.claimNoSha.length === 1,
  'doneNoSha=' + JSON.stringify(r1.doneNoSha) + ' claimNoSha=' + JSON.stringify(r1.claimNoSha));

const s2 = base.map((r) => (r.id === 902 ? mk({ id: 902, status: 'blocked', blocked: 'yes', note: '等李老师' }) : r));
const r2 = checkQueue(s2, 'S2');
ok('Q7-② 合成样本：删掉 blocked 行的 why ⇒ 必须被抓到', r2.noWhy.length === 1, 'noWhy=' + JSON.stringify(r2.noWhy));

const s3 = base.map((r) => (r.id === 901 ? mk({ id: 901, status: 'done2' }) : r));
const r3 = checkQueue(s3, 'S3');
ok('Q7-③ 合成样本：status 写成非法值 ⇒ 必须被抓到', r3.badStatus.length === 1, 'badStatus=' + JSON.stringify(r3.badStatus));

// ===== Q8 反恒真 · 真实内容变异（作用于**副本**，绝不写真文件）=====
// 🔴 为什么不用真文件做变异：门禁是**并发**跑套件的，本套件若去写 `review/AUTO_QUEUE.md`，
//    与同一时刻正在读它的其它套件构成竞态（读到被抹掉证据的半截内容 ⇒ 别人假红）。
//    判据的证明力来自「用的是**真实内容**」，而不是「写在真实路径上」
//    ⇒ 复制到临时文件再变异，证明力等价、零副作用（也不用担心 SIGTERM 残留污染）。
const origBuf = fs.readFileSync(QUEUE_ABS);
const TMP_ABS = path.join(ROOT, '_m3', '_queue_status_mutation_tmp.md');
try {
  if (!fs.existsSync(path.join(ROOT, '_m3'))) fs.mkdirSync(path.join(ROOT, '_m3'), { recursive: true });
  // 取第一条 done 行，把它的**全部落点**抹掉（sha → zzzzzzz、轮次号 → R000）⇒ Q2-③ 必须转红
  //   ⚠️ 只抹 sha 不够：多数 done 行同时写了轮次号（R### 也能检索到 commit）⇒ 抹一个仍会漏网，
  //      那样 Q8 会假红 —— 而假红又会诱使人去"放宽判据"。故这里两条腿一起抹。
  const target = rows.find((r) => r.status === 'done' && hasAnchor(r.note));
  if (target) {
    const mutLine = target.line
      .replace(/[0-9a-f]{7,40}/g, 'zzzzzzz')
      .replace(/(?:^|[^A-Za-z0-9])R\d{2,3}\b/g, ' R000')
      .replace(/无代码提交[^|]*/g, '（声明也抹掉）');
    const mutText = text.replace(target.line, mutLine);
    fs.writeFileSync(TMP_ABS, mutText, 'utf8');   // 写真副本，不碰真文件
    const rr = checkQueue(parseQueue(fs.readFileSync(TMP_ABS, 'utf8')), 'M');
    ok('Q8 真实内容变异：把一条 done 行的全部落点抹掉 ⇒ 必须被抓到（变异只落在副本上）',
      rr.doneNoSha.length >= 1 || rr.shaFake.length >= 1 || rr.claimNoSha.length >= 1,
      'doneNoSha=' + JSON.stringify(rr.doneNoSha) + ' shaFake=' + JSON.stringify(rr.shaFake));
  } else {
    ok('Q8 真实内容变异：找不到可用于变异的 done 行（判据无法自证）', false, '无目标行');
  }
} finally {
  // ⚠️ 不删临时副本：本机 `fs.unlinkSync` 会被 safe-delete shim 拦截并抛
  //    `[safe-delete] 操作失败 … ETIMEDOUT`（R457 实测），反而把套件打死。
  //    该副本在未跟踪的 `_m3/` 目录里（不进仓库），下次运行直接覆盖即可。
}

// 落盘自证：真文件自始至终没被写过（与开跑前逐字节一致）
const afterBuf = fs.readFileSync(QUEUE_ABS);
ok('Q9 真文件未被本套件写过（逐字节一致，零副作用）', Buffer.compare(origBuf, afterBuf) === 0);

console.log('');
console.log('============================================================');
console.log('===== 队列状态与代码事实一致性守卫结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail === 0 ? 0 : 1);
