# -*- coding: utf-8 -*-
"""R251 证据脱敏（v2）：把真云回包里的**真实业务数据**（菜品名 / 成本卡名）替换为占位名，
结构、平台键、份数、金额、行数**一字不动**（判据价值全保住），原文另存到 `_probe_tmp/r251_raw/`。

WHY（本仓纪律，R250 已立）：review/evidence 的取证可以入库，但
  「真实账单原件与含数据行的矩阵**不入库**」—— 菜品名 + 份数 + 金额合起来就是营业额结构，
  属**真实业务数据**。`_probe_tmp/` 已被 `.gitignore` 忽略（R249）⇒ 原文放那里安全。

🔴 v1 的坑（已修）：Python `io.open(p,'w')` 在 Windows 会把 `\\n` 翻成 `\\r\\n`
  ⇒ 下游 `txt.indexOf('\\n\\n')` 定位不到分隔行、切出半行 ⇒ `JSON.parse` 报
  `Unexpected non-whitespace character after JSON at position 4`。
  ⇒ 本版：① 一律**规范化后再解析**；② 额外产出**纯 JSON**（`payload_r251.json`、`cards_r251.json`）
     供下游直接读，不再解析带表头的 .txt；③ 写文件统一 `newline=''`（不翻译行尾）。

跑法：python review/evidence/r251_dishreview/_r251_sanitize.py
"""
import io
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
RAW_DIR = os.path.join(REPO, '_probe_tmp', 'r251_raw')

DISH_SEQ = ['★发鱿鱼', '【耙牛筋】六荤六素单人餐+米饭', '【超实惠】耙肥肠六荤六素单人餐(含有米饭)',
            '【超豪华】耙牛肉六荤六素单人套餐(含米饭)', '【超豪华】耙牛肉六荤六素单人套餐(含米饭)+老国宾',
            '乐堡', '冬瓜', '加个油碟', '包包白', '双汇火腿肠', '国宾', '土豆', '土豆粉', '小料油碟',
            '小郎酒', '广味小香肠', '方竹笋', '来点辣椒吗', '梅林午餐肉', '煮小酥肉', '王老吉',
            '百事可乐单支500ml', '米饭', '老村长谷香', '耗儿鱼', '耙牛筋', '耙牛肉', '耙猪蹄',
            '耙肥肠', '耙萝卜', '脆毛肚', '脆皮肠', '莲藕', '莴笋尖', '菠萝啤酒', '虎皮凤爪',
            '蛋炒饭', '豆皮', '豆芽', '贡菜', '起泡豆干', '郡花', '金针菇', '雪碧500ml',
            '鱼籽福袋', '鸭血', '鹌鹑蛋', '黄喉', '黄瓜条', '黑豆腐', '粑粑肠']
CARDS = ['鱼香肉丝', '炸鸡腿', '肥炸鸡腿']


def read_norm(rel):
    """读文本并规范化行尾（LF）"""
    with io.open(rel, encoding='utf-8') as f:
        return f.read().replace('\r\n', '\n').replace('\r', '\n')


def write_norm(rel, txt):
    """写文本且**不翻译行尾**"""
    with io.open(rel, 'w', encoding='utf-8', newline='') as f:
        f.write(txt)


def payload_of(txt):
    """取表头之后的纯 JSON（先规范化行尾）。
    ⚠️ 不能只按空行切：`probe_r251_cards.txt` 的表头与 JSON 之间**只有一个 \\n**（无空行）
    ⇒ 按 `\\n\\n` 切会切出整份文本、解析失败。改为**从第一个 `{` 起**取。"""
    i = txt.find('\n\n')
    if i < 0:
        i = txt.find('{')
        if i < 0:
            raise ValueError('找不到 JSON 起点')
        return json.loads(txt[i:])
    return json.loads(txt[i + 2:])


def make_map():
    m = {}
    for i, n in enumerate(DISH_SEQ):
        m[n] = '菜品%02d' % (i + 1)
    for i, n in enumerate(CARDS):
        m[n] = '成本卡%d' % (i + 1)
    return m


def desensitize_text(txt, m):
    out = txt
    for k in sorted(m, key=len, reverse=True):     # 长名优先，防前缀先被替掉
        out = out.replace(k, m[k])
    return out


def main():
    os.makedirs(RAW_DIR, exist_ok=True)
    m = make_map()
    jobs = [('probe_r251.txt', 'payload_r251.json'), ('probe_r251_cards.txt', 'cards_r251.json')]

    for name, jsonname in jobs:
        raw_rel = os.path.join(RAW_DIR, name)
        src_rel = raw_rel if os.path.exists(raw_rel) else os.path.join(HERE, name)
        txt = read_norm(src_rel)
        obj = payload_of(txt)

        # ① 原文另存（仓外忽略目录；只在首次从仓内取时写，避免二次运行把已脱敏的当原文）
        if src_rel != raw_rel:
            write_norm(raw_rel, txt)
        # ② 纯 JSON（脱敏）—— 下游直接读它，不再解析带表头的 txt
        write_norm(os.path.join(HERE, jsonname), json.dumps(desensitize_text_obj(obj, m),
                                                            ensure_ascii=False, indent=2) + '\n')
        # ③ 人读档（脱敏，保留表头形态）
        write_norm(os.path.join(HERE, name), desensitize_text(
            txt[:txt.find('\n\n') + 2] + json.dumps(obj, ensure_ascii=False, indent=2), m) + '\n')
        print('已脱敏：%s + %s' % (name, jsonname))

    # ④ 自证：仓内文件不得再出现任何真名
    leaked = []
    for name, _ in jobs:
        t = read_norm(os.path.join(HERE, name))
        for k in m:
            if k in t:
                leaked.append((name, k))
    print('残留真名 = %d %s' % (len(leaked), leaked[:5]))
    return 1 if leaked else 0


def desensitize_text_obj(obj, m):
    """对 JSON 结构做脱敏（只改字符串值；数字/键不动）"""
    s = json.dumps(obj, ensure_ascii=False)
    return json.loads(desensitize_text(s, m))


if __name__ == '__main__':
    raise SystemExit(main())
