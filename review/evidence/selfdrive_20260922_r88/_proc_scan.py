import subprocess, os, re
me = os.getpid()
KEY = ['catering-profit', 'verify_all', 'win_gui', 'selftest', 'check_', 'cli.bat']
try:
    out = subprocess.run(['tasklist', '/FO', 'CSV', '/NH'], capture_output=True, text=True,
                         encoding='gbk', errors='ignore').stdout
except Exception as e:
    out = str(e)
lines = [l for l in out.splitlines() if l.strip()]
hits = []
for l in lines:
    low = l.lower()
    if any(k.lower() in low for k in KEY):
        hits.append(l)
print("PID_SELF", me)
print("TOTAL_PROC", len(lines))
print("HITS", len(hits))
for h in hits:
    print("  ", h[:200])
