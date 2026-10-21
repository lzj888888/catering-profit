// utils/moneyFmt.js —— R395 · 金额展示的**单源格式化**（纯函数 · 零依赖）
//
// 为什么要有这个文件（实测出来的，不是设计洁癖）：
//   1) `subpkg/tools/sandbox/index.js` 里**同时躺着 4 个**局部 `money`：
//        · 723  行 `String(Math.abs(n))` + 千分位 —— 不做 round ⇒ 遇到小数会输出 `9,160.000,000,000,002`
//                 （不是"少四舍五入"，是**千分位正则作用到了小数位**，比不格式化更糟）
//        · 1198 行 `toFixed(1) + 万`
//        · 1279 行 `toFixed(2) + 万`
//      ⇒ 同一页紧挨着的两张卡，1 万以上金额一个是「1.2万」、一个是「1.23万」。
//        老板不会觉得"精度不同"，只会觉得**这两个数对不上**。
//   2) `subpkg/tools/sandbox/matrix.js` 还有 2 份（470 收元、626 收分），阈值写法还不同。
//
// 结论：金额格式化**不是可以各写一份的东西**——它决定老板看到的字长什么样。
//
// 🔴 三条硬规则（本模块替所有调用方守住）：
//   ① **先取整，再做千分位**：小数位绝不能被分组（`groupDigits` 只接受整数输入）。
//   ② **非有限值不显示数字**：Infinity / NaN 一律回 `—`。
//      （R380 实证：`lossPct=100` 时引擎会算出 Infinity，JSON 化后变 null，再拼进界面就是 "null"）
//   ③ **万的口径只有一处**：>= 10000 元按「万」显示，小数位由 `wanDigits` 统一指定，
//      默认 1 位 —— 测算本身的误差远大于 100 元，显示到分是假精确。

var WAN_FLOOR = 10000;

// 整数千分位。**入参必须是整数**：小数会被四舍五入掉（这是刻意的，见规则①）。
function groupDigits(n) {
  var v = Number(n);
  if (!isFinite(v)) return '—';
  var s = String(Math.round(Math.abs(v)));
  var out = '';
  var c = 0;
  for (var i = s.length - 1; i >= 0; i--) {
    out = s.charAt(i) + out;
    c++;
    if (c % 3 === 0 && i > 0) out = ',' + out;
  }
  return (v < 0 ? '-' : '') + out;
}

// 元 → 展示串。
//   opts.prefix   前置（如 '¥'、'+¥'）
//   opts.yuanUnit 不足 1 万时的后缀（默认 '元'）
//   opts.wanUnit  达到 1 万时的后缀（默认 '万'）
//   opts.wanDigits 万的位数（默认 1）
//   opts.plain     true ⇒ 永不用「万」，一律千分位（用于表格列对齐等场景）
function formatYuan(yuan, opts) {
  var o = opts || {};
  // 缺数不编 0：`null` 表示"这个数还没有"，不是"这个数是 0"（与 R298 三态判据同族）
  if (yuan === null || yuan === undefined) return o.fallback === undefined ? '—' : o.fallback;
  var v = Number(yuan);
  if (!isFinite(v)) return o.fallback === undefined ? '—' : o.fallback;
  var sign = v < 0 ? '-' : '';
  var abs = Math.abs(v);
  var body;
  if (!o.plain && abs >= WAN_FLOOR) {
    body = (abs / WAN_FLOOR).toFixed(o.wanDigits === undefined ? 1 : o.wanDigits)
      + (o.wanUnit === undefined ? '万' : o.wanUnit);
  } else {
    // ⚠️ 不足 1 万时**不加千分位**：这是刻意与旧实现保持一字不差（`9160元` 而不是 `9,160元`）。
    //   要不要给所有金额加千分位是**展示风格决策**（李老师定），不该混在"修 bug"里顺手改。
    //   需要千分位的地方显式用 `groupDigits`（如吸底条 `+¥9,160`，它本来就带）。
    body = String(Math.round(abs)) + (o.yuanUnit === undefined ? '元' : o.yuanUnit);
  }
  return (o.prefix || '') + sign + body;
}

// 分 → 展示串（口径同 formatYuan，只是先除以 100）。
//   ⚠️ 分转元用除法而不是移位：分是整数、/100 的浮点误差在 toFixed/round 之后不显现。
function formatFen(fen, opts) {
  var v = Number(fen);
  if (!isFinite(v)) return (opts && opts.fallback !== undefined) ? opts.fallback : '—';
  return formatYuan(v / 100, opts);
}

module.exports = {
  WAN_FLOOR: WAN_FLOOR,
  groupDigits: groupDigits,
  formatYuan: formatYuan,
  formatFen: formatFen,
};
