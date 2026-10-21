// utils/channelRule.js —— M2 渠道占比规则（R412 · 队列 #24）
//
// 为什么要有这个文件（而不是在页面里写个 if）：
//   ① **必须能被机器验**：`type="number"`/`digit`、占比上限这类"规则"如果只活在页面事件回调里，
//      守卫只能 grep 字面量 —— 而本仓已踩过「注释里写着函数名 ⇒ 删掉调用判据照绿」（R299 恒真第③型）。
//      抽成纯函数后，守卫可以喂真数字看返回值，判的是**行为**不是文本。
//   ② **口径只能有一处**：「外卖占比 + 团购占比」是**占同一份流水**的两个切片（见 pages/sandbox/index.js
//      `recomputeChannel` 头注：老板嘴里的"抽点"是该渠道收入的百分比，必须按占比加权到总流水）。
//      既然是同一份流水的切片，两片之和 > 100 就是**逻辑不可能**，不是"还可以接受"。
//   ③ 军规 D8：单位换算与规则判定写成纯函数 + 单测，不靠运行时推断。
//
// 🔴 口径说明（为什么 100 是硬上限，不是软提示）：
//   老板填「外卖 60% + 团购 60%」时，`recomputeChannel` 会算
//     佣金 = 60%×（平台抽成+打包） + 60%×（团购抽成+折扣） + 刷卡
//   这等于**按 120% 的流水**扣佣 ⇒ 加权挂钩费率虚高 ⇒ 保本额虚高 ⇒ 老板以为要多卖很多才不亏。
//   全程零报错。所以超限必须**显著提示**。
//
// ⚠️ 本模块**只判定、不改数**：超限时页面照原样算并提示"请调整"。
//   为什么不静默钳到 100%：钳制会掩盖输入错误 —— 老板看不出自己填错了，看到的仍是一个
//   看起来很合理的保本额（钳制后的数同样是错的，因为真实占比关系未知）。如实暴露 > 假装修正。

/**
 * 渠道占比合计是否超过 100%（外卖 + 团购）。
 *
 * @param {number|string} takeawayRatio 外卖占流水%（老板输入框原值，可能是字符串）
 * @param {number|string} groupRatio    团购占流水%
 * @returns {boolean} true = 超限，页面必须提示；false = 正常（含垃圾入参）
 *
 * 边界口径：
 *   · 恰好 100（60 + 40）⇒ **不超**（全程走满仍自洽，没有第 101 份流水）
 *   · 负数 / NaN / null / undefined / 非数字串 ⇒ 按 0 处理，**不报超限**
 *     为什么：这不是"占比超限"问题，报超限会把老板引向错误的修改方向（他该改的是"填了个负号/乱字符"）。
 *     空值走 0 也让 `recomputeChannel` 的既有语义（`Number(x) || 0`）保持一致。
 */
function isChannelRatioOver100(takeawayRatio, groupRatio) {
  const a = Number(takeawayRatio);
  const b = Number(groupRatio);
  const x = isFinite(a) ? a : 0;
  const y = isFinite(b) ? b : 0;
  const sum = x + y;
  if (!isFinite(sum)) return false;
  // 1e-9 容差：0.1 + 0.2 之类的浮点残差不能把"恰好 100"误判成超限
  return sum - 100 > 1e-9;
}

module.exports = { isChannelRatioOver100: isChannelRatioOver100 };
