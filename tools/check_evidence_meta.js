// tools/check_evidence_meta.js —— 证据文件「留证元信息」守卫（R95）
// 运行： node tools/check_evidence_meta.js
//
// 背景（复审方 round38 · R95）：**留证元信息自相矛盾，一天内第 3 例**：
//   ① `47_timeout_all.txt` 头注写「本文件不含任何云侧写入」，而 §F 含一次部署；
//   ② `48_result_raw_afterdrop.txt` 采集于 05:30，而引用它的前置写「05:31 已删除」（**前置晚于采集**）；
//   ③ round37 那张截图。
//   本仓对**代码/文档计数**有 6 个守卫，对**证据文件的元信息**一个都没有 ⇒ 本件补上。
//
// 规则（两条，都只管"声明与内容是否自洽"，不管内容对错）：
//   E1 纯读声明 vs 写入痕迹：
//      文件**头注区**（前 12 行）若声明「纯读 / 只读 / 不含任何云侧写入 / 无云侧写入」，
//      则全文出现**写入动作强信号**时，该痕迹所在**小节**（从最近的 `##`/`###` 标题起）
//      必须自带**例外声明**（「含一次云侧写入」「本节性质不同」「非纯读」等）。
//      ⇒ 诚实标注的例外**放行**（仓内 `47_timeout_all.txt §F` 就是这么写的，它是正面样本）；
//        **无声明却写入 = 元信息撒谎 ⇒ 判红**。
//   E2 时刻序：
//      同一文件内若同时有「采集时刻」与「前置动作时刻」，则 **前置 ≤ 采集**必须成立；
//      前置晚于采集 ⇒ 该文件描述的因果链不成立（先删后采，采到的是删除后的状态）⇒ 判红。
//
// 自失效护栏（否则"零命中"会伪装成绿）：
//   S1 扫描面文件数 ≥ 1（没有证据文件 = 守卫没在工作）；
//   S2 E1 至少**触发过一次完整检查**（有文件进到"声明纯读 + 检出写入痕迹"这一步），
//      否则说明正则已腐（比如标题形态变了、写入关键词写法变了）⇒ 判红。
//
// 边界（明写，别高估本守卫）：
//   · 只能查**能被引擎识别的显式标记**；隐式矛盾（截图里的时刻与正文不符）查不到 —— 那要人工。
//   · E2 依赖「采集/前置」字面标记；没写标记的文件**跳过**，不算通过也不算失败。
(function () {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.resolve(__dirname, '..');
  const EVIDENCE = path.join(ROOT, 'review', 'evidence');

  let pass = 0, failN = 0;
  const bad = [];
  function check(name, cond, detail) {
    if (cond) { pass++; console.log('✅ ' + name + (detail ? ' · ' + detail : '')); }
    else { failN++; bad.push(name + (detail ? ' · ' + detail : '')); console.log('❌ ' + name + (detail ? ' · ' + detail : '')); }
  }

  // ---------- 扫描面 ----------
  function walk(dir, out) {
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(md|txt)$/i.test(e.name)) out.push(p);
    }
    return out;
  }
  const files = walk(EVIDENCE, []);

  console.log('===== S · 自失效护栏 =====');
  check('S1 扫描面非空', files.length >= 1, 'review/evidence 下 .md/.txt = ' + files.length + ' 个');

  // ---------- 规则常量 ----------
  // 纯读声明（头注区）
  const PURE = /(纯读|只读|不含任何云侧写入|无云侧写入|零云侧写入|不含写入)/;
  // 写入动作强信号（要"动作性"，避免把"写入"这个名词本身当证据）
  const WRITE_ACT = [
    /cloud\s+functions\s+deploy/i,
    /cli\.bat[^\n]*deploy/i,
    /--apply\b/,
    /createCollection[\s\S]{0,120}ok\s*:\s*true/,
    /(saveLedger|saveAsset|saveCostCard|saveMaterial|archiveMonth|syncCostCard|payCallback|initDb)[^\n]*(SUCCESS|写入成功)/,
    /重发部署|重新部署|上传并部署/,
  ];
  // 例外声明（同一小节内出现即视为"已诚实标注"）
  const EXEMPT = /(含一次云侧写入|含云侧写入|本节性质.{0,12}不同|非纯读|含写入|不是纯读|例外)/;
  const HEAD_RE = /^#{2,3}\s+/m;

  // ---------- E1 ----------
  console.log('\n===== E1 · 纯读声明 vs 写入痕迹 =====');
  let e1Checked = 0, e1Exempt = 0;
  for (const f of files) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    let txt;
    try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
    const lines = txt.split(/\r?\n/);
    const head = lines.slice(0, 12).join('\n');
    if (!PURE.test(head)) continue;              // 没声明纯读 ⇒ 不适用本规则

    // 逐行找写入痕迹，回溯到所属小节标题，看该小节内是否有例外声明
    for (let i = 0; i < lines.length; i++) {
      const hit = WRITE_ACT.find((re) => re.test(lines[i]));
      if (!hit) continue;
      e1Checked++;
      // 回溯小节起点
      let start = i;
      for (let j = i; j >= 0; j--) { if (HEAD_RE.test(lines[j])) { start = j; break; } }
      const section = lines.slice(start, i + 1).join('\n');
      if (EXEMPT.test(section)) {
        e1Exempt++;
        console.log('   ↳ ' + rel + ':' + (i + 1) + ' 检出写入痕迹，但**同小节已声明例外** ⇒ 放行（正面样本）');
      } else {
        check('E1 ' + rel + ':' + (i + 1) + ' 声明纯读却无例外声明地含写入动作', false,
          '命中 /' + hit.source.slice(0, 40) + '/；该小节未见「含一次云侧写入」等例外声明' +
          ' ⇒ 要么补例外声明，要么改头注');
      }
    }
  }
  if (e1Checked === 0) {
    check('S2 E1 规则曾被完整触发（防正则腐化）', false,
      '没有任何"声明纯读 + 检出写入痕迹"的样本 ⇒ 正则可能已腐（标题形态/关键词写法变了），本条无法自证有效');
  } else {
    check('S2 E1 规则曾被完整触发（防正则腐化）', true, '触发 ' + e1Checked + ' 次，其中例外放行 ' + e1Exempt + ' 次');
  }

  // ---------- E2 ----------
  // ⚠️ 段标题**只在真有样本时才打印**：R66（`verify_all` 的 auditAssertions）会把「段标题下 ✅ == 0」
  //    判成「断言静默未跑」⇒ 若本轮没有「采集 + 前置」双标记的文件，打出空段会被 R66 判红。
  //    正解不是补一条恒真断言（那违反"断言不得恒真"），而是**不适用就不开段**。
  const HM = /(\d{1,2}):(\d{2})/;
  const toMin = (h, m) => Number(h) * 60 + Number(m);
  let e2Checked = 0;
  const e2Findings = [];
  for (const f of files) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    let txt;
    try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
    const lines = txt.split(/\r?\n/);
    // 采集时刻
    let collect = null;
    for (const l of lines) {
      const m = /(采集|捕获|生成)[^\d:]{0,10}(\d{1,2}):(\d{2})/.exec(l);
      if (m) { collect = toMin(m[2], m[3]); break; }
    }
    if (collect === null) continue;
    // 前置动作时刻（形如「05:31 已删除」「已删除 05:31」）
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const m = /(\d{1,2}):(\d{2})\s{0,4}(已删除|已清理|已提交|已部署|已改|已修|已重跑|已重建)/.exec(l)
        || /(前置|先)[^\d:]{0,10}(\d{1,2}):(\d{2})/.exec(l);
      if (!m) continue;
      const isPre = m[3] !== undefined && /(前置|先)/.test(m[0]);
      const pre = toMin(m[1] !== undefined && !isPre ? m[1] : m[2], isPre ? m[3] : m[2]);
      e2Checked++;
      e2Findings.push({
        rel, line: i + 1, pre, collect,
      });
    }
  }
  if (e2Checked === 0) {
    console.log('\n（E2 本轮无「采集 + 前置」双标记的文件 ⇒ 规则不适用，不开段以免 R66 误判零断言）');
  } else {
    console.log('\n===== E2 · 采集时刻 vs 前置动作时刻 =====');
    for (const f2 of e2Findings) {
      check('E2 ' + f2.rel + ':' + f2.line + ' 前置动作时刻 ≤ 采集时刻', f2.pre <= f2.collect,
        '前置 ' + String(Math.floor(f2.pre / 60)).padStart(2, '0') + ':' + String(f2.pre % 60).padStart(2, '0') +
        ' vs 采集 ' + String(Math.floor(f2.collect / 60)).padStart(2, '0') + ':' + String(f2.collect % 60).padStart(2, '0'));
    }
  }

  console.log('\n===== 留证元信息守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
  if (failN) { bad.forEach((b) => console.log('   ❌ ' + b)); }
  process.exit(failN === 0 ? 0 : 1);
})();
