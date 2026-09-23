import subprocess, os, time

ME = os.getpid()
NOISE = ('sheetagent', 'weixinpay', 'node_modules')
HIT = ('catering-profit', 'verify_all', 'win_gui', 'cli.bat')

out = []
try:
    r = subprocess.run(
        ['wmic', 'process', 'where', "name='node.exe' or name='python.exe'",
         'get', 'ProcessId,CommandLine', '/format:csv'],
        capture_output=True, encoding='gbk', errors='replace', timeout=60)
    for line in (r.stdout or '').splitlines():
        line = line.strip()
        if not line or line.startswith('Node,') or ',' not in line:
            continue
        parts = line.split(',')
        if len(parts) < 3:
            continue
        pid_s, _, cmd = parts[0], parts[1], ','.join(parts[2:])
        try:
            pid = int(pid_s)
        except Exception:
            continue
        if pid == ME:
            continue
        low = cmd.lower()
        if any(n in low for n in NOISE):
            continue
        if any(h in low for h in HIT):
            out.append((pid, cmd[:200]))
except Exception as e:
    out.append(('ERR', str(e)))

print('PID_SELF', ME)
print('HITS', len(out))
for pid, cmd in out:
    print('  ', pid, cmd)
