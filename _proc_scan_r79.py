# round79 进程采样：写成 .py 文件跑（命令行只剩路径），并排除自身 PID
import subprocess, os, time, sys
ME = os.getpid()
KEYS = ['catering-profit', 'verify_all', 'win_gui', 'selftest_', 'cli.bat']
NOISE = ['sheetagent', 'weixinpay', 'dsh']
out = []
try:
    r = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq node.exe', '/V', '/FO', 'CSV'],
                       capture_output=True, encoding='gbk', errors='ignore')
    lines = r.stdout.splitlines()
except Exception as e:
    lines = []
    out.append('ERR:' + str(e))
print('PID_ME', ME, 'time', time.strftime('%H:%M:%S'))
hits = 0
for ln in lines:
    low = ln.lower()
    if any(k.lower() in low for k in KEYS):
        out.append('HIT_NODE: ' + ln[:220])
        hits += 1
try:
    r2 = subprocess.run(['wmic', 'process', 'where', "name='python.exe'", 'get',
                         'ProcessId,CommandLine', '/format:csv'],
                        capture_output=True, encoding='gbk', errors='ignore')
    for ln in r2.stdout.splitlines():
        if not ln.strip() or ln.startswith('Node'):
            continue
        parts = ln.split(',')
        if len(parts) < 3:
            continue
        try:
            pid = int(parts[-1].strip())
        except Exception:
            continue
        if pid == ME:
            continue
        cmd = ','.join(parts[1:-1]).lower()
        if 'proc_scan' in cmd:
            continue
        if any(k.lower() in cmd for k in KEYS):
            out.append('HIT_PY: ' + ln[:220])
            hits += 1
        elif 'python' in cmd and len(cmd) > 40:
            out.append('PY_OTHER: ' + ln[:180])
except Exception as e:
    out.append('ERR2:' + str(e))
print('CONCURRENT_HITS', hits)
for o in out[:25]:
    print(o)
