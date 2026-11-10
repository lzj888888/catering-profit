# -*- coding: utf-8 -*-
# R685：云开发控制台批量抬 timeout（3 → 20），每步机器校验，不靠目视。
# 坐标全部来自配方 19（R215d 实测 / R230b 11 步复验），控制台窗口 rect=(60,0,1800x1034)。
# 「图内坐标 + 60 = 屏幕 x」；窗口 top=0 故 y 不加。
import subprocess, sys, time, os, re, json

CLI = r'C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat'
REPO = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
ENV = 'cloud1-d4gphpoxy337f2a25'
W = r'C:\Users\lzj\.workbuddy\skills\win-desktop-control\scripts\win_gui.py'
OCR = r'C:\Users\lzj\.workbuddy\skills\win-desktop-control\scripts\ocr_screen.py'
AD = r'C:\Users\lzj\AppData\Roaming\npm\agent-desktop.cmd'
SHOT_DIR = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit\review\evidence\r685_timeout\shots'
os.makedirs(SHOT_DIR, exist_ok=True)

# 屏幕物理像素（配方 19 + 本轮 OCR 复核）
P_SEARCH = (1674, 240)
P_BACK = (382, 152)
P_VERCFG = (1596, 390)   # 唯一行「版本与配置」
P_CONFIG = (1572, 390)   # $LATEST 行「配置」（1612 会误点「下载」，R215d 配方值不适用于当前布局）
P_ADV = (607, 556)      # 展开高级配置
P_TIMEOUT = (792, 716)  # 执行超时数字框
P_OK = (1321, 906)      # 绿底「确定」

def run(args, timeout=120):
    return subprocess.run(args, capture_output=True, timeout=timeout)

def gui(*args):
    r = run([sys.executable, W] + list(args))
    return (r.stdout or b'').decode('utf-8', 'replace').strip()

def click(p, settle=0.9):
    gui('click', '--x', str(p[0]), '--y', str(p[1]))
    time.sleep(settle)

def key(name, ctrl=False):
    a = ['key', '--name', name]
    if ctrl: a.append('--ctrl')
    gui(*a)
    time.sleep(0.35)

def typ(text):
    gui('type', '--text', text)
    time.sleep(0.5)

def shot(name):
    p = os.path.join(SHOT_DIR, name + '.png')
    run(['cmd', '/c', AD, 'screenshot', p, '--window-id', 'w-10422404'])
    return p

def ocr_hit(png, kw, crop=None):
    a = [sys.executable, OCR, 'find', png, kw, '--scale', '2']
    if crop: a += ['--crop'] + [str(x) for x in crop]
    r = run(a)
    t = (r.stdout or b'').decode('utf-8', 'replace')
    return ('HIT' in t and kw in t), t.strip()

def read_timeout(fn):
    r = run([CLI, 'cloud', 'functions', 'info', '--names', fn, '-e', ENV, '--project', REPO], timeout=90)
    t = ((r.stdout or b'') + (r.stderr or b'')).decode('utf-8', 'replace')
    m = re.search(r'\u2502\s*' + re.escape(fn) + r'\s*\u2502\s*\'?(\w+)\'?\s*\u2502\s*(\d+)', t)
    if not m:
        m = re.search(r'\|\s*' + re.escape(fn) + r'\s*\|\s*\'?(\w+)\'?\s*\|\s*(\d+)', t)
    return (m.group(1), int(m.group(2))) if m else ('?', None)

def fix(fn, idx, do_back=True):
    print('\n===== [%d] %s =====' % (idx, fn), flush=True)
    # 1) 回列表 + 搜索筛出唯一行（第一个函数此刻已在筛选结果页，无需返回）
    if do_back:
        click(P_BACK, 1.2)
    click(P_SEARCH, 0.5)
    key('a', ctrl=True)
    typ(fn)
    time.sleep(1.6)
    png = shot('%d_%s_search' % (idx, fn))
    ok, _ = ocr_hit(png, '共1条')
    if not ok:
        print('  STOP: 搜索未得到「共1条」'); return False
    print('  ✓ 共1条', flush=True)

    # 2) 版本与配置（先在版本页用顶部标题防串函数，长英文函数名在这层 OCR 能读到）
    click(P_VERCFG, 2.5)
    png_ver = shot('%d_%s_ver' % (idx, fn))
    ok, info = ocr_hit(png_ver, fn, crop=(300, 110, 700, 200))
    if not ok:
        print('  STOP: 版本页顶部标题不是 %s | %s' % (fn, info)); return False
    print('  ✓ 版本页函数名 = ' + fn, flush=True)

    # 3) 点「配置」开对话框。对话框标志词 = 高级配置 + 云函数名称（OCR 稳定）；
    #    长英文函数名在对话框内 OCR 读不出，故不拿它当判据。
    def open_dialog(tag):
        click(P_CONFIG, 2.2)
        p = shot('%d_%s_dialog%s' % (idx, fn, tag))
        a, _ = ocr_hit(p, '高级配置')
        b, _ = ocr_hit(p, '云函数名称')
        return (a and b), p
    ok, png = open_dialog('')
    if not ok:
        key('esc')                      # 关掉可能误开的「下载」菜单
        ok, png = open_dialog('_retry')
    if not ok:
        print('  STOP: 配置对话框未打开（高级配置/云函数名称 未命中）'); return False
    print('  ✓ 配置对话框已打开', flush=True)

    # 3) 展开高级配置、改超时
    click(P_ADV, 1.0)
    click(P_TIMEOUT, 0.5)
    key('a', ctrl=True)
    typ('20')
    # 哨兵法：先把剪贴板污染，再从输入框复制回来
    gui('clip', '--set', 'SENTINEL_R685')
    key('a', ctrl=True)
    key('c', ctrl=True)
    got = gui('clip', '--get').strip()
    if got != '20':
        print('  STOP: 输入框回读 = %r（应为 20）' % got); return False
    print('  ✓ 输入框哨兵回读 = 20', flush=True)

    # 4) 保存
    click(P_OK, 2.2)
    shot('%d_%s_saved' % (idx, fn))

    # 5) 权威判据：cli 回读
    st, to = read_timeout(fn)
    print('  cli info => status=%s timeout=%s' % (st, to), flush=True)
    # status 可能是 Updating（保存后云端短暂的配置生效中间态）⇒ 不在此判红，
    # 最后统一全量回读 Active 即可。timeout 才是本次要改的目标值。
    if to != 20:
        print('  STOP: 回读 timeout 不符合预期'); return False
    return True

if __name__ == '__main__':
    fns = sys.argv[1:]
    results = {}
    for i, fn in enumerate(fns, 1):
        results[fn] = fix(fn, i, do_back=True)
        with open(os.path.join(SHOT_DIR, 'results.json'), 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False, indent=1)
        if not results[fn]:
            print('\n!!! 有函数失败，立即停止，不继续后面的'); sys.exit(1)
    print('\n===== 全部成功 =====')
    print(json.dumps(results, ensure_ascii=False))
