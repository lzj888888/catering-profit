#!/usr/bin/env node
// tools/check_docx_derive.js —— 派生件 .docx 内容守卫（把 tools/verify_docx.py 挂进 SUITES）
//
// 为什么需要这一层（2026-09-19 round53 发现）：
//   `tools/verify_docx.py` 是《改计数后必跑》的权威判据 —— 仓库根 .md 是单源，同名 .docx 是派生件，
//   .docx 是二进制、门禁 A–L 与各 check_*.js **都扫不到**，.docx 里装着已被否定的旧结论只能靠它抓。
//   但它此前**从未登记进 `verify_all.js` 的 SUITES** ⇒ 「门禁 66/66 全绿」这句话**不包含** docx 校验，
//   只要人忘了手动跑一次，docx 漂移就会一直躺在库里且无人知晓（"守卫存在" ≠ "被自动执行"，与 R86
//   「索引已建 ≠ 生效」同族）。本文件的唯一职责 = 把这条判据**变成每次门禁都会跑**。
//
// 实现要点：
//   1) `verify_all.js` 的 runner 固定用 `execFileSync(NODE, [fp])` ⇒ SUITES 项必须是 **node 脚本**，
//      不能直接挂 .py。故本文件做薄包装：找 python → 前置校验 → 跑 verify_docx.py → 透传输出 → 汇总收尾。
//   2) **fail-closed**：python 解释器不可用 / python-docx 缺失 / verify_docx.py 缺失 一律**判红**，
//      绝不静默跳过（静默跳过 = 把缺口换个地方继续藏着）。
//   3) 计数类期望值**不写死**：覆盖份数从 verify_docx.py 自己的输出里提取；若将来新增根 .docx，
//      只需同步本文件的 EXPECTED_DOCS 或从输出派生，不要复制第二份数字。
//
// 运行：node tools/check_docx_derive.js   （由 verify_all.js 的 [docx-derive] 套件调用）

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PY_SRC = 'tools/verify_docx.py';
// 根目录下"应当被校验"的派生件份数 —— 与 verify_docx.py 实际扫到的份数做交叉比对（不写死内容，只写死份数；
// 份数变化时必须同步此处，这是本守卫**唯一**允许存在的字面量，且变化时门禁会立刻红给你看）。
const EXPECTED_DOCS = 3;

function candidatePythons() {
  const list = [];
  if (process.env.DOCX_PYTHON) list.push(process.env.DOCX_PYTHON);
  if (process.env.PYTHON) list.push(process.env.PYTHON);
  list.push(path.join(os.homedir(), '.workbuddy/binaries/python/envs/default/Scripts/python.exe'));
  list.push(path.join(os.homedir(), '.workbuddy/binaries/python/envs/default/python.exe'));
  list.push('python');
  list.push('python3');
  list.push('py');
  return list;
}

function tryPython(py) {
  try {
    const args = path.basename(py).toLowerCase() === 'py' ? ['-3', '--version'] : ['--version'];
    execFileSync(py, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch (_) {
    return false;
  }
}

function hasDocx(py) {
  try {
    execFileSync(py, ['-c', 'import docx'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }),
    });
    return true;
  } catch (_) {
    return false;
  }
}

(function main() {
  const pass = [];
  const bad = [];
  // ⚠️ check() 必须**当场打印** ✅/❌：verify_all.js 的 R66 审计要求「每个段标题下至少一个 ✅」，
  //    只登记不打印 ⇒ 被判「断言疑似静默未跑」而转红（本文件首次接入时就踩过）。
  const check = (name, ok, detail) => {
    (ok ? pass : bad).push(name + (detail ? ' · ' + detail : ''));
    console.log((ok ? '✅ ' : '❌ ') + name + (detail ? ' · ' + detail : ''));
  };

  console.log('===== D1 前置：python 解释器可用 =====');
  let py = null;
  for (const cand of candidatePythons()) {
    if (tryPython(cand)) { py = cand; break; }
  }
  check('D1 python 解释器可用', !!py, py || '候选全部不可用：' + candidatePythons().join(' / '));
  if (!py) {
    console.log('   ❌ ' + bad.join('\n   ❌ '));
    console.log('\n修复指引：');
    console.log('  1) 设置环境变量 DOCX_PYTHON 指向带 python-docx 的解释器；');
    console.log('  2) 或安装托管 venv：~/.workbuddy/binaries/python/envs/default 并 `pip install python-docx`。');
    console.log('\n===== 派生件 docx 守卫结果：0 通过 / ' + bad.length + ' 失败 =====');
    process.exit(1);
  }

  console.log('\n===== D2 前置：python-docx 依赖可用 =====');
  const docxOk = hasDocx(py);
  check('D2 python-docx 依赖可用', docxOk, docxOk ? 'import docx OK' : py + ' 无法 `import docx`');
  if (!docxOk) {
    console.log('\n===== 派生件 docx 守卫结果：1 通过 / 1 失败 =====');
    process.exit(1);
  }

  console.log('\n===== D3 判据本体存在 =====');
  const srcOk = fs.existsSync(path.join(ROOT, PY_SRC));
  check('D3 ' + PY_SRC + ' 存在', srcOk, srcOk ? 'fail-closed 前置' : '判据本体丢失');
  if (!srcOk) {
    console.log('\n===== 派生件 docx 守卫结果：2 通过 / 1 失败 =====');
    process.exit(1);
  }

  // ===== 实跑 verify_docx.py =====
  let out = '';
  let rc = 0;
  let errMsg = '';
  try {
    out = execFileSync(py, [PY_SRC], {
      cwd: ROOT, encoding: 'utf8',
      env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }),
    });
  } catch (e) {
    rc = e.status === undefined ? -1 : e.status;
    out = String((e.stdout || '') + (e.stderr || ''));
    errMsg = String(e.message || '');
  }
  process.stdout.write('\n' + out);

  console.log('\n===== D4 · 实跑 verify_docx.py 退出码 =====');
  check('D4 ' + PY_SRC + ' 退出码为 0', rc === 0, rc === 0 ? 'rc=0' : 'rc=' + rc + (errMsg ? ' · ' + errMsg : ''));

  console.log('\n===== D5 · 覆盖份数（不写死内容，只交叉份数）=====');
  const m = /（(\d+)\s*份）/.exec(out);
  const got = m ? Number(m[1]) : null;
  check('D5 实扫份数 ≡ ' + EXPECTED_DOCS + ' 份', got === EXPECTED_DOCS,
    got === null ? '未能从输出解析份数（判据或输出格式变动）' : '实扫 ' + got + ' 份');

  console.log('\n===== D6 · 输出内无失败标记 =====');
  const noBad = !/❌/.test(out);
  check('D6 输出内零 ❌', noBad);

  const failN = bad.length;
  console.log('\n===== 派生件 docx 守卫结果：' + pass.length + ' 通过 / ' + failN + ' 失败 =====');
  if (failN) {
    bad.forEach((b) => console.log('   ❌ ' + b));
    console.log('\n修复指引：');
    console.log('  1) 若 D4/D6 红：按 verify_docx.py 的指引重生派生件（.md → .docx），别手改 docx；');
    console.log('  2) 若 D5 红：根目录新增/删除了派生 .docx，同步本文件 EXPECTED_DOCS 或补齐派生链。');
  }
  process.exit(failN === 0 ? 0 : 1);
})();
