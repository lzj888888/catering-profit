#!/usr/bin/env bash
# R298 · B3 遗留三项（W1 异常兜底 / W2 重名去重 / 隐式全局：163）独立变异证明
#   —— fail-before / pass-after，真跑真守卫，业务码在 HEAD(修复前) ↔ 工作树(修复后) 间切换。
# 用法：bash review/evidence/r298_b3_export/mutation_proof_b3_leftovers.sh
# 纪律：不挂 gitcache preload（要读工作树真内容）；时间戳唯一目录；**不删除**已有目录。
set -u
REPO="/c/Users/lzj/WorkBuddy/Claw/catering-profit"
NODE="C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
BASE="/c/Users/lzj/AppData/Local/Temp/inscode/r298w_mut"
STAMP=$(date +%Y%m%d_%H%M%S)
T="$BASE/$STAMP"

echo "===== R298·B3 遗留三项 · 独立变异证明 ====="
echo "仓库：$REPO"
echo "临时根：$T"
echo ""

build() {  # $1=目标目录（真守卫 + 工作树业务码 起步）
  mkdir -p "$1/tools" "$1/utils" "$1/cloudfunctions/adminExport"
  cp "$REPO/tools/check_export_roundtrip.js"      "$1/tools/"
  cp -r "$REPO/cloudfunctions/exportData"         "$1/cloudfunctions/"
  cp "$REPO/cloudfunctions/adminExport/index.js"  "$1/cloudfunctions/adminExport/"
  cp "$REPO/utils/exportFile.js"                  "$1/utils/"
}

run() {  # $1=目录 ; 打印 RC + 总览 + 失败条目
  ( cd "$1" && "$NODE" tools/check_export_roundtrip.js > "$1/out.log" 2>&1 )
  local rc=$?
  echo "  RC=$rc   $(grep -E '通过 /' "$1/out.log" | tail -1 | sed 's/^ *//')"
  grep '❌' "$1/out.log" | sed 's/^/    /' | head -10
  return $rc
}

# ---------- C1 基线：工作树业务码 + 工作树守卫（修复后）----------
echo "----- C1 基线（业务码=工作树 · 守卫=工作树）⇒ 期望 RC=0 -----"
build "$T/c1"; run "$T/c1"; echo ""

# ---------- C2 修复前业务码：HEAD 业务码 + 工作树守卫 ----------
echo "----- C2 修复前（业务码=HEAD · 守卫=工作树）⇒ 期望 RC=1（W1/W2/W3 + E2b/E3b 应红）-----"
build "$T/c2"
( cd "$REPO" && git show HEAD:cloudfunctions/exportData/index.js > "$T/c2/cloudfunctions/exportData/index.js" )
run "$T/c2"; echo ""

# ---------- C3 修复前守卫：工作树业务码 + HEAD 守卫 ----------
echo "----- C3 老守卫（业务码=工作树 · 守卫=HEAD）⇒ 期望 RC=1（老 E2/E3/W1/W2 应红：修复即行为变化）-----"
build "$T/c3"
( cd "$REPO" && git show HEAD:tools/check_export_roundtrip.js > "$T/c3/tools/check_export_roundtrip.js" )
run "$T/c3"; echo ""

# ---------- C4 还原回归 ----------
echo "----- C4 还原回归（业务码=工作树 · 守卫=工作树）⇒ 期望 RC=0 -----"
build "$T/c4"; run "$T/c4"; echo ""

echo "===== 变异证明结束（临时根 $T，未删除）====="
