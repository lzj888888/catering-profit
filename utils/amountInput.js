// utils/amountInput.js —— 金额输入的**可读性判定**（R414 · 队列 #25 · 纯函数零依赖）
//
// 为什么要有它：
//   界面「元」进引擎的唯一入口是 `utils/api.js::yuanToFen`，它对非法输入 **fail-soft 返回 0** ——
//   这个行为被 `check_money_precision` B 组**刻意钉住**（很多地方依赖它不抛错），**不能改它**。
//   于是：老板从微信/Excel 粘贴「12,000」⇒ 进引擎是 **0 分**，而 0 是合法金额 ⇒ 云端校验无从拒 ⇒ **零报错**。
//   实测（`_m3/_r415_probe/probe.js`，毛利率 65% / 人工 1.5 万 / 水电 3 千）：
//     房租 `12000`   ⇒ 固定 3 万，保本 **46154 元/月**
//     房租 `12,000`  ⇒ 固定 1.8 万，保本 **27692 元/月**  ⇒ **少 40%**
//
// 🔴 本模块**只判定、不改数、不做静默清洗**：
//   · 不改 `yuanToFen`（那是被守卫钉住的 fail-soft 契约）；
//   · **不自动去掉逗号**替老板"修好"—— 因为 `1,5` 这种可能是欧洲写法（15 还是 1.5？），
//     猜错了比不猜更糟（与 #24「不钳制、如实暴露」同一原则）；
//   · 只回答一个问题：**这个框里填的东西，系统读得成金额吗？** 读不成 ⇒ 页面必须说出来。
//
// 🤖 守卫：`tools/check_amount_input.js`

// 判定结果的状态码（页面据此给提示；`ok` / `empty` 不该打扰老板）
const STATE = {
  EMPTY: 'empty',           // 没填 —— 正常，不提示
  OK: 'ok',                 // 读得成
  THOUSAND_SEP: 'thousandSep', // 带千分位逗号（12,000）—— 最常见，粘贴来的
  FULLWIDTH: 'fullwidth',   // 全角数字（１２０００）—— 输入法没切过来
  SPACE: 'space',           // 含空格（12 000 / 前后空白）
  NEGATIVE: 'negative',     // 负号
  MULTI_DOT: 'multiDot',    // 多个小数点（1.2.3）
  EXPONENT: 'exponent',     // 科学计数（1e3）
  OTHER: 'other',           // 其他读不成数字的
};

const FULLWIDTH_RE = /[\uFF10-\uFF19\uFF0E]/; // ０-９ 与全角句点

/**
 * 判定一个输入框原值。
 * @param {*} raw 输入框原值（通常是字符串；也可能是 number）
 * @returns {{state: string, fen: number, readable: boolean}}
 *   readable = true 表示"系统能读出金额"（含 empty：没填不算读错）
 */
function classifyAmount(raw) {
  const s = raw == null ? '' : String(raw);
  if (s.trim() === '') return { state: STATE.EMPTY, fen: 0, readable: true };
  if (FULLWIDTH_RE.test(s)) return { state: STATE.FULLWIDTH, fen: 0, readable: false };
  if (s.indexOf(',') >= 0) return { state: STATE.THOUSAND_SEP, fen: 0, readable: false };
  if (/\s/.test(s)) return { state: STATE.SPACE, fen: 0, readable: false };
  if (s.charAt(0) === '-') return { state: STATE.NEGATIVE, fen: 0, readable: false };
  let dots = 0;
  for (let i = 0; i < s.length; i++) if (s.charAt(i) === '.') dots++;
  if (dots > 1) return { state: STATE.MULTI_DOT, fen: 0, readable: false };
  if (s.indexOf('e') >= 0 || s.indexOf('E') >= 0) return { state: STATE.EXPONENT, fen: 0, readable: false };
  // 合法：纯数字，可带一个小数点
  let okChars = true;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (!((c >= '0' && c <= '9') || c === '.')) { okChars = false; break; }
  }
  if (!okChars || s === '.') return { state: STATE.OTHER, fen: 0, readable: false };
  const v = Number(s);
  if (!isFinite(v)) return { state: STATE.OTHER, fen: 0, readable: false };
  // 🔴 元→分必须用**十进制安全**形态（`check_money_precision` C-④ 只认这一种）：
  //   先 `toFixed(10)` 抹掉二进制残差再 round —— 否则 `1.005 * 100 = 100.49999999999999` 会少进 1 分。
  return { state: STATE.OK, fen: Math.round(Number((v * 100).toFixed(10))), readable: true };
}

/**
 * 批量体检：给一组「字段名 → 原值」，返回读不成金额的那些。
 * @param {object} fields  { rentYuan: '12,000', laborTotalYuan: '15000', ... }
 * @returns {Array<{key: string, raw: string, state: string}>} 按传入顺序
 */
function findUnreadable(fields) {
  const out = [];
  const o = fields || {};
  for (const k in o) {
    if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
    const r = classifyAmount(o[k]);
    if (!r.readable) out.push({ key: k, raw: String(o[k] == null ? '' : o[k]), state: r.state });
  }
  return out;
}

module.exports = {
  STATE: STATE,
  classifyAmount: classifyAmount,
  findUnreadable: findUnreadable,
};
