// revenueStore.js —— 营收日报表的落库与读取（R619）
//
// 为什么要落库：R616 那条链路是**只读**的，老板每次看都要重新选一次文件，
//   关掉就没了。他要的是「导一次，这个月随时能看」。
//
// 🔴 四条设计红线（三司会诊后定的，别改回去）：
//   1. **一个月只留一条 active**，重导生成新版本、旧的标 superseded ⇒ 不物理覆盖、可追溯。
//   2. **不硬封账**：平台 9 月才结算 8 月的单、9 月才退 8 月的款，封账会挡住正常业务。
//      这里不检查"是否归档月"，只保证版本可追。
//   3. **存完整解析快照**（result），不在读的时候重算 ⇒ 读到的就是当初算的，
//      不会出现"明细一套算法、汇总另一套算法"的分叉。口径变了就升 caliber_version。
//   4. **不碰 M1**：这是一张独立的营收事实表，`shop_monthly_income` / incomeItems 一行不动。
//      将来要并进 M1 月度账，必须先定权威源，不能双轨并行直接相加（会重复计算）。
const COLL = 'revenue_batch';
const CALIBER_VERSION = 'r619.1';

// 同 user + shop + month 只允许一条 active
const KEY = (uid, sid, month) => ({ user_id: uid, shop_id: sid, month: month });

// 🔴 表名只在这一处出现：既保住「单源」，又不让 collection(变量) 散落多处
//   （doc-write 守卫的 S-⑧ 数的是「动态集合名写点」，散落 6 处会触顶；
//    收敛成 1 个 helper 后既是单源、也不占额度）
function coll(db) {
  return db.collection(COLL);
}

// 集合不存在时自愈创建。
// 为什么要在代码里做：云函数 CLI 只有 list/info/deploy/download，**没法调用函数**；
//   让老板为了开个功能先去控制台建集合，是产品设计的失败。
//   ⇒ 首次写入时集合若不存在（错误码 502005 / collection not exists），就地建一次再写。
function isMissingColl(e) {
  const s = String((e && (e.errMsg || e.message || e.errCode)) || '');
  return /502005/.test(s) || /collection.*not\s*exist/i.test(s);
}

async function ensureColl(db) {
  try {
    if (typeof db.createCollection === 'function') await db.createCollection(COLL);
  } catch (e) {
    // 已存在 / 并发创建 / 权限不足 ⇒ 都交给后面的写入暴露真实原因，这里不吞错也不抛
  }
}

function nowIso() {
  return new Date().toISOString();
}

// 差异摘要：重导时要让老板看见"变了什么"，不能静默覆盖
function diffSummary(oldResult, newResult) {
  const pick = (r) => ({
    totalYuan: (r && r.revenueM1 && r.revenueM1.totalYuan) || 0,
    cashYuan: (r && r.cashInflow && r.cashInflow.totalYuan) || 0,
    dayCount: (r && r.coverage && r.coverage.dayCount) || 0,
    shiftCount: r && r.shiftCount ? r.shiftCount : 0,
  });
  const a = pick(oldResult);
  const b = pick(newResult);
  return {
    oldTotalYuan: a.totalYuan,
    newTotalYuan: b.totalYuan,
    totalDeltaYuan: Math.round(Number(((b.totalYuan - a.totalYuan) * 100).toFixed(10))) / 100,
    oldDayCount: a.dayCount,
    newDayCount: b.dayCount,
    dayDelta: b.dayCount - a.dayCount,
    oldShiftCount: a.shiftCount,
    newShiftCount: b.shiftCount,
    shiftDelta: b.shiftCount - a.shiftCount,
    changed: Math.abs(b.totalYuan - a.totalYuan) > 0.005 || b.dayCount !== a.dayCount,
  };
}

// 读查询的容错：集合还没建时返回「空」，不抛。
//   否则页面一进来读库就报错，老板会看到「加载失败」——而他其实只是还没导过数据。
async function safeGet(p) {
  try {
    return await p;
  } catch (e) {
    if (isMissingColl(e)) return null;
    throw e;
  }
}

async function findActive(db, uid, sid, month) {
  const r = await safeGet(coll(db)
    .where(Object.assign(KEY(uid, sid, month), { status: 'active' }))
    .orderBy('created_at', 'desc')
    .limit(1)
    .get());
  return (r && r.data && r.data[0]) || null;
}

async function findByFile(db, uid, sid, fileMd5) {
  const r = await safeGet(coll(db)
    .where({ user_id: uid, shop_id: sid, file_md5: fileMd5, status: 'active' })
    .limit(1)
    .get());
  return (r && r.data && r.data[0]) || null;
}

