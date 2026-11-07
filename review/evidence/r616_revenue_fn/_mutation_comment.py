# -*- coding: utf-8 -*-
import io,os,subprocess,hashlib
R=os.getcwd(); G='tools/check_comment_safety.js'
A='cloudfunctions/importSalesBill/index.js'; B='cloudfunctions/importSalesBill/revenueDailyParse.js'
FILES=[A,B]
O={p:io.open(p,'rb').read() for p in FILES}; H={p:hashlib.md5(v).hexdigest() for p,v in O.items()}
def run():
    r=subprocess.run(['node',G],cwd=R,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=180)
    return r.returncode,r.stdout.decode('utf-8','replace')
def restore():
    for p in FILES: io.open(p,'wb').write(O[p])
    for p in FILES: assert hashlib.md5(io.open(p,'rb').read()).hexdigest()==H[p],'还原失败 '+p

ANCHOR_A = 'const RevenueDaily = require'
ANCHOR_B = '// \U0001F534 本解析器'.encode('utf-8').decode('unicode_escape') if False else "// 🔴 本解析器"

MUT=[
 ('① 复现本轮原错：注释写 common/**（斜杠+星号）', A, ANCHOR_A,
  '// 不进 cloudfunctions/common/** —— 分发副本\n' + ANCHOR_A, 'A 行注释'),
 ('② markdown 粗体相邻（**甲**/**乙** = 星号斜杠+斜杠星号）', B, ANCHOR_B,
  '//   **甲**/**乙** 相邻写法\n' + ANCHOR_B, 'A 行注释'),
 ('③ 注释里出现独立的星号斜杠（块注释提前结束）', A, ANCHOR_A,
  '// 这里出现提前结束符 */ 了\n' + ANCHOR_A, 'B 行注释'),
]
rc0,_=run(); print('守卫基线 RC=%d（应 0）'%rc0); assert rc0==0
hits=0
try:
    for name,tgt,old,new,want in MUT:
        s=O[tgt]; ob=old.encode('utf-8'); nb=new.encode('utf-8')
        n=s.count(ob)
        assert n==1, '锚点 %d 次: %s'%(n,name)
        io.open(tgt,'wb').write(s.replace(ob,nb,1))
        rc,out=run()
        red=[l.strip() for l in out.splitlines() if '❌' in l]
        named=any(want in l for l in red)
        print('\n  %s'%name)
        print('    期望含「%s」的红项 => %s'%(want,'命中 OK' if named else '未命中 FAIL'))
        for l in red[:2]: print('      '+l[:110])
        if named: hits+=1
        restore()
finally:
    restore()
rc1,_=run(); print('\n还原后 RC=%d（应 0）'%rc1)
print('注释安全变异：%d/%d 命中'%(hits,len(MUT)))
assert hits==len(MUT) and rc1==0
print('PASS 源码逐字节还原')
