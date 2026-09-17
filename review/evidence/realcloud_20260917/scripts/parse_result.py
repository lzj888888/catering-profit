# -*- coding: utf-8 -*-
"""把 smokeTest 的剪贴板原文解析成结构化证据（原文优先，不做任何改写）。"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdb  # noqa

RAW = os.path.join(cdb.EV, '_clip_raw.txt')
raw = open(RAW, encoding='utf-8').read()

# 返回结果 = 原文里第一个完整 JSON 对象（clip 里前后还含入参 {} 与日志文本）
start = raw.index('{"env"')
depth = 0
end = None
for i in range(start, len(raw)):
    ch = raw[i]
    if ch == '{':
        depth += 1
    elif ch == '}':
        depth -= 1
        if depth == 0:
            end = i + 1
            break
assert end, '未能切出 JSON 对象'
body = raw[start:end]
data = json.loads(body)  # 解析失败即抛（fail-closed，别写半截证据）

# 日志段里的 Duration（摘要在 clip 末尾）
m = re.search(r'Duration:\s*(\d+)ms', raw)
dur = int(m.group(1)) if m else None
m2 = re.search(r'Coldstart:\s*(\d+)ms', raw)
cold = int(m2.group(1)) if m2 else None

out = {
    'captured_at': '2026-09-18 01:2x +0800',
    'source': '云开发控制台 v2.0.3 → 云函数 → smokeTest → 云端测试 → 入参 {} → 运行测试',
    'env_display': 'cloud1（免费开发环境）',
    'raw_clipboard_len': len(raw),
    'result_json': data,
    'invocation': {'duration_ms': dur, 'coldstart_ms': cold},
    'clipboard_raw_tail': raw[start + len(body):].strip()[:600],
}
with open(os.path.join(cdb.EV, '01_smokeTest.json'), 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

print('RESULT_JSON_WRITTEN')
print(json.dumps(data, ensure_ascii=False, indent=2)[:2000])
print('duration', dur, 'coldstart', cold)
