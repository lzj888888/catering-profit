// utils/exportFile.js —— 导出文件的**投递单源**（R265）
//
// 为什么单独建这个文件：三处导出（M1 月度报表 / M3 菜品成本卡 / M2 方案对比）此前各写一份
//   `downloadContent`，且**全都踩同一个坑**——落 CSV 后调 `wx.openDocument({fileType:'csv'})`。
//   微信 fileType 合法值只有 doc/docx/xls/xlsx/ppt/pptx/pdf（**csv/json 一律打不开**）⇒ 必走 fail，
//   而 fail 回调是空的 ⇒ 用户只看到「导出完成」，文件躺在小程序沙箱里永远找不到（真机反馈）。
//
// 本单源三条铁律：
//   ① **白名单 fileType**：不在合法值里 ⇒ 不调 openDocument（调了也是白调），直接走转发兜底。
//   ② **showMenu 必开**：不给右上角「…」，用户拿到文件也存不下来/转不出去。
//   ③ **fail 不许空**：打开失败必须给「转发到微信」这条可走的路 + 说清文件叫什么。
'use strict';
const { TERMS } = require('../miniprogram/i18n/terms.js');

// 🔴 硬编码白名单 = 微信 openDocument 官方合法值（含 csv 就会静默失败，别加）
const OPENABLE = { doc: 'doc', docx: 'docx', xls: 'xls', xlsx: 'xlsx', ppt: 'ppt', pptx: 'pptx', pdf: 'pdf' };

// 🔴 R723（R721 台账 R3-1）：本会话导出文件名清单。只记文件名、不记内容；
//   注销时按清单逐个删，避免收入/成本/进价/店名月份以明文长期留在 USER_DATA_PATH。
//   ⚠️ 不能用「文件名前缀」做白名单：导出件以真实店名开头（exportData 生成
//      `${shopName}_${month}_月度报表.xlsx`），没有统一前缀 ⇒ 会漏删成假修好。
const EXPORTED_FILES_KEY = 'r723_exported_files';

function rememberExported(filename) {
  try {
    if (typeof wx.getStorageSync !== 'function' || typeof wx.setStorageSync !== 'function') return;
    const raw = wx.getStorageSync(EXPORTED_FILES_KEY) || [];
    const list = Array.isArray(raw) ? raw.slice() : [];
    if (list.indexOf(filename) < 0) list.push(filename);
    wx.setStorageSync(EXPORTED_FILES_KEY, list.slice(-50));
  } catch (e) { /* 记不下不影响导出主流程 */ }
}

/** 注销前调用：按清单删本次会话导出的文件。任何异常都不阻断登出。 */
function clearExportedFiles() {
  let list = [];
  try {
    const raw = wx.getStorageSync(EXPORTED_FILES_KEY) || [];
    list = Array.isArray(raw) ? raw : [];
  } catch (e) { return { attempted: 0, removed: 0, failed: 0 }; }
  let removed = 0, failed = 0;
  try {
    const fs = wx.getFileSystemManager();
    for (const name of list) {
      try { fs.unlinkSync(`${wx.env.USER_DATA_PATH}/${name}`); removed++; }
      catch (e) { failed++; }   // 不存在 / 被占用 / 无权限：都算过，绝不打断登出
    }
  } catch (e) { /* 拿不到文件系统也不阻断登出 */ }
  return { attempted: list.length, removed: removed, failed: failed };
}

function writeFileToSandbox(filename, content, encoding) {
  const fs = wx.getFileSystemManager();
  const filePath = `${wx.env.USER_DATA_PATH}/${filename}`;
  const isBin = encoding === 'base64';
  let data;
  try {
    data = isBin ? wx.base64ToArrayBuffer(content) : String(content);
  } catch (e) {
    wx.showToast({ title: TERMS.expFile.writeFail, icon: 'none' });
    return '';
  }
  try {
    fs.writeFileSync(filePath, data, isBin ? 'binary' : 'utf8');
  } catch (e) {
    wx.showToast({ title: TERMS.expFile.writeFail, icon: 'none' });
    return '';
  }
  rememberExported(filename);
  return filePath;
}

// 打不开时的唯一出路：转发到自己/电脑（微信里点开可另存，等于「导出到电脑上」）
function fallbackShare(filePath, filename) {
  wx.showModal({
    title: TERMS.expFile.openFailTitle,
    content: String(TERMS.expFile.openFailContent).replace('{name}', filename),
    confirmText: TERMS.expFile.forward,
    cancelText: TERMS.expFile.close,
    success: (r) => {
      if (!r.confirm) return;
      wx.shareFileMessage({
        filePath,
        fileName: filename,
        fail: () => wx.showToast({ title: TERMS.expFile.forwardFail, icon: 'none' }),
      });
    },
  });
}

/**
 * 落盘 + 打开（打不开就转发）。调用方只需把 exportData 的返回原样丢进来。
 * @param {{filename:string, content:string, format:string, encoding:string}} res
 */
function deliver(res) {
  const r = res || {};
  const filename = r.filename || 'export.xlsx';
  const filePath = writeFileToSandbox(filename, r.content, r.encoding || 'utf8');
  if (!filePath) return;                       // 写盘失败已 toast
  const fileType = OPENABLE[String(r.format || '').toLowerCase()];
  if (!fileType) { fallbackShare(filePath, filename); return; }   // csv/json 等：直接走转发
  wx.openDocument({
    filePath,
    fileType,
    showMenu: true,
    // P0#1（2026-10-11）：原来只弹一句「已生成Excel」toast，用户仍不知道文件叫什么、去哪找。
    //   改成显式弹窗：文件名 + 格式 + 去向（右上角「…」转发/存电脑），闭环「导出完成 → 知道去哪」。
    success: () => wx.showModal({
      title: TERMS.expFile.savedTitle,
      content: String(TERMS.expFile.savedBody).replace('{name}', filename).replace('{type}', fileType),
      confirmText: TERMS.expFile.ok,
      showCancel: false,
    }),
    fail: () => fallbackShare(filePath, filename),
  });
}

module.exports = { deliver, OPENABLE, clearExportedFiles, EXPORTED_FILES_KEY };
