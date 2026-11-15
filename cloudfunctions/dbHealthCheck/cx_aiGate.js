// cloudfunctions/common/aiGate.js —— AI「出站」前的 k-匿名门槛（纯函数，零 IO）
//
// 队列 #28（NOTE_R405 §9-2 如实登记的缺口）。设计稿：review/PLAN_2026-10-20_AI授权模型设计.md §5。
//
// 🔴 为什么门槛必须放在「出站」这一刻，而不是"存结论"那一刻：
//   结论本身是聚合过的（方向 + 幅度 + 引用），存下来不构成泄露；
//   把"偏离值"发给外部模型时，**聚合粒度可能等于原始值** —— 单店 1 个 SKU 单日 1 笔订单，
//   均值/偏离度反推回去就是那一笔订单的原始金额，脱敏等于没脱。
//   ⇒ 所以本函数判的不是"能不能存"，而是"这批样本够不够大到看不出单笔"。
//
// 🔴 为什么门槛不满足时必须显式给 `fallback: 'L0'`：
//   退回 L0 规则话术（"这项偏离你自己的历史，请核对单据"）是**有答案**的；
//   若返回一个空结果，页面只能显示"暂无数据"或者让上游自己编 ——
//   上游编同业对比 = 拿别家门店的区间套到这家店上，属于凭空造数。
//   ⇒ 把"退回哪条路"写进出参，调用方就没有"自由发挥"的空间。
//
// 🔴 为什么 `consent` 入参必须是**读侧已判定的出参**，不是原始 doc：
//   四态判定（none/active/expired/revoked）+ 条款版本一致性已在
//   `cloudfunctions/getAiConsent/service.js` 落过一份。本函数若再判一遍 `revoked_at/expire_at`，
//   就是同一语义的第二份实现 —— 将来改一处漏一处，就会出现"读侧说已撤回、出站侧说还能用"，
//   而老板只会看到其中一个。⇒ 这里只**消费** `state` / `effective_scope` / `policy_stale`，
//   原始 doc 传进来（没有 state 字段）会被判 `consent_unjudged` 而不是"猜着判"。
//
// 🔴 为什么计数值不做 `Number()` 静默归一：
//   本仓已有一课（`utils/api.js::yuanToFen` 把 "12,000" 静默读成 0 ⇒ 保本额少 40% 且零报错）：
//   静默归一 = 值是错的、但没有任何一处报错。这里是**隐私门槛**，宁可拒（fail-closed）
//   也不能把 "5" 这种字符串当成 5 行放行。非法入参一律 `sample_shape_invalid`。

// 设计稿 §5 的硬门槛：行数 ≥ 5 且 供应商数 ≥ 3。
// ⚠️ 这两个数是**产品口径**，不是实现细节 —— 单测里钉死（改口径必须先改设计稿与 NOTE）。
const SAMPLE_MIN = { lineCount: 5, supplierCount: 3 };

// 允许的用途，与 `shop_ai_consent.scope` 的取值同源（设计稿 §2）。
// 🔴 未知用途一律拒，不许"默认放行"：加新能力时旧授权不能被自动当成已同意（设计稿 §0）。
const PURPOSES = ['diagnose', 'pricing', 'expand'];

const REASONS = {
  OK: 'ok',
  INPUT_INVALID: 'input_invalid',
  CONSENT_UNJUDGED: 'consent_unjudged',     // 传了原始 doc / 缺 state ⇒ 不知道授权态，拒
  CONSENT_NOT_ACTIVE: 'consent_not_active', // none / expired / revoked
  POLICY_STALE: 'policy_stale',             // 条款版本变了 ⇒ 必须重新同意
  PURPOSE_INVALID: 'purpose_invalid',
  PURPOSE_NOT_GRANTED: 'purpose_not_granted',
  SAMPLE_INVALID: 'sample_shape_invalid',
  BELOW_LINE_FLOOR: 'below_line_floor',
  BELOW_SUPPLIER_FLOOR: 'below_supplier_floor',
};

// 「退回 L0 规则话术」是唯一的降级路（设计稿 §5）。写进常量，避免调用方各写各的字符串。
const FALLBACK_L0 = 'L0';

function isCount(v) {
  // 只认真整数。`typeof '5' === 'string'` ⇒ 拒；`2.5` / `-1` / `NaN` / `Infinity` ⇒ 拒。
  return typeof v === 'number' && isFinite(v) && v >= 0 && Math.floor(v) === v;
}

