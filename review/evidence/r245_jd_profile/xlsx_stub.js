// 探针用 xlsx 替身：cloudfunctions/importSalesBill/service.js 只在 bufferToMatrix 里用 XLSX，
// 本探针只测 parseBillMatrix / detectPlatform ⇒ 不需要真实现（PITFALLS §23 补丁法）。
module.exports = { utils: {}, read: function () { throw new Error('stub'); } };
