#!/usr/bin/env bash
# review/evidence/r453_amortize_audit/mutation_proof_r453.sh
# R453 · 独立变异证明：证明「摊销引擎等价性」判据**有鉴别力**，且旧守卫确实漏报。
#
# 做法：搭一个**最小临时树**（只放 batch8c 真正读/require 的那 60 来个文件），
#       在三份摊销引擎里任选一份做**人为漂移**，然后分别用
#       【旧守卫 = HEAD 版 selftest_batch8c.js】与【新守卫 = 工作树版】跑，比对判定。
#
# 期望矩阵（这才是"证明"，不是自述）：
#   ┌────────────────────┬──────────────┬──────────────┐
#   │ 情形               │ 旧守卫(HEAD) │ 新守卫(WT)   │
#   ├────────────────────┼──────────────┼──────────────┤
#   │ 基线（无篡改）      │ 绿           │ 绿           │
#   │ 篡改 ② 尾差句       │ 绿（漏报！） │ 红（抓到）   │
#   │ 篡改 ③ 尾差句       │ 绿（漏报！） │ 红（抓到）   │
#   │ 篡改 ① 尾差句       │ 红           │ 红           │
#   └────────────────────┴──────────────┴──────────────┘
#
# ⚠️ 三条本机纪律（都踩过）：
#   ① 不挂 gitcache preload（本证明要读**工作树真内容**，不是缓存）；
#   ② 不用 rm -rf（会被 safe-delete 拦、卡在确认） ⇒ 目录名带时间戳，每次全新；
#   ③ 不逐文件 cp 8692 个跟踪文件（Windows 上要分钟级） ⇒ 只复制依赖面。
set -u
REPO="/c/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP="/c/Users/lzj/AppData/Local/Temp/inscode/r453_mut_$(date +%s)"
NODE="C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
unset NODE_OPTIONS 2>/dev/null || true

cd "$REPO" || exit 1
echo "临时树：$TMP"

mkdir -p "$TMP/cloudfunctions/saveLedger" "$TMP/tools" "$TMP/pages/month" \
         "$TMP/miniprogram/i18n" "$TMP/specs/dev-specs/i18n" "$TMP/specs/dev-specs/core"
cp -r cloudfunctions/saveAsset cloudfunctions/calcAmortize cloudfunctions/getAmortSchedule "$TMP/cloudfunctions/"
cp cloudfunctions/saveLedger/service.js "$TMP/cloudfunctions/saveLedger/"
cp tools/selftest_batch8c.js "$TMP/tools/"
git show HEAD:tools/selftest_batch8c.js > "$TMP/tools/_guard_old.js"
cp miniprogram/i18n/terms.js "$TMP/miniprogram/i18n/"
cp specs/dev-specs/i18n/terms.js "$TMP/specs/dev-specs/i18n/"
cp "specs/dev-specs/core/开发规范v1.0_ModuleA_收入费用核算.md" "$TMP/specs/dev-specs/core/"
for f in amortize.js amortize.wxml amortize.wxss assetEdit.js assetEdit.wxml input.js input.wxml input.wxss; do
  cp "pages/month/$f" "$TMP/pages/month/"
done
echo "依赖面复制完成：$(find "$TMP" -type f | wc -l) 个文件"

TAIL='if (end === naturalEnd) return asset.total_value - base * (N - 1);'
P1="$TMP/cloudfunctions/calcAmortize/service.js"
P2="$TMP/cloudfunctions/getAmortSchedule/service.js"
P3="$TMP/cloudfunctions/saveLedger/service.js"

run() {
  out=$("$NODE" "$1" 2>&1); rc=$?
  n=$(printf '%s' "$out" | grep -c "❌")
  printf "   [%s] RC=%s  失败断言=%s\n" "$2" "$rc" "$n"
  printf '%s' "$out" | grep -E "三份引擎全矩阵|尾差倒挤句仍在|影子样本" | sed 's/^/      /' | head -9
}

echo ""
echo "=== ① 基线（无篡改）==="
run "$TMP/tools/_guard_old.js" "旧守卫"
run "$TMP/tools/selftest_batch8c.js" "新守卫"

echo ""
echo "=== ② 篡改 ② getAmortSchedule 的尾差句（→ return base）==="
cp "$P2" "$P2.bak"
sed -i "s|if (end === naturalEnd) return asset.total_value - base \* (N - 1);|if (end === naturalEnd) return base;|" "$P2"
printf "   篡改生效：%s 处 'return base;'\n" "$(grep -c 'return base;' "$P2")"
run "$TMP/tools/_guard_old.js" "旧守卫"
run "$TMP/tools/selftest_batch8c.js" "新守卫"
cp "$P2.bak" "$P2"

echo ""
echo "=== ③ 篡改 ③ saveLedger 的尾差句（→ return base）==="
cp "$P3" "$P3.bak"
sed -i "s|if (end === naturalEnd) return asset.total_value - base \* (N - 1);|if (end === naturalEnd) return base;|" "$P3"
run "$TMP/tools/_guard_old.js" "旧守卫"
run "$TMP/tools/selftest_batch8c.js" "新守卫"
cp "$P3.bak" "$P3"

echo ""
echo "=== ④ 篡改 ① calcAmortize 的尾差句（旧守卫本就覆盖这份）==="
cp "$P1" "$P1.bak"
sed -i "s|return asset.total_value - base \* (N - 1);|return base;|" "$P1"
run "$TMP/tools/_guard_old.js" "旧守卫"
run "$TMP/tools/selftest_batch8c.js" "新守卫"
cp "$P1.bak" "$P1"

echo ""
echo "=== ⑤ 还原后回归（应回到全绿）==="
run "$TMP/tools/selftest_batch8c.js" "新守卫"
echo ""
echo "临时树：$TMP"
echo "ALLDONE"
