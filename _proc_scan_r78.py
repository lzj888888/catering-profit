import os, subprocess, time, re
ME = os.getpid()
NOISE = ('sheetagent', 'weixinpay', '.dsh')
def sample():
    out = subprocess.run(
        ['wmic', 'process', 'where', "name='node.exe' or name='python.exe'",
         'get', 'ProcessId,CommandLine', '/format:csv'],
        capture_output=True, encoding='gbk', errors='ignore').stdout
    hits = []
    for line in out.splitlines():
        low = line.lower()
        if not low.strip() or 'processid' in low.lower() and 'commandline' in low.lower():
            continue
        m = re.match(r'^\s*[^,]*,\s*(\d+)\s*,', line)
        pid = m.group(1) if m else ''
        try:
            if pid and int(pid) == ME:
                continue
        except Exception:
            pass
        if any(n in low for n in NOISE):
            continue
        if 'catering-profit' in low or 'verify_all' in low or 'win_gui' in low or 'selftest' in low:
            hits.append(line.strip()[:200])
    return hits

h1 = sample()
print('SAMPLE1', time.strftime('%H:%M:%S'), len(h1))
for h in h1:
    print('   ', h)
time.sleep(70)
h2 = sample()
print('SAMPLE2', time.strftime('%H:%M:%S'), len(h2))
for h in h2:
    print('   ', h)
print('CONCURRENT_TRUE' if (h1 and h2) else 'CONCURRENT_FALSE')
