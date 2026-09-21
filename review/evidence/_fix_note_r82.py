# round82：NOTE 回填本件 commit sha（字节级，保持 CRLF）
P = r'review/NOTE_2026-09-22_round82-selfdrive.md'
raw = open(P, 'rb').read()
txt = raw.decode('utf-8')
n1 = txt.count('commit 见文末')
n2 = txt.count('commit 同上')
assert n1 >= 1 and n2 >= 1, (n1, n2)
txt = txt.replace('commit 见文末', 'commit `609fc28`')
txt = txt.replace('commit 同上', 'commit `609fc28`')
print('replaced 见文末=%d 同上=%d' % (n1, n2))
open(P, 'wb').write(txt.encode('utf-8'))
d = open(P, 'rb').read()
print('CRLF', d.count(b'\r\n'), 'LF', d.count(b'\n'), 'sha_in_note', '609fc28' in d.decode('utf-8'))
