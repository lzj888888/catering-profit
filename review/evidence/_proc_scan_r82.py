import subprocess, os, time
# 采样仓内进程：排除自身 PID，排除常驻噪音
NOISE = ('sheetagent', 'weixinpay', '.dsh')
KEY = ('catering-profit', 'verify_all', 'win_gui', 'cli.bat', 'selftest_')
me = os.getpid()
out = subprocess.run(['wmic', 'process', 'where', "name='node.exe' or name='python.exe' or name='cmd.exe'",
                      'get', 'ProcessId,CommandLine', '/format:csv'],
                     encoding='gbk', errors='replace', capture_output=True, text=True).stdout
hits = []
for line in out.splitlines():
    if not line.strip() or line.startswith('Node') or 'ProcessId' in line and 'CommandLine' in line:
        continue
    parts = line.strip().split(',')
    if len(parts) < 3:
        continue
    pid = parts[-1].strip()
    cl = ','.join(parts[1:-1])
    if pid == str(me):
        continue
    low = cl.lower()
    if any(n in low for n in NOISE):
        continue
    if any(k in low for k in KEY):
        hits.append((pid, cl[:220]))
print('TIME', time.strftime('%H:%M:%S'), 'PID_ME', me, 'HITS', len(hits))
for h in hits:
    print('  ', h[0], h[1])
