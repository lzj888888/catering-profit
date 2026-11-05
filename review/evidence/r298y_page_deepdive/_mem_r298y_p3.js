'use strict';
/** R298Y 收尾 · 记忆维护第三遍（压缩 R272 覆盖率明细，落到 7000 以下） */
const fs = require('fs');
const path = require('path');
const DIR = 'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/.workbuddy/memory';
const MAIN = path.join(DIR, 'MEMORY.md');
const ARCH = path.join(DIR, 'MEMORY_外移_202610.md');
const chars = (s) => Array.from(s).length;

let main = fs.readFileSync(MAIN, 'utf8');
const before = chars(main);

const anchor = '堂食建卡/覆盖率 R272';
const cur = main.split('\n').find((l) => l.includes(anchor));
if (!cur) throw new Error('R272 锚点未命中');

const full = cur.replace(/^-\s*/, '').replace(/^🔴\s*/, '');
let arch = fs.readFileSync(ARCH, 'utf8');
if (!arch.endsWith('\n')) arch += '\n';
arch += '\n- 〔原 L19〕🔴 ' + full + '\n';
fs.writeFileSync(ARCH, arch, 'utf8');

const comp = '- 🔴 **堂食建卡/覆盖率 R272**：**快餐=自助档位不建单品卡**；⚠️ **改码需先审后合、未动**。四类闭合比例与 C 档覆盖率明细 ⇒ 外移件 〔原 L19〕。';
main = main.replace(cur, comp);
fs.writeFileSync(MAIN, main, 'utf8');

const after = chars(main);
console.log('主 MEMORY.md：' + before + ' → ' + after + '（余 ' + (8000 - after) + '）');
console.log('外移件：' + chars(fs.readFileSync(ARCH, 'utf8')) + ' 码点（阈值 60000）');
