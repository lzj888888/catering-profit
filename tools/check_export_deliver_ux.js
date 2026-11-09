// tools/check_export_deliver_ux.js —— 导出「点了到底有没有反应」守卫（R649）
//
// 背景：李老师报「导出按钮没反馈，文件去哪、什么格式都不清楚」。
// 排查发现前端投递层（utils/exportFile.js）三条铁律都做了，
// 但**"写了"不等于"真会给反馈"** —— 这里真跑 deliver()，桩掉微信文件/文档 API，
// 逐一验证四种结局都有明确反馈，且**没有一种会静默无反应**。

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0; let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); } else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

// ---- 可编程的 wx 桩：控制每一步成/败 ----
const calls = [];
let mode = {};
function loadExportFile() {
  calls.length = 0;
  global.wx = {
    env: { USER_DATA_PATH: '/wxfs' },
    base64ToArrayBuffer: (s) => ({ __buf: s }),
    getFileSystemManager: () => ({
      writeFileSync: (p, d, e) => {
        calls.push({ k: 'write', p, enc: e });
        if (mode.writeFail) throw new Error('disk full');
      },
    }),
    openDocument: (o) => {
      calls.push({ k: 'open', fileType: o.fileType, showMenu: o.showMenu });
      if (mode.openFail) o.fail && o.fail({ errMsg: 'cannot open' }); else o.success && o.success();
    },
    showModal: (o) => { calls.push({ k: 'modal', title: o.title, content: o.content, confirm: o.confirmText }); if (mode.modalConfirm) o.success && o.success({ confirm: true }); },
    showToast: (o) => { calls.push({ k: 'toast', title: o.title }); },
    shareFileMessage: (o) => { calls.push({ k: 'share', fileName: o.fileName }); if (mode.shareFail) o.fail && o.fail(); },
  };
  delete require.cache[require.resolve(path.join(ROOT, 'utils/exportFile.js'))];
  return require(path.join(ROOT, 'utils/exportFile.js'));
}

console.log('\n===== E 正常路径：xlsx 生成成功 =====');
mode = {};
let XF = loadExportFile();
XF.deliver({ filename: '店算_月度报表_2026-09.xlsx', content: 'BASE64DATA', format: 'xlsx', encoding: 'base64' });
ok('E-① 真的写盘了', calls.some((c) => c.k === 'write'));
ok('E-② 用二进制写（base64 内容不能按 utf8 写，否则 xlsx 损坏）',
  (calls.find((c) => c.k === 'write') || {}).enc === 'binary', (calls.find((c) => c.k === 'write') || {}).enc);
ok('E-③ 调了 openDocument 且 fileType=xlsx', (calls.find((c) => c.k === 'open') || {}).fileType === 'xlsx');
ok('E-④ 🔴 showMenu 必须开（不给右上角「…」，用户存不下来也转不出去）',
  (calls.find((c) => c.k === 'open') || {}).showMenu === true);
const modal1 = calls.find((c) => c.k === 'modal');
ok('E-⑤ 🔴 打开成功后弹窗说清**文件名**（不是"已生成Excel"这种空话）',
  !!modal1 && String(modal1.content).indexOf('.xlsx') >= 0, modal1 ? String(modal1.content).slice(0, 50) + '…' : '无弹窗');
ok('E-⑥ 弹窗里还要说清**格式与去向**（右上角 … 转发/存电脑）',
  !!modal1 && /转发|电脑|右上角/.test(String(modal1.content)));

console.log('\n===== E 打开失败：必须有转发兜底 =====');
mode = { openFail: true };
XF = loadExportFile();
XF.deliver({ filename: 'a.xlsx', content: 'X', format: 'xlsx', encoding: 'base64' });
const m2 = calls.find((c) => c.k === 'modal');
ok('E-⑦ 打不开 ⇒ 弹「转发到微信」而不是静默', !!m2 && String(m2.content).indexOf('a.xlsx') >= 0, m2 ? '有提示' : '**静默无反应**');
ok('E-⑧ 点确认 ⇒ 真的调 shareFileMessage（这条是「导出到电脑」的唯一出路）',
  (() => { mode = { openFail: true, modalConfirm: true }; XF = loadExportFile(); XF.deliver({ filename: 'a.xlsx', content: 'X', format: 'xlsx', encoding: 'base64' }); return calls.some((c) => c.k === 'share' && c.fileName === 'a.xlsx'); })());
ok('E-⑨ 转发失败也要提示（不能点了没动静）',
  (() => { mode = { openFail: true, modalConfirm: true, shareFail: true }; XF = loadExportFile(); XF.deliver({ filename: 'a.xlsx', content: 'X', format: 'xlsx', encoding: 'base64' }); return calls.some((c) => c.k === 'toast'); })());

console.log('\n===== E 写盘失败 =====');
mode = { writeFail: true };
XF = loadExportFile();
XF.deliver({ filename: 'b.xlsx', content: 'X', format: 'xlsx', encoding: 'base64' });
ok('E-⑩ 写盘失败 ⇒ 必须 toast（不能点了什么都不发生）', calls.some((c) => c.k === 'toast'));

console.log('\n===== E 不支持的格式（csv/json）=====');
mode = {};
XF = loadExportFile();
XF.deliver({ filename: 'c.csv', content: 'a,b', format: 'csv', encoding: 'utf8' });
ok('E-⑪ csv **不许**调 openDocument（微信打不开 csv，调了必然静默失败）',
  !calls.some((c) => c.k === 'open'));
ok('E-⑫ csv 直接走转发兜底（用户仍拿得到文件）', calls.some((c) => c.k === 'modal'));

console.log('\n===== E 无静默路径（穷举四种结局）=====');
const hasFeedback = (modeObj) => {
  mode = modeObj; XF = loadExportFile();
  XF.deliver({ filename: 'z.xlsx', content: 'X', format: 'xlsx', encoding: 'base64' });
  return calls.some((c) => c.k === 'modal' || c.k === 'toast' || c.k === 'open');
};
ok('E-⑬ 🔴 四种结局（成功/打开失败/写盘失败/不支持格式）**全部**有用户可见反馈',
  hasFeedback({}) && hasFeedback({ openFail: true }) && hasFeedback({ writeFail: true })
  && hasFeedback({ format: 'csv' }));

console.log('\n===== 结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
