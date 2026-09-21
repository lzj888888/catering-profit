import subprocess, os, time
me = os.getpid()
def sample():
    out = subprocess.run(['wmic','process','where',"name='node.exe' or name='python.exe'",'get','ProcessId,CommandLine','/format:csv'],
                         capture_output=True, encoding='gbk', errors='ignore').stdout
    hits=[]
    for line in out.splitlines():
        low = line.lower()
        if 'catering-profit' in low or 'verify_all' in low or 'win_gui' in low:
            if str(me) in line.split(',')[1] if ',' in line else False:
                continue
            hits.append(line[:200])
    return hits
s1 = sample()
print('SAMPLE1', len(s1))
for h in s1: print('  ', h)
time.sleep(75)
s2 = sample()
print('SAMPLE2', len(s2))
for h in s2: print('  ', h)
