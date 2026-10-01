#!/usr/bin/env node
// tools/check_pack_size.js —— 小程序「打包体积 / ignore 规则」守卫（R182）
// 运行： node tools/check_pack_size.js
//
// 根因（2026-10-01 round181o 实锤，代价 = 一次出码连败 6 轮）：
//   李老师要一张真机预览码，`cli.bat preview` 连败 6 次，**每次都死在同一处** —— 前两步
//   「IDE server started」「Using AppID」都正常，第三步「Uploading」卡住。历史上 preview 失败
//   全是「server 起不来」，**症状不同却被老经验带偏**，一度判成登录态问题。把出码脚本改成
//   「原始输出全量落盘」后一次抓到真报错：
//       code 10 · 源码包超出最大限制, source size 118969KB exceed max limit 2MB
//   即入包 118 MB、**超上限 59 倍**。追源：仓库根多了一个调试截图堆 `_m3/`（747 个 png / 116 MB）。
//   它**从未进 git**、也早就写在 `.gitignore` 里 —— 但 **.gitignore 管不了微信打包**：
//   开发者工具只认 `project.config.json` 的 `packOptions.ignore`，本地磁盘有什么就往包里塞什么。
//   补规则后入包 116.86 MB → 0.61 MB，出码立刻成功。
//
// 为什么补完规则还要立守卫（本仓「形态类缺陷立用例表单源」纪律）：
//   光修不守 ⇒ 下一次任何人再丢一个临时目录 / 截图堆 / 导出件进来，**事故原样重演**，而
//   A–L 与全部既有套件**一条都覆盖不到**（它们扫代码 / 文档 / 集合 / 索引，没有一个看打包体积）。
//   与 round53「判据存在 ≠ 判据被执行」、round60「新判据忘了挂 SUITES」同族；
//   邻近先例 = R55「测试脚本落位」约（正因为 `packOptions.ignore` 不忽略 `utils/` 与 `.js`）。
//
// 判据三段：
//   S 自失效护栏：S1 扫描面非退化（未忽略文件数达下界）· S2 关键入口真在入包集合内 ·
//                S3 规则匹配器 4 类 × 正负样本互证（匹配器腐化成恒真 ⇒ P 段全绿却什么都没判）；
//   P 入包体积：P-① 总量 ≤ 预算（留余）· P-② 预算常量自洽（< 微信硬上限，防「改大预算绕过」）·
//              P-③ 单个未忽略顶层条目 ≤ 顶格（这条会在失败行里**点名罪魁**，`_m3` 型事故的直接告警）；
//   G 规则完整性：G-① 必备规则逐条在位（含 `_` 族兜底）· G-② 规则条数下界 ·
//                G-③ 每条规则 type ∈ 官方六种（拼错会被工具静默忽略 ⇒ 假 ignore）·
//                G-④ 未使用 regexp/glob（本守卫未实现其匹配 ⇒ fail-closed，不许静默漏判）。
//
// 边界（明写，别高估本守卫）：
//   · 只守**体积与规则形态**；包里「该不该有某个业务文件」判不出来（那是别的套件的事）。
//   · 上限类判据**只能发现变多、发现不了变少** ⇒ 故配 S1/S2 两道非退化检查兜底。
//   · 复现 devtools 的 ignore 语义（官方文档：value 以小程序根为根、全部大小写不敏感）；
//     `prefix` 的匹配面（路径前缀 vs 文件名前缀）官方未写死 ⇒ 本守卫取两者**并集**，
//     并用 G-① 强制 `_` 族目录另有显式 folder 规则兜底，消除这个歧义。

