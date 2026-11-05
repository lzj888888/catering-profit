#!/usr/bin/env bash
# R298W · 幂等行为对拍（I8）独立变异证明 —— fail-before / pass-after
#   在**单点变异** common/idempotency.js 后真跑 tools/check_idempotency.js，验证 I8 判据不是恒真。
#   ⚠️ 变更是"就地改 + 立即还原"（bash→node 允许；node→node 派生被沙箱拦，故不用 spawnSync）。
set -u
REPO="/c/Users/lzj/WorkBuddy/Claw/catering-profit"
NODE="C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
T="$REPO/cloudfunctions/common/idempotency.js"
BAK="/c/Users/lzj/AppData/Local/Temp/inscode/idem_orig_$$.js"

cp "$T" "$BAK"
restore() { cp "$BAK" "$T"; }
trap restore EXIT

run() {
  ( cd "$REPO" && "$NODE" tools/check_idempotency.js ) > /c/Users/lzj/AppData/Local/Temp/inscode/idem_run.txt 2>&1
  local rc=$?
  echo "  rc=$rc  $(grep -E '通过 / .* 失败' /c/Users/lzj/AppData/Local/Temp/inscode/idem_run.txt | tail -1 | sed 's/^ *//')"
  grep '❌' /c/Users/lzj/AppData/Local/Temp/inscode/idem_run.txt | sed 's/^/     /' | head -6
}

echo "===== R298W · 幂等行为对拍（I8）独立变异证明 ====="
echo "----- C0 基线（未变异）⇒ 期望 85/0 -----"
run
echo ""

case_run() {  # $1=case 号 $2=标签 $3=期望红的断言关键字
  restore
  ( cd "$REPO" && "$NODE" review/evidence/r298w_idem/mutate_idem.js "$1" ) > /dev/null 2>&1
  local mrc=$?
  if [ "$mrc" != "0" ]; then
    echo "----- C$1 $2 ⇒ ❌ 变异未生效（mutate rc=$mrc，本情形无效）-----"
    return
  fi
  echo "----- C$1 $2 ⇒ 期望红（含 $3）-----"
  run
  echo ""
}

case_run 1 "键分隔符 __ → _（键格式漂移）"        "I8.1"
case_run 2 "键忽略 shopId（跨店串台）"            "I8.10"
case_run 3 "checkIdempotent 无条件判重复"          "I8.3"
case_run 4 "findPriorResult 返回整行而非 after_data" "I8.8"

restore
echo "----- C5 还原回归 ⇒ 期望 85/0 -----"
run

echo ""
echo "=== 工作树是否已还原（应无 idempotency.js 改动）==="
( cd "$REPO" && git diff --name-only )
echo "===== 结束 ====="
