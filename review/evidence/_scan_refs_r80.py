import os
md=[]
for dp,dn,fn in os.walk('specs'):
    if os.sep+'review' in dp+os.sep: continue
    for f in fn:
        if f.endswith('.md'): md.append(os.path.join(dp,f))
print('MD面数 =', len(md))
ref_files=[]
for root in ['tools','specs/dev-specs/prototype']:
    for dp,dn,fn in os.walk(root):
        for f in fn:
            if f.endswith(('.js','.py','.json','.sh')): ref_files.append(os.path.join(dp,f))
blobs={}
for f in ref_files:
    try: blobs[f]=open(f,encoding='utf-8',errors='ignore').read()
    except: pass
print('引用面文件数 =', len(blobs))
rows=[]
for p in md:
    base=os.path.basename(p); stem=base[:-3]
    who=[]
    for f,b in blobs.items():
        if base in b or stem in b: who.append(f)
    rows.append((len(who),p,who[:3]))
rows.sort()
for n,p,who in rows:
    print('%3d  %s   %s' % (n,p,who if n<=2 else ''))
