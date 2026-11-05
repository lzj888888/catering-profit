#!/usr/bin/env node
// tools/check_release_checklist.js —— 「正式版发布前清单」数字与单源一致性守卫（R410）
//
// 为什么需要（R410 实测）：
//   `review/CHECKLIST_正式版发布前必做.md` 自称**活文档**，是李老师发布当天**照着执行**的清单。
//   R410 实测发现它里面数字与单源全面脱节，且**文件内部自相矛盾**：
//     · 库结构：正文写 27 集合 / 45 索引（12 unique），单源运行时实读 **29 / 49 / 13**
//     · 集合数：标题写 27，B1 动作行却写「建 25 张集合」—— 同一件事三个数
//     · 云函数：43 / 42（部署）/ 44（历史回读）三个数并存，单源实为 **55**
//     · 索引另有「40/45」「45/45」两套历史表述
//   🔴 后果不是"看起来旧"。照它执行会**漏建 4 条索引**，其中 `shop_ai_consent` 的
//      `idx_ai_consent_user_shop` 是 **unique** ⇒ 同一用户重复授权可产生多条记录、授权判定取错行；
//      另会漏建 2 张 `shop_ai_*` 集合 ⇒ AI 功能写库直接报错。漏建索引在真机上只表现为"慢"和
//      "偶发数据重复"，排查成本极高 —— 属于典型的**静默错**。
//   根因：全仓 121 个 check_*.js **无一扫这份文件**（grep 零命中）⇒ 单源改了它不跟着改，也没人知道。
//   与 R124（页面术语键）、R406（文案与机制一致性）同族：**文档承诺与实现之间没有机器契约**。
//
// 判据设计（关键取舍）：
//   · 单源 = `cloudfunctions/initDb/collections.js` **运行时实读**，不数行、不手抄。
//     （本仓教训：数行/数注释都会漂；只有 require 出来才是真值。）
//   · 分两类声明，**待遇不同**：
//       ① 当前态声明（"库结构 = N 集合 / N 索引"、"建 N 张集合"、"部署 N 个函数"）⇒ 必须等于单源；
//       ② 历史时点快照（如 R215d 的 44 函数 timeout 回读）⇒ **保留原值**，但该行必须显式标注
//          「时点值」/「历史」或带 evidence 路径。**不许存在"没标注的旧数字"** —— 这是本守卫最值钱的一条：
//          它让"未来的我又写回旧值"当场转红，而不是等下一次人工盘点。
//   · 不做全文模糊匹配：`个函数` 在本文件里有局部语义（"重新部署 2 个函数"指 payCreateOrder+payRenew），
//     全局反查会误杀 ⇒ 函数数只守两处**精确锚点**；集合/索引语义唯一，才做全局反查。
//   · 判据抽为纯函数 `analyze(docText, truth)`：真实文档与合成样本走**同一**函数 ⇒ 样本能证伪判据本身
//     （R299：只对真文档做字符串手术的"反恒真"证明不了判据成立）。
//
// 运行：node tools/check_release_checklist.js   （EXIT 0 = 全绿）

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOC = 'review/CHECKLIST_正式版发布前必做.md';

