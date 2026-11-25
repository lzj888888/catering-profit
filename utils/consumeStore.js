// utils/consumeStore.js —— 损耗核查数据的持久化（云存储 JSON + 本地兜底）
//
// 🔴 背景（2026-11-25 T1）：
//   三期做下来，「非销售耗用」「原料盘点（含采购金额）」全都存在 `wx.setStorageSync` 里。
//   换手机 / 清缓存 / 卸载重装 ⇒ **四个月的数据全没**，而且服务器上从不存在。
//   这是"是不是真产品"的分界线，必须先解决。
//
// 🔴 为什么不用数据库 / 不新建云函数（两个方案都实地否决过）：
//   ① 改 `saveLedger` 加字段 —— **实测不可行**：`validate.js::cleanItems` 里
//      `if (list === undefined || list === null) return [];` ⇒ 缺省返回**空数组**，
//      而 Controller 无条件写入 ⇒ 对账页只传 inventory 就会把收入/支出**清空**。
//   ② 新建 `saveConsumeCheck` / `getConsumeCheck` —— 仓里 62 个云函数、4 个守卫管着
//      （fn_inventory / fn_contract_params / fn_public_surface / fn_deps）+ 契约文档 + 集合登记，
//      上线前动这套制度成本过高。
//   ⇒ 选**云存储 JSON 文件**：`wx.cloud.uploadFile` / `downloadFile` 是端侧 API，
//      **零云函数、零部署**，一样能跨设备读回。
//
// 🔴 双写策略（不是二选一）：
//   云端 = 长期真相（换设备能读回）；本地 = 当前会话兜底（云端失败/离线时仍可用）。
//   读取顺序：先本地（秒开）→ 异步云端覆盖（拿到更新的就替换）。写入：先本地（立即）→ 再云端。
//
// 数据格式（带版本号，便于以后迁移）：
//   { v: 1, month: '2026-11', nonsalesFen: 8000, items: [{ material_id, opening_qty, purchase_qty, closing_qty, purchase_amount_fen }], updatedAt: 1690000000000 }
//
// 🔴 隐私说明：本文件存的是**门店经营数据**（员工餐金额、原料采购量价），无客户个人信息。
//   云存储路径按 shop_id 隔离；若日后要做"仅创建者可读"，需在云控制台配权限规则
//   （见 cloud-console-audit 技能的只读核查清单），本模块不假设权限已收紧。

const SCHEMA_VERSION = 1;
const DIR = 'consume_check';

