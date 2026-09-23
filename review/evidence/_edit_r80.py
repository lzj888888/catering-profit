import io
p='specs/dev-specs/core/开发规范v1.0_ModuleM1_月度盈利核算.md'
d=open(p,'rb').read()
nl=b'\r\n' if d.count(b'\r\n')==d.count(b'\n') else b'\n'
print('行尾 =', 'CRLF' if nl==b'\r\n' else 'LF')
anchor='四红线（占比相对营收）：'
assert anchor.encode('utf-8') in d, '锚点缺失'
marker='> **经营红线阈值口径（唯一声明处）**：房租占比 **15**% / 人工占比 **20**% / 菜品毛利率 **55**% / 食材损耗率 **5**%。'
mb=marker.encode('utf-8')
if mb in d:
    print('已存在，跳过')
else:
    lines=d.split(nl)
    out=[]
    for ln in lines:
        out.append(ln)
        if anchor.encode('utf-8') in ln:
            out.append(mb)
            out.append(b'')
    d=nl.join(out)
    open(p,'wb').write(d)
    print('已插入标记行')
d2=open(p,'rb').read()
print('写后 CRLF=',d2.count(b'\r\n'),'LF=',d2.count(b'\n'))
