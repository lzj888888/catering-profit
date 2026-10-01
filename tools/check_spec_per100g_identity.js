// tools/check_spec_per100g_identity.js —— R141 守卫：per100g 规格「恒等（全 1 系数）」硬约束
//
// 依据 M3v1.2_B（D21/M3.31）：「每 100g」计价规格的 coef 必须**全 1（恒等）**，
//   含义 = 该规格成本 ≡ 该卡标准成本（不缩放）。若有人把它改成缩放系数（如 0.9），
//   就会让"按 100g 称重"的成本静默算错 —— 这正是本守卫要拦的。
//
// 判据（含反恒真）：
//   P1  SPEC_PRESETS 存在 spec_key === 'per100g' 的条目（删掉即红）
//   P2  该条目 coef 五项（main/aux/season/semi/pack）必须全部 === 1
//   P3  反恒真：用同一套判定跑一个故意 coef.main=0.9 的合成条目，必须判"不合规"（否则判据恒真 ⇒ 红）
//   P4  unit_label === '100g'（缺字段 ⇒ 红）
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

// 反向：half/small 仍原样（顺序与内容不变，不误伤）
const half = SPEC_PRESETS.find((x) => x.spec_key === 'half');
const small = SPEC_PRESETS.find((x) => x.spec_key === 'small');
check('反向：half/small 仍在（未误删）', !!half && !!small, '');
check('反向：half.coef 仍非全 1（缩放规格未被误改）', half ? allOnes(half.coef) === false : false, half ? JSON.stringify(half.coef) : '');

console.log(`\n==== R141 每100g恒等规格守卫：${pass} 通过 / ${fail} 失败 ====`);
process.exit(fail === 0 ? 0 : 1);