/** 纯函数：云存储路径（按店按月，一个店一个月一个文件） */
function cloudPathOf(shopId, month) {
  const sid = String(shopId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const m = String(month || '').replace(/[^0-9-]/g, '');
  if (!sid || !m) return '';
  return DIR + '/' + sid + '/' + m + '.json';
}

/** 纯函数：组装要存的对象（数字一律取整/保留原样，不做业务判断） */
function payloadOf(month, nonsalesFen, items) {
  const list = Array.isArray(items) ? items : [];
  return {
    v: SCHEMA_VERSION,
    month: String(month || ''),
    nonsalesFen: Math.max(0, Math.round(Number(nonsalesFen) || 0)),
    items: list.filter((x) => x && x.material_id).map((x) => ({
      material_id: String(x.material_id),
      opening_qty: Number(x.opening_qty) || 0,
      purchase_qty: Number(x.purchase_qty) || 0,
      closing_qty: Number(x.closing_qty) || 0,
      purchase_amount_fen: Math.max(0, Math.round(Number(x.purchase_amount_fen) || 0)),
    })),
    updatedAt: Date.now(),
  };
}

/**
 * 纯函数：解析读回来的文本（**容错**，任何异常都返回 null 而不是抛）。
 * 为什么要这么小心：云端文件可能被手工改坏、可能是旧版本、可能被截断。
 * 一段坏数据不该让整个对账页白屏。
 */
function parsePayload(text) {
  if (typeof text !== 'string' || !text) return null;
  let o;
  try { o = JSON.parse(text); } catch (e) { return null; }
  if (!o || typeof o !== 'object') return null;
  // 版本不认识 ⇒ 当没有（宁可让老板重填，也不要拿错结构去算钱）
  if (Number(o.v) !== SCHEMA_VERSION) return null;
  const items = Array.isArray(o.items) ? o.items : [];
  return {
    v: SCHEMA_VERSION,
    month: String(o.month || ''),
    nonsalesFen: Math.max(0, Math.round(Number(o.nonsalesFen) || 0)),
    items: items.filter((x) => x && x.material_id).map((x) => ({
      material_id: String(x.material_id),
      opening_qty: Number(x.opening_qty) || 0,
      purchase_qty: Number(x.purchase_qty) || 0,
      closing_qty: Number(x.closing_qty) || 0,
      purchase_amount_fen: Math.max(0, Math.round(Number(x.purchase_amount_fen) || 0)),
    })),
    updatedAt: Number(o.updatedAt) || 0,
  };
}

/**
 * 🔴🔴 2026-11-25 真机（模拟器）实测推翻了我上一版的假设：
 *   `wx.cloud.getTempFileURL({ fileList: [cloudPath] })` **不认 cloudPath**，只认 **fileID**
 *   （实测 cloudPath 返回 status=1，fileID 正常）。
 *   而 fileID = `cloud://{env}.{bucket}/{cloudPath}` —— 这两个值无法推导。
 *   ⇒ 后果：**换设备时读不回来**（本地没有 fileID），而这正是本模块要解决的问题。
 *
 * 破局：上传一个**内容固定的探针文件** `consume_check/_ping.txt`，
 *   从它返回的 fileID 里解析出 `{env, bucket}`，缓存到本地，之后拼业务文件的 fileID 去读。
 *   · 为什么不用硬编码：app.js 有铁律「禁止硬编码环境 ID，只能从 config/env.js 取」；
 *     而 bucket（形如 `636c-<env>-<数字>`）无法从 env 推导。
 *   · 为什么探针无副作用：路径独立、内容固定、覆盖无害，**不碰任何业务数据**。
 *   · 离线/失败 ⇒ 返回空串，调用方降级用本地（不阻塞页面）。
 */
const BUCKET_KEY = 'consume_bucket_v1';

function parseEnvBucket(fileID) {
  const m = /^cloud:\/\/([^.]+)\.([^/]+)\//.exec(String(fileID || ''));
  return m ? { env: m[1], bucket: m[2] } : null;
}

async function ensureEnvBucket() {
  // 1) 本地缓存优先（同一设备只学一次）
  try {
    const c = wx.getStorageSync(BUCKET_KEY);
    if (c && c.env && c.bucket) return c;
  } catch (e) { /* 忽略 */ }
  // 2) 学一次：上传探针文件
  try {
    const fsm = wx.getFileSystemManager();
    const tmp = (wx.env && wx.env.USER_DATA_PATH ? wx.env.USER_DATA_PATH : '') + '/_ping.txt';
    fsm.writeFileSync(tmp, 'ping', 'utf8');
    const r = await wx.cloud.uploadFile({ cloudPath: DIR + '/_ping.txt', filePath: tmp });
    const eb = parseEnvBucket(r && r.fileID);
    if (eb) {
      try { wx.setStorageSync(BUCKET_KEY, eb); } catch (e2) { /* 忽略 */ }
      return eb;
    }
  } catch (e) { /* 忽略，降级 */ }
  return null;
}

/**
 * 上传到云存储（**覆盖**同名文件）。
 * @returns {Promise<{ok:boolean, reason?:string}>} 绝不抛 —— 调用方据此决定是否提示，不该因此崩页面
 */
async function saveCloud(shopId, month, payload) {
  const cp = cloudPathOf(shopId, month);
  if (!cp) return { ok: false, reason: 'bad_params' };
  if (typeof wx === 'undefined' || !wx.cloud || !wx.getFileSystemManager) return { ok: false, reason: 'no_cloud' };
  let tmp = '';
  try {
    const fsm = wx.getFileSystemManager();
    tmp = (wx.env && wx.env.USER_DATA_PATH ? wx.env.USER_DATA_PATH : '') + '/consume_' + month + '.json';
    fsm.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
    const r = await wx.cloud.uploadFile({ cloudPath: cp, filePath: tmp });
    // 顺手学会 env/bucket（省掉另一次探针上传）
    const eb = parseEnvBucket(r && r.fileID);
    if (eb) { try { wx.setStorageSync(BUCKET_KEY, eb); } catch (e3) { /* 忽略 */ } }
    return { ok: true };
  } catch (e) {
    // 🔴 失败不是灾难：本地已经写过了（页面先写本地再调这里），本次会话不受影响。
    //   不弹 toast 打扰老板 —— 网络抖动时弹"保存失败"只会让人以为数据丢了。
    return { ok: false, reason: (e && (e.errMsg || e.message)) || 'upload_fail' };
  } finally {
    // 临时文件删掉（失败也不影响，USER_DATA_PATH 会被系统回收）
    try { if (tmp && wx.getFileSystemManager) wx.getFileSystemManager().unlinkSync(tmp); } catch (e2) { /* 忽略 */ }
  }
}

/**
 * 从云存储读取。
 * 🔴 为什么不是 `downloadFile({ fileID: cloudPath })`：fileID 不是路径拼出来的，
 *   必须 `cloud://{env}.{bucket}/{path}`（见文件头 ensureEnvBucket 的说明）。
 * @returns {Promise<object|null>} 没数据/读失败 ⇒ null（不区分"没有"与"读不到"：
 *   对调用方都是"云端没东西"，降级用本地即可）
 */
async function loadCloud(shopId, month) {
  const cp = cloudPathOf(shopId, month);
  if (!cp) return null;
  if (typeof wx === 'undefined' || !wx.cloud || !wx.getFileSystemManager) return null;
  try {
    const eb = await ensureEnvBucket();
    if (!eb) return null;                      // 拿不到 env/bucket ⇒ 没法拼 fileID，降级本地
    const fileID = 'cloud://' + eb.env + '.' + eb.bucket + '/' + cp;
    const r = await wx.cloud.getTempFileURL({ fileList: [fileID] });
    const f = r && r.fileList && r.fileList[0];
    // status 非 0 或没有 url ⇒ 文件不存在（首次使用就是这种，属正常）
    if (!f || !f.tempFileURL) return null;
    const dl = await new Promise((resolve, reject) => {
      wx.downloadFile({
        url: f.tempFileURL,
        success: (res) => (res.statusCode === 200 ? resolve(res) : reject(new Error('http_' + res.statusCode))),
        fail: reject,
      });
    });
    const txt = wx.getFileSystemManager().readFileSync(dl.tempFilePath, 'utf8');
    return parsePayload(txt);
  } catch (e) {
    return null;
  }
}

module.exports = {
  SCHEMA_VERSION, DIR, BUCKET_KEY, cloudPathOf, payloadOf, parsePayload, parseEnvBucket,
  saveCloud, loadCloud,
};
