// R253 探针：证明 D4/D5 在 A2 变异下是否真有可观测差异（一次性，归档用）
const path = require('path');
const ROOT = process.argv[2];
const bp = require(path.join(ROOT, 'utils', 'billParse.js'));

const BOTH = ['账单日期', '结算金额', '商家应收款'];   // 同时满足淘宝+美团签名
const ROWS = [['表头组'], BOTH, ['1', '2', '3', '4']];

const rowsHit = bp.detectPlatformInRows(ROWS);
const matrixHit = bp.detectPlatformInMatrix({ sheets: { s1: { rows: ROWS } } });

console.log('detectPlatform(BOTH)      =', JSON.stringify(bp.detectPlatform(BOTH)));
console.log('detectPlatformInRows      =', JSON.stringify(rowsHit));
console.log('detectPlatformInMatrix    =', JSON.stringify(matrixHit));

// 关键：多 sheet 场景 —— 哨兵在 s1，正常平台在 s2（若瞎传会不会跳到 s2？不会，提前 return）
const MIX = { sheets: { s1: { rows: ROWS }, s2: { rows: [['账单日期', '结算金额']] } } };
console.log('matrix(mix s1哨兵,s2淘宝)  =', JSON.stringify(bp.detectPlatformInMatrix(MIX)));

// 关键：哨兵在**第二行**，第一行正常单平台 —— 显式拦会立即返回哨兵行？
const ROWS2 = [['账单日期', '结算金额'], BOTH];
console.log('rows(第一行淘宝,第二行哨兵) =', JSON.stringify(bp.detectPlatformInRows(ROWS2)));
