// tools/launch_gap_report.js —— 上线缺口自检（报告型，不进 verify_all 门禁）
//
// 运行： node tools/launch_gap_report.js         人读表格
//       node tools/launch_gap_report.js --json   机器消费
//
// 为什么要有它（2026-11-23）：
//   「距离上线还差哪些」此前只存在于人写的清单/审计里，每次回答都靠回忆，
//   且 11-16 共识与 11-22 裁定对 iOS 结论相反、无人发现（见 review/AUDIT_2026-11-22...Q5）。
//   本脚本把缺口从「叙述」变成「读当前源码/配置得出的判据」，每次跑都是现状。
//
// 边界（别高估）：
//   · 只读本地文件，**不连微信后台** ⇒ 备案阶段、prod 环境是否真实存在、审核状态一律标
//     「需人工」，不猜、不伪绿。
//   · 不判红、不改文件、不进 333 套件；它回答的是「还差什么」，不是「代码对不对」。
//   · 新增/完成一项缺口时，改下面的 facts/items，不要改判据文案来凑绿。
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
  catch (e) { return ''; }
}
function pick(rel, re, fallback) {
  const src = read(rel);
  const m = src.match(re);
  return m ? (m[1] !== undefined ? m[1] : m[0]) : fallback;
}

// ===== 从源码现读的事实（不手抄，避免清单漂移）=====
const facts = {
  prodEnvId: pick('miniprogram/config/env.js', /prod:\s*'([^']+)'/, '(未读到)'),
  activeEnv: pick('miniprogram/config/env.js', /ACTIVE_ENV:\s*'([^']+)'/, '(未读到)'),
  paywallEnabled: pick('utils/featureFlags.js', /const\s+PAYWALL_ENABLED\s*=\s*(true|false)/, '(未读到)'),
  freeAccess: pick('cloudfunctions/common/payFlags.js', /const\s+FREE_ACCESS\s*=\s*(true|false)/, '(未读到)'),
  realPay: pick('cloudfunctions/payCreateOrder/service.js', /const\s+ENABLE_REAL_PAYMENT\s*=\s*(true|false)/, '(未读到)'),
  verifyStub: /verify:\s*\(\)\s*=>\s*false/.test(read('cloudfunctions/xpayNotify/index.js')),
  // 有注入点、但缺省值仍是空串 = 空壳（不是「已完成」）。第一版正则 `paySig = ''` 匹配不到
  // `const paySig = (...) ? ... : ''`，会把空壳误报成完成 —— 报告工具自我证伪后修正。
  signerStub: (() => {
    const src = read('cloudfunctions/xpayNotify/service.js');
    return /q\.signer\s*\(/.test(src) && /:\s*''\s*;/.test(src);
  })(),
  payParamsNull: /pay_params:\s*null/.test(read('cloudfunctions/payCreateOrder/service.js')),
  iosOneCut: /if\s*\(isIOS\(\)\)\s*return\s*showIOSBlocked\(\)/.test(read('utils/paywall.js')),
  frontendVirtualPay: /wx\.requestVirtualPayment\s*\(/.test(read('utils/paywall.js')) ||
    /wx\.requestVirtualPayment\s*\(/.test(read('subpkg/tools/pay/orders.js')),
  payingState: /支付处理中|paying|payInProgress/.test(read('utils/paywall.js')),
  reconcileWired: /decideReconcile/.test(read('subpkg/tools/pay/orders.js')) ||
    /decideReconcile/.test(read('utils/paywall.js')),
  orderNoAsserted: /虚拟支付单号合规（防 -15002）/.test(
    read('cloudfunctions/payCreateOrder/selftest.js')),
  xpayNotifyStaged: fs.existsSync(path.join(ROOT, 'cloudfunctions/xpayNotify/service.js')),
  checklistFnCount: pick('review/CHECKLIST_正式版发布前必做.md', /云函数 \| \*\*(\d+) 个\*\*/, '(未读到)'),

  // ===== 上线材料/平台侧（2026-11-23 第二轮：把「原来探讨过但没进清单」的项也现读 =====
  policyPlaceholders: (read('specs/dev-specs/上线材料_隐私政策_v1.md').match(/【[^】]+】/g) || []).length,
  featureSpecDraft: /提审时要填的「功能说明」草稿/.test(read('review/CHECKLIST_提审自查_20261110.md')),
  mineContactEntry: /open-type=["']contact["']/.test(read('pages/mine/index.wxml')),
  serviceApiWired: /openCustomerServiceConversation/.test(read('utils/paywall.js')),
  privacyContractWired: /openPrivacyContract/.test(read('pages/mine/index.js')),
  purgeFnReady: fs.existsSync(path.join(ROOT, 'cloudfunctions/purgeDeletedData/index.js')),
  grouponSpecReady: fs.existsSync(path.join(ROOT, 'specs/dev-specs/core/团购核算_专项核对.md')),
  privacyContradictionFixed: (() => {
    const s = read('specs/dev-specs/上线材料_隐私政策_v1.md');
    return /唯一例外/.test(s) && !/相册相关\s*API\s*均未出现/.test(s);
  })(),
};

const isPlaceholder = (id) => /xxxxxxxx|^\s*$/.test(String(id));
const S = { DONE: 'DONE', HUMAN: 'HUMAN', CODE: 'CODE', COND: 'COND', DECIDE: 'DECIDE' };
const item = (layer, id, title, status, owner, criterion, evidence) =>
  ({ layer, id, title, status, owner, criterion, evidence });

const items = [];

// ---------- 层 1：免费版正式发布（与收不收钱无关）----------
items.push(
  item('免费版上线', 'F1', '小程序备案通过（管局审核）', S.HUMAN, '李老师',
    'MP 后台备案状态=已完成，拿到备案号', '需人工登录 mp.weixin.qq.com 查；脚本不连后台'),
  item('免费版上线', 'F2', '新建 prod 云环境', isPlaceholder(facts.prodEnvId) ? S.HUMAN : S.DONE,
    '李老师', 'env.js::ENV_MAP.prod 填入真实环境 ID（非 xxxxxxxx）',
    'miniprogram/config/env.js:24 → ' + facts.prodEnvId),
  item('免费版上线', 'F3', 'prod 库结构 33 集合 + 55 索引', S.HUMAN, '李老师 / 我',
    'apply_indexes.js --env <prod_id> --apply 回读全绿；集合由控制台建（initDb 有 prod 门禁）',
    'review/CHECKLIST_正式版发布前必做.md §B'),
  item('免费版上线', 'F4', 'prod 种子数据（subscription_plan / feature_permissions）', S.HUMAN, '我（待 F2）',
    'prod 库两张集合非空，否则付费/权限查不到配置',
    'review/CHECKLIST_正式版发布前必做.md §C'),
  item('免费版上线', 'F5', '全量云函数部署 prod（含新 xpayNotify）', S.HUMAN, '我（待 F2）',
    'cli functions info -e <prod_id> 逐个回读更新时间为本次；timeout 手工抬到 20',
    'review/CHECKLIST_正式版发布前必做.md §D'),
  item('免费版上线', 'F6', '前端切 ACTIVE_ENV=prod', facts.activeEnv === 'prod' ? S.DONE : S.HUMAN,
    '我（待 F2）', 'ACTIVE_ENV=prod 且 check_env_ready 无 ENV_FALLBACK 告警',
    'miniprogram/config/env.js:28 → ' + facts.activeEnv),
  item('免费版上线', 'F7', '上传 / 体验版 / 提交审核 / 发布', S.HUMAN, '李老师',
    'MP 版本管理出现审核中→已发布', 'review/CHECKLIST_正式版发布前必做.md §F'),
  item('免费版上线', 'F8', '隐私指引勾选相册+摄像头', S.HUMAN, '李老师',
    'MP 后台用户隐私保护指引含「相册（选中的照片或视频信息）」「摄像头」',
    'review/CHECKLIST_正式版发布前必做.md §F4'),
  item('免费版上线', 'F9', 'dev 侧第 49 条索引补齐', S.HUMAN, '我（待 AppSecret）',
    'idx_ai_insight_shop_month 建成，dev 48/49 → 49/49',
    'review/CHECKLIST_正式版发布前必做.md §0')
);

// ---------- 层 2：付费能力上线（依赖主体资质 + 商户号）----------
items.push(
  item('付费上线', 'P1', '付费交易闸门 PAYWALL_ENABLED', facts.paywallEnabled === 'true' ? S.DONE : S.COND,
    '李老师决策', '个人主体提审期刻意关闭（免费放行、无购买入口）；打开前不得提审',
    'utils/featureFlags.js:57 → ' + facts.paywallEnabled),
  item('付费上线', 'P2', '微信支付商户号 + 虚拟支付能力 + 4 道具上架', S.HUMAN, '李老师',
    '拿到 mchid / offerId / productId，goodsPrice 与后台逐分一致',
    'review/PLAN_2026-11-22_虚拟支付规则核实与接入方案.md'),
  item('付费上线', 'P3', 'ENABLE_REAL_PAYMENT 打开', facts.realPay === 'true' ? S.DONE : S.CODE,
    '我（待 P2）', 'payCreateOrder 与 payRenew 两处同值；改完必须重新部署',
    'cloudfunctions/payCreateOrder/service.js:11 → ' + facts.realPay),
  item('付费上线', 'P4', 'xpayNotify 真实验签器注入', facts.verifyStub ? S.CODE : S.DONE,
    '我（待 P2）', 'verifiers.verify=官方实现；当前默认 false = 所有回调被拒（fail-closed 安全默认）',
    'cloudfunctions/xpayNotify/index.js:33'),
  item('付费上线', 'P5', 'signData 真实 RSA 签名注入', facts.signerStub ? S.CODE : S.DONE,
    '我（待 P2）', 'paySig 非空；当前空串 = 前端拿空签名调起必被拒（fail-closed 正确行为）',
    'cloudfunctions/xpayNotify/service.js:373'),
  item('付费上线', 'P6', '前端 wx.requestVirtualPayment 调起 + 支付中状态', facts.frontendVirtualPay ? S.DONE : S.CODE,
    '我（待 P2/P3）', '下单拿到 pay_params 后调起；支付中提示「权益到账后刷新」，防重复下单',
    'utils/paywall.js:203 仅一行注释；subpkg/tools/pay/orders.js:116-125 同缺'),
  item('付费上线', 'P7', '主动查单兜底接线（decideReconcile）', facts.reconcileWired ? S.DONE : S.CODE,
    '我（待 P2）', '前端支付中超阈值主动查单；服务端纯函数已就绪但未暴露/未调用',
    'cloudfunctions/xpayNotify/service.js:318-334（纯函数）'),
  item('付费上线', 'P8', 'iOS 从一刀切禁买改为「说明+留资」', facts.iosOneCut ? S.CODE : S.DONE,
    '我（待李老师裁定）', '11-16 共识记「无需动」，11-22 三司 Q5 要求改 —— 两份结论冲突，先定再改',
    'utils/paywall.js:64,179；review/PLAN_2026-11-16_与豆包总方案对齐_共识.md:29'),
  item('付费上线', 'P9', '真机联调（Android 沙箱 + iOS 现网真扣款）', S.HUMAN, '李老师 + 我',
    '1 分钱真实下单→回调落库→权益生效；退款链路走通',
    'review/AUDIT_2026-11-22_接支付方案三司会诊裁定.md §2 二期'),
  item('付费上线', 'P10', '下单单号虚拟支付合规断言（防 -15002）', facts.orderNoAsserted ? S.DONE : S.CODE,
    '我', 'genOrderNo 产出须 8–32 字符、非 _ 开头、可直接喂 buildVirtualPaySign',
    'cloudfunctions/payCreateOrder/selftest.js')
);

// ---------- 层 3 · 上线材料 / 平台侧（历史探讨过、但没进主清单的项）----------
items.push(
  item('上线材料', 'M1', '隐私政策「不收集」段与第 9 项参考照片字面互斥',
    facts.privacyContradictionFixed ? S.DONE : S.CODE, '我',
    '「不收集」段提及相册/拍照须写例外；附录不得再写「相册相关 API 均未出现」',
    'specs/dev-specs/上线材料_隐私政策_v1.md:46,109；tools/check_privacy_collection.js C10'),
  item('上线材料', 'M2', '隐私政策 6 处占位符填值 + 后台录入 + 公网 URL',
    facts.policyPlaceholders === 0 ? S.DONE : S.HUMAN, '李老师',
    '6 处 【…】 替换（主体名/邮箱/客服方式/响应时限/第九节/公网 URL）并照抄进 mp 后台',
    'specs/dev-specs/上线材料_隐私政策_v1.md:95-102；当前残留 ' + facts.policyPlaceholders + ' 处'),
  item('上线材料', 'M3', '提审「功能说明」草稿（让审核员 3 步走通）',
    facts.featureSpecDraft ? S.DONE : S.CODE, '我（已备）/ 李老师（照抄）',
    '草稿含真机验过的 4 个数字，后台补充说明栏直接粘贴',
    'review/CHECKLIST_提审自查_20261110.md:108-128'),
  item('上线材料', 'M4', '审核测试账号 / 演示数据 seedDemo A/B 二选一', S.HUMAN, '李老师裁定',
    '确定给审核员哪种体验路径；未定则按 M3 草稿「自动建示例店铺」',
    'specs/dev-specs/上线材料_提审材料包_v1.md:39-60,165,180'),
  item('上线材料', 'M5', '客服：入口三处已接 + 已绑 1 个客服（剩客服端登录在线）', S.HUMAN, '李老师（客服端）',
    '2026-11-23 实测：mp 后台「基础功能→客服」已绑 1 个「餐饮智算 客服管理员」（还可加 99）；'
    + '代码入口三处（我的/订单/诊断）open-type="contact" 已接。'
    + '⚠️ 剩：客服本人登录「小程序客服助手」设在线 + 配自动回复；未登录=会话无人接（工具无法探测后台登录态，故仍标人工）',
    'review/PLAN_2026-11-23_客服售后直达与未上线测试.md §1.3（含实操复核表）；'
    + 'review/客服自动回复文案模板_可直接粘贴.md'),
  item('上线材料', 'M6', '首启隐私弹窗真机补测（#148）', S.HUMAN, '李老师',
    '真机首启弹窗出现、同意/拒绝两路径正常',
    'review/CHECKLIST_提审自查_20261110.md:30,139'),
  item('上线材料', 'M7', '备案材料清单（主体一致 / 短信核验 / 备案号展示）', S.HUMAN, '李老师',
    '备案号下发；「更多资料」页展示为微信系统行为，无需代码',
    'review/CHECKLIST_备案材料清单_20261110.md:73-76,99-103'),
  item('上线材料', 'M8', '服务范围声明 / 类目文案（避开投资回报等词）', S.HUMAN, '李老师',
    '类目「工具→效率」；文案不出现理财/回报承诺',
    'specs/dev-specs/上线材料_提审材料包_v1.md:111-129'),
  item('上线材料', 'M9', '团购核算专项核对文件缺失', facts.grouponSpecReady ? S.DONE : S.DECIDE,
    '待李老师裁定', '外卖专项已补、团购仍缺；13_总览给的是「补文件 or 明确不补」二选一',
    'specs/dev-specs/core/13_上线前查缺补漏_决策与待办总览.md:319-348,384-386'),
  item('上线材料', 'M10', 'M1.6 四红线 + 红绿灯零实现', S.DECIDE, '待李老师二选一',
    '13_总览 :313-315 要求「补实现 or 明确降级」，未定前不算材料齐',
    'specs/dev-specs/core/13_上线前查缺补漏_决策与待办总览.md:289-316'),
  item('上线材料', 'M11', 'idx_line_card 规范陈述勘误（锁定版）', S.DECIDE, '待解锁 M3 v1.1',
    '云端已删旧索引、代码已改 idx_line_row；规范仍写旧名，按锁定版纪律只登记不擅改',
    'specs/dev-specs/core/13_上线前查缺补漏_决策与待办总览.md:415-433')
);

// ---------- 输出 ----------
const label = { DONE: '[OK]', HUMAN: '[WAIT-HUMAN]', CODE: '[CODE-GAP]', COND: '[INTENTIONAL-OFF]', DECIDE: '[PENDING-DECISION]' };
const summary = {
  DONE: items.filter((x) => x.status === S.DONE).length,
  HUMAN: items.filter((x) => x.status === S.HUMAN).length,
  CODE: items.filter((x) => x.status === S.CODE).length,
  COND: items.filter((x) => x.status === S.COND).length,
  DECIDE: items.filter((x) => x.status === S.DECIDE).length,
};

if (process.argv.indexOf('--json') >= 0) {
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), facts, summary, items }, null, 2));
} else {
  console.log('===== 上线缺口自检（读当前源码；不连微信后台）=====');
  console.log('事实快照：prod=' + facts.prodEnvId + '  ACTIVE_ENV=' + facts.activeEnv +
    '  PAYWALL_ENABLED=' + facts.paywallEnabled + '  ENABLE_REAL_PAYMENT=' + facts.realPay);
  console.log('云函数清单声明=' + facts.checklistFnCount + '  xpayNotify 已落地=' + facts.xpayNotifyStaged);
  let last = '';
  for (const x of items) {
    if (x.layer !== last) { console.log('\n--- ' + x.layer + ' ---'); last = x.layer; }
    console.log(label[x.status] + ' ' + x.id + ' ' + x.title);
    console.log('      判据：' + x.criterion);
    console.log('      谁做：' + x.owner + '  证据：' + x.evidence);
  }
  console.log('\n===== 汇总：' + summary.DONE + ' 完成 / ' + summary.HUMAN + ' 需人工或资质 / ' +
    summary.CODE + ' 代码侧缺口 / ' + summary.COND + ' 有意关闭 / ' +
    summary.DECIDE + ' 待裁定 =====');
  console.log('说明：CODE-GAP 不等于「现在能白做」——P3~P8 要等主体资质/商户号或李老师裁定，');
  console.log('      提前硬开会踩审核红线（见 utils/featureFlags.js:41-57）。本工具只报现状，不改文件。');
}
