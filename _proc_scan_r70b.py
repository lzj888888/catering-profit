import subprocess, os, time
me = os.getpid()
hits = []
out = subprocess.run(['wmic','process','where',"name='node.exe' or name='python.exe'",
                      'get','ProcessId,CommandLine','/format:csv'],
                     capture_output=True, encoding='gbk', errors='ignore').stdout
noise = ('sheetagent','weixinpay','dsh')
for line in out.splitlines():
    low = line.lower()
    if 'processid' in low and 'commandline' in low:
        continue
    parts = [p for p in line.split(',') if p.strip()]
    if len(parts) < 3:
        continue
    try:
        pid = int(parts[-2])
    except Exception:
        continue
    if pid == me:
        continue
    cmd = ','.join(parts[2:])
    if any(n in cmd.lower() for n in noise):
        continue
    if 'catering-profit' in cmd.lower() or 'win_gui' in cmd.lower() or 'verify_all' in cmd.lower():
        hits.append((pid, cmd[:160]))
print('SAMPLE_TS', time.strftime('%Y-%m-%d %H:%M:%S'), 'ME', me, 'HITS', len(hits))
for h in hits:
    print(h)
