import subprocess, os, time
ME = os.getpid()
KEY = ['catering-profit', 'verify_all', 'win_gui', 'selftest_', 'cli.bat', 'check_']
def sample():
    out = []
    r = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq node.exe', '/FO', 'CSV', '/NH'],
                       capture_output=True, text=True, encoding='gbk', errors='ignore')
    r2 = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq python.exe', '/FO', 'CSV', '/NH'],
                        capture_output=True, text=True, encoding='gbk', errors='ignore')
    out.append(('node', r.stdout.strip()))
    out.append(('python', r2.stdout.strip()))
    pr = subprocess.run(['wmic', 'process', 'where',
                         "name='node.exe' or name='python.exe'",
                         'get', 'ProcessId,CommandLine', '/format:csv'],
                        capture_output=True, text=True, encoding='gbk', errors='ignore')
    hit = []
    for line in pr.stdout.splitlines():
        low = line.lower()
        if 'processid' in low and 'commandline' in low:
            continue
        parts = line.split(',')
        if len(parts) < 3:
            continue
        try:
            pid = int(parts[-2].strip())
        except Exception:
            continue
        if pid == ME:
            continue
        if any(k.lower() in low for k in KEY):
            hit.append(line.strip()[:220])
    return out, hit

for i in range(2):
    o, h = sample()
    print('--- sample', i+1, time.strftime('%H:%M:%S'))
    print('node count:', len([x for x in o[0][1].splitlines() if x.strip()]))
    print('python count:', len([x for x in o[1][1].splitlines() if x.strip()]))
    print('HIT(仓内相关, 排除自身PID=%d): %d' % (ME, len(h)))
    for x in h:
        print('   ', x)
    if i == 0:
        time.sleep(75)
