import subprocess, os, time, sys

SELF = os.getpid()
KEYS = ['catering-profit', 'verify_all', 'win_gui', 'selftest_', 'cli.bat',
        'check_theme', 'takeaway', 'node.exe']

def sample():
    out = subprocess.run(
        ['wmic', 'process', 'where', "name='node.exe' or name='python.exe'",
         'get', 'ProcessId,CommandLine', '/format:csv'],
        capture_output=True, encoding='gbk', errors='replace')
    hits = []
    for line in out.stdout.splitlines():
        line = line.strip()
        if not line or line.startswith('Node') or line.startswith('CommandLine'):
            continue
        parts = line.split(',')
        if len(parts) < 3:
            continue
        pid = parts[1].strip() if len(parts) > 1 else ''
        cmd = ','.join(parts[2:])
        if not pid.isdigit():
            continue
        if int(pid) == SELF:
            continue
        low = cmd.lower()
        if 'wmic' in low:
            continue
        for k in KEYS:
            if k.lower() in low:
                hits.append((pid, cmd[:160]))
                break
    return hits

if __name__ == '__main__':
    a = sample()
    print('SAMPLE1 ts=%s hits=%d' % (time.strftime('%H:%M:%S'), len(a)))
    for h in a:
        print('  ', h)
    sys.stdout.flush()
    time.sleep(75)
    b = sample()
    print('SAMPLE2 ts=%s hits=%d' % (time.strftime('%H:%M:%S'), len(b)))
    for h in b:
        print('  ', h)
