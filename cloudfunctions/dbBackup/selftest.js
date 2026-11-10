// cloudfunctions/dbBackup/selftest.js —— R688 · 备份轮转自测
// 运行： node cloudfunctions/dbBackup/selftest.js
//
// 只测得到"能测的部分"（shiftStamp 跨年、保留期常量、轮转触发条件）——
// 真实删除要连云存储，本机测不了，故用源码结构断言 + 纯函数求值两层。
// 诚实说明：**轮转是否真的删掉了文件，只能靠云端日志的「轮转：删除 N 个超期文件」确认**。
const fs = require('fs');
const path = require('path');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

const RAW = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
const SRC = (() => {
  return RAW.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
})();

// ===== A. 纯函数：shiftStamp 从源码取出来真跑 =====
console.log('===== A · shiftStamp 月份偏移（跨年最容易错）=====');
const fnSrc = SRC.match(/function shiftStamp\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
check('源码存在 shiftStamp 函数', !!fnSrc);
let shiftStamp;
if (fnSrc) {
  // eslint-disable-next-line no-new-func
  shiftStamp = new Function('return (' + fnSrc[0] + ')')();
} else {
  shiftStamp = () => '';
}

check('2026-11 往前 2 期 = 2026-09', shiftStamp('2026-11', -2) === '2026-09', shiftStamp('2026-11', -2));
check('跨年：2026-01 往前 2 期 = 2025-11（借位）', shiftStamp('2026-01', -2) === '2025-11', shiftStamp('2026-01', -2));
check('跨年：2026-02 往前 3 期 = 2025-11', shiftStamp('2026-02', -3) === '2025-11', shiftStamp('2026-02', -3));
check('往前 12 期 = 上一年同月', shiftStamp('2026-11', -12) === '2025-11', shiftStamp('2026-11', -12));
check('往前 24 期 = 前年同月', shiftStamp('2026-11', -24) === '2024-11', shiftStamp('2026-11', -24));
check('往前 0 期 = 自身', shiftStamp('2026-11', 0) === '2026-11');
check('非法入参返回空串（不抛错、不返回乱值）', shiftStamp('abc', -2) === '' && shiftStamp('', -2) === '');
check('变异自证：若把借位写反（mo<=0 时直接置 12 不减年）本题会红',
  shiftStamp('2026-01', -2) !== '2026-11');

// ===== B. 保留期常量 =====
console.log('\n===== B · 保留期 =====');
check('KEEP_EPOCHS = 2（当期 + 上一期；不设 1 是为防"当月失败即无备份"）',
  /const KEEP_EPOCHS = 2;/.test(SRC));
check('有 MAX_EPOCHS_BACK 上限（防扫太远/死循环）', /MAX_EPOCHS_BACK = \d+/.test(SRC));
check('保留 2 期 ≈ 最老数据 60 天（与隐私政策口径一致）',
  KEEP_EPOCHS_HINT());

function KEEP_EPOCHS_HINT() {
  const m = SRC.match(/const KEEP_EPOCHS = (\d+);/);
  const n = m ? Number(m[1]) : 0;
  // 60 天口径写在注释里 ⇒ 查 RAW 而不是剥注释的 SRC，防「改了常量忘改文案」
  return n === 2 && /约 60 天/.test(RAW);
}

// ===== C. 轮转触发条件 =====
console.log('\n===== C · 什么时候才允许删旧备份 =====');
check('轮转只在本期完全成功时执行（失败还删旧 = 把仅存的完整备份也弄没了）',
  /if \(!ok \|\| !done\.length\)/.test(SRC) && /本期未完全成功，跳过轮转/.test(SRC));
check('轮转失败/缺失都记入 rotation 结果（不静默）',
  /rotation\.reason/.test(SRC) && /rotation\.failed/.test(SRC));
check('存储前缀从**本次上传返回的 fileID**提取，不硬编码 env/bucket',
  /indexOf\('\/backup\/'\)/.test(SRC) && !/cloud:\/\/[a-z0-9-]+\./.test(SRC));
check('解析不到前缀时跳过（宁可少删也不误删）',
  /无法从 file_id 解析存储前缀/.test(SRC));
check('deleteFile 分批（单次 ≤50）', /i \+= 50/.test(SRC));
check('轮转结果挂进返回值（可被日志/调用方核查）', /summary\.rotation = rotation/.test(SRC));

console.log(`\n==== dbBackup 轮转自测结果：${pass} 通过 / ${failN} 失败 ====`);
console.log('⚠️ 未覆盖：轮转是否真删掉云端文件 —— 本机无云存储，只能看云端日志「轮转：删除 N 个超期文件」');
process.exit(failN === 0 ? 0 : 1);
