#!/bin/bash
# 部署 40 个业务云函数到 dev（已获用户授权）
# 分批 5 个，失败重试最多 3 轮
CLI="/c/Program Files (x86)/Tencent/微信web开发者工具/cli.bat"
PROJ="C:/Users/lzj/WorkBuddy/Claw/catering-profit"
ENV=cloud1-d4gphpoxy337f2a25
ROOT=/c/Users/lzj/WorkBuddy/Claw/catering-profit/cloudfunctions

ALL=$(cd "$ROOT" && for d in */; do n="${d%/}"; [ -f "$n/index.js" ] && echo "$n"; done | grep -v '^common$' | grep -v '^initDb$' | grep -v '^smokeTest$' | tr '\n' ' ')
echo "待部署: $ALL"
echo "总数: $(echo $ALL | wc -w)"

ROUND=1
PENDING="$ALL"
while [ $ROUND -le 4 ]; do
  echo ""
  echo "########## 第 $ROUND 轮 ##########"
  FAILED=""
  CNT=0; BATCH=""
  for f in $PENDING; do
    BATCH="$BATCH $f"; CNT=$((CNT+1))
    if [ $CNT -eq 5 ]; then
      echo "--- 批次: $BATCH"
      OUT=$("$CLI" cloud functions deploy -e $ENV --project "$PROJ" --names $BATCH -r 2>&1)
      echo "$OUT" | grep -E "success|√|×|error" | tail -12
      for g in $BATCH; do
        if echo "$OUT" | grep -q "│ $g .*│ true"; then echo "  ✅ $g"; else echo "  ❌ $g"; FAILED="$FAILED $g"; fi
      done
      BATCH=""; CNT=0
      sleep 5
    fi
  done
  if [ -n "$BATCH" ]; then
    echo "--- 批次: $BATCH"
    OUT=$("$CLI" cloud functions deploy -e $ENV --project "$PROJ" --names $BATCH -r 2>&1)
    echo "$OUT" | grep -E "success|√|×|error" | tail -12
    for g in $BATCH; do
      if echo "$OUT" | grep -q "│ $g .*│ true"; then echo "  ✅ $g"; else echo "  ❌ $g"; FAILED="$FAILED $g"; fi
    done
  fi
  PENDING=$(echo $FAILED | tr ' ' '\n' | sort -u | tr '\n' ' ')
  if [ -z "$(echo $PENDING | tr -d ' ')" ]; then echo "全部部署成功"; break; fi
  echo ">>> 第 $ROUND 轮后仍失败: $PENDING （等待 60s 重试）"
  sleep 60
  ROUND=$((ROUND+1))
done
echo ""
echo "########## 最终云端清单 ##########"
"$CLI" cloud functions list -e $ENV --project "$PROJ" 2>&1 | tail -60