(function () {
  const fs = require('fs');
  const path = require('path');

  const ROOT = path.resolve(__dirname, '..');
  const CFG_REL = 'project.config.json';

  // ---- 阈值（全部取实测值的保守侧；实测证据见 review/evidence/r181p_pack_guard/README.md）----
  const TOTAL_BUDGET_MB = 1.5;      // 实测入包 0.615 MB ⇒ 预算留约 2.4 倍余量，仍能抓到任何 >=0.9 MB 的新增垃圾
  const WECHAT_HARD_LIMIT_MB = 2;   // 微信预览 / 上传硬上限，不可协商
  const PER_TOP_CAP_MB = 0.8;       // 实测最大合法顶层项 = pages 0.426 MB ⇒ 取约 1.9 倍
  const MIN_KEPT_FILES = 60;        // 实测未忽略 108 个 ⇒ 保守下沿
  const MIN_RULES = 16;             // 实测 20 条
  const VALID_TYPES = ['folder', 'file', 'suffix', 'prefix', 'regexp', 'glob'];
  const UNSUPPORTED_TYPES = ['regexp', 'glob'];

  // G-① 必备规则（语义级：(type, value) 对，大小写不敏感；理由写清，便于新增时判断该不该动）
  const REQUIRED = [
    ['folder', 'specs', '规范目录不进小程序包'],
    ['folder', 'review', '评审 / 取证目录不进小程序包'],
    ['folder', '_m3', 'round181o 事故罪魁（调试截图堆 116 MB）'],
    ['folder', '_bak_r70', '变异备份残留不进小程序包'],
    ['folder', 'admin-h5', '内部管理后台（check_terms_forbidden.js 已声明不进小程序审核）'],
    ['folder', 'cloudfunctions', '云函数目录不进小程序包'],
    ['folder', 'tools', '判据脚本不进小程序包（R55 立约）'],
    ['folder', 'web-preview', 'H5 预览页不进小程序包'],
    ['folder', '.inscode', 'InsCode 本地元数据'],
    ['folder', '.atomcode', 'InsCode 本地元数据（.atomcode 目录）'],
    ['folder', 'node_modules', '依赖目录不进小程序包'],
    ['prefix', '_', '_ 族兜底：所有下划线开头的临时 / 调试 / 备份件'],
    ['suffix', '.md', '人读文档不进小程序包'],
    ['suffix', '.pdf', '导出件不进小程序包'],
    ['suffix', '.docx', '导出件不进小程序包'],
    ['suffix', '.txt', '导出件不进小程序包'],
    ['file', 'verify_all.js', '仓库根校验器不进小程序包'],
    ['file', 'LICENSE', '仓库元文件不进小程序包'],
    ['file', '.gitignore', '仓库元文件不进小程序包'],
    ['file', 'project.private.config.json', '个人 / 本地配置不进小程序包'],
  ];

  // S2 非退化锚点：这些文件若不在入包集合内，说明扫描面被扫空 / 根路径写错（而非「包变小了」）
  const ANCHORS = ['app.js', 'app.json', 'app.wxss', 'pages/card/index.js', 'pages/takeaway/index.js'];

  // S3 匹配器正负样本（自带规则表，不依赖真实配置 ⇒ 配置坏了也能自证匹配器是否还活着）
  const SAMPLE_RULES = [
    { type: 'folder', value: 'aaaa' },
    { type: 'file', value: 'bb/bb.js' },
    { type: 'suffix', value: '.ccc' },
    { type: 'prefix', value: 'ddd' },
  ];
  const SAMPLE_POS = ['aaaa/f1.js', 'aaaa/deep/f2.wxml', 'bb/bb.js', 'x/y/zz.ccc', 'ddd_1.py', 'ddd/inner.js'];
  // 负样本必须「只缺被测项」：aaaa.txt 是与 folder:aaaa 同级、名字沾边的普通文件
  //   （⚠️ 首版把 'aaaa' 本身当负样本 ⇒ 它作为**路径**确实会被 folder:aaaa 命中 ⇒ 自己造了一条假红）
  const SAMPLE_NEG = ['pages/f1.js', 'bb/other.js', 'x/y/zz.ccd', 'eee_1.py', 'aaaa.txt'];

  let pass = 0;
  let failN = 0;
  const bad = [];
  function check(name, cond, detail) {
    if (cond) {
      pass++;
      console.log('✅ ' + name + (detail ? ' · ' + detail : ''));
    } else {
      failN++;
      bad.push(name + (detail ? ' · ' + detail : ''));
      console.log('❌ ' + name + (detail ? ' · ' + detail : ''));
    }
  }
  const mb = (b) => Math.round((b / 1048576) * 10000) / 10000 + ' MB';

  // 匹配器：镜像 devtools 语义（value 以小程序根为根、大小写不敏感）；返回命中的规则串，便于失败时报出罪魁
  function makeMatcher(rules) {
    const folders = new Set();
    const files = new Set();
    const suffixes = new Set();
    const prefixes = new Set();
    for (const r of rules || []) {
      const t = String((r && r.type) || '').toLowerCase();
      const v = String((r && r.value) || '').toLowerCase();
      if (t === 'folder') folders.add(v);
      else if (t === 'file') files.add(v);
      else if (t === 'suffix') suffixes.add(v);
      else if (t === 'prefix') prefixes.add(v);
    }
    return function hit(rel) {
      const low = String(rel).toLowerCase();
      const seg = low.split('/');
      const base = seg[seg.length - 1];
      for (let i = 1; i <= seg.length; i++) {
        const p = seg.slice(0, i).join('/');
        if (folders.has(p)) return 'folder:' + p;
      }
      if (files.has(low)) return 'file:' + low;
      for (const s of suffixes) if (low.endsWith(s)) return 'suffix:' + s;
      for (const p of prefixes) if (low.startsWith(p) || base.startsWith(p)) return 'prefix:' + p;
      return null;
    };
  }

  // 目录遍历（跳过 .git —— 它从不进包）
  function collectDirs(dir, out) {
    out.push(dir);
    let ents = [];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return out;
    }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      if (e.name === '.git') continue;
      collectDirs(path.join(dir, e.name), out);
    }
    return out;
  }

  // ---- 前置（fail-closed：配置不可解析 ⇒ 判红，绝不当成「零字节所以安全」）----
  let cfg = null;
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(ROOT, CFG_REL), 'utf8'));
  } catch (e) {
    cfg = null;
  }
  if (!cfg || !cfg.packOptions || !Array.isArray(cfg.packOptions.ignore)) {
    console.log('❌ 前置 ' + CFG_REL + ' 可解析且含 packOptions.ignore 数组 · '
      + (cfg ? 'packOptions.ignore 不是数组' : 'JSON 解析失败或文件缺失'));
    console.log('\n==== R182 打包体积守卫：0 通过 / 1 失败 ====');
    console.log('   ❌ 前置失败 ⇒ fail-closed（配置读不到时「入包 0 字节」是假绿，不许放行）');
    process.exit(1);
  }
  const RULES = cfg.packOptions.ignore;

  // =====================================================================
  console.log('===== S · 自失效护栏（防「判据恒真」与「扫描面扫空」）=====');
  const sampleMatcher = makeMatcher(SAMPLE_RULES);
  let matcherHits = 0;
  for (const s of SAMPLE_POS) if (sampleMatcher(s)) matcherHits++;
  let matcherMiss = 0;
  for (const s of SAMPLE_NEG) if (sampleMatcher(s)) matcherMiss++;
  check('S3-a 匹配器正样本全部命中（folder / file / suffix / prefix 四类）',
    matcherHits === SAMPLE_POS.length, matcherHits + '/' + SAMPLE_POS.length + ' 命中');
  check('S3-b 匹配器负样本全部放行（禁「一律忽略」式恒真）',
    matcherMiss === 0, (SAMPLE_NEG.length - matcherMiss) + '/' + SAMPLE_NEG.length + ' 放行');

  const isIgnored = makeMatcher(RULES);
  const dirs = collectDirs(ROOT, []);
  const kept = [];
  const tops = new Map();
  let allFiles = 0;
  for (const dp of dirs) {
    let ents = [];
    try {
      ents = fs.readdirSync(dp, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const e of ents) {
      if (!e.isFile()) continue;
      const abs = path.join(dp, e.name);
      const rel = path.relative(ROOT, abs).split(path.sep).join('/');
      allFiles++;
      let size = 0;
      try {
        size = fs.statSync(abs).size;
      } catch (e2) {
        continue;
      }
      if (isIgnored(rel)) continue;
      kept.push({ rel: rel, size: size });
      const top = rel.split('/')[0];
      tops.set(top, (tops.get(top) || 0) + size);
    }
  }
  const keptSet = new Set(kept.map((k) => k.rel));

  check('S1 扫描面非退化：未忽略文件数达下界', kept.length >= MIN_KEPT_FILES,
    '全盘 ' + allFiles + ' 个文件中未忽略 ' + kept.length + ' 个（下界 ' + MIN_KEPT_FILES + '）');
  const anchorMiss = ANCHORS.filter((a) => !keptSet.has(a));
  check('S2 关键入口真在入包集合内（扫空 / 根路径写错即转红）', anchorMiss.length === 0,
    anchorMiss.length ? '缺失 ' + anchorMiss.join(', ') : '锚点 ' + ANCHORS.length + ' 个全部命中');

  // =====================================================================
  console.log('\n===== P · 入包体积（微信预览 / 上传硬上限 ' + WECHAT_HARD_LIMIT_MB + ' MB）=====');
  const totalBytes = kept.reduce((a, b) => a + b.size, 0);
  const sortedTops = Array.from(tops.entries()).sort((a, b) => b[1] - a[1]);
  console.log('   入包总量 ' + mb(totalBytes) + ' · 未忽略文件 ' + kept.length + ' 个');
  console.log('   未忽略顶层条目（按体积）：' + (sortedTops.length
    ? sortedTops.map((t) => t[0] + '=' + mb(t[1])).join(' / ') : '(无)'));
  check('P-① 入包总量 ≤ 预算', totalBytes <= TOTAL_BUDGET_MB * 1048576,
    '实测 ' + mb(totalBytes) + ' / 预算 ' + TOTAL_BUDGET_MB + ' MB');
  check('P-② 预算常量自洽：预算 < 微信硬上限（防「改大预算绕过」）',
    TOTAL_BUDGET_MB < WECHAT_HARD_LIMIT_MB && PER_TOP_CAP_MB <= TOTAL_BUDGET_MB,
    '预算 ' + TOTAL_BUDGET_MB + ' MB < 硬上限 ' + WECHAT_HARD_LIMIT_MB + ' MB，且单条目顶格 '
    + PER_TOP_CAP_MB + ' MB ≤ 预算');
  const overTop = sortedTops.filter((t) => t[1] > PER_TOP_CAP_MB * 1048576);
  check('P-③ 无单个未忽略顶层条目超顶格', overTop.length === 0,
    overTop.length
      ? '罪魁：' + overTop.map((t) => t[0] + '=' + mb(t[1]) + '（> ' + PER_TOP_CAP_MB + ' MB）').join('；')
        + ' ⇒ 多半是新的临时目录 / 截图堆没进 packOptions.ignore'
      : '最大项 ' + (sortedTops.length ? sortedTops[0][0] + '=' + mb(sortedTops[0][1]) : '无')
        + ' ≤ 顶格 ' + PER_TOP_CAP_MB + ' MB');

  // =====================================================================
  console.log('\n===== G · ignore 规则完整性 =====');
  // ⚠️ 两侧都必须归一化：配置值已 lower、REQUIRED 侧若漏 lower ⇒ 只有含大写的项（LICENSE）会假报缺失
  const pairs = new Set(RULES.map((r) => String((r && r.type) || '').toLowerCase()
    + '|' + String((r && r.value) || '').toLowerCase()));
  const missing = REQUIRED.filter((q) => !pairs.has(q[0].toLowerCase() + '|' + q[1].toLowerCase()));
  check('G-① 必备 ignore 规则逐条在位', missing.length === 0,
    missing.length
      ? '缺 ' + missing.length + ' 条：' + missing.map((q) => q[0] + ':' + q[1] + '（' + q[2] + '）').join('；')
      : '必备 ' + REQUIRED.length + ' 条全部命中（配置共 ' + RULES.length + ' 条）');
  check('G-② 规则条数达下界', RULES.length >= MIN_RULES,
    '实测 ' + RULES.length + ' 条 / 下界 ' + MIN_RULES);
  const badType = RULES.filter((r) => VALID_TYPES.indexOf(String((r && r.type) || '').toLowerCase()) < 0);
  check('G-③ 每条规则 type ∈ 官方六种', badType.length === 0,
    badType.length ? '非法 type：' + badType.map((r) => String(r.type)).join(', ')
      : '全部 ∈ ' + VALID_TYPES.join(' / '));
  const unsupported = RULES.filter((r) => UNSUPPORTED_TYPES.indexOf(String((r && r.type) || '').toLowerCase()) >= 0);
  check('G-④ 未使用 regexp/glob（本守卫未实现其匹配，出现即 fail-closed）', unsupported.length === 0,
    unsupported.length
      ? '出现 ' + unsupported.map((r) => String(r.type) + ':' + String(r.value)).join(', ')
        + ' ⇒ 本守卫会把它当「未忽略」而虚报体积；请改用 folder/file/suffix/prefix，或先扩展本守卫'
      : '零 regexp/glob 规则');

  // =====================================================================
  console.log('\n==== R182 打包体积守卫：' + pass + ' 通过 / ' + failN + ' 失败 ====');
  if (failN) {
    bad.forEach((b) => console.log('   ❌ ' + b));
    console.log('\n修复指引：');
    console.log('  1) P 段红：把罪魁目录 / 后缀加进 project.config.json 的 packOptions.ignore');
    console.log('     （`.gitignore` 对微信打包**无效** —— 开发者工具只认 packOptions.ignore）；');
    console.log('  2) G-① 红：缺的必备规则按失败行逐条补回，`_` 族另须显式 folder 规则兜底；');
    console.log('  3) S 段红：先怀疑扫描面 / 匹配器被改坏，不要先去调阈值。');
  }
  process.exit(failN === 0 ? 0 : 1);
})();
