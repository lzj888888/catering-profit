#!/usr/bin/env bash
# R298·C1/C3 独立变异证明（fail-before / pass-after）
# 目的：证明「升级后的守卫」在**修复前的代码**上必红、在**修复后的代码**上必绿。
# 做法：把真守卫 + 真业务码复制到临时树，先在临时树里把业务码换成 HEAD（修复前）版本 ⇒ 期望 RED；
#       再换回工作树（修复后）版本 ⇒ 期望 GREEN。两个守卫都跑。
# 为什么不用 node 驱动：沙箱禁 node→node 派生子进程；bash→node 可。
set -u
REPO="C:/Users/lzj/WorkBuddy/Claw/catering-profit"
TMP="C:/Users/lzj/AppData/Local/Temp/inscode/mut_r298"
NODE="C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"

rm -rf "$TMP"; mkdir -p "$TMP/tools" "$TMP/pages" "$TMP/utils" "$TMP/miniprogram" "$TMP/cloudfunctions/saveLedger"

# —— 复制「真守卫」（工作树当前版本）
cp "$REPO/tools/selftest_ui_fix.js"        "$TMP/tools/"
cp "$REPO/tools/check_archive_grace.js"    "$TMP/tools/"
# —— 复制「真业务码」的工作树（修复后）版本。pages/ 与 utils/ 整树复制：
#    selftest_ui_fix.js 的扫描面横跨多页（result/amortize/index/input/mine），少一份即 ENOENT 抛错。
cp -r "$REPO/pages/."                        "$TMP/pages/"
cp -r "$REPO/utils/."                        "$TMP/utils/"
cp -r "$REPO/miniprogram/."                  "$TMP/miniprogram/"
cp "$REPO/cloudfunctions/saveLedger/index.js" "$TMP/cloudfunctions/saveLedger/"
# check_archive_grace 需要 specs 树（声明处 + i18n 镜像 + md 扫描面）
cp -r "$REPO/specs" "$TMP/specs"

run() {  # $1=label  $2=期望(before|after)
  local lab="$1"
  local outA outB rcA rcB
  outA=$("$NODE" "$TMP/tools/selftest_ui_fix.js" 2>&1); rcA=$?
  outB=$("$NODE" "$TMP/tools/check_archive_grace.js" 2>&1); rcB=$?
  echo "[$lab] selftest_ui_fix RC=$rcA :: $(echo "$outA" | grep -E 'through|通过 / ' | tail -1)"
  echo "[$lab] archive_grace   RC=$rcB :: $(echo "$outB" | grep -E '通过 / ' | tail -1)"
  if [ "$rcA" != "0" ]; then echo "   ↳ ui_fix 红的断言："; echo "$outA" | grep "❌" | sed 's/^/     /'; fi
  if [ "$rcB" != "0" ]; then echo "   ↳ archive_grace 红的断言："; echo "$outB" | grep "❌" | sed 's/^/     /'; fi
}

echo "################ 阶段 A：业务码 = HEAD（修复前）⇒ 期望两个守卫都 RED ################"
cd "$REPO"
git show HEAD:pages/month/result.wxml          > "$TMP/pages/month/result.wxml"
git show HEAD:pages/month/result.js            > "$TMP/pages/month/result.js"
git show HEAD:cloudfunctions/saveLedger/index.js > "$TMP/cloudfunctions/saveLedger/index.js"
git show HEAD:utils/ui.js                      > "$TMP/utils/ui.js"
run "BEFORE"

echo ""
echo "################ 阶段 B：业务码 = 工作树（修复后）⇒ 期望两个守卫都 GREEN ################"
cp "$REPO/pages/month/result.wxml"          "$TMP/pages/month/"
cp "$REPO/pages/month/result.js"            "$TMP/pages/month/"
cp "$REPO/cloudfunctions/saveLedger/index.js" "$TMP/cloudfunctions/saveLedger/"
cp "$REPO/utils/ui.js"                      "$TMP/utils/"
run "AFTER"
