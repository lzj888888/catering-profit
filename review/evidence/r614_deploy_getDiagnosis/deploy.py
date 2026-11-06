# R611：部署 getLedger 到 dev（三项刚性 three_cost 字段 11-05 才入云函数，从未部署）
# 定式：cli.bat / 必带 -r / 一次一个 / 不传 --port / rc 不作判据（流式落盘 + 结果回读）
import subprocess, sys, time, os
CLI = r'C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat'
REPO = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit'
ENV = 'cloud1-d4gphpoxy337f2a25'   # 现读 cloudfunctions/initDb/config.json
NAME = 'getDiagnosis'
LOG = os.path.join(os.path.dirname(__file__), 'deploy_getDiagnosis_r614.log')
cmd = [CLI, 'cloud', 'functions', 'deploy', '--project', REPO, '-e', ENV, '--names', NAME, '-r']
print('CMD =', ' '.join(cmd), flush=True)
t0 = time.time()
with open(LOG, 'ab', buffering=0) as out:
    out.write(('\n===== R611 deploy %s  %s =====\n' % (NAME, time.strftime('%Y-%m-%d %H:%M:%S'))).encode('utf-8'))
    try:
        r = subprocess.run(cmd, stdout=out, stderr=subprocess.STDOUT, timeout=300)
        print('CLI_RC =', r.returncode, '用时 %.1fs' % (time.time() - t0), flush=True)
    except subprocess.TimeoutExpired:
        print('CLI_TIMEOUT 300s', flush=True)
print('LOG =', LOG, flush=True)
