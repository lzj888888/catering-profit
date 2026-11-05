# review/evidence/r393_mut.py
# R393 变异：证明 S6（转圈标题必须进行时形态）不是恒真。
# 三种错法各跑一次，每次跑完立即还原。
# ⚠️ 不用 .bak 文件：本机 os.remove 走回收站垫片会抛 OSError ⇒ 原文存内存，还原时直接写回。
import io, os, subprocess, signal, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TERMS = os.path.join(ROOT, 'miniprogram', 'i18n', 'terms.js')
TK = os.path.join(ROOT, 'pages', 'takeaway', 'index.js')

CUR = {'f': None, 'src': None}


def restore():
    if CUR['f'] and CUR['src'] is not None:
        io.open(CUR['f'], 'w', encoding='utf-8', newline='').write(CUR['src'])
    CUR['f'] = None
    CUR['src'] = None


def on_sig(signum, frame):
    restore()
    print('SIGTERM/SIGINT ⇒ 已还原当前文件后退出')
    sys.exit(2)


signal.signal(signal.SIGTERM, on_sig)
signal.signal(signal.SIGINT, on_sig)


def run_tool():
    p = subprocess.run(['node', 'tools/check_page_terms.js'], cwd=ROOT,
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    out = (p.stdout or '') + (p.stderr or '')
    hit = [l.strip() for l in out.splitlines() if 'S6' in l and '❌' in l]
    return p.returncode, hit


def mutate(path, old, new, label):
    src = io.open(path, encoding='utf-8', newline='').read()
    assert old in src, label + ' 锚点缺失'
    CUR['f'], CUR['src'] = path, src
    io.open(path, 'w', encoding='utf-8', newline='').write(src.replace(old, new, 1))
    rc, hit = run_tool()
    restore()
    ok = (rc != 0 and bool(hit))
    print(('[抓到了] ' if ok else '[漏过了] ') + label + ' → rc=' + str(rc))
    for h in hit[:2]:
        print('           ' + h[:110])
    return ok


cases = []
cases.append(mutate(TERMS, "syncIng: '正在同步…',", "syncIng: '正在同步',",
                    'M1 去掉省略号（"正在同步"不是进行时形态）'))
cases.append(mutate(TK, "wx.showLoading({ title: TK.importIng, mask: true });",
                    "wx.showLoading({ title: TK.importConfirm, mask: true });",
                    'M2 借按钮文案（"确认导入"当转圈标题）'))
cases.append(mutate(TERMS, "    syncIng: '正在同步…',\n", "",
                    'M3 删掉 syncIng 键（引用即缺 ⇒ 取不到文本）'))

rc0, hit0 = run_tool()
print('\n还原后复跑：rc=' + str(rc0) + ' （应为 0）')
print('===== 变异结果：' + str(sum(1 for c in cases if c)) + '/' + str(len(cases)) + ' 抓到 =====')
sys.exit(0 if all(cases) and rc0 == 0 else 1)