/**
 * 只判样本量（不含授权），便于调用方单独解释"为什么不够"。
 * @param {{lineCount:number, supplierCount:number}} sample
 * @returns {{ok:boolean, reason:string, need?:object}}
 */
function judgeSample(sample) {
  if (!sample || typeof sample !== 'object') {
    return { ok: false, reason: REASONS.SAMPLE_INVALID };
  }
  const lineCount = sample.lineCount;
  const supplierCount = sample.supplierCount;
  if (!isCount(lineCount) || !isCount(supplierCount)) {
    return { ok: false, reason: REASONS.SAMPLE_INVALID };
  }
  // 先判行数再判供应商：两者都不够时给出**先要补的那一项**，页面才有可执行的下一步。
  if (lineCount < SAMPLE_MIN.lineCount) {
    return { ok: false, reason: REASONS.BELOW_LINE_FLOOR, need: { lineCount: SAMPLE_MIN.lineCount, supplierCount: SAMPLE_MIN.supplierCount } };
  }
  if (supplierCount < SAMPLE_MIN.supplierCount) {
    return { ok: false, reason: REASONS.BELOW_SUPPLIER_FLOOR, need: { lineCount: SAMPLE_MIN.lineCount, supplierCount: SAMPLE_MIN.supplierCount } };
  }
  return { ok: true, reason: REASONS.OK };
}

/**
 * 出站闸门：这批数据能不能发给外部模型（用途 + 授权态 + 样本量三关）。
 *
 * @param {object} input
 * @param {object} input.consent `getAiConsent` 的出参（必须含 state / effective_scope / policy_stale）
 * @param {object} input.sample  `{ lineCount, supplierCount }`（服务端聚合出来的计数，不是前端填的）
 * @param {string} input.purpose `diagnose` / `pricing` / `expand`
 * @returns {{allow:boolean, reason:string, fallback:string, need?:object, got?:object}}
 *
 * 不修改入参（纯函数），同一入参两次调用结果一致（确定性）。
 */
function canSendToModel(input) {
  const deny = (reason, extra) => Object.assign({ allow: false, reason: reason, fallback: FALLBACK_L0 }, extra || {});
  const allow = () => ({ allow: true, reason: REASONS.OK, fallback: '' });

  if (!input || typeof input !== 'object') return deny(REASONS.INPUT_INVALID);

  const consent = input.consent;
  const purpose = input.purpose;

  // ---- 第一关：授权态。必须来自读侧判定结果（有 state 字段）----
  if (!consent || typeof consent !== 'object' || typeof consent.state !== 'string' || !consent.state) {
    // 原始 doc（只有 revoked_at/expire_at）落在这里 ⇒ 拒，别在这里补一份四态判定。
    return deny(REASONS.CONSENT_UNJUDGED);
  }
  if (consent.state !== 'active') {
    return deny(REASONS.CONSENT_NOT_ACTIVE, { state: consent.state });
  }
  // 读侧对 stale 已把 effective_scope 清空，这里再判一次是**纵深**（不是第二份实现）：
  // 只要 stale 为真就不出站，哪怕调用方自己拼了一个非空 scope 传进来。
  if (consent.policy_stale === true || consent.need_regrant === true) {
    return deny(REASONS.POLICY_STALE);
  }

  // ---- 第二关：用途必须显式授权过 ----
  if (typeof purpose !== 'string' || PURPOSES.indexOf(purpose) === -1) {
    return deny(REASONS.PURPOSE_INVALID);
  }
  const scopes = Array.isArray(consent.effective_scope) ? consent.effective_scope : [];
  if (scopes.indexOf(purpose) === -1) {
    return deny(REASONS.PURPOSE_NOT_GRANTED, { purpose: purpose });
  }

  // ---- 第三关：k-匿名 ----
  const judged = judgeSample(input.sample);
  if (!judged.ok) {
    return deny(judged.reason, {
      need: judged.need,
      got: (input.sample && typeof input.sample === 'object')
        ? { lineCount: input.sample.lineCount, supplierCount: input.sample.supplierCount }
        : null,
    });
  }

  return allow();
}

module.exports = {
  SAMPLE_MIN: SAMPLE_MIN,
  PURPOSES: PURPOSES,
  REASONS: REASONS,
  FALLBACK_L0: FALLBACK_L0,
  judgeSample: judgeSample,
  canSendToModel: canSendToModel,
};
