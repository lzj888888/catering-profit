import io

p = 'pages/sandbox/index.js'
s = io.open(p, encoding='utf-8').read()


def rep(old, new, cnt=1):
    global s
    assert s.count(old) == cnt, ('anchor miss', s.count(old), old[:70])
    s = s.replace(old, new, cnt)


# ---------- 1) t 映射：复用 M1 的文案（不另造一句）----------
rep("      resBreakMonthly: M.resBreakMonthly,",
    """      // 🔴 R338：安全垫文案**复用 M1**（TERMS.card），不另写 —— 同一个老板在两个模块
      //   必须看到同一句话，否则像两套软件。改口径只改一处。
      safeMargin: TERMS.card.beMargin,
      safeMarginDrop: TERMS.card.beMarginDrop,
      safeMarginEven: TERMS.matrix.cushionBreakEven,
      resBreakMonthly: M.resBreakMonthly,""")

# ---------- 2) 结果派生：安全垫 ----------
rep("""      const presetResultObj = !hasFixed ? null : {
        red_alert: !!d.red_alert,""",
    """      // 🔴 R338：安全垫 —— 与 M1 同一条算式（(营收 − 保本) ÷ 营收 × 100，一位小数）。
      //   为什么不直接用 target/break 的字符串：`fen()` 返回的是展示串，拿来算会带入格式化误差。
      const _beFen = Number(d.break_even_monthly_fen) || 0;
      const _tgFen = Number(d.target_monthly_fen) || 0;
      const _cushion = (_beFen > 0 && _tgFen > 0)
        ? Math.round(((_tgFen - _beFen) * 1000) / _tgFen) / 10
        : null;
      // 目标利润=0 ⇒ 目标营收 = 保本营收 ⇒ 安全垫恒为 0。
      // 🔴 这时显示「保本线」而不是「0%」：0% 会让老板以为系统算坏了（0% 是"一跌就亏"的意思，
      //   但真实语义是"你填的目标就是保本线"）。
      const _cushionText = _cushion == null ? ''
        : (Math.abs(_cushion) < 0.05
          ? TERMS.matrix.cushionBreakEven
          : String(TERMS.card.beMarginDrop || '').replace('{p}', String(_cushion)));

      const presetResultObj = !hasFixed ? null : {
        cushion_pct: _cushion,
        cushion_text: _cushionText,
        red_alert: !!d.red_alert,""")

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('js ok')
