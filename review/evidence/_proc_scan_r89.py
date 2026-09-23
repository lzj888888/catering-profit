import subprocess, os, time, sys, re
ME = os.getpid()
KW = ['catering-profit', 'verify_all', 'selftest', 'check_', 'win_gui', 'cli.bat', 'node.exe']
out = []
try:
    r = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq node.exe', '/FO', 'CSV'],
                       capture_output=True, text=True, encoding='gbk', errors='replace', timeout=30)
    nodes = [l for l in r.stdout.splitlines() if 'node.exe' in l.lower()]
    out.append('node.exe count=%d' % len(nodes))
except Exception as e:
    out.append('node tasklist ERR %s' % e)
try:
    r2 = subprocess.run(['wmic', 'process', 'where', "name='node.exe' or name='python.exe'",
                         'get', 'ProcessId,CommandLine', '/format:csv'],
                        capture_output=True, text=True, encoding='gbk', errors='replace', timeout=60)
    hits = []
    for l in r2.stdout.splitlines():
        if not l.strip() or l.startswith('Node,') or ',' not in l:
            continue
        parts = l.split(',', 2)
        if len(parts) < 3:
            continue
        pid = parts[-2].strip() if parts[-2].strip().isdigit() else ''
        cl = parts[-1] if len(parts) > 2 else ''
        if pid and pid == str(ME):
            continue
        if 'wmic' in cl.lower():
            continue
        low = cl.lower()
        if any(k.lower() in low for k in KW):
            hits.append((pid, cl[:160]))
    out.append('MATCH=%d' % len(hits))
    for pid, cl in hits:
        out.append('  pid=%s %s' % (pid, cl))
except Exception as e:
    out.append('wmic ERR %s' % e)
print('\n'.join(out))
