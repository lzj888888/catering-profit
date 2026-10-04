// cloudfunctions/manageShop/index.js —— 店铺管理（新建 / 重命名 / 删除）· Controller 层 · 写
//
// 为什么新增本函数（R194，李老师 2026-10-03 授权「都听你的，安排。做吧」）：
//   全站盘点（review/AUDIT_2026-10-03_全站功能入口与按钮盘点.md §2 P0-1/P1-7）实测：
//     ① `cloudfunctions/` 里**没有任何**删除店铺的路径 ⇒ 免费档只给 1 家店，用户误建第 2 家
//        就**永久占额度**，连新建都做不了（基础设施其实齐：shop 有 is_deleted、DataAdapter 已统一过滤）；
//     ② `shop/switch` 的「新增店铺」按钮**根本建不了店** —— 它跳到 `shop/setting`，而设置页走
//        `saveShopSetting`（只更新**当前**店）⇒ 用户以为在建店，实际在给当前店改名；
//     ③ 重命名只能改「当前店」，且要先进设置页（列表里没有入口）。
//   ⇒ 三件事合成一个函数：`op: create | rename | delete`。
//   R210 再加两个：`op: reset`（清空这家店的月度账，**店还在**）、`op: stats`（只读清点量级）。
//     起因 = 李老师「对于有一个店的餐饮老板，删除店铺是删除不了的」——R208 虽已放开末店可删，
//     但老板真正想要的出口是「重做一遍账」，不该被迫把店删掉。详见 service.js 的 R210 注释段。
//
// 契约：
//   入参 { op, name?, target_shop_id?, client_request_id? }
//     ⚠️ 目标店字段**必须**叫 `target_shop_id`：`utils/api.js::call()` 会无条件注入当前店的 `shop_id`
//   出参（各 op 同形子集）{ op, shop_id, name?, used?, remaining?, free_limit?, replayed?, client_request_id,
//                          months?, rows?, income?, expense? }（后四个只有 stats / reset 回）
//   错误：INVALID_PARAM（入参）、FORBIDDEN（非本人店铺）、RESOURCE_NOT_FOUND（店不存在或已软删）、
//        FREE_LIMIT_EXCEEDED（超免费额度）、HARD_CAP_EXCEEDED（超硬上限）、SYSTEM_ERROR（写库未被写入 / 配额配置缺失 /
//        清空行数超护栏 RESET_MAX_ROWS）
//   权限：create 只验身份；rename / delete / reset / stats 另验**目标店归属**（assertShopOwner）
//   幂等：rename / delete / reset 走 `findPriorResult`（重放形态，同一 crid 直接回首次结果）；
//        create 走**确定性 `_id`**（同 crid 重试撞 `_id` ⇒ 回读首次结果），与 common/defaultShopId 同一手法。
//        ⚠️ stats 是**纯读**，跳过幂等重放（同样不写 audit_log，否则清点一次就留一条垃圾审计）。
//   软删：删除店铺 / 清空月度账都只写 is_deleted=true（**绝不物理删除**），历史数据保留可追溯。
//
// ⚠️ 本函数**不动金额引擎**（无 netUnitCostWan / calcCostCard 调用）⇒ 无锚点复算面。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner, genId, isDuplicateKeyError } = common;
const { ERROR_CODES, ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { nowUtc } = common.utilTime;
const { writeAudit } = common.audit;
// ⚠️ 幂等单源一律用**限定名**调用（`common.idempotency.findPriorResult` / `.shopKey`），
//    不解构到局部 —— `tools/check_idempotency.js` 的 I2/I4 按 `idempotency.xxx(` 形态识别，
//    解构后形如裸调用 ⇒ 会被判成「无幂等实现 / 自拼键」，是**假红**（本轮实测踩到）。
const S = require('./service');
const { validateInput } = require('./validate');

// 免费档配置行（与 getShopList / checkQuota **同一真相源**；本函数不硬编码任何额度值）
const PLAN_ID = 'plan_free';

exports.main = async (event) => {
  const ctx = cloud.getWXContext();

  // ===== 1. 鉴权中间件（批次 0）=====
  const auth = await resolveAuth(ctx, db);
  if (auth.error) return fail(auth.error);
  const userId = auth.user.id;

  // ===== 2. 入参校验 =====
  const v = validateInput(event);
  if (v.error) return fail(v.error, v.msg);
  const crid = v.input.client_request_id;

  // 🔴 R194：create 的幂等预检必须落在**任何业务写之前**（R73 的 I3「顺序不变量」按**整文件文本序**判，
  //    文本序 = 执行序）。create 的目标 `_id` 由 (userId, crid) **确定性派生**且含 userId
  //    ⇒ 用它可以安全地做重放预检（键落在自己名下，不涉及他人店铺）。
  //    ⚠️ rename / delete 的预检**不在此处**：它们必须排在 `assertShopOwner` **之后**
  //      （先鉴权后重放），否则越权用户可借他人 shop_id 重放别人的首次结果。
  if (v.op === 'create' && crid) {
    const newId0 = S.buildCreateShopId(userId, crid);
    if (newId0) {
      const prior0 = await common.idempotency.findPriorResult(db, newId0, crid);
      if (prior0) return ok(prior0);
    }
  }

  const da = makeAdapter(db);
  const now = nowUtc();

  if (v.op === 'create') return onCreate(da, userId, v, crid, now);
  return onWriteExisting(da, userId, v, crid, now);
};

// ===== op=create：新建店铺 =====
async function onCreate(da, userId, v, crid, now) {
  // 3. 额度判定（唯一真相源 feature_permissions.plan_free.limits）
  let d;
  try {
    const fpRes = await db.collection('feature_permissions').where({ plan_id: PLAN_ID }).limit(1).get();
    const fp = fpRes && fpRes.data && fpRes.data[0];
    const cnt = await da.countActive('shop', { user_id: userId });   // 软删不占额度（countActive 恒带 is_deleted=false）
    // 🔴 R215b：付费判定走单源 common/entitlement.js（只读 expire_at，不看 plan_id）
    const paid = common.isPaid(await common.entitlement.loadExpireAt(db, userId));
    d = S.decideCreate({ used: (cnt && cnt.total) || 0, limits: fp && fp.limits, isPaid: paid });
  } catch (e) {
    return fail(ERROR_CODES.SYSTEM_ERROR, (e && e.message) || '额度判定失败');
  }
  if (d.hit_hard_limit) return fail(ERROR_CODES.HARD_CAP_EXCEEDED, '店铺数已达硬上限（' + d.hard_limit + ' 家）');
  // 付费墙在**前端**由 getShopList.hit_free_limit 先弹；这里只是服务端兜底（写入真拦截，R120 口径）
  if (d.hit_free_limit) return fail(ERROR_CODES.FREE_LIMIT_EXCEEDED, '免费档最多 ' + d.free_limit + ' 家店铺');

  // 4. 落库（`_id` 确定性派生 ⇒ 幂等由构造保证）
  const newId = S.buildCreateShopId(userId, crid) || genId(S.CREATE_ID_PREFIX);
  const docx = S.buildShopDoc({ _id: newId, userId, name: v.name, now });
  try {
    await da.insert('shop', docx);
  } catch (e) {
    if (isDuplicateKeyError(e)) {
      // 重放：同一 crid 的第二次调用 ⇒ 回读首次创建的店，**不报错、不重复建店**
      const again = await da.get('shop', newId);
      if (again) {
        return ok({
          op: 'create', shop_id: again.shop_id || newId, name: again.name || v.name,
          used: d.used, free_limit: d.free_limit, replayed: true, client_request_id: crid,
        });
      }
    }
    throw e;
  }

  const result = {
    op: 'create', shop_id: newId, name: v.name,
    used: d.used + 1, free_limit: d.free_limit, replayed: false, client_request_id: crid,
  };
  await writeAudit(db, {
    action: 'SHOP_CREATE', operator_type: 'user', operator_id: userId, shop_id: newId,
    before_data: null, after_data: result, remark: '新建店铺', idempotency_key: common.idempotency.shopKey(newId, crid),
  });
  return ok(result);
}

// ===== op=rename / delete：都要先验「目标店归属」=====
async function onWriteExisting(da, userId, v, crid, now) {
  const target = v.target_shop_id;

  const owner = await assertShopOwner(db, target, userId);
  if (owner.error) return fail(owner.error, owner.msg);

  // 🔴 R210：stats 是**纯读** ⇒ 必须排在 findPriorResult **之前**返回
  //    （清点一次不该留下幂等记录、也不该进审计表），但仍排在 assertShopOwner **之后**
  //    —— 越权者连「这家店有几条账」都不该问到。
  if (v.op === 'stats') return onStats(da, target);

  // 幂等重放（同一 crid 的第二次调用 ⇒ 直接回首次结果）
  const prior = await common.idempotency.findPriorResult(db, target, crid);
  if (prior) return ok(prior);

  // 🔴 写库主键**必须**用 `_id`：`doc(业务键).update()` 在真云会静默 0 行（round116 血案）
  const rid = (owner.data && (owner.data._id || owner.data.id)) || target;

  if (v.op === 'rename') {
    const up = await db.collection('shop').doc(rid).update({ data: S.buildRenamePatch({ name: v.name, now }) });
    const updated = (up && up.stats && up.stats.updated) || 0;
    if (!updated) return fail(ERROR_CODES.SYSTEM_ERROR, '店铺名未写入（target=' + rid + '）');
    const result = { op: 'rename', shop_id: target, name: v.name, client_request_id: crid };
    await writeAudit(db, {
      action: 'SHOP_RENAME', operator_type: 'user', operator_id: userId, shop_id: target,
      before_data: { name: (owner.data && owner.data.name) || '' }, after_data: result,
      remark: '重命名店铺', idempotency_key: common.idempotency.shopKey(target, crid),
    });
    return ok(result);
  }

  // ===== op=reset：清空这家店的月度账（店铺本身**保留**）=====
  if (v.op === 'reset') return onReset(da, userId, target, crid);

  // op=delete
  // R208：只要还有 ≥1 家活跃店就允许删（删到 0 家 = 额度释放，可再建；旧判据要求剩 ≥1 家是错的）
  //   —— 详见 service.js::decideDelete 头注的历史更正。此处仅在「已无活跃店铺」这一异常态上 fail-closed。
  const cnt = await da.countActive('shop', { user_id: userId });
  const d = S.decideDelete({ activeCount: (cnt && cnt.total) || 0 });
  if (!d.allowed) return fail(ERROR_CODES.RESOURCE_NOT_FOUND, '没有可删除的店铺');

  const res = await da.softDelete('shop', rid, userId);
  const updated = (res && res.stats && res.stats.updated) || 0;
  if (!updated) return fail(ERROR_CODES.SYSTEM_ERROR, '店铺未删除（target=' + rid + '）');

  const result = {
    op: 'delete', shop_id: target, name: (owner.data && owner.data.name) || '',
    used: d.remaining, remaining: d.remaining, client_request_id: crid,
  };
  await writeAudit(db, {
    action: 'SHOP_DELETE', operator_type: 'user', operator_id: userId, shop_id: target,
    before_data: { name: result.name, is_deleted: false }, after_data: result,
    remark: '删除店铺（软删，不物理清除历史账本与成本卡）', idempotency_key: common.idempotency.shopKey(target, crid),
  });
  return ok(result);
}

// ===== R210：清点这家店的月度账量级（纯读，供 op=stats 与 op=reset 共用）=====
// 🔴 凡「要全部行」的场景**必用 listAll**（`list()` 上限 LIST_LIMIT 且语义是"展示用列表"）：
//    否则「到底判据」不成立 —— 漏掉的行既不会被清、也不会报错，是典型的静默半删。
async function scanMonthly(da, target) {
  const acc = await da.listAll('shop_monthly_account', { shop_id: target, is_deleted: false });
  const rows = (acc && acc.data) || [];
  const seen = {};
  let months = 0;
  for (let i = 0; i < rows.length; i++) {
    const m = rows[i] && rows[i].month;
    if (m && !seen[m]) { seen[m] = 1; months += 1; }
  }
  const inc = await da.countActive('shop_monthly_income', { shop_id: target });
  const exp = await da.countActive('shop_monthly_expense', { shop_id: target });
  const income = (inc && inc.total) || 0;
  const expense = (exp && exp.total) || 0;
  return {
    months,
    rows: rows.length + income + expense,     // 三表合计行数 ⇒ 与 RESET_MAX_ROWS 同一口径
    income, expense,
    truncated: !!(acc && acc.truncated),
    detail: { account: rows.length, income, expense },
  };
}

// ===== op=stats：只读清点（不写库、不写审计、不进幂等）=====
async function onStats(da, target) {
  const st = await scanMonthly(da, target);
  return ok({
    op: 'stats', shop_id: target,
    months: st.months, rows: st.rows,
    income: st.income, expense: st.expense,
  });
}

// ===== op=reset：清空这家店的月度账（店 / 菜品卡 / 原料全保留）=====
async function onReset(da, userId, target, crid) {
  // 1. 先清点 ⇒ 交给 decideReset 判能不能清（没账不清、超护栏不清）
  const st = await scanMonthly(da, target);
  const d = S.decideReset({ months: st.months, rows: st.rows, truncated: st.truncated });
  if (!d.allowed) {
    if (d.reason === 'TOO_MANY_ROWS') {
      return fail(ERROR_CODES.SYSTEM_ERROR,
        '这家店月度账数据太多（超 ' + S.RESET_MAX_ROWS + ' 行），暂不支持一键清空');
    }
    return fail(ERROR_CODES.RESOURCE_NOT_FOUND, '这家店还没有月度账套，不需要清空');
  }

  // 2. 逐表软删。🔴 写库主键**必须**用 `_id`（`doc(业务键).update()` 在真云**静默 0 行**，
  //    round116 血案）⇒ 先 listAll 拿到真实 `_id`，再按小批并发 softDelete，逐条核 stats.updated；
  //    任一行没被写入即整体 fail —— **绝不留"半清干净"的中间态**。
  const BATCH = 20;
  const cleaned = {};
  for (let i = 0; i < S.RESET_COLLECTIONS.length; i++) {
    const coll = S.RESET_COLLECTIONS[i];
    const all = await da.listAll(coll, { shop_id: target, is_deleted: false });
    const list = (all && all.data) || [];
    const ids = [];
    for (let j = 0; j < list.length; j++) {
      const row = list[j] || {};
      const ridRow = row._id || row.id || '';
      if (ridRow) ids.push(ridRow);
    }
    if (ids.length !== list.length) {
      return fail(ERROR_CODES.SYSTEM_ERROR, '月度账读取不完整（' + coll + '：缺 ' + (list.length - ids.length) + ' 个主键）');
    }
    let done = 0;
    for (let b = 0; b < ids.length; b += BATCH) {
      const slice = ids.slice(b, b + BATCH);
      const rs = await Promise.all(slice.map((ridRow) => da.softDelete(coll, ridRow, userId)));
      for (let k = 0; k < rs.length; k++) done += (rs[k] && rs[k].stats && rs[k].stats.updated) || 0;
    }
    if (done !== ids.length) {
      return fail(ERROR_CODES.SYSTEM_ERROR, '月度账未完全清空（' + coll + '：' + done + '/' + ids.length + '）');
    }
    cleaned[coll] = done;
  }

  const result = {
    op: 'reset', shop_id: target,
    months: d.months, rows: d.rows,
    income: cleaned.shop_monthly_income || 0,
    expense: cleaned.shop_monthly_expense || 0,
    client_request_id: crid,
  };
  await writeAudit(db, {
    action: 'SHOP_RESET', operator_type: 'user', operator_id: userId, shop_id: target,
    before_data: st.detail, after_data: result,
    remark: '清空月度账（软删 ' + d.months + ' 个月账套 / ' + d.rows + ' 行；店铺与菜品卡、原料保留）',
    idempotency_key: common.idempotency.shopKey(target, crid),
  });
  return ok(result);
}
