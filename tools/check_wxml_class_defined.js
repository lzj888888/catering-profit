#!/usr/bin/env node
// tools/check_wxml_class_defined.js —— R351 · 「class 用了但没样式」守卫
//
// ============ 为什么要有这条（R351 实扫，不是假想）============
// 扫 pages/sandbox/*.wxml 发现 7 个 class 被引用，但 `app.wxss` 与同页 `.wxss` 里
// **从来没有定义**：warn / warn-note / ipt-num / unit / entry-row / entry-btn / cmp。
// 它们的共同点：**能编译、能运行、零报错，只是长得不对**（走浏览器默认样式）。
//   · `.warn` —— 活动卡在「让价超过毛利率，卖多少都亏」时的告警块，本该琥珀底+左侧竖条，
//                实际渲染成一行普通黑字 ⇒ **最关键的那句警告最不像警告**。
//   · `.entry-row/.entry-btn` —— `.btn` 是 `display:flex` 且未限宽 ⇒ 两个入口按钮各自占满整行。
//   · `.ipt-num/.unit` —— 外卖渠道 7 个输入框与单位走默认样式，和同页 `.row-in/.row-unit` 不一致。
//
// 为什么既有守卫都没抓到：
//   check_wxml_structure（R123）只看标签/属性/if-else 相邻性；
//   check_page_card_width 只看 `.card` 类。
//   **没有任何一条把 wxml 的 class 与 wxss 的选择器做集合比对** —— 本条补的就是这个缺口。
//
// ============ 四条判据 ============
// A-① 静态 class token 必须能在「app.wxss ∪ 同页 .wxss」找到定义（白名单除外）
// A-② 白名单项**必须仍然无定义** —— 有人给它补了样式却不摘白名单 ⇒ 白名单变成永久豁免 ⇒ 判红
// A-③ 每个 .wxml 都必须真被读到、且确实解析出 class —— 防「glob 失效 ⇒ 0 文件 ⇒ 全绿」
// A-④ 动态前缀自检：`class="lv-{{x}}"` 必须只产出 `lv-` 并被跳过（
//      否则 `lv-` 这类拼接名会被误报，或反过来把真实类名整段吞掉 ⇒ 判据恒真）

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE_DIR = path.join(ROOT, 'pages/sandbox');

// 纯标记类：wxml 里写着，但**本来就不需要样式**（默认视图样式已够）。
// 加进来的理由必须写清；A-② 会盯着它，一旦有人补了样式就判红（逼着摘掉）。
const ALLOW_NO_STYLE = {
  'calc-basis': '纯标记位（.card2 已有样式），只是给未来定位留的钩子',
  cmp: '纯标记位（默认 view 就是 block），无样式依赖',
};

function readCss(file) {
  if (!fs.existsSync(file)) return new Set();
  const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const set = new Set();
  // 选择器里的类名：`.foo` / `.foo.bar` / `.foo-bar`
  for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) set.add(m[1]);
  return set;
}

// 把一个 class 属性的值拆成「静态 token」。
// `{{}}` 里的内容整段抹掉 —— 那是运行时才决定的类名，静态守卫无从判断。
function tokensOf(raw) {
  return raw
    .replace(/\{\{[\s\S]*?\}\}/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

const appCss = readCss(path.join(ROOT, 'app.wxss'));
const files = fs.readdirSync(PAGE_DIR).filter((f) => f.endsWith('.wxml')).sort();

const undefinedHits = [];   // {file, line, cls}
const allowStale = [];      // 白名单里其实已经有定义的
const emptyFiles = [];      // 读不到 / 没解析出 class 的文件
const scanned = [];

for (const f of files) {
  const wf = path.join(PAGE_DIR, f);
  const ownCss = readCss(wf.replace(/\.wxml$/, '.wxss'));
  const src = fs.readFileSync(wf, 'utf8');
  const lines = src.split('\n');
  let clsCount = 0;

  lines.forEach((line, i) => {
    // 跳过注释行：注释里出现 class="xxx" 不算引用
    if (/^\s*<!--/.test(line)) return;
    for (const m of line.matchAll(/class="([^"]*)"/g)) {
      for (const cls of tokensOf(m[1])) {
        // 动态拼接前缀（`lv-{{x}}` ⇒ `lv-`）：运行时才知道全名，静态判不了
        if (cls.endsWith('-') || /[{}]/.test(cls)) continue;
        clsCount += 1;
        if (appCss.has(cls) || ownCss.has(cls)) continue;
        if (Object.prototype.hasOwnProperty.call(ALLOW_NO_STYLE, cls)) continue;
        undefinedHits.push({ file: f, line: i + 1, cls });
      }
    }
  });

  if (clsCount === 0) emptyFiles.push(f);
  scanned.push({ file: f, clsCount });
}

// A-②：白名单必须「仍然无定义」，否则该摘掉
for (const cls of Object.keys(ALLOW_NO_STYLE)) {
  for (const f of files) {
    const ownCss = readCss(path.join(PAGE_DIR, f).replace(/\.wxml$/, '.wxss'));
    if (appCss.has(cls) || ownCss.has(cls)) {
      allowStale.push({ cls, file: f });
    }
  }
}

// A-④：动态前缀自检（用一个合成样本验同一套函数）
const selfSample = tokensOf('lv-{{item.lv}} static-cls');
const selfOk = selfSample.length === 2
  && selfSample[0] === 'lv-'
  && selfSample[1] === 'static-cls';

let pass = 0;
const bad = [];

if (undefinedHits.length === 0) { pass += 1; console.log('✅ A-① pages/sandbox/*.wxml 的静态 class 全部有样式定义'); }
else {
  for (const h of undefinedHits) {
    console.log(`  ❌ ${h.file}:${h.line} class="${h.cls}" 在 app.wxss 与本页 wxss 都没有定义`);
  }
  bad.push(`A-① 未定义 class ${undefinedHits.length} 处`);
}

if (allowStale.length === 0) { pass += 1; console.log('✅ A-② 白名单项确实仍无定义（没有变成永久豁免）'); }
else {
  for (const s of allowStale) console.log(`  ❌ ${s.file} 已给 .${s.cls} 补了样式，请从 ALLOW_NO_STYLE 摘掉`);
  bad.push(`A-② 白名单已过期 ${allowStale.length} 项`);
}

if (emptyFiles.length === 0 && scanned.length >= 3) { pass += 1; console.log(`✅ A-③ ${scanned.length} 个 wxml 全部读到并解析出 class`); }
else bad.push(`A-③ 文件数 ${scanned.length} / 空解析 ${emptyFiles.join(',') || '无'}`);

if (selfOk) { pass += 1; console.log('✅ A-④ 动态前缀样本 lv-{{x}} 正确拆成 lv- 并跳过'); }
else bad.push('A-④ 动态前缀解析异常');

console.log(bad.length
  ? `❌ class 定义守卫：${pass} 通过 / ${bad.length} 失败（${bad.join('；')}）`
  : `✅ class 定义守卫：${pass} 通过 / 0 失败（R351 · 未定义 class 0 处）`);

process.exit(bad.length ? 1 : 0);
