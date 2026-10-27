// tools/check_spec_per100g_identity.js —— R141 守卫：per100g 预设「系数全 1 + 克重不许预设」
//
// 依据 M3v1.2_B（D21/M3.31）：「每 100g」计价规格的 coef 必须**全 1**。
//   🔴 R547（M1）更正了这条约束的**含义**：全 1 描述的是「与整份之间没有**按组件类型**的差别」
//   （不像半份那样"调料不减半"），**不是**「100g 的成本等于整份的成本」——
//   后者是旧实现的理解，正是缺陷（毛利率 11.76% vs 真值 82.35%）。
//   份量换算走 `portion_g`（老板填的卡数据）+ `per100gFactor`（100 ÷ 克重），不写进 coef。
//   ⇒ 本守卫保留 P1~P4（预设层仍是全 1），并新增 **P5：预设里不得带 portion_g 默认值** ——
//   一旦有人给个"猜的克重"（如 250），每张卡都会静默按这个克重算成本，比不给数更危险。
//
// 判据（含反恒真）：
//   P1  SPEC_PRESETS 存在 spec_key === 'per100g' 的条目（删掉即红）
//   P2  该条目 coef 五项（main/aux/season/semi/pack）必须全部 === 1
//   P3  反恒真：用同一套判定跑一个故意 coef.main=0.9 的合成条目，必须判"不合规"（否则判据恒真 ⇒ 红）
//   P4  unit_label === '100g'（缺字段 ⇒ 红）
//   P5  预设**不带** portion_g / portion 默认克重（克重只能来自用户填的卡数据）
//
// 运行：node tools/check_spec_per100g_identity.js

const { SPEC_PRESETS, LINE_KINDS } = require('../cloudfunctions/common/specDerive.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { fail++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

// 判据核心：coef 五项严格 === 1（与 P2/P3 共用同一套，防两处各写一份漂移）
function allOnes(coef) {
  if (!coef || typeof coef !== 'object' || Array.isArray(coef)) return false;
  return LINE_KINDS.every((k) => coef[k] === 1);
}

console.log('===== R141 per100g 恒等规格守卫 =====');

// P1 存在性
const p = SPEC_PRESETS.find((x) => x.spec_key === 'per100g');
check('P1 SPEC_PRESETS 存在 spec_key === per100g', !!p, p ? JSON.stringify(p) : '缺失');

// P2 全 1
if (p) {
  check('P2 per100g.coef 五项全 === 1', allOnes(p.coef) === true, JSON.stringify(p.coef));
} else {
  check('P2 per100g.coef 五项全 === 1', false, '（P1 已失败，无法取 coef）');
}

// P3 反恒真：故意 coef.main=0.9 的合成条目必须被判「不合规」
const synthetic = { spec_key: 'per100g', coef: { main: 0.9, aux: 1, season: 1, semi: 1, pack: 1 } };
check('P3 反恒真：合成 coef.main=0.9 必须判为不合规（allOnes=false）',
  allOnes(synthetic.coef) === false, `allOnes=${allOnes(synthetic.coef)}`);

// P4 unit_label
if (p) {
  check("P4 unit_label === '100g'", p.unit_label === '100g', `got ${p.unit_label}`);
} else {
  check("P4 unit_label === '100g'", false, '（P1 已失败）');
}

// P5（R547/M1）：预设不得携带克重默认值 —— 克重是**用户事实**（这份多重），不是引擎常量。
//   反证：若这里出现 `portion_g: 250`，每张选了这个规格的卡都会按 250g 静默算成本（错数且零提示）。
const hasPortionDefault = !!(p && (p.portion_g != null || p.portionG != null));
check('P5 预设不带 portion_g 默认克重（克重必须由老板填）', p && !hasPortionDefault,
  hasPortionDefault ? `发现默认克重：${JSON.stringify(p.portion_g || p.portionG)}` : '');

// 反向：half/small 仍原样（顺序与内容不变，不误伤）
const half = SPEC_PRESETS.find((x) => x.spec_key === 'half');
const small = SPEC_PRESETS.find((x) => x.spec_key === 'small');
check('反向：half/small 仍在（未误删）', !!half && !!small, '');
check('反向：half.coef 仍非全 1（缩放规格未被误改）', half ? allOnes(half.coef) === false : false, half ? JSON.stringify(half.coef) : '');

console.log(`\n==== R141 每100g恒等规格守卫：${pass} 通过 / ${fail} 失败 ====`);
process.exit(fail === 0 ? 0 : 1);
