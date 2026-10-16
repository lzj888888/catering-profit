#!/usr/bin/env bash
# review/evidence/r298x_m3/mutation_proof_r298x.sh —— R298X 独立变异证明
#
# 目的：证明本轮三组新判据**有分辨力**（不是恒真/不是恒绿），且**不误伤正确实现**。
#   A 组 tools/selftest_m3_recon.js          —— R298X 抑制原因 → 文案键（单源分派 + 语义相符）
#   B 组 cloudfunctions/getShopContext/selftest.js —— R298X switch key 跨函数同源
#   C 组 tools/check_pages.js ⑥              —— R298X 下拉刷新「钩子 ⇒ 开关」
#
# 🔴 纪律（沿用 r298w_idem / r298_b3_export 两轮）：
#   · 就地改 + trap 还原 + **残留复核**（跑完必须逐字节回到跑前状态）；
#   · **bash → node**，不用 node 的 spawnSync 去起 node（本机沙箱会 EBUSY）；
#   · 不删文件、不改 SUITES、不挂 preload（避免污染被测量的对象）；
#   · 变异器对「未逐字命中」直接 exit 2 —— 防「变异没打上」被误读成「守卫抓不到」。
#
# 用法：bash review/evidence/r298x_m3/mutation_proof_r298x.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
cd "$ROOT" || exit 1

MUT="review/evidence/r298x_m3/mutate_r298x.js"
SUITE_RECON="tools/selftest_m3_recon.js"
SUITE_CTX="cloudfunctions/getShopContext/selftest.js"
SUITE_PAGES="tools/check_pages.js"

# 会被本证明改动的文件（跑前备一份，跑后逐字节比对）
FILES="
utils/reconDerive.js
pages/recon/index.js
pages/recon/index.json
miniprogram/i18n/terms.js
cloudfunctions/getShopContext/service.js
cloudfunctions/getShopContext/selftest.js
cloudfunctions/getAmortSchedule/index.js
cloudfunctions/saveShopSetting/index.js
"
TMP="$(mktemp -d)"
snapshot() { for f in $FILES; do mkdir -p "$TMP/$(dirname "$f")"; cp "$f" "$TMP/$f"; done; }
restore()  { for f in $FILES; do cp "$TMP/$f" "$f"; done; }
trap restore EXIT
snapshot

total=0; bad=0
# probe <标签> <变异id或-> <被测脚本> <期望RC> <期望在输出里出现的串>
probe() {
  local label="$1" mutid="$2" suite="$3" want_rc="$4" want_pat="$5"
  total=$((total + 1))
  if [ "$mutid" != "-" ]; then
    node "$MUT" "$mutid" || { echo "❌[$label] 变异器失败（未逐字命中 ⇒ 本情形作废，需修变异器）"; bad=$((bad + 1)); return; }
  fi
  local out rc
  out="$(node "$suite" 2>&1)"; rc=$?
  local hit='—'
  if [ -n "$want_pat" ]; then
    if printf '%s' "$out" | grep -qF "$want_pat"; then hit='命中'; else hit='未命中'; fi
  fi
  # 结论行（`N 通过 / M 失败`）
  local tail_line
  tail_line="$(printf '%s' "$out" | grep -E '[0-9]+ *通过 *[／/] *[0-9]+ *失败' | tail -1)"
  [ -z "$tail_line" ] && tail_line="$(printf '%s' "$out" | grep -E '页面声明校验' | tail -1)"
  local ok=1
  if [ "$want_rc" = "0" ] && [ "$rc" != "0" ]; then ok=0; fi
  if [ "$want_rc" != "0" ] && [ "$rc" = "0" ]; then ok=0; fi
  if [ -n "$want_pat" ] && [ "$hit" = "未命中" ]; then ok=0; fi
  if [ "$ok" = "1" ]; then
    echo "✅[$label] RC=$rc（期望$want_rc）· 判据串「$want_pat」$hit  ·  ${tail_line}"
  else
    echo "❌[$label] RC=$rc（期望$want_rc）· 判据串「$want_pat」$hit  ·  ${tail_line}"
    bad=$((bad + 1))
  fi
  restore
}

echo "==================== R298X 独立变异证明 ===================="
echo "【C0 基线】三组套件在全绿状态下必须全绿"
probe "C0a-基线-recon" "-" "$SUITE_RECON" 0 "0 失败"
probe "C0b-基线-getShopContext" "-" "$SUITE_CTX" 0 "0 失败"
probe "C0c-基线-check_pages" "-" "$SUITE_PAGES" 0 ""

echo
echo "【A 组】recon 抑制原因 → 文案键（期望红在 R298X-③/⑥/⑩）"
probe "A1-单源又把 menu_no_price 借回覆盖率文案" A1 "$SUITE_RECON" 1 "❌ R298X-③"
probe "A2-页面退回内联分派"                    A2 "$SUITE_RECON" 1 "❌ R298X-⑩"
probe "A3-「没填售价」文案被写成覆盖率口径"    A3 "$SUITE_RECON" 1 "❌ R298X-⑥"

echo
echo "【B 组】switch key 跨函数同源（期望红在 R298X-J1/J2/J3/J4）"
probe "B1-读侧同名键值改坏"        B1 "$SUITE_CTX" 1 "❌ R298X-J1"
probe "B2-清空缺键登记表"          B2 "$SUITE_CTX" 1 "❌ R298X-J2"
probe "B3-新造未注册键字面量"      B3 "$SUITE_CTX" 1 "❌ R298X-J3d"
probe "B4-常量引用换裸字面量(死键)" B4 "$SUITE_CTX" 1 "❌ R298X-J4"

echo
echo "【C 组】下拉刷新「钩子 ⇒ 开关」（期望 ⑥ 判红；反向不得误伤）"
probe "C1-给 recon 页加回死钩子" C1 "$SUITE_PAGES" 1 "⑥"
# 反向：同时打开开关 ⇒ 应恢复绿（证明 ⑥ 判的是"一致"而不是"不许有钩子"）
{
  node "$MUT" C1 >/dev/null && node "$MUT" C2 >/dev/null || { echo "❌[C2] 变异器失败"; bad=$((bad + 1)); }
  out2="$(node "$SUITE_PAGES" 2>&1)"; rc2=$?
  total=$((total + 1))
  if [ "$rc2" = "0" ] && printf '%s' "$out2" | grep -qF "下拉钩子 18 页全部已开启"; then
    echo "✅[C2-反向-开关打开后恢复绿] RC=0 · 18 页全部已开启（⑥ 不误伤）"
  else
    echo "❌[C2-反向-开关打开后恢复绿] RC=$rc2 · $(printf '%s' "$out2" | tail -1)"
    bad=$((bad + 1))
  fi
  restore
}

echo
echo "==================== 残留复核（必须逐字节回到跑前）===================="
left=0
for f in $FILES; do
  if ! cmp -s "$TMP/$f" "$f"; then echo "❌ 未还原：$f"; left=$((left + 1)); fi
done
if [ "$left" = "0" ]; then echo "✅ 全部 $(( $(printf '%s' "$FILES" | tr -s '\n' '\n' | grep -c .) )) 个文件逐字节一致，无残留"; else bad=$((bad + 1)); fi

echo
echo "==================== 结论：$((total - bad))/$total 情形符合预期 ===================="
[ "$bad" = "0" ] || exit 1
