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
    success: () => wx.showToast({ title: TERMS.expFile.opened, icon: 'success' }),
    fail: () => fallbackShare(filePath, filename),
  });
}

module.exports = { deliver, OPENABLE };
