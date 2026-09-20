import subprocess, os, time
me = os.getpid()
out = subprocess.run(['wmic','process','where',"name='node.exe' or name='python.exe'",
                      'get','ProcessId,CommandLine','/format:csv'],
                     capture_output=True)
txt = out.stdout.decode('gbk', errors='ignore')
hits = []
for line in txt.splitlines():
    low = line.lower()
    if 'catering-profit' in low or 'win_gui' in low or 'verify_all' in low:
        # exclude self pid
        parts = line.split(',')
        pid = parts[-1].strip() if parts else ''
        if pid == str(me):
            continue
        hits.append(line.strip()[:200])
print('PID_ME', me, 'HITS', len(hits))
for h in hits:
    print('  ', h)
