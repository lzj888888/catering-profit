#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""extract_tables.py —— 把真表 xlsx 无损抽成 JSON，供 node 侧门禁读取。

为什么需要这一步：
  `tools/check_bill_realtables.js` 要吃真表，但项目**没有 node 侧 xlsx 依赖**
  （不想为一个测试套件引入 400KB 的依赖）。所以用 openpyxl 抽成 JSON 存进仓。

为什么不直接读 xlsx：
  xlsx 是 zip+XML，node 侧要解压+解析 sharedStrings，手写容易出错；
  而真表的**价值在于数据本身**，抽成 JSON 不损失任何单元格内容（空值统一成 ''，
  日期统一成 'YYYY-MM-DD' 或 'YYYY-MM-DD HH:MM:SS' 字符串）。

重跑（改了真表或想加新表时）：
  C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe \\
    review/evidence/r700_realtables/extract_tables.py

⚠️ 抽取必须**保留全部 sheet**：真 xlsx 常带多 sheet（淘宝闪购有 6 个），
   解析器要自己按表头签名找对 sheet —— 这是被测行为的一部分，不能为了变小只留一个。
"""
import os
import json
import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))

JOBS = [
    ('review/evidence/r615_wechat_real/meituan_bill_20260907-0913.xlsx',
     'meituan_bill.json'),
    ('review/evidence/r181l_stage1_import_feed/fixtures/淘宝闪购.xlsx',
     'taobao_bill.json'),
    ('review/evidence/r615_wechat_real/meituan_goods_20260907-0913.xlsx',
     'meituan_goods.json'),
]


def extract(src, dst):
    wb = openpyxl.load_workbook(os.path.join(ROOT, src), data_only=True)
    book = {'sheets': {}, '_source': src}
    for sn in wb.sheetnames:
        ws = wb[sn]
        rows = []
        for r in range(1, ws.max_row + 1):
            row = []
            for c in range(1, ws.max_column + 1):
                v = ws.cell(r, c).value
                if v is None:
                    v = ''
                elif hasattr(v, 'date'):          # datetime -> 字符串，与后台导出的文本形态一致
                    v = str(v)[:19]
                else:
                    v = str(v)                     # 金额统一成字符串，交给 toNum 去逗号/币符
                row.append(v)
            rows.append(row)
        book['sheets'][sn] = {'rows': rows}
    wb.close()
    with open(os.path.join(HERE, dst), 'w', encoding='utf-8') as f:
        json.dump(book, f, ensure_ascii=False)
    shape = [(s, len(book['sheets'][s]['rows'])) for s in book['sheets']]
    print('  %-22s <- %s' % (dst, src))
    print('     %d 个 sheet：%s' % (len(shape), shape))


if __name__ == '__main__':
    print('抽取真表 xlsx -> JSON：')
    for s, d in JOBS:
        extract(s, d)
    print('完成。')
