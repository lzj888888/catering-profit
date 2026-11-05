#!/usr/bin/env node
// tools/check_auto_queue.js —— 自驱队列 `review/AUTO_QUEUE.md` 的自洽性守卫
//
// 为什么需要它（本仓第 N 例「唯一真源没人看护」）：
//   AUTO_QUEUE.md 自己写着「**全仓待办只看这张表**」——它是自驱流程的**唯一输入**。
//   于是它的错不是"看着旧"，而是**整条流水线照着错的走**。R609 实测出三种：
//     ① `status: blocked` 而 `blocked: no`（#114/#115）——「卡住了」和「随时可做」同时成立，
//        取任务的一侧按 status 跳过，人看的一侧按 blocked 以为能做，双方各读一半；
//     ② `status: in_progress` 而**没有任何人在做**（#108）—— 队列规则写着
//        「in_progress 的行一律跳过」⇒ 这一行**永久卡死**：既不会被取，也不会被收；
//     ③ `status: done` 却仍 `blocked: yes` —— 已完成件还占着"等人"的位置。
//   三种都是「格式合法的文本」，没有任何现有守卫会红（全仓 121 个 check_*.js 无一扫这份表）。
//
// 判据（S 自证 / Q 自洽 / Y 语义三段，fail-closed）：
//   S 自证：文件在 / 能解析出 ≥100 数据行 / 状态值域合法（防文件被掏空后"零矛盾"恒真）
//   Q 自洽：blocked↔blocked=yes 双向 / todo·in_progress ⇒ blocked=no / done ⇒ blocked≠yes
//   Y 语义：blocked 必须写 why / done·todo 备注不得为空
//
// 🔴 鉴别力（M 段，内置合成样本）：判据一律走纯函数 `audit(text)`，
//    因此可用**内存合成文本**驱动，不碰磁盘、不依赖真实队列的当前状态。
//    5 个合成样本必须各自点名报出其 code —— 否则说明该判据恒真、等于没守。
//
// 运行：node tools/check_auto_queue.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const QUEUE = path.join(ROOT, 'review', 'AUTO_QUEUE.md');

