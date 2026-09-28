"""R168 读取 v5（正式）：等「（全文 N 字）」→ 展开「展开全部」→ TextPattern 取全文 → 提取落盘。
用法: read_uia5.py <tag> <anchor> [max_min]
"""
import sys, time, re
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
import uiautomation as auto
from win_gui import find_window

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/_m3/dbai'
tag, anchor = sys.argv[1], sys.argv[2]
max_min = float(sys.argv[3]) if len(sys.argv) > 3 else 6.0
auto.SetGlobalSearchTimeout(2)
h = find_window(title='豆包')


def snap():
    top = auto.ControlFromHandle(h)
    for c, d in auto.WalkControl(top, includeTop=False, maxDepth=10):
        if c.ControlTypeName == 'DocumentControl':
            return top, c
    return top, None


def read(doc):
    if not doc:
        return ''
    try:
        return doc.GetTextPattern().DocumentRange.GetText(-1) or ''
    except Exception:
        return ''


# 1) 等完成标记
t0, full = time.time(), ''
while time.time() - t0 < max_min * 60:
    _, doc = snap()
    full = read(doc)
    if re.search(r'（全文\s*\d+\s*字）', full):
        print('[1] 完成标记出现 len=%d' % len(full)); break
    print('  waiting len=%d' % len(full), flush=True)
    time.sleep(15)

# 2) 展开「展开全部」
top, doc = snap()
done = False
for c, d in auto.WalkControl(top, includeTop=False, maxDepth=45):
    if (c.Name or '') in ('展开全部', '展开', '展开阅读全文'):
        for how in ('legacy', 'parent-invoke'):
            try:
                if how == 'legacy':
                    c.GetLegacyIAccessiblePattern().DoDefaultAction()
                else:
                    c.GetParentControl().GetInvokePattern().Invoke()
                print('[2] 展开成功 via %s' % how); done = True; break
            except Exception as e:
                print('[2] %s 失败: %s' % (how, e))
        if done:
            break
if done:
    time.sleep(2.5)
    _, doc = snap()
    f2 = read(doc)
    print('[3] 展开后 len=%d (前 %d)' % (len(f2), len(full)))
    if len(f2) > len(full):
        full = f2

# 3) 提取
i = full.rfind(anchor)
body = full[i + len(anchor):] if i >= 0 else full
for cut in ['\n对话\n', '\n更多\n豆包', '\n发消息或按住空格', '\nConversation index']:
    j = body.find(cut)
    if j > 0:
        body = body[:j]; break
body = body.strip()
with open(OUT + '/_r168_%s_answer.txt' % tag, 'w', encoding='utf-8') as f:
    f.write(body + '\n')
with open(OUT + '/_r168_%s_fullpage.txt' % tag, 'w', encoding='utf-8') as f:
    f.write(full)
print('==== %s_answer.txt: %d 字（全页 %d，锚点%s）===='
      % (tag, len(body), len(full), '命中' if i >= 0 else '未命中'))
print(body[:1500])
