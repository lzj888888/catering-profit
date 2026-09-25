"""InsCode 后台监工 —— 常驻轮询审批弹窗，按 SOP 自动批准安全项。

为什么不是「5 分钟定时自动化」：本平台 recurring 排程最小粒度是 1 小时
（FREQ=MINUTELY 被拒；BYMINUTE 列表不被展开）。所以用常驻脚本做秒级值守，
定时自动化只做小时级的复核/提交把关。

核心判据（顺序取信）：
  1. inscode.db / approval_audit —— 「是否在等审批」只看 id 最大的那一行。
     注意：本表是**成对追加**的 —— 挂起时插一行 pending，获批时再插一行
     approved_once，两行共用同一个 call_id。所以旧行长期停在 pending，
     是噪音，不要被它骗了。
  2. 弹窗卡片 OCR —— 取工具名与目标路径/命令文本（WinRT 读不出蓝底白字的
     「允许」，但能读「拒绝」；两按钮同行、水平间距约 100px，用它做锚点定位）。
  3. 仓库实际状态 —— 目标文件/目录是否存在。

自动批准策略（保守：拿不准就 im 不动，写 NEEDS_HUMAN 等人）：
  - write_file / patch / write / edit：目标路径必须在仓库内；若落在
    cloudfunctions/common/ 、initDb/ 、.git/ 之内 → 交人。
  - bash：命令内不得出现任何 BLOCK 词；所有绝对路径必须在仓库内；
    只允许「建目录 / 写 package.json / node 跑门禁 / 只读查看」这类操作。
  - 其它工具 → 交人。

用法（必须用带 PIL+winocr 的解释器）：
  <py> inscode_watch.py            # 常驻（默认 20 秒一轮）
  <py> inscode_watch.py --dry      # 只看不点，用来验证判定
  <py> inscode_watch.py --once     # 单轮
  <py> inscode_watch.py --stop     # 让正在跑的监工下一轮自行退出
  <py> inscode_watch.py --status   # 打印状态（是否在跑、批了多少）

日志：C:\\Users\\lzj\\.config\\inscode\\watch\\watch.log
      ...\\watch\\auto_approve.jsonl    每次自动批准一行（含完整判定依据）
      ...\\watch\\needs_human.json       出现的「需人工」项
      ...\\watch\\batch_done.flag        批次空闲标记（供定时自动化读）
"""
import sys, os, time, json, sqlite3, ctypes, datetime, re

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, r"C:\Users\lzj\.workbuddy\skills\inscode-desktop-feed\scripts")
sys.path.insert(0, r"C:\Users\lzj\.workbuddy\skills\win-desktop-control\scripts")

DB = r"C:\Users\lzj\.config\inscode\inscode.db"
STREAM = r"C:\Users\lzj\.config\inscode\logs\session-stream.log"
WATCH = r"C:\Users\lzj\.config\inscode\watch"
LOG = os.path.join(WATCH, "watch.log")
JSONL = os.path.join(WATCH, "auto_approve.jsonl")
NEEDS = os.path.join(WATCH, "needs_human.json")
DONEFLAG = os.path.join(WATCH, "batch_done.flag")
STOPFILE = os.path.join(WATCH, "stop.flag")
HEART = os.path.join(WATCH, "heartbeat.json")
REPO = r"C:\Users\lzj\WorkBuddy\Claw\catering-profit"
REPO_ALT = "/c/Users/lzj/WorkBuddy/Claw/catering-profit"
SESSION_ID = "831bd65c-70cb-4600-8fb6-7ebe07886768"
EVID_ROOT = os.path.join(REPO, "review", "evidence")
TMP = r"C:\Users\lzj\AppData\Local\Temp\inscode"

INTERVAL = 20
MAX_PER_HOUR = 30
PROTECTED = ("cloudfunctions/common", "common/", "initdb", ".git")

