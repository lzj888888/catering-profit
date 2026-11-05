import io

# ══ 1) terms 双副本：分批中断的说明 ══
for q in ['miniprogram/i18n/terms.js', 'specs/dev-specs/i18n/terms.js']:
    t = io.open(q, encoding='utf-8', newline='').read()
    a = "    matrixRowsTooMany: '档位组合 {n} 行，超过上限 {max} 行，请减少档位',"
    assert t.count(a) == 1, (q, t.count(a))
    if 'matrixPartial' not in t:
        t = t.replace(a, a + """
    // 🔴 R357：分批中途失败 ⇒ 已算出的先给，**并说清哪一段没算**（不能整张表空白）
    matrixPartial: '第 {a}-{b} 档没算出来（共 {n} 档），下表只显示已算出的 {m} 档',""", 1)
    io.open(q, 'w', encoding='utf-8', newline='').write(t)
print('terms ok')

# ══ 2) matrix.js：分批内层 try/catch + partial ══
p = 'pages/sandbox/matrix.js'
s = io.open(p, encoding='utf-8', newline='').read()

old = """      const CHUNK = 150;
      const allRows = [];
      const rejected = [];
      for (let off = 0; off < cleanArr.length; off += CHUNK) {
        const part = cleanArr.slice(off, off + CHUNK);
        const d = await api.call('calcSandbox', { action: 'matrix', clean_array: part });
        const got = d.rows || [];
        for (let k = 0; k < got.length; k++) allRows.push(got[k]);
        (d.rejected || []).forEach((x) => {
          rejected.push({ index: (Number(x.index) || 0) + off, code: x.code, msg: x.msg });
        });
      }
      const rows = allRows.map((res, i) => this.toRow(meta[i], res));"""
assert s.count(old) == 1, ('分批块', s.count(old))

new = """      const CHUNK = 150;
      const allRows = [];
      const rejected = [];
      // 🔴 R357：分批中途失败**不能把已算好的也丢掉**（原来外层 catch ⇒ 整张表空白 + 一句笼统错误，
      //   老板分不清"全错"还是"错了一部分"）。改为逐批 try，失败即停，但保留已算出的行，
      //   并在页面上明说「第 a-b 档没算出来」。
      let failedAt = -1;
      let failedMsg = '';
      for (let off = 0; off < cleanArr.length; off += CHUNK) {
        const part = cleanArr.slice(off, off + CHUNK);
        try {
          const d = await api.call('calcSandbox', { action: 'matrix', clean_array: part });
          const got = d.rows || [];
          for (let k = 0; k < got.length; k++) allRows.push(got[k]);
          (d.rejected || []).forEach((x) => {
            rejected.push({ index: (Number(x.index) || 0) + off, code: x.code, msg: x.msg });
          });
        } catch (e) {
          failedAt = off;
          failedMsg = (e && e.msg) || '';
          break;
        }
      }
      // 第一批就失败 ⇒ 没有可展示的结果，保持原语义：报错退出
      if (failedAt === 0 || (!allRows.length && failedAt > 0)) {
        this.setData({ loading: false });
        api.toastError({ msg: failedMsg });
        return;
      }
      const partialText = failedAt >= 0
        ? fmt(M.matrixPartial, {
          a: failedAt + 1,
          b: Math.min(failedAt + CHUNK, cleanArr.length),
          n: cleanArr.length,
          m: allRows.length,
        })
        : '';
      const rows = allRows.map((res, i) => this.toRow(meta[i], res));"""
s = s.replace(old, new, 1)

# result 里带上 partialText
old2 = """        result: { rows, view: 'detail', count: rows.length, pivot, insight, rejected },"""
assert s.count(old2) == 1, ('result 写入', s.count(old2))
s = s.replace(old2, """        result: { rows, view: 'detail', count: rows.length, pivot, insight, rejected, partialText },""", 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('matrix.js ok')