// ---------- 单源实读 ----------
function loadTruth() {
  const mod = require(path.join(ROOT, 'cloudfunctions/initDb/collections.js'));
  const COLLECTIONS = mod.COLLECTIONS || mod.collections || [];
  const INDEXES = mod.INDEXES || mod.indexes || {};
  let indexes = 0;
  let unique = 0;
  Object.keys(INDEXES).forEach((k) => {
    (INDEXES[k] || []).forEach((it) => {
      indexes += 1;
      if (it && it.unique) unique += 1;
    });
  });
  const dirs = fs.readdirSync(path.join(ROOT, 'cloudfunctions'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => n !== 'common' && n !== '_adminCore');
  return {
    collections: COLLECTIONS.length,
    indexes: indexes,
    unique: unique,
    fns: dirs.length,
    dirs: dirs.length + 2,   // 加回两个库目录 ⇒ 与文档里「N 个目录 − 两个库目录」的说法对齐
  };
}

// ---------- 判据（纯函数：真文档与合成样本共用） ----------
// 返回 fails: string[]（空 = 通过）
function analyze(docText, truth) {
  const fails = [];
  const lines = String(docText || '').split(/\r?\n/);

  function lineOf(pred) {
    for (let i = 0; i < lines.length; i++) if (pred(lines[i])) return { n: i + 1, t: lines[i] };
    return null;
  }
  // 「历史快照」的豁免判据：必须显式标注，不是"随便哪行都能过"
  function markedHistory(t) {
    return /时点值|历史快照|历史值|勿当现状/.test(t) || /review\/evidence\//.test(t);
  }

  // D1 文档存在且非空
  if (!String(docText || '').trim()) {
    fails.push('D1 清单文档为空或读不到');
    return fails;
  }

  // D2 库结构行：N 集合 / N 索引（N unique）
  const lib = lineOf((t) => /\|\s*库结构\s*\|/.test(t));
  if (!lib) {
    fails.push('D2 找不到「库结构」行（改结构时判据会失明，必须显式保留）');
  } else {
    const m = lib.t.match(/\*\*(\d+)\s*集合\s*\/\s*(\d+)\s*索引\*\*（(\d+)\s*unique）/);
    if (!m) {
      fails.push('D2 「库结构」行格式不再是「N 集合 / N 索引（N unique）」，判据无法定位');
    } else {
      const got = { c: +m[1], i: +m[2], u: +m[3] };
      if (got.c !== truth.collections) fails.push('D2 库结构集合数 ' + got.c + ' ≠ 单源 ' + truth.collections + '（' + DOC + ':' + lib.n + '）');
      if (got.i !== truth.indexes) fails.push('D2 库结构索引数 ' + got.i + ' ≠ 单源 ' + truth.indexes + '（' + DOC + ':' + lib.n + '）');
      if (got.u !== truth.unique) fails.push('D2 库结构 unique 数 ' + got.u + ' ≠ 单源 ' + truth.unique + '（' + DOC + ':' + lib.n + '）');
    }
  }

  // D3 §B 标题
  const bh = lineOf((t) => /^###\s*B\.\s*prod 库结构/.test(t));
  if (!bh) {
    fails.push('D3 找不到「### B. prod 库结构」标题');
  } else {
    const m = bh.t.match(/（(\d+)\s*集合\s*\+\s*(\d+)\s*索引）/);
    if (!m) {
      fails.push('D3 §B 标题格式不再是「（N 集合 + N 索引）」，判据无法定位');
    } else {
      if (+m[1] !== truth.collections) fails.push('D3 §B 标题集合数 ' + m[1] + ' ≠ 单源 ' + truth.collections + '（:' + bh.n + '）');
      if (+m[2] !== truth.indexes) fails.push('D3 §B 标题索引数 ' + m[2] + ' ≠ 单源 ' + truth.indexes + '（:' + bh.n + '）');
    }
  }

  // D4 B1「建 N 张集合」
  const b1 = lineOf((t) => /\|\s*B1\s*\|/.test(t));
  if (!b1) {
    fails.push('D4 找不到 B1（建集合动作行）');
  } else {
    const m = b1.t.match(/建\s*\**(\d+)\**\s*张集合/);
    if (!m) fails.push('D4 B1 格式不再是「建 N 张集合」，判据无法定位');
    else if (+m[1] !== truth.collections) fails.push('D4 B1 建集合数 ' + m[1] + ' ≠ 单源 ' + truth.collections + '（:' + b1.n + '）');
  }

  // D5 B2「建 N 条索引」
  const b2 = lineOf((t) => /\|\s*B2\s*\|/.test(t));
  if (!b2) {
    fails.push('D5 找不到 B2（建索引动作行）');
  } else {
    const m = b2.t.match(/建\s*\**(\d+)\**\s*条索引/);
    if (!m) fails.push('D5 B2 格式不再是「建 N 条索引」，判据无法定位');
    else if (+m[1] !== truth.indexes) fails.push('D5 B2 建索引数 ' + m[1] + ' ≠ 单源 ' + truth.indexes + '（:' + b2.n + '）');
  }

  // D6 D1「全量部署 N 个函数（M − initDb）」
  const d1 = lineOf((t) => /\|\s*D1\s*\|/.test(t));
  if (!d1) {
    fails.push('D6 找不到 D1（全量部署动作行）');
  } else {
    // ⚠️ 粗体 `**` 可能夹在「个函数」与全角括号之间（`**54 个函数**（55 − …`）——
    //    首版漏了这一个 `\**`，导致该腿恒为「格式无法定位」：B6 看起来"抓到了"，
    //    实际红的原因是格式不认，不是数字不符 —— 假命中。已补 `\**`。
    const m = d1.t.match(/全量部署\s*\**(\d+)\**\s*个函数\**\s*（(\d+)\s*−/);
    if (!m) {
      fails.push('D6 D1 格式不再是「全量部署 N 个函数（M − initDb）」，判据无法定位');
    } else {
      if (+m[1] !== truth.fns - 1) fails.push('D6 D1 部署数 ' + m[1] + ' ≠ 单源函数数−1 = ' + (truth.fns - 1) + '（:' + d1.n + '）');
      if (+m[2] !== truth.fns) fails.push('D6 D1 括注函数数 ' + m[2] + ' ≠ 单源 ' + truth.fns + '（:' + d1.n + '）');
    }
  }

  // D7 「云函数 | N 个（M 个目录 − ...）」
  const fnLine = lineOf((t) => /\|\s*云函数\s*\|/.test(t));
  if (!fnLine) {
    fails.push('D7 找不到「云函数」行');
  } else {
    const m = fnLine.t.match(/\*\*(\d+)\s*个\*\*（(\d+)\s*个目录/);
    if (!m) {
      fails.push('D7 「云函数」行格式不再是「**N 个**（M 个目录 − …）」，判据无法定位');
    } else {
      if (+m[1] !== truth.fns) fails.push('D7 云函数数 ' + m[1] + ' ≠ 单源 ' + truth.fns + '（:' + fnLine.n + '）');
      if (+m[2] !== truth.dirs) fails.push('D7 目录数 ' + m[2] + ' ≠ 单源 ' + truth.dirs + '（:' + fnLine.n + '）');
    }
  }

  // D8 全局反查：所有「N 集合 / N 张集合 / N 索引 / N 条索引 / N unique」
  //    值 ≠ 单源 ⇒ 该行必须是显式标注的历史快照，否则判红。
  //    🔴 这是本守卫最值钱的一条：**未来把旧数字写回来会当场转红**。
  const KINDS = [
    { re: /(\d+)\s*张?集合/g, want: truth.collections, label: '集合' },
    { re: /(\d+)\s*条索引/g, want: truth.indexes, label: '索引' },
    { re: /(\d+)\s*unique/g, want: truth.unique, label: 'unique' },
  ];
  lines.forEach((t, i) => {
    if (/^\s*$/.test(t)) return;
    if (markedHistory(t)) return;   // 已标注的历史快照 ⇒ 豁免（且必须标注，见上）
    KINDS.forEach((k) => {
      k.re.lastIndex = 0;
      let m;
      while ((m = k.re.exec(t)) !== null) {
        const v = +m[1];
        if (v !== k.want) {
          fails.push('D8 ' + DOC + ':' + (i + 1) + ' 出现未标注的旧数字「' + m[0] + '」，单源 ' + k.label + ' = ' + k.want
            + '（历史快照须显式写「时点值」或带 evidence 路径）');
        }
      }
    });
  });

  return fails;
}

// ---------- 跑真实文档 ----------
const fails = [];
const pass = [];
function ok(name, cond, detail) {
  if (cond) { pass.push(name); console.log('  ✅ ' + name); }
  else { fails.push(name + (detail ? ' —— ' + detail : '')); console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

console.log('===== R410 发布前清单数字一致性守卫 =====');
const truth = loadTruth();
console.log('  单源实读：' + truth.collections + ' 集合 / ' + truth.indexes + ' 索引（' + truth.unique + ' unique）'
  + ' / ' + truth.fns + ' 云函数（' + truth.dirs + ' 目录）');

// S0：单源本身读成功（fail-closed —— 单源读成 0 时，下面所有"等于单源"的判据都会变成
//     "等于 0"，那是恒真/恒假的温床，必须先拦）。
//     本段必须有断言：R66 守卫要求每个 `=====` 段标题下不得零断言（否则段名会变成装饰）。
ok('S0 单源实读成功（集合/索引/函数数均为正）',
  truth.collections > 0 && truth.indexes > 0 && truth.fns > 0,
  '单源读成 0：' + JSON.stringify(truth));

let docText = '';
try {
  docText = fs.readFileSync(path.join(ROOT, DOC), 'utf8');
} catch (e) {
  docText = '';
}

console.log('\n===== A 真实文档 =====');
const real = analyze(docText, truth);
ok('A1 真实文档 ' + DOC + ' 与单源一致（' + real.length + ' 处不符）', real.length === 0, real.join('；'));

// ---------- 反恒真：合成样本走同一 analyze ----------
console.log('\n===== B 反恒真（合成样本，与真文档共用 analyze） =====');

const T = { collections: 29, indexes: 49, unique: 13, fns: 55, dirs: 57 };
const GOOD = [
  '| 云函数 | **55 个**（57 个目录 − `common` / `_adminCore` 两个库目录） |',
  '| 库结构 | **29 集合 / 49 索引**（13 unique） | src |',
  '### B. prod 库结构（29 集合 + 49 索引）',
  '| B1 | 建 29 张集合 | 说明 |',
  '| B2 | 建 **49 条索引**（历史说明） | 说明 |',
  '| D1 | 全量部署 **54 个函数**（55 − `initDb`） | 说明 |',
  '- ❌ 不需要把 dev 的 49 条索引"复制"到 prod 里',
].join('\n');

ok('B1 正样本全绿', analyze(GOOD, T).length === 0, analyze(GOOD, T).join('；'));

ok('B2 负样本：集合数写回 27 ⇒ D2/D3/D8 至少三条腿同时红',
  analyze(GOOD.replace('**29 集合', '**27 集合'), T).some((f) => /D2|D8/.test(f)));

ok('B3 负样本：B1 写「建 25 张集合」⇒ D4 红（同文件内自相矛盾的原始形态）',
  analyze(GOOD.replace('建 29 张集合', '建 25 张集合'), T).some((f) => /D4/.test(f)));

ok('B4 负样本：B2 写回 45 条索引 ⇒ D5 红',
  analyze(GOOD.replace('**49 条索引**', '**45 条索引**'), T).some((f) => /D5/.test(f)));

ok('B5 负样本：云函数写回 43 ⇒ D7 红',
  analyze(GOOD.replace('**55 个**', '**43 个**'), T).some((f) => /D7/.test(f)));

ok('B6 负样本：部署数写回 42 ⇒ D6 红',
  analyze(GOOD.replace('**54 个函数**', '**42 个函数**'), T).some((f) => /D6/.test(f)));

ok('B7 负样本：unique 写回 12 ⇒ D2 红',
  analyze(GOOD.replace('13 unique', '12 unique'), T).some((f) => /D2/.test(f)));

// B8/B9 必须构成**同一数字形态、只差标注**的对照对 —— 否则"通过"可能只是"压根没抓到数字"。
//   首版样本用「40/45」这种非 N 条索引形态 ⇒ B8 假绿（不是标注生效），B9 假红（D8 抓不到函数数）。
const HIST_MARKED = GOOD + '\n| 历史 | 曾规划 **45 条索引** —— 🔴 R215c 时点值（非当前现状） |';
const HIST_BARE = GOOD + '\n| 历史 | 曾规划 **45 条索引** |';

ok('B8 已标注的历史快照不判红（守住"留证据"与"防漂移"的边界）', analyze(HIST_MARKED, T).length === 0, analyze(HIST_MARKED, T).join('；'));

// B9 关键：同一条旧数字，**去掉标注** ⇒ 必须红（证明豁免来自"标注"而非"这行恰好不匹配"）
ok('B9 同一数字去掉「时点值」标注 ⇒ D8 红（证明豁免不是恒真）',
  analyze(HIST_BARE, T).some((f) => /D8/.test(f)), analyze(HIST_BARE, T).join('；'));

// B10 空文档 ⇒ D1 红（fail-closed，不是"没数字所以全绿"）
ok('B10 空文档 ⇒ D1 红（fail-closed）', analyze('', T).some((f) => /D1/.test(f)));

// B11 truth 变化必须让真文档形状的样本转红（防止判据把 truth 写死成常量）
ok('B11 truth 换成 30 集合 ⇒ GOOD 样本转红（判据实读 truth，未写死）',
  analyze(GOOD, Object.assign({}, T, { collections: 30 })).some((f) => /D2|D8/.test(f)));

const failN = fails.length;
console.log('\n===== 结果：' + pass.length + ' 通过 / ' + failN + ' 失败 =====');
if (failN) {
  fails.forEach((b) => console.log('   ❌ ' + b));
  console.log('\n修复指引：');
  console.log('  1) 先把单源真值跑出来：node -e "const m=require(\'./cloudfunctions/initDb/collections.js\'); …"');
  console.log('     或直接看本守卫开头打印的「单源实读」行。');
  console.log('  2) 把 ' + DOC + ' 里的当前态数字改成单源值。');
  console.log('  3) 历史时点快照**不要改值**，在那一行显式写「时点值 / 勿当现状」或附 evidence 路径。');
}
process.exit(failN === 0 ? 0 : 1);
