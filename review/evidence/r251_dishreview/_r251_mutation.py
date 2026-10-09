# -*- coding: utf-8 -*-
"""R251 变异回灌：证明 ⑥ 组守卫**真能抓到**「平台块只留光标题」这一族缺陷。

铁律（本仓）：
  · 每条变异**独立、可还原**；还原后 md5 必须全等；
  · 变异必须红在**目标断言名**上（崩溃红 ≠ 有效红）；
  · 行尾自适应（仓内文件是 CRLF，锚点写 LF 会「命中 0 次」而**不改动任何文件** ⇒ 误报"变异无效"）。
跑法：python review/evidence/r251_dishreview/_r251_mutation.py
"""
import hashlib
import io
import os
import subprocess
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
PY = r'C:/Users/lzj/.workbuddy/binaries/python/versions/3.13.12/python.exe'
NODE = r'C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-6/node.exe'
GUARD = 'tools/check_dishreview_engine.js'

PAGE = 'pages/m3/dishreview/index.js'
WXML = 'pages/m3/dishreview/index.wxml'

# (编号, 文件, old, new, 期望红的断言名)
MUTS = [
    ('M1 页面不再给「空榜成因」',
     PAGE,
     "          emptyReason: ranked.length ? ''\n"
     "            : (unmatchedCount > 0 ? TERMS.card.reviewPlatformAllUnmatched : TERMS.card.reviewPlatformBillOnly),\n",
     "          emptyReason: '',\n",
     '6-②'),

    ('M2 页面丢掉 unmatchedCount（回退成"前端自己猜"）',
     PAGE,
     "      unmatchedCount: t.unmatchedCount || 0,\n",
     "      unmatchedCount: 0,\n",
     '6-⑤'),

    ('M3 wxml 删掉「成因说明」渲染行（回到光标题）',
     WXML,
     '          <view class="muted" wx:if="{{item.emptyReason}}">{{item.emptyReason}}</view>\n',
     "",
     '6-⑨'),

    ('M4 未匹配行不再标来源平台',
     PAGE,
     "      platformText: Array.from(x.platforms).join(' / '),\n",
     "      platformText: '',\n",
     '6-⑥'),

    ('M5 未匹配行丢失「口味询问类」标记',
     PAGE,
     "      zeroAmount: x.amountFen === 0 && x.qty > 0,\n",
     "      zeroAmount: false,\n",
     '6-⑦'),
]


def read_bytes(rel):
    with open(os.path.join(REPO, rel), 'rb') as f:
        return f.read()


def md5(b):
    return hashlib.md5(b).hexdigest()


def apply_mut(rel, old, new):
    """自适应行尾；返回 (是否命中, 原字节)"""
    raw = read_bytes(rel)
    for old_b in (old.encode('utf-8'),
                  old.replace('\n', '\r\n').encode('utf-8')):
        if old_b in raw:
            new_b = new.encode('utf-8')
            if b'\r\n' in old_b and b'\r\n' not in new_b and new_b.endswith(b'\n'):
                new_b = new_b[:-1].replace(b'\n', b'\r\n') + b'\r\n'
            with open(os.path.join(REPO, rel), 'wb') as f:
                f.write(raw.replace(old_b, new_b, 1))
            return True, raw
    return False, raw


def run_guard():
    p = subprocess.run([NODE, GUARD], cwd=REPO, capture_output=True)
    out = (p.stdout or b'').decode('utf-8', 'replace') + (p.stderr or b'').decode('utf-8', 'replace')
    return p.returncode, out


def restore(rel, raw):
    with open(os.path.join(REPO, rel), 'wb') as f:
        f.write(raw)


def main():
    files = sorted({m[1] for m in MUTS})
    before = {r: md5(read_bytes(r)) for r in files}

    rc0, out0 = run_guard()
    base_green = (rc0 == 0) and ('0 失败' in out0)
    print('基线：RC=%d 绿=%s' % (rc0, base_green))
    if not base_green:
        print(out0[-2000:])
        return 1

    all_ok = True
    for name, rel, old, new, expect in MUTS:
        hit, raw = apply_mut(rel, old, new)
        if not hit:
            print('❌ %s —— 锚点未命中（未改动任何文件）' % name)
            all_ok = False
            continue
        rc, out = run_guard()
        # 红在**目标断言名**上
        red_on_target = ('❌ %s' % expect) in out
        # ⚠️ 还原**之后**才能判 md5（第一版在 restore 之前判 ⇒ 恒 False，属我脚本的判据错）
        restore(rel, raw)
        back = md5(read_bytes(rel)) == before[rel]
        rc2, out2 = run_guard()
        green_again = (rc2 == 0) and ('0 失败' in out2)
        ok = (rc != 0) and red_on_target and back and green_again
        all_ok = all_ok and ok
        print('%s %s —— RC=%d · 红在 %s=%s · 还原md5全等=%s · 复绿=%s'
              % ('✅' if ok else '❌', name, rc, expect, red_on_target, back, green_again))
        if not red_on_target:
            for ln in out.splitlines():
                if '❌' in ln:
                    print('      实际红：' + ln.strip())

    print('\n全部变异有效 = %s' % all_ok)
    return 0 if all_ok else 1


if __name__ == '__main__':
    sys.exit(main())