# bash 命令里出现任一 → 交人（不做删除/移动/权限/历史变更/网络下载/装包）
BLOCK = ["rm ", "rm -", "rmdir", "del ", " del/", "mv ", " cp ", "chmod", "chown",
         "truncate", "dd ", "sudo", "taskkill", "shutdown", " reg ", "format ",
         "git clean", "git reset", "git checkout", "git restore", "git stash",
         "git push", "git commit", "git add", "git rm", "git rebase",
         "npm i", "npm install", "pnpm", "yarn", "pip install", "npx ",
         "curl", "wget", "powershell", "cmd /c", "cmd //c", "start ", "scp",
         "ssh ", "rsync", "tar ", "unzip", "xcopy", "robocopy", "remove-item",
         "sed -i", "perl -i", "awk -i",
         "rmsync", "unlinksync", "removesync", "rmdirsync", "execsync",
         "child_process", "spawn(", "fs.unlink", "fs.rm", "shutil",
         "drop table", "delete from", "truncate table"]
# bash 命令只允许这些词开头/出现（不含则交人）
SAFE_OPS = ["cd ", "mkdir", "printf", "echo", "node ", "node\t", "ls", "cat ",
            "grep", "find ", "head", "tail", "wc ", "du ", "test ", "true",
            "for ", "do ", "done", "if ", "then", "fi", "sleep", "sort", "uniq",
            "cut ", "tr ", "bash", "sh "]
ALLOW_TOOLS = ("write_file", "patch", "write", "edit", "create_file", "apply_patch")


def now():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def log(msg):
    line = "[%s] %s" % (now(), msg)
    print(line, flush=True)
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def db():
    return sqlite3.connect("file:%s?mode=ro" % DB.replace("\\", "/"), uri=True)


# ---------- 单实例锁（心跳） ----------
def heartbeat(detail=None):
    try:
        with open(HEART, "w", encoding="utf-8") as f:
            json.dump({"pid": os.getpid(), "epoch": time.time(), "at": now(),
                       "detail": detail}, f, ensure_ascii=False)
    except Exception:
        pass


def alive_other(max_age=90):
    """返回仍在运行的另一实例信息（心跳新鲜），否则 None。"""
    try:
        d = json.load(open(HEART, encoding="utf-8"))
        if d.get("pid") == os.getpid():
            return None
        if time.time() - float(d.get("epoch", 0)) < max_age:
            return d
    except Exception:
        pass
    return None


# ---------- 状态读取 ----------
def newest_approval():
    """返回 (row, is_pending)。只看 id 最大的一行（成对追加写的语义）。"""
    c = db()
    r = c.execute("select id,call_id,tool,command_name,state,resolved_by,wait_ms,ts "
                  "from approval_audit order by id desc limit 1").fetchone()
    c.close()
    if not r:
        return None, False
    row = {"id": r[0], "call_id": r[1], "tool": r[2], "cmd": r[3],
           "state": r[4], "by": r[5], "wait_s": round((r[6] or 0) / 1000), "ts": r[7]}
    return row, row["state"] == "pending"


def inflight():
    c = db()
    try:
        return c.execute("select count(*) from inflight_turn").fetchone()[0]
    finally:
        c.close()


def stream_age():
    try:
        return int(time.time() - os.stat(STREAM).st_mtime)
    except Exception:
        return -1


def last_turn():
    c = db()
    try:
        cols = [r[1] for r in c.execute("pragma table_info(turn_telemetry)")]
        r = c.execute("select * from turn_telemetry order by rowid desc limit 1").fetchone()
        return dict(zip(cols, r)) if r else {}
    finally:
        c.close()


def current_batch():
    """从会话最后一条 User 里抠出「批次 N 开始」，用于决定证据目录。"""
    try:
        c = db()
        b, = c.execute("select body from sessions where id=?", (SESSION_ID,)).fetchone()
        c.close()
        msgs = json.loads(b)["messages"]
        U = [m for m in msgs if m.get("role") == "User" and (m.get("text") or "").strip()]
        for m in reversed(U):
            mm = re.search(r"批次\s*(\d+)\s*开始", m["text"])
            if mm:
                return int(mm.group(1))
    except Exception:
        pass
    return None


def evid_dir(batch):
    d = os.path.join(EVID_ROOT, ("batch%d_feed" % batch) if batch else "watch_feed")
    os.makedirs(d, exist_ok=True)
    return d


# ---------- 窗口操作 ----------
def _focus():
    import inscode_ui as ins
    import win_gui as wg
    u = ins.u
    k = ctypes.windll.kernel32
    u.SetProcessDPIAware()
    h = ins.find_inscode()
    u.ShowWindow(h, 9)
    time.sleep(0.3)
    fg = u.GetForegroundWindow()
    tfg = u.GetWindowThreadProcessId(fg, None)
    tme = k.GetCurrentThreadId()
    u.AttachThreadInput(tme, tfg, True)
    u.SetForegroundWindow(h); u.BringWindowToTop(h); u.SetFocus(h)
    u.AttachThreadInput(tme, tfg, False)
    time.sleep(0.8)
    return h, ins, wg, u


