# review/evidence/r394_mut.py
# R394 变异：证明 S7（绿勾提示必须完成态）不是恒真。
# ⚠️ 不用 .bak 文件：本机 os.remove 走回收站垫片会抛 OSError ⇒ 原文存内存，还原时直接写回。
import io, os, subprocess, signal, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TERMS = os.path.join(ROOT, 'miniprogram', 'i18n', 'terms.js')
CARD = os.path.join(ROOT, 'pages', 'card', 'index.js')

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
    hit = [l.strip() for l in out.splitlines() if 'S7' in l and '❌' in l]
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
        print('           ' + h[:120])
    return ok


cases = []
cases.append(mutate(CARD,
    "wx.showToast({ title: TERMS.ui.deletedDone, icon: 'success' });",
    "wx.showToast({ title: TERMS.card.deleteCard, icon: 'success' });",
    'M1 复用菜单项文案（"删除"当成功提示）'))
cases.append(mutate(TERMS,
    "    savedDone: '已保存',",
    "    savedDone: '保存',",
    'M2 完成态退化成动词（"已保存"→"保存"）'))
cases.append(mutate(TERMS,
    "    deletedDone: '已删除',\n", "",
    'M3 删掉术语键（静态引用取不到文本）'))

rc0, hit0 = run_tool()
print('\n还原后复跑：rc=' + str(rc0) + ' （应为 0）')
print('===== 变异结果：' + str(sum(1 for c in cases if c)) + '/' + str(len(cases)) + ' 抓到 =====')
sys.exit(0 if all(cases) and rc0 == 0 else 1)
