# -*- coding: utf-8 -*-
"""提取 docx 正文（段落 + 表格按阅读顺序），落盘为 md"""
import io, re, sys, zipfile

SRC = sys.argv[1]
DST = sys.argv[2]

z = zipfile.ZipFile(SRC)
xml = z.read('word/document.xml').decode('utf-8', 'ignore')

# 去掉所有 revInd 等噪声，按块切
blocks = re.split(r'(?=<w:p[ >])|(?=<w:tbl[ >])', xml)
out = []
for b in blocks:
    if b.startswith('<w:tbl'):
        # 表格：按行提取
        rows = re.findall(r'<w:tr[ >].*?</w:tr>', b, re.S)
        for r in rows:
            cells = re.findall(r'<w:tc[ >].*?</w:tc>', r, re.S)
            vals = []
            for c in cells:
                t = ''.join(re.findall(r'<w:t[^>]*>(.*?)</w:t>', c, re.S))
                t = re.sub(r'<[^>]+>', '', t)
                vals.append(t.strip())
            out.append('| ' + ' | '.join(vals) + ' |')
        out.append('')
    else:
        t = ''.join(re.findall(r'<w:t[^>]*>(.*?)</w:t>', b, re.S))
        t = re.sub(r'<[^>]+>', '', t)
        t = t.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"')
        # 标题层级
        m = re.search(r'<w:pStyle w:val="([^"]+)"', b)
        style = m.group(1) if m else ''
        if t.strip():
            if re.search(r'[Hh]eading1|^1$', style):
                out.append('# ' + t.strip())
            elif re.search(r'[Hh]eading2|^2$', style):
                out.append('## ' + t.strip())
            elif re.search(r'[Hh]eading3|^3$', style):
                out.append('### ' + t.strip())
            else:
                out.append(t.strip())
        else:
            out.append('')

txt = '\n'.join(out)
txt = re.sub(r'\n{3,}', '\n\n', txt)
with io.open(DST, 'w', encoding='utf-8') as f:
    f.write(txt)
print('SRC=' + SRC)
print('DST=' + DST)
print('chars=' + str(len(txt)) + '  lines=' + str(txt.count('\n') + 1))
print('--- 头 60 行 ---')
print('\n'.join(txt.split('\n')[:60]))