def _shot(h, wg, path):
    wg.screenshot_window(h, path, focus_first=False)
    return path


def _ocr(png, crop=None, scale=2.0):
    import ocr_screen as ocr
    im = ocr._load(png, crop, scale)
    res = ocr._ocr(im)
    return ocr._lines(res, cl=crop[0] if crop else 0.0,
                      ct=crop[1] if crop else 0.0, s=scale)


CARD_CROP = (270, 520, 1005, 1000)   # 审批卡片区（窗口 1620x1000 的 PNG 坐标）


def read_card(tag):
    """拉前台 → 截图 → 卡片内滚动取 4 帧 → OCR 拼全文。返回 dict。"""
    h, ins, wg, u = _focus()
    r = wg.rect(h)
    L, T = r[0], r[1]
    base = _shot(h, wg, os.path.join(TMP, "w_%s.png" % tag))
    frames = [base]
    u.SetCursorPos(L + 600, T + 800)
    time.sleep(0.4)
    for i in range(3):
        for _ in range(6):
            u.mouse_event(0x0800, 0, 0, ctypes.c_ulong(-120).value, 0)
            time.sleep(0.05)
        time.sleep(0.8)
        frames.append(_shot(h, wg, os.path.join(TMP, "w_%s_d%d.png" % (tag, i))))
    for _ in range(24):
        u.mouse_event(0x0800, 0, 0, ctypes.c_ulong(120).value, 0)
        time.sleep(0.04)
    time.sleep(0.7)
    seen, lines = set(), []
    for p in frames:
        try:
            for ln in _ocr(p, CARD_CROP, 2.0):
                t = ln["text"].strip()
                if t and t not in seen:
                    seen.add(t); lines.append(t)
        except Exception as e:
            lines.append("[OCR_ERR %s]" % e)
    try:
        full = _ocr(base, None, 1.5)
    except Exception:
        full = []
    return {"base": base, "frames": frames, "card": lines, "all": full,
            "hwnd": h, "L": L, "T": T}


def allow_xy(card):
    """「允许」按钮定位：以 OCR 到的「拒绝」为锚点（同排、右移约 100px）。"""
    for ln in card["all"]:
        if "拒绝" in ln["text"]:
            return int(ln["cx"] + 100), int(ln["cy"])
    return None


# ---------- 判定 ----------
def paths_in_text(text):
    cands = re.findall(r"(?:[A-Za-z]:[\\/]|/c/|/mnt/)\S+", text)
    return [p.rstrip("\"',;:)").replace("\\", "/") for p in cands]


# OCR 会把 l 读成 I/1、o 读成 0，还会吃掉命令分隔符前后的空格
# （实测：Claw→CIaw、lzj→Izj、`-profit&&git log`→`-profit&&gitIog`）。
# 直接做前缀比较会把这些**合法的仓库内路径**判成"仓库外"→ 假阳性交人。
# 归一化（分隔符→路径边界、易混字符统一）后再比前缀，并要求边界字符不是路径字符。
_CMD_SEP = re.compile(r"[&|;<>,\s\"'`()\[\]{}]+")
_BAD_CHR = re.compile(r"[^a-z0-9/._\-]")
_OCR_MAP = str.maketrans({"1": "l", "i": "l", "0": "o"})
_PATH_CHARS = set("abcdefghijklmnopqrstuvwxyz23456789._-")


def _canon(p):
    p = p.lower().replace("\\", "/")
    p = _CMD_SEP.sub("/", p)          # 命令分隔符 = 路径边界
    p = _BAD_CHR.sub("", p)
    return p.translate(_OCR_MAP)


REPO_CANON = _canon(REPO)
REPO_ALT_CANON = _canon(REPO_ALT)


def outside_repo(text):
    bad = []
    for p in paths_in_text(text):
        c = _canon(p)
        ok = False
        for rc in (REPO_CANON, REPO_ALT_CANON):
            if rc and c.startswith(rc):
                nxt = c[len(rc):len(rc) + 1]
                if not nxt or nxt not in _PATH_CHARS:
                    ok = True
                    break
        if not ok:
            bad.append(p)
    return bad