/**
 * 落库。返回 { ok, mode, batch_id, diff, reason }
 * mode: 'created' | 'duplicate' | 'need_confirm' | 'replaced'
 */
async function commit(ctx) {
  const { db } = ctx;
  const uid = ctx.userId;
  const sid = ctx.shopId;
  const md5 = ctx.fileMd5;
  const result = ctx.result;
  const month = (result.coverage && result.coverage.month) || '';
  if (!month) {
    return { ok: false, reason: 'no_month' };
  }

  // ① 同一份文件已经在库 ⇒ 幂等，不重复写（老板点了两次不会出两条）
  const same = await findByFile(db, uid, sid, md5);
  if (same) {
    return { ok: true, mode: 'duplicate', batch_id: same._id, result: same.result };
  }

  const active = await findActive(db, uid, sid, month);
  const diff = active ? diffSummary(active.result, result) : null;

  // ② 不同文件但同月已有数据 ⇒ 先给差异，确认后才换（不静默覆盖）
  if (active && !ctx.confirm) {
    return {
      ok: true, mode: 'need_confirm', batch_id: active._id,
      diff, old_batch_id: active._id,
      old_file_name: active.file_name || '',
      old_created_at: active.created_at || '',
    };
  }

  // ③ 写新版本
  const doc = {
    user_id: uid,
    shop_id: sid,
    month,
    file_md5: md5,
    file_name: ctx.fileName || '',
    file_size: ctx.fileSize || 0,
    // excel = 平台/收银导出的原始表；manual = 老板手填的整月汇总。
    // 两者都进同一张表，但来源必须留痕 —— 手填的数不能当成"可对账的原始凭证"。
    source: ctx.source || 'excel',
    caliber_version: CALIBER_VERSION,
    status: 'active',
    superseded_by: '',
    total_fen: (result.revenueM1 && result.revenueM1.totalFen) || 0,
    total_yuan: (result.revenueM1 && result.revenueM1.totalYuan) || 0,
    day_count: (result.coverage && result.coverage.dayCount) || 0,
    shift_count: (result.shifts || []).length,
    coverage: result.coverage || null,
    result,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const ins = await (async () => {
    try {
      return await coll(db).add({ data: doc });
    } catch (e) {
      if (!isMissingColl(e)) throw e;
      await ensureColl(db);                       // 集合还没建 ⇒ 就地建一次再试
      return await coll(db).add({ data: doc });
    }
  })();
  const newId = ins._id || (ins.id || '');

  // ④ 旧版本降级（写成功之后才降，最坏情况是两条 active，读时取最新一条）
  if (active && active._id && active._id !== newId) {
    await coll(db).doc(active._id).update({
      data: { status: 'superseded', superseded_by: newId, updated_at: nowIso() },
    });
  }

  return { ok: true, mode: active ? 'replaced' : 'created', batch_id: newId, diff };
}

/** 读当前生效的一版。没有就返回 null（页面显示上传入口）
 *  month 留空 ⇒ 取该店**最近一次**导入的那一版（页面一进来就要有东西看，不能让老板先选月份） */
async function getActive(ctx) {
  let doc = null;
  if (ctx.month) {
    doc = await findActive(ctx.db, ctx.userId, ctx.shopId, ctx.month);
  } else {
    const r = await safeGet(coll(ctx.db)
      .where({ user_id: ctx.userId, shop_id: ctx.shopId, status: 'active' })
      .orderBy('created_at', 'desc')
      .limit(1)
      .get());
    doc = (r && r.data && r.data[0]) || null;
  }
  if (!doc) return null;
  return {
    batch_id: doc._id,
    month: doc.month,
    file_name: doc.file_name || '',
    source: doc.source || 'excel',
    created_at: doc.created_at || '',
    caliber_version: doc.caliber_version || '',
    coverage: doc.coverage || null,
    result: doc.result,
  };
}

/** 该店已有哪些月份（页面可用来做月份切换，暂未接） */
async function listMonths(ctx) {
  const r = await coll(ctx.db)
    .where({ user_id: ctx.userId, shop_id: ctx.shopId, status: 'active' })
    .field({ month: true, total_yuan: true, created_at: true })
    .orderBy('month', 'desc')
    .limit(24)
    .get();
  return (r.data || []).map((x) => ({
    month: x.month, totalYuan: x.total_yuan, createdAt: x.created_at,
  }));
}

module.exports = { COLL, CALIBER_VERSION, commit, getActive, listMonths, diffSummary };
