# R759 登记新套件 + 同步头注套件数（一次性脚本）
p = 'verify_all.js'
b = open(p, 'rb').read()
print('before CRLF=%d LF=%d' % (b.count(b'\r\n'), b.count(b'\n') - b.count(b'\r\n')))
s = b.decode('utf-8')

old = '// 串联：341 个套件'
assert s.count(old) == 1, 'head count occurrences=%d' % s.count(old)
s = s.replace(old, '// 串联：342 个套件')

anchor = "  ['hub-icons', 'tools/check_hub_icons.js'],"
assert s.count(anchor) == 1, 'anchor occurrences=%d' % s.count(anchor)
ins = (anchor + '\r\n'
       + '  // R759：活动测算「两段分离」守卫（页面桩真跑 recalc，不依赖 IDE）。\r\n'
       + '  //   李老师纠偏：折扣换算（买2送1=几折）是主角、不该被毛利率卡住；回本测算是次要。\r\n'
       + '  //   守：A 换算独立 + B 回本对拍 + C 两段联动 + D 反恒真，14 断言。\r\n'
       + "  ['promo-two-stage', 'tools/check_promo_two_stage.js'],")
s = s.replace(anchor, ins)

open(p, 'wb').write(s.encode('utf-8'))
b2 = open(p, 'rb').read()
print('after CRLF=%d LF=%d' % (b2.count(b'\r\n'), b2.count(b'\n') - b2.count(b'\r\n')))
