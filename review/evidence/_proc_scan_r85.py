import subprocess, os, sys, time

ME = os.getpid()
KEY = ['catering-profit', 'verify_all', 'win_gui', 'selftest_', 'check_waimai', 'cli.bat']
NOISE = ['sheetagent', 'weixinpay', '.dsh\\runtime']

def sample():
    out = []
    try:
        r = subprocess.run(['tasklist', '/FO', 'CSV', '/NH'], capture_output=True, text=True,
                           encoding='gbk', errors='ignore', timeout=30)
        lines = r.stdout.splitlines()
    except Exception as e:
        return ['TASKLIST_ERR ' + str(e)]
    for ln in lines:
        if 'node.exe' not in ln and 'python.exe' not in ln:
            continue
        out.append(ln[:220])
    return out

def cmdlines():
    res = []
    try:
        r = subprocess.run(['wmic', 'process', 'where', "name='node.exe' or name='python.exe'",
                            'get', 'ProcessId,CommandLine', '/format:csv'],
                           capture_output=True, text=True, encoding='gbk', errors='ignore', timeout=60)
        for ln in r.stdout.splitlines():
            if not ln.strip() or ln.startswith('Node'):
                continue
            low = ln.lower()
            if any(n in low for n in NOISE):
                continue
            parts = ln.split(',')
            pid = parts[-1].strip() if len(parts) > 1 else ''
            if pid.isdigit() and int(pid) == ME:
                continue
            if any(k.lower() in low for k in KEY):
                res.append(ln[:260])
    except Exception as e:
        res.append('WMIC_ERR ' + str(e))
    return res

tag = sys.argv[1] if len(sys.argv) > 1 else 's1'
print('=== pid(me)=%d tag=%s time=%s ===' % (ME, tag, time.strftime('%H:%M:%S')))
p = sample()
print('-- node/python process count: %d' % len(p))
for x in p:
    print('  P| ' + x)
c = cmdlines()
print('-- repo-keyword hits (noise+self excluded): %d' % len(c))
for x in c:
    print('  C| ' + x)