def decide(tool, text, batch):
    """返回 (decision, reasons)。decision ∈ allow / human。"""
    reasons = []
    low = text.lower()
    tool = (tool or "").lower()
    if tool in ALLOW_TOOLS:
        if any(k in low for k in PROTECTED):
            return "human", ["目标是受保护路径（common/ 单源、initDb 或 .git）"]
        bad = outside_repo(text)
        if bad:
            return "human", ["目标路径在仓库外：%s" % bad]
        if not paths_in_text(text):
            return "human", ["没读到目标路径，无法确认落点"]
        return "allow", ["仓库内文件写入，非受保护路径"]
    if tool == "bash":
        hits = [b for b in BLOCK if b in low]
        if hits:
            return "human", ["命令含高危词：%s" % hits]
        bad = outside_repo(text)
        if bad:
            return "human", ["命令引用了仓库外路径：%s" % bad]
        if any(k in low for k in ("…", "...", "```")):
            reasons.append("文本可能有省略号（OCR 截断风险）")
        if not any(op in low for op in SAFE_OPS):
            return "human", ["命令里没有可识别的安全操作（cb/mkdir/node/ls 等）"]
        if reasons:
            return "human", reasons
        return "allow", ["无高危词、路径全在仓库内、操作属安全白名单"]
    return "human", ["工具 %s 不在自动批准白名单" % (tool or "?")]


def click_allow(h, L, T, xy, ins, wg, tag):
    sx, sy = L + xy[0], T + xy[1]
    ins.click(sx, sy, settle=1.5)
    time.sleep(2.2)
    out = os.path.join(TMP, "w_%s_after.png" % tag)
    _shot(h, wg, out)
    return out, (sx, sy)


