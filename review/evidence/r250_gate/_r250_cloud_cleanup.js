// review/evidence/r250_gate/_r250_cloud_cleanup.js
// R250 收尾：删掉 A/B 探针上传到**云存储**的临时文件（`sales_bills/r250_*`），保持环境干净。
//   🔴 本脚本**只删自己上传的探针文件**（按 r250_ 前缀白名单），不碰任何业务文件。
const automator = require('miniprogram-automator');
const WS = process.env.WS || 'ws://127.0.0.1:9420';

const FILE_IDS = process.argv.slice(2);
if (!FILE_IDS.length) { console.log('用法：node _r250_cloud_cleanup.js <fileID> [fileID...]'); process.exit(2); }
const bad = FILE_IDS.filter((f) => f.indexOf('/sales_bills/r250_') < 0);
if (bad.length) { console.log('❌ 拒绝删除非 r250 探针文件：', bad); process.exit(2); }

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS, timeout: 30000 });
  const r = await mp.evaluate(async (ids) => {
    try {
      const res = await wx.cloud.deleteFile({ fileList: ids });
      return { ok: true, res };
    } catch (e) { return { ok: false, err: (e && (e.errMsg || e.message)) || String(e) }; }
  }, FILE_IDS);
  console.log('deleteFile ⇒', JSON.stringify(r));
  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL', (e && e.message) || e); process.exit(1); });
