// tools/selftest_ad_gates.js —— 上线前 AD 缺口补齐（G1~G8 + debounce）静态自测
// 运行： node tools/selftest_ad_gates.js
// 覆盖：G1 字号≥28rpx / G2 触控≥88rpx / G3 adjust-position / G4 热更新 / G5 头像昵称 /
//       G6 vibrateShort / G7 scene / G8 断网提示 / debounce 已删。
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}
function readAll(roots, ext) {
  const out = [];
  const walk = (p) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const f = path.join(p, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith(ext)) out.push(f);
    }
  };
  for (const r of roots) walk(path.join(ROOT, r));
  return out;
}

console.log('===== G1 · 字号 ≥28rpx（应 0 残留）=====');
const g1Files = readAll(["pages"], ".wxss").concat([path.join(ROOT, "app.wxss")]);
let g1bad = [];
const g1re = /font-size:\s*([0-9]|1[0-9]|2[0-7])(\.[0-9]+)?rpx/;
for (const f of g1Files) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  lines.forEach((ln, i) => { if (g1re.test(ln)) g1bad.push(`${path.relative(ROOT, f).replace(/\\/g, "/")}:${i + 1} ${ln.trim().slice(0, 60)}`); });
}
check('G1 无 <28rpx 字号（0 残留）', g1bad.length === 0, g1bad.length ? g1bad.slice(0, 3).join(' | ') : '');
const g1scope = readAll(["pages/month"], ".wxss").map((f) => fs.readFileSync(f, "utf8")).join("\n");
check('G1 .scope（填表引导口径）≥28rpx', !/\.scope \{[^}]*font-size:\s*2[0-7]rpx/.test(g1scope));

console.log('===== G2 · 触控 ≥88rpx（占位 20/40rpx 除外）=====');
const g2bad = [];
const g2re = /min-height:\s*([0-9]|1[0-9]|2[0-7]|3[0-9]|4[0-9]|5[0-9]|6[0-9]|7[0-9])(\.[0-9]+)?rpx/;
for (const f of g1Files) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  lines.forEach((ln, i) => {
    if (g2re.test(ln) && !/min-height:\s*(20|40)rpx/.test(ln)) g2bad.push(`${path.relative(ROOT, f).replace(/\\/g, "/")}:${i + 1} ${ln.trim().slice(0, 60)}`);
  });
}
const g2wxml = readAll(["pages"], ".wxml").map((f) => fs.readFileSync(f, "utf8")).join("\n");
const g2inline = (g2wxml.match(/min-height:\s*([0-9]|1[0-9]|2[0-7]|3[0-9]|4[0-9]|5[0-9]|6[0-9]|7[0-9])rpx/g) || []);
check('G2 wxss 无 <88rpx min-height（20/40 占位除外）', g2bad.length === 0, g2bad.slice(0, 3).join(' | '));
check('G2 wxml 内联无 <88rpx min-height', g2inline.length === 0, g2inline.join(','));

console.log('===== G3 · 数字输入 adjust-position =====');
const numInputs = (g2wxml.match(/<input[\s\S]*?type="(digit|number)"[\s\S]*?\/>/g) || []);
const withoutAdj = numInputs.filter((t) => !/adjust-position/.test(t));
check(`G3 全部数字输入含 adjust-position（共 ${numInputs.length} 个）`, withoutAdj.length === 0, withoutAdj.length ? '缺: ' + withoutAdj.length : '');
check('G3 均配 cursor-spacing', numInputs.every((t) => /cursor-spacing/.test(t)));

console.log('===== G4 · 热更新 getUpdateManager =====');
const appJs = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
check('G4 app.js 有 setupUpdate/getUpdateManager', /setupUpdate\(\)/.test(appJs) && /getUpdateManager/.test(appJs));
check('G4 有 applyUpdate（用户确认后）', /um\.applyUpdate\(\)/.test(appJs));
check('G4 同版本只提示一次（updatePromptedVersion 去重）', /updatePromptedVersion/.test(appJs));
check('G4 不静默强更（showModal + updateTitle 用户确认）', /wx\.showModal/.test(appJs) && /updateTitle/.test(appJs) && /um\.applyUpdate\(\)/.test(appJs));

console.log('===== G5 · 头像昵称（AD-15）=====');
const mineWxml = fs.readFileSync(path.join(ROOT, "pages/mine/index.wxml"), "utf8");
const mineJs = fs.readFileSync(path.join(ROOT, "pages/mine/index.js"), "utf8");
check('G5 mine 页有 chooseAvatar 按钮', /open-type="chooseAvatar"/.test(mineWxml) && /bindchooseavatar="onChooseAvatar"/.test(mineWxml));
check('G5 mine 页有 nickname 输入', /type="nickname"/.test(mineWxml));
check('G5 未用废弃 getUserProfile 调用', !/getUserProfile\(\{/.test(mineJs + mineWxml));

console.log('===== G6 · 触觉反馈（不可逆操作）=====');
const amortizeJs = fs.readFileSync(path.join(ROOT, "pages/month/amortize.js"), "utf8");
check('G6 报废资产 vibrateShort(medium)', /onTerminate[\s\S]{0,800}vibrateShort/.test(amortizeJs));
check('G6 注销 vibrateShort', /doLogout[\s\S]{0,400}vibrateShort/.test(mineJs));
check('G6 仅不可逆操作（amortize 仅 1 行 vibrateShort 调用）', (amortizeJs.match(/wx\.vibrateShort\(\{/g) || []).length === 1);

console.log('===== G7 · 场景值留痕 =====');
check('G7 app.js 有 recordScene', /recordScene\(options\)/.test(appJs) && /launchScene/.test(appJs));
check('G7 onLaunch 与 onShow 都记录', /onLaunch\(options\)[\s\S]{0,400}recordScene/.test(appJs) && /onShow\(options\)[\s\S]{0,400}recordScene/.test(appJs));

console.log('===== G8 · 断网提示 =====');
check('G8 app.js 有 onNetworkStatusChange', /setupNetwork\(\)/.test(appJs) && /onNetworkStatusChange/.test(appJs));
check('G8 断网给全局提示（offlineBody）', /offlineBody/.test(appJs));
const apiJs = fs.readFileSync(path.join(ROOT, "utils/api.js"), "utf8");
check('G8 api.js 区分网络错误（NETWORK_ERROR）', /NETWORK_ERROR/.test(apiJs) && /networkErr/.test(apiJs));

console.log('===== debounce 死代码 =====');
check('debounce 已从 api.js 删除', !/debounce/.test(apiJs));
check('全仓无 debounce 调用残留', readAll(["pages", "utils"], ".js").every((f) => !/\.debounce\(/.test(fs.readFileSync(f, "utf8"))));

console.log('===== K11 双副本 =====');
const t1 = fs.readFileSync(path.join(ROOT, "miniprogram/i18n/terms.js"), "utf8");
const t2 = fs.readFileSync(path.join(ROOT, "specs/dev-specs/i18n/terms.js"), "utf8");
check('K11 i18n 双副本逐字一致', t1 === t2);

console.log(`\n==== 上线前 AD 缺口自测：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
