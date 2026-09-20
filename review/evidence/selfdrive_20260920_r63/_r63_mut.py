# -*- coding: utf-8 -*-
# round63 变异回灌：隐私政策占位符口径守卫（R99）
# 铁律⑩：变异前本轮改动必须已入 index；还原一律 git checkout -- <file>
import os, subprocess, sys

ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
POLICY = 'specs/dev-specs/上线材料_隐私政策_v1.md'
RESTART = 'specs/dev-specs/★知识存储点_2026-09-10.md'
GUARD = 'tools/check_privacy_placeholders.js'


def abspath(rel):
    return os.path.join(ROOT, rel.replace('/', os.sep))


def git(*a):
    return subprocess.run(['git'] + list(a), cwd=ROOT, capture_output=True, text=True)


def checkout(rel):
    git('checkout', '--', rel)


def load(rel):
    p = abspath(rel)
    with open(p, 'rb') as f:
        data = f.read()
    nl = '\r\n' if b'\r\n' in data else '\n'
    if data.startswith(b'\xef\xbb\xbf'):
        data = data[3:]
    return data.decode('utf-8'), nl


def save(rel, text):
    p = abspath(rel)
    with open(p, 'wb') as f:
        f.write(text.encode('utf-8'))


def find_idx(lines, needle):
    for i, l in enumerate(lines):
        if needle in l:
            return i
    return -1


def run_guard():
    r = subprocess.run(['node', 'tools/check_privacy_placeholders.js'], cwd=ROOT,
                       capture_output=True, text=True)
    return r.returncode, (r.stdout or '') + (r.stderr or '')


MUTS = []


def mut(name, rel, apply_fn, expect_red, note):
    MUTS.append((name, rel, apply_fn, expect_red, note))


# M1 漏：正文新增一个裸占位符（实扫 7 ≠ 声明 6）
def m1():
    t, nl = load(POLICY)
    lines = t.split('\n')
    i = find_idx(lines, '我们会在【15】个工作日内响应')
    if i < 0:
        return False
    lines.insert(i + 1, '【联系人姓名】')
    save(POLICY, '\n'.join(lines))
    return True


# M2 不错杀：唯一声明处换措辞（保留标记+数字+「处」）⇒ 应仍绿
def m2():
    t, nl = load(POLICY)
    lines = t.split('\n')
    i = find_idx(lines, '占位符全集口径（唯一声明处）')
    if i < 0:
        return False
    lines[i] = '🔢 占位符全集口径（唯一声明处）：全文待填项合计 **6** 处（口径＝剥反引号后的裸 `【…】`）。'
    save(POLICY, '\n'.join(lines))
    return True


# M3 fail-closed：删掉唯一声明处行
def m3():
    t, nl = load(POLICY)
    lines = t.split('\n')
    i = find_idx(lines, '占位符全集口径（唯一声明处）')
    if i < 0:
        return False
    del lines[i]
    save(POLICY, '\n'.join(lines))
    return True


# M4 第 7 例回归：重启键引用数字改回 7
def m4():
    t, nl = load(RESTART)
    lines = t.split('\n')
    i = find_idx(lines, '占位符全集口径引用')
    if i < 0:
        return False
    lines[i] = lines[i].replace('**6 处**', '**7 处**')
    save(RESTART, '\n'.join(lines))
    return True


# M5 规则生效：把 L86 的元描述 `【…】` 从反引号里拿出来 ⇒ 实扫 +1
def m5():
    t, nl = load(POLICY)
    i = t.find('文档内 `【…】` 标记')
    if i < 0:
        return False
    t = t[:i] + '文档内 【…】 标记' + t[i + len('文档内 `【…】` 标记'):]
    save(POLICY, t)
    return True


# M6 扫描面打错（guard 里路径写错）⇒ P1 fail-closed 红
def m6():
    t, nl = load(GUARD)
    i = find_idx(t.split('\n'), "const POLICY_REL = ")
    if i < 0:
        return False
    lines = t.split('\n')
    lines[i] = lines[i].replace('上线材料_隐私政策_v1.md', '上线材料_隐私政策_v9.md')
    save(GUARD, '\n'.join(lines))
    return True


mut('M1 正文加一个占位符（漏）', POLICY, m1, True, '实扫 7 ≠ 声明 6')
mut('M2 唯一声明处换措辞（错杀）', POLICY, m2, False, '保留标记+数字 ⇒ 仍绿')
mut('M3 删唯一声明处（fail-closed）', POLICY, m3, True, '标记命中 < 3 且 P6 零命中')
mut('M4 重启键引用改回 7（第 7 例回归）', RESTART, m4, True, '声明 7 ≠ 实扫 6')
mut('M5 元描述拿出反引号（规则生效）', POLICY, m5, True, '裸 【…】 被计入 ⇒ 7 ≠ 6')
mut('M6 扫描面路径写错（P1）', GUARD, m6, True, '扫描面 fail-closed')

results = []
for name, rel, fn, expect_red, note in MUTS:
    ok = fn()
    if not ok:
        results.append((name, 'MUTATION_NOT_APPLIED', '?', note))
        continue
    rc, out = run_guard()
    red = rc != 0
    verdict = 'OK' if red == expect_red else 'MISMATCH'
    first_red = ''
    for line in out.splitlines():
        if line.strip().startswith('❌'):
            first_red = line.strip()[:90]
            break
    results.append((name, verdict, 'RC=%d' % rc, note + (' | ' + first_red if first_red else '')))
    checkout(rel)

print('%-38s %-20s %-6s %s' % ('MUTATION', 'VERDICT', 'RC', 'NOTE'))
for r in results:
    print('%-38s %-20s %-6s %s' % r)
bad = [r for r in results if r[1] != 'OK']
print('\nBAD=%d / TOTAL=%d' % (len(bad), len(results)))
sys.exit(1 if bad else 0)
