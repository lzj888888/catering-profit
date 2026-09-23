p = 'tools/check_redline_thresholds.js'
d = open(p,'rb').read()
nl = b'\r\n' if d.count(b'\r\n') == d.count(b'\n') else b'\n'
old = "  const pairs = [['菜品毛利率', /毛利(?:率)?≥(\d+)%/], ['房租占比', /房租≤(\d+)%/], ['人工占比', /人工≤(\d+)%/], ['食材损耗率', /损耗≤(\d+)%/]];"
new = "  // ⚠️ 符号两侧允许空白 —— round80 M7 变异实证：写死「毛利≥55%」时，正确实现换成「毛利 ≥55%」\n  //    就会被判成解析失败而转红（「绑字面」同族病，与 round58 E1 口径守卫同一形态）。\n  const pairs = [['菜品毛利率', /毛利(?:率)?\s*[≥>=]\s*(\d+)\s*%/], ['房租占比', /房租\s*[≤<=]\s*(\d+)\s*%/], ['人工占比', /人工\s*[≤<=]\s*(\d+)\s*%/], ['食材损耗率', /损耗\s*[≤<=]\s*(\d+)\s*%/]];"
o = old.replace('\n', nl.decode()).encode('utf-8')
n = new.replace('\n', nl.decode()).encode('utf-8')
if o not in d:
    print('!! 锚点未命中'); raise SystemExit(1)
d = d.replace(o, n, 1)
open(p,'wb').write(d)
d2 = open(p,'rb').read(); print('写后 CRLF=', d2.count(b'\r\n'), 'LF=', d2.count(b'\n'))
