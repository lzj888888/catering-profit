// ⚠️ 本文件由 tools/sync_common.js 从 cloudfunctions/common/ 单源自动派生，请勿手改。
// 为什么是「文件」而不是「目录」：2026-09-15 云端实测，Windows 侧打包会把子目录
// 拼成 "common\xxx.js" 这种带反斜杠的扁平文件名，Linux 云端不认它是目录，
// 导致 require('./common') 报 MODULE_NOT_FOUND。故此云函数包内不使用子目录。
module.exports = require('./cx_index');