# ---------- 主循环 ----------
def run_once(dry=False, state=None):
    row, pending = newest_approval()
    if not pending:
        if state is not None:
            state["busy_seen"] = state.get("busy_seen") or inflight() > 0
            if state["busy_seen"] and inflight() == 0 and stream_age() > 120:
                if not os.path.exists(DONEFLAG):
                    lt = last_turn()
                    with open(DONEFLAG, "w", encoding="utf-8") as f:
                        f.write(json.dumps({"at": now(), "stop_reason": lt.get("stop_reason"),
                                            "turn_id": lt.get("turn_id"),
                                            "stream_age": stream_age()},
                                           ensure_ascii=False))
                    log("批次空闲 → 写 BATCH_DONE.flag（stop_reason=%s）" % lt.get("stop_reason"))
                state["busy_seen"] = False
        return {"state": "idle", "inflight": inflight(), "stream_age": stream_age()}
    # 有审批挂起
    if state is not None:
        state["busy_seen"] = True
    if row["id"] == (state or {}).get("handled_id"):
        return {"state": "already_handled", "id": row["id"]}
    waited = round((time.time() * 1000 - row["ts"]) / 1000.0)
    log("发现挂起审批 id=%s tool=%s 已等 %ss" % (row["id"], row["tool"], waited))
    batch = current_batch()
    card = read_card("id%s" % row["id"])
    text = "\n".join(card["card"])
    d, reasons = decide(row["tool"], text, batch)
    xy = allow_xy(card)
    rec = {"at": now(), "id": row["id"], "call_id": row["call_id"], "tool": row["tool"],
           "waited_s": waited, "decision": d, "reasons": reasons,
           "allow_xy": xy, "card_text": card["card"], "batch": batch,
           "evidence": card["base"], "frames": card["frames"]}
    log("判定 %s：%s" % (d.upper(), reasons))
    if d != "allow" or dry:
        try:
            with open(NEEDS, "w", encoding="utf-8") as f:
                json.dump({"at": now(), "dry": dry, **rec}, f, ensure_ascii=False, indent=1)
        except Exception:
            pass
        with open(JSONL, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        if d != "allow":
            log("→ 交人：已写入 needs_human.json，本轮不点。请人工打开 InsCode 处置。")
            if state is not None:
                state["halt"] = True
        return {"state": "human" if d != "allow" else "dry_allow", "id": row["id"],
                "reasons": reasons, "evidence": card["base"]}
    if not xy:
        log("→ 定位不到「允许」按钮，交人。")
        if state is not None:
            state["halt"] = True
        return {"state": "no_button", "id": row["id"], "evidence": card["base"]}
    h, ins, wg, u = _focus()
    r = wg.rect(h)
    after, scr = click_allow(h, r[0], r[1], xy, ins, wg, "id%s" % row["id"])
    time.sleep(2.5)
    row2, still = newest_approval()
    ok = not still
    rec.update({"clicked_screen_xy": scr, "resolved": ok,
                "after": after, "newest_id": row2["id"] if row2 else None,
                "newest_state": row2["state"] if row2 else None})
    with open(JSONL, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    # 留证
    try:
        ed = evid_dir(batch)
        for src, name in ((card["base"], "审批_auto_%s_%s_弹窗.png" % (row["id"], row["tool"])),
                          (after, "审批_auto_%s_批准后.png" % row["id"])):
            if os.path.exists(src):
                import shutil
                shutil.copy2(src, os.path.join(ed, name))
    except Exception as e:
        log("留证失败：%s" % e)
    if ok:
        log("已批准 id=%s（点了 %s），审批已消解 → 继续跑" % (row["id"], scr))
        if state is not None:
            state["handled_id"] = row["id"]
            state["count"] = state.get("count", 0) + 1
            state["times"] = state.get("times", []) + [time.time()]
    else:
        log("点了但仍是 pending（状态=%s）→ 停止自动批准，交人" %
            (row2["state"] if row2 else "无"))
        if state is not None:
            state["halt"] = True
    return {"state": "approved" if ok else "click_failed", "id": row["id"],
            "evidence": card["base"]}


def main():
    args = sys.argv[1:]
    os.makedirs(WATCH, exist_ok=True)
    if "--stop" in args:
        open(STOPFILE, "w").close()
        print("已放置停止标记，监工将在下一轮退出。")
        return
    if "--status" in args:
        row, pending = newest_approval()
        hb = None
        if os.path.exists(HEART):
            try:
                hb = json.load(open(HEART, encoding="utf-8"))
                hb["age_s"] = int(time.time() - float(hb.get("epoch", 0)))
                hb["alive"] = hb["age_s"] < 90
            except Exception:
                pass
        print(json.dumps({"now": now(), "pending": pending, "newest": row,
                          "inflight": inflight(), "stream_age": stream_age(),
                          "watch_heartbeat": hb,
                          "stop_flag": os.path.exists(STOPFILE),
                          "done_flag": os.path.exists(DONEFLAG),
                          "batch": current_batch(),
                          "auto_approved_lines": (sum(1 for _ in open(JSONL, encoding="utf-8"))
                                                  if os.path.exists(JSONL) else 0)},
                         ensure_ascii=False, indent=1))
        if os.path.exists(NEEDS):
            print("--- 需人工项 ---")
            print(open(NEEDS, encoding="utf-8").read()[:1500])
        return

    dry = "--dry" in args
    once = "--once" in args
    other = alive_other()
    if other and "--force" not in args and not once:
        print("已有监工在跑（pid=%s，心跳 %ss 前）→ 本次不重复启动。"
              % (other.get("pid"), int(time.time() - float(other.get("epoch", 0)))))
        return
    if os.path.exists(STOPFILE):
        os.remove(STOPFILE)
    heartbeat("start")
    log("=== 监工启动（%s，间隔 %ds，pid=%d）==="
        % ("DRY 只看不点" if dry else "自动批准", INTERVAL, os.getpid()))
    state = {"count": 0, "times": [], "busy_seen": False}
    while True:
        if os.path.exists(STOPFILE):
            log("收到停止标记 → 退出。本轮共自动批准 %d 次。" % state.get("count", 0))
            return
        # 频率上限
        nowt = time.time()
        state["times"] = [t for t in state.get("times", []) if nowt - t < 3600]
        if len(state["times"]) >= MAX_PER_HOUR:
            log("已达每小时 %d 次上限 → 退出，交人复核。" % MAX_PER_HOUR)
            return
        try:
            r = run_once(dry=dry, state=state)
            heartbeat("after %s" % json.dumps(r, ensure_ascii=False)[:120])
        except Exception as e:
            log("巡检异常：%r" % e)
            heartbeat("error %r" % e)
        if state.get("halt"):
            log("进入「交人」状态 → 退出，等人工处置。")
            return
        if once:
            return
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