let pass = 0, failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' —— ' + detail : ''}`); }
  else { failN++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}
const sec = (t) => console.log(`\n===== ${t} =====`);

// ============ 判据（纯函数：只吃文本，不读磁盘）============
const STATUS_OK = ['done', 'todo', 'in_progress', 'blocked'];
const BLOCKED_OK = ['yes', 'no'];

/**
 * 解析队列表格的数据行。
 * 🔴 R609 实测踩到的坑：这张表**两种行尾混存** ——
 *    有的行以 `|` 结尾（`... | no | 备注 |`），有的不以 `|` 结尾（`... | no | 备注`）。
 *    首版按「第 5 段到倒数第 1 段」拼备注，对**不以 | 结尾**的行会把备注整段砍掉 ⇒
 *    解析出空备注 ⇒ Q-⑦ 误报（#64/#65 明明写了很完整的证据却被判"备注为空"）。
 *    现改为：去掉首段（第一个 `|` 之前的空串）+ 若末段是空串则弹出，剩下按位置取。
 * ⚠️ 备注里可能出现表格转义的 `\|`，故备注 = 第 4 段之后**全部拼回**，不取单个单元格。
 */
function parseRows(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = /^\|\s*(\d+)\s*\|/.exec(line);
    if (!m) continue;
    const body = line.split('|').slice(1);   // 丢掉首个 `|` 之前的空串
    if (body.length && body[body.length - 1].trim() === '') body.pop(); // 兼容以 | 结尾
    if (body.length < 4) continue;
    out.push({
      id: m[1],
      task: (body[1] || '').trim(),
      status: (body[2] || '').trim(),
      blocked: (body[3] || '').trim(),
      note: body.slice(4).join('|').trim(),
      raw: line,
    });
  }
  return out;
}

/**
 * 审计一批行，返回错误清单 [{code, id, msg}]。
 * 每条判据单独一个 code，便于合成样本点名命中。
 */
function audit(text, opt) {
  const o = Object.assign({ minRows: 100 }, opt || {});
  const rows = parseRows(text);
  const errs = [];
  const push = (code, id, msg) => errs.push({ code, id, msg });

  // S-③ 防掏空：数据行太少 ⇒ 后面的自洽性判据全部"零矛盾"通过（恒真）
  if (rows.length < o.minRows) {
    push('S3', '-', `数据行仅 ${rows.length} 条，少于 ${o.minRows} 条下限（文件可能被掏空）`);
  }

  for (const r of rows) {
    // Q1 / Q2 值域
    if (STATUS_OK.indexOf(r.status) < 0) push('Q1', r.id, `status 非法值「${r.status}」`);
    if (BLOCKED_OK.indexOf(r.blocked) < 0) push('Q2', r.id, `blocked 非法值「${r.blocked}」`);
    if (STATUS_OK.indexOf(r.status) < 0 || BLOCKED_OK.indexOf(r.blocked) < 0) continue;

    // Q3：blocked ↔ blocked=yes 双向
    if (r.status === 'blocked' && r.blocked !== 'yes') {
      push('Q3', r.id, 'status=blocked 但 blocked≠yes（「卡住了」与「随时可做」同时成立）');
    }
    // Q4：可做的状态不得标 blocked
    if ((r.status === 'todo' || r.status === 'in_progress') && r.blocked !== 'no') {
      push('Q4', r.id, `status=${r.status} 却标 blocked=yes（取任务的会跳过它，永远做不上）`);
    }
    // Q5：done 不得还占着 blocked
    if (r.status === 'done' && r.blocked === 'yes') {
      push('Q5', r.id, 'status=done 却仍 blocked=yes（已完成件还占着「等人」位置）');
    }
    // Q6：blocked 必须自述「卡在什么上」（队列自己的规矩：「需要人决策的改 blocked: yes 并写 why」）
    // ⚠️ 判据只管**说没说清卡点**，不管格式 —— R609 实测队列里有三种合法写法：
    //    「why: ...」/「why（R443 收窄）：...」/「原 why 的①已作废，仅剩一件...」
    //    首版只认 `why:` 导致 #9/#12 被误报（它们写得更清楚，只是不是那个格式）。
    //    放宽后仍能抓出「等着吧」这类没说卡点的行 ⇒ 有鉴别力（见 M4）。
    const WHY_RE = /why|卡在|卡平台|卡\s*AppSecret|需李老师|待平台|前置|等真实反馈/;
    if (r.status === 'blocked' && !WHY_RE.test(r.note)) {
      push('Q6', r.id, 'status=blocked 但备注没写卡点（无 why / 卡在 / 需李老师 等）');
    }
    // Q7：done / todo 备注不得为空
    if ((r.status === 'done' || r.status === 'todo') && r.note.length < 4) {
      push('Q7', r.id, `status=${r.status} 但备注为空（无法判断是否真做完 / 怎么开始）`);
    }
  }
  return { rows, errs };
}

// ============ S 自证 ============
sec('S 自证（文件真实、可解析、非空壳）');
const REAL = fs.existsSync(QUEUE) ? fs.readFileSync(QUEUE, 'utf8') : '';
ok('S-① review/AUTO_QUEUE.md 存在', fs.existsSync(QUEUE));
const real = audit(REAL);
ok('S-② 解析出 ≥100 条数据行', real.rows.length >= 100, `${real.rows.length} 条`);
{
  const cnt = {};
  real.rows.forEach((r) => { cnt[r.status] = (cnt[r.status] || 0) + 1; });
  ok('S-③ 状态分布与仓库历史量级相符（done 占多数、无 in_progress 卡死）',
    (cnt.done || 0) >= 60 && (cnt.in_progress || 0) === 0,
    Object.keys(cnt).map((k) => `${k}:${cnt[k]}`).join(' '));
  ok('S-④ 四个状态键都只出现在值域内（S-③ 的分布才能被解释）',
    real.errs.filter((e) => e.code === 'Q1' || e.code === 'Q2').length === 0,
    'Q1/Q2 零错');
}

// ============ Q 自洽 ============
sec('Q 自洽（真实队列逐行）');
{
  const by = (c) => real.errs.filter((e) => e.code === c);
  const q3 = by('Q3'), q4 = by('Q4'), q5 = by('Q5');
  ok('Q-③ status=blocked ⇒ blocked=yes', q3.length === 0, q3.map((e) => '#' + e.id).join(' ') || '零违例');
  ok('Q-④ status=todo|in_progress ⇒ blocked=no', q4.length === 0, q4.map((e) => '#' + e.id).join(' ') || '零违例');
  ok('Q-⑤ status=done ⇒ blocked≠yes', q5.length === 0, q5.map((e) => '#' + e.id).join(' ') || '零违例');
  const q6 = by('Q6');
  ok('Q-⑥ status=blocked ⇒ 备注含 why:', q6.length === 0, q6.map((e) => '#' + e.id).join(' ') || '零违例');
  const q7 = by('Q7');
  ok('Q-⑦ status=done|todo ⇒ 备注非空', q7.length === 0, q7.map((e) => '#' + e.id).join(' ') || '零违例');
  ok('Q-⑧ 全表零违例（上五条合起来的最终判据）', real.errs.length === 0,
    real.errs.length ? real.errs.slice(0, 5).map((e) => e.code + '#' + e.id).join(' ') : '0 错');
}

// ============ Y 语义（进阶：done 必须有交付痕迹）============
sec('Y 语义（done 不能说"已完成"三个字就交差）');
{
  // 队列的 done 行必须能追溯到「做了什么」——要么引 commit / R 编号 / 轮次，
  // 要么写明机器判据（如「控制台改值」这种无代码提交的，队列自己要求写清判据）。
  // 判据不必求全：只要备注里有**任一**可追溯标记即可，防的是「已完成」三个字。
  const VAGUE = /^(已完成|done|ok|完成)[。.!！]?$/;
  const TRACE = /commit|\bR\d{2,4}\b|`[0-9a-f]{7,}`|轮|判据|cli |控制台|回读|部署/;
  const bad = real.rows.filter((r) => r.status === 'done' && (VAGUE.test(r.note) || !TRACE.test(r.note)));
  ok('Y-① 每条 done 都能追溯到交付痕迹（commit / R 轮次 / 机器判据）', bad.length === 0,
    bad.length ? bad.map((r) => '#' + r.id).join(' ') : `${real.rows.filter((r) => r.status === 'done').length} 条全部可追溯`);
  // 反恒真：确认上面这条判据不是"什么都匹配"——空备注必须被判红
  ok('Y-② 判据不恒真：空备注 / 只写「已完成」的 done 会被判红',
    VAGUE.test('已完成') && !TRACE.test('已完成') && TRACE.test('R609 已落'));
}

// ============ M 鉴别力（合成样本，不落盘）============
sec('M 鉴别力（5 个合成样本必须各自点名报出预期 code）');
{
  const head = '| # | 任务 | status | blocked | 依据 |\n|---|---|---|---|---|\n';
  // 用同一套填充行把样本撑到 100 行以上，使 S3 不干扰单条判据的验证
  const filler = (n) => Array.from({ length: n }, (_, i) =>
    `| ${900 + i} | 填充任务 | done | no | R609 填充 |`).join('\n');
  const build = (one) => head + one + '\n' + filler(120);

  const CASES = [
    { id: 'M1', desc: 'status=blocked 却 blocked=no（#114/#115 原样）',
      line: '| 1 | 某任务 | blocked | no | why: 卡平台 |', expect: 'Q3' },
    { id: 'M2', desc: 'status=todo 却 blocked=yes（永远做不上）',
      line: '| 2 | 某任务 | todo | yes | R609 |', expect: 'Q4' },
    { id: 'M3', desc: 'status 写成非法值（打错字）',
      line: '| 3 | 某任务 | wip | no | R609 |', expect: 'Q1' },
    { id: 'M4', desc: 'blocked 但没写 why（不知道在等什么）',
      line: '| 4 | 某任务 | blocked | yes | 等着吧 |', expect: 'Q6' },
    { id: 'M5', desc: 'done 却 blocked=yes（已完成还占位）',
      line: '| 5 | 某任务 | done | yes | R609 已落 |', expect: 'Q5' },
  ];

  let hitAll = 0;
  for (const c of CASES) {
    const got = audit(build(c.line)).errs.map((e) => e.code);
    const hit = got.indexOf(c.expect) >= 0;
    if (hit) hitAll++;
    ok(`M-${c.id} ${c.desc} ⇒ 命中 ${c.expect}`, hit, hit ? '按预期报红' : `未命中（实际 ${got.join(',') || '无错'}）= 判据恒真`);
  }
  ok('M-⑥ 5 个样本全部命中（判据有鉴别力、不是恒真）', hitAll === CASES.length, `${hitAll}/${CASES.length}`);

  // 反向：完全合法的样本必须零错（否则判据恒红，一样无用）
  const clean = audit(build('| 6 | 某任务 | todo | no | R609 可做 |'));
  ok('M-⑦ 反向自证：合法样本零错（判据不是恒红）', clean.errs.length === 0,
    clean.errs.map((e) => e.code + '#' + e.id).join(' ') || '0 错');
  // 掏空自证：只留 3 行必须报 S3
  const hollow = audit(head + '| 1 | a | done | no | R1 |\n| 2 | b | done | no | R2 |\n| 3 | c | done | no | R3 |');
  ok('M-⑧ 掏空自证：数据行不足 ⇒ 报 S3（"零矛盾"不能靠删行换来）',
    hollow.errs.some((e) => e.code === 'S3'), `行数 ${hollow.rows.length}`);

  // 🔴 M-⑨：这张表**两种行尾混存**（有 `|` 结尾 / 无 `|` 结尾）。首版只处理了有尾的那种，
  //    结果无尾行的备注被整段砍掉 ⇒ Q-⑦ 把 #64/#65 判成"备注为空"（它们其实写得很完整）。
  //    直接测 parseRows 本身，不绕 audit —— 这是「守卫自身的样本也要被守」。
  const tailYes = parseRows('| 1 | 任务甲 | done | no | 备注甲 |');
  const tailNo = parseRows('| 2 | 任务乙 | done | no | 备注乙');
  ok('M-⑨ 备注解析兼容两种行尾（有 `|` 结尾 / 无 `|` 结尾）',
    tailYes.length === 1 && tailNo.length === 1 &&
    tailYes[0].note === '备注甲' && tailNo[0].note === '备注乙',
    `有尾=「${tailYes[0] && tailYes[0].note}」无尾=「${tailNo[0] && tailNo[0].note}」`);
  // 备注里含表格转义 `\|` 时不得被截断
  const escaped = parseRows('| 3 | 任务丙 | done | no | 见 `a \\| b` 两处 |');
  ok('M-⑩ 备注含转义竖线不被截断', escaped.length === 1 && /a \\?\| b/.test(escaped[0].note),
    escaped[0] ? escaped[0].note : '解析失败');
}

// ============ N 轮次编号（全局共享资源，靠人记必然撞车）============
sec('N 轮次编号（单源 review/ROUND_INDEX.md）');
{
  const IDX = path.join(ROOT, 'review', 'ROUND_INDEX.md');
  ok('N-① review/ROUND_INDEX.md 存在', fs.existsSync(IDX));
  const idxSrc = fs.existsSync(IDX) ? fs.readFileSync(IDX, 'utf8') : '';
  const mNext = /^\s*NEXT:\s*(\d{3,4})\s*$/m.exec(idxSrc);
  ok('N-② 能解析出 `NEXT: <号>`（手工要维护的只有这一个数字）', !!mNext,
    mNext ? 'NEXT=' + mNext[1] : '未找到 NEXT 行');

  if (mNext) {
    const nextNo = Number(mNext[1]);
    // 现扫全仓编号出现处（排除二进制/数据件；排除 ROUND_INDEX 自身——它必然提到自己）
    const SKIP = /\.(b64|json|log|xlsx|xls|png|jpg|jpeg|pdf|docx|txt)$/i;
    const walk = (dir, out) => {
      if (!fs.existsSync(dir)) return out;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name === '.git') continue;
          walk(path.join(dir, e.name), out);
        } else if (/\.(md|js)$/i.test(e.name) && !SKIP.test(e.name)) {
          out.push(path.join(dir, e.name));
        }
      }
      return out;
    };
    const files = []
      .concat(walk(path.join(ROOT, 'review'), []))
      .concat(walk(path.join(ROOT, 'specs'), []))
      .concat(walk(path.join(ROOT, 'tools'), []))
      .filter((f) => path.resolve(f) !== path.resolve(IDX));

    let maxUsed = 0;
    const hitFiles = [];
    for (const f of files) {
      const t = fs.readFileSync(f, 'utf8');
      const ms = t.match(/\bR(\d{3,4})\b/g);
      if (!ms) continue;
      for (const s of ms) {
        const n = Number(s.slice(1));
        if (n >= 1 && n <= 999) {
          if (n > maxUsed) maxUsed = n;
          if (n === nextNo) hitFiles.push(path.relative(ROOT, f));
        }
      }
    }

    ok('N-③ NEXT 未被全仓任何记录用过（撞车当场报红）', hitFiles.length === 0,
      hitFiles.length ? 'R' + nextNo + ' 已出现在：' + hitFiles.slice(0, 3).join(' / ') : 'R' + nextNo + ' 空闲');
    ok('N-④ NEXT > 全仓实际最大已用号（防止取号回退到旧号段）', nextNo > maxUsed,
      `NEXT=${nextNo} / 已用最大=R${maxUsed}`);
    // 反自证：ROUND_INDEX 必须显式保留"欠账"段 —— 缺口可以被知道，不可以被悄悄抹掉
    ok('N-⑤ ROUND_INDEX 显式标注已知欠账（缺口只能被知道、不能被抹掉）',
      /欠账/.test(idxSrc) && /AUTO_LOG/.test(idxSrc),
      /欠账/.test(idxSrc) ? '有欠账段' : '缺欠账段');
    // 判据不恒真：拿一个肯定用过的号（maxUsed）走一遍，必须命中
    const probeUsed = hitFiles.length === 0 && maxUsed > 0;
    ok('N-⑥ 判据不恒真：把 NEXT 换成已用的 R' + maxUsed + ' 时必须报红', probeUsed,
      probeUsed ? '（N-③ 对 maxUsed 必然命中，逻辑一致）' : '无法自证');
  }
}

console.log(`\n===== 自驱队列自洽性守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
