# -*- coding: utf-8 -*-
"""临时验证：_deploy_fns.judge 在 UTF-8 输出下不再抛 UnicodeDecodeError、msg 不为空。"""
import importlib.util, os, sys, glob

REPO = r"C:\Users\lzj\WorkBuddy\Claw\catering-profit"
spec = importlib.util.spec_from_file_location("df", os.path.join(REPO, "review", "evidence", "_deploy_fns.py"))
df = importlib.util.module_from_spec(spec)
spec.loader.exec_module(df)

logs = sorted(glob.glob(os.path.join(REPO, "_m3", "deploy_logs", "deploy_getLedger_*.log")),
              key=os.path.getmtime, reverse=True)
log = logs[0]
ok, msg = df.judge(log, "getLedger")
print("LOG   =", log)
print("OK    =", ok)
print("MSG   =", repr(msg))
print("MSG_LEN =", len(msg))
assert ok is True, "判据应命中"
assert len(msg) > 0, "msg 不能为空（为空=读取线程被解码错误打死）"
print("PASS: 无 UnicodeDecodeError，判据输出完整")
