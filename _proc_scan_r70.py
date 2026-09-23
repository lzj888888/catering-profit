import subprocess, os, time, sys
ME = os.getpid()
def sample():
    out = []
    try:
        r = subprocess.run(['wmic','process','where',"name='node.exe' or name='python.exe'",
                            'get','ProcessId,CommandLine','/format:csv'],
                           encoding='gbk', errors='replace', capture_output=True, timeout=60)
        for line in r.stdout.splitlines():
            line = line.strip()
            if not line or line.startswith('Node,') or 'ProcessId' in line:
                continue
            parts = line.split(',', 1)
            if len(parts) < 2:
                continue
            try:
                pid = int(parts[0])
            except Exception:
                continue
            if pid == ME:
                continue
            cmd = parts[1]
            low = cmd.lower()
            if 'catering-profit' in low or 'verify_all' in low or 'win_gui' in low \
               or 'check_error_codes' in low or 'selftest_' in low:
                out.append((pid, cmd[:200]))
    except Exception as e:
        out.append((-1, 'ERR ' + str(e)))
    return out

a = sample()
print('SAMPLE1', len(a))
for pid, c in a:
    print(' ', pid, c)
time.sleep(75)
b = sample()
print('SAMPLE2', len(b))
for pid, c in b:
    print(' ', pid, c)
