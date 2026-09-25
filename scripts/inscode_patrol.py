"""InsCode 巡检器 —— 供 5 分钟定时自动化调用。

用法（必须用带 PIL+winocr 的解释器）：
  <py> inscode_patrol.py                 # 只体检，输出状态报告
  <py> inscode_patrol.py --approve       # 点「允许」（先由上游按 SOP 判定安全）
  <py> inscode_patrol.py --approve X Y   # 指定 PNG 坐标点「允许」

STATE 取值：
  NOT_RUNNING      InsCode 进程不在
  WORKING          有在飞轮次，输出流在涨
  STALLED          有在飞轮次，但输出流 >5 分钟没动
  WAITING_APPROVAL 最新审批记录仍是 pending —— 必须按 SOP 复核
  IDLE_DONE        空闲，最后一轮正常结束（可复核/提交/投喂下一批）
  IDLE_ERROR       空闲，最后一轮非正常结束（ProviderError 等）

典型解释器：
  C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe
"""
import sys, os, time, json, sqlite3, ctypes, datetime

sys.path.insert(0, r"C:\Users\lzj\.workbuddy\skills\inscode-desktop-feed\scripts")
sys.path.insert(0, r"C:\Users\lzj\.workbuddy\skills\win-desktop-control\scripts")

DB = r"C:\Users\lzj\.config\inscode\inscode.db"
STREAM = r"C:\Users\lzj\.config\inscode\logs\session-stream.log"
LIFECYCLE = r"C:\Users\lzj\.config\inscode\logs\turn-lifecycle.log"
TMP = r"C:\Users\lzj\AppData\Local\Temp\inscode"
SESSION_ID = "831bd65c-70cb-4600-8fb6-7ebe07886768"
REPO = r"C:\Users\lzj\WorkBuddy\Claw\catering-profit"

os.makedirs(TMP, exist_ok=True)
WHEEL = 0x0800
CARD_CROP = (270, 560, 1005, 1000)   # 审批卡片所在区域（PNG 坐标，窗口 1620x1000）
NOISE = ("描述你的任务", "自动编辑", "deepseek-v4", "Shift+Enter", "Enter 发送",
         "引用文件", "使用命令", "使用技能", "待审批", "需要审批")


def _db():
    return sqlite3.connect("file:%s?mode=ro" % DB.replace("\\", "/"), uri=True)


def now():
    return datetime.datetime.now().strftime("%H:%M:%S")


def hhmm(ms):
    try:
        return datetime.datetime.fromtimestamp(ms / 1000.0).strftime("%H:%M:%S")
    except Exception:
        return "?"


# ---------------- 体检 ----------------
def check_db():
    d = {}
    c = _db()
    d["inflight"] = c.execute("select count(*) from inflight_turn").fetchone()[0]
    # 审批表是「追加式」：pending 行点完不会改状态，而是再追加一条已决行。
    # 所以「当前是否在等审批」只看 id 最大的那一行。
    d["tail"] = []
    for r in c.execute(
        "select id,tool,command_name,state,resolved_by,wait_ms,ts "
        "from approval_audit order by id desc limit 4"
    ):
        d["tail"].append({"id": r[0], "tool": r[1], "cmd": r[2], "state": r[3],
                          "by": r[4], "wait_s": round((r[5] or 0) / 1000.0),
                          "at": hhmm(r[6]), "ts": r[6]})
    d["waiting"] = bool(d["tail"]) and d["tail"][0]["state"] == "pending"
    d["pending_since"] = d["tail"][0]["ts"] if d["waiting"] else None
    # 已决总数里 pending 的行数（历史噪音，仅供对照）
    d["stale_pending"] = c.execute(
        "select count(*) from approval_audit where state='pending'").fetchone()[0]
    try:
        cols = [r[1] for r in c.execute("pragma table_info(turn_telemetry)")]
        row = c.execute("select * from turn_telemetry order by rowid desc limit 1").fetchone()
        d["last_turn"] = dict(zip(cols, row)) if row else {}
    except Exception as e:
        d["last_turn"] = {"ERR": str(e)}
    c.close()
    return d


def check_stream():
    try:
        st = os.stat(STREAM)
        return {"size": st.st_size, "age_sec": int(time.time() - st.st_mtime),
                "mtime": datetime.datetime.fromtimestamp(st.st_mtime).strftime("%H:%M:%S")}
    except Exception as e:
        return {"size": -1, "age_sec": -1, "mtime": "ERR %s" % e}


def ins_running():
    try:
        import subprocess
        p = subprocess.run(["tasklist", "/FI", "IMAGENAME eq InsCode.exe"],
                           capture_output=True, timeout=30)
        out = (p.stdout or b"").decode("utf-8", "replace") + \
              (p.stdout or b"").decode("gbk", "replace")
        return "InsCode.exe" in out or "inscode.exe" in out.lower()
    except Exception:
        return True  # 判不了就当在跑，交给后面的 find_inscode 报错


# ---------------- 取证（审批弹窗） ----------------
def focus_inscode():
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


def ocr_lines(png, crop, scale=2.0):
    import ocr_screen as ocr
    im = ocr._load(png, crop, scale)
    res = ocr._ocr(im)
    return ocr._lines(res, cl=crop[0] if crop else 0.0,
                      ct=crop[1] if crop else 0.0, s=scale)


def capture_dialog(tag="patrol"):
    """InsCode 拉前台 → 截图 → 在卡片内滚动取多帧 → OCR 拼全文。"""
    h, ins, wg, u = focus_inscode()
    r = wg.rect(h)
    L, T = r[0], r[1]
    base = os.path.join(TMP, "pt_%s.png" % tag)
    wg.screenshot_window(h, base, focus_first=False)

    frames = [(0, base)]
    u.SetCursorPos(L + 600, T + 800)   # 卡片内（长命令的代码块可滚）
    time.sleep(0.4)
    for i in range(1, 4):
        for _ in range(6):
            u.mouse_event(WHEEL, 0, 0, ctypes.c_ulong(-120).value, 0)
            time.sleep(0.05)
        time.sleep(0.9)
        p = os.path.join(TMP, "pt_%s_d%d.png" % (tag, i))
        wg.screenshot_window(h, p, focus_first=False)
        frames.append((i, p))
    for _ in range(24):
        u.mouse_event(WHEEL, 0, 0, ctypes.c_ulong(120).value, 0)
        time.sleep(0.04)
    time.sleep(0.8)

    seen, lines_all = set(), []
    for i, p in frames:
        try:
            for ln in ocr_lines(p, CARD_CROP, 2.0):
                t = ln["text"].strip()
                if t and t not in seen:
                    seen.add(t)
                    lines_all.append(t)
        except Exception as e:
            lines_all.append("[OCR ERR frame%d: %s]" % (i, e))
    keep = [t for t in lines_all if not any(n in t for n in NOISE)]
    return {"base_png": base, "frames": [p for _, p in frames],
            "lines": keep, "raw_lines": lines_all, "hwnd": h, "origin": (L, T)}


DESTRUCTIVE = ["rm -rf", "rm -r ", "rm -f ", "rmdir", "del /f", "del /s",
               "git clean", "git reset --hard", "git checkout --", "format ",
               "remove-item", "rmtree", "truncate", "drop table", "delete from",
               "> /dev/", "shutil.rmtree"]


def analyse(lines):
    import re
    text = "\n".join(lines)
    low = text.lower()
    hits = [t for t in DESTRUCTIVE if t.lower() in low]
    dirs = sorted(set(re.findall(r"mkdir\s+-p\s+\"?\$?\{?([A-Za-z_][A-Za-z0-9_\-]*)", text)))
    for m in re.finditer(r"for\s+(\w+)\s+in\s+([^;]+);", text):
        dirs += [w for w in m.group(2).split() if re.match(r"^[A-Za-z_][\w\-]*$", w)]
    dirs = sorted(set(dirs))
    exist = {d: os.path.exists(os.path.join(REPO, "cloudfunctions", d)) for d in dirs}
    # 目标文件（write_file 类审批）
    files = sorted(set(re.findall(r"[A-Za-z]:[\\/][^\s\"'<>|]*\.(?:js|json|md|wxss|wxml)", text)))
    fexist = {f: os.path.exists(f) for f in files}
    return {"destructive_hits": hits, "candidate_dirs": dirs, "dir_exists": exist,
            "target_files": files, "file_exists": fexist, "text": text}


def find_allow(png, h=None):
    """定位「允许」按钮。

    WinRT OCR 读不出蓝底白字的「允许」（反色对比失败），但能稳定读到
    「拒绝 Esc」。实测两按钮同行、水平间距约 100px → 用 拒绝 的坐标做锚点。
    兜底：按窗口尺寸的比例位（实测 1620x1000 时为 (899, 830)）。
    """
    try:
        for ln in ocr_lines(png, None, 1.5):
            if "拒绝" in ln["text"]:
                return int(ln["cx"] + 100), int(ln["cy"])
    except Exception:
        pass
    if h:
        try:
            import win_gui as wg
            r = wg.rect(h)
            return int(r[0] + (r[2] - r[0]) * 0.555), int(r[1] + (r[3] - r[1]) * 0.83)
        except Exception:
            pass
    return None


# ---------------- 动作 ----------------
def do_approve(x=None, y=None):
    h, ins, wg, u = focus_inscode()
    r = wg.rect(h)
    L, T = r[0], r[1]
    if x is None:
        base = os.path.join(TMP, "pt_approve.png")
        wg.screenshot_window(h, base, focus_first=False)
        pos = find_allow(base, h)
        if not pos:
            return {"ok": False, "err": "未定位到「允许」按钮", "png": base}
        x, y = pos
        x = x - L if x > L else x      # find_allow 返回的是窗口内坐标
        y = y - T if y > T else y
    sx, sy = L + x, T + y
    ins.click(sx, sy, settle=1.5)
    time.sleep(2.0)
    out = os.path.join(TMP, "pt_after_allow.png")
    wg.screenshot_window(h, out, focus_first=False)
    return {"ok": True, "clicked_window_xy": [x, y], "clicked_screen_xy": [sx, sy], "png": out}


def last_report(n=2500):
    try:
        c = _db()
        b, = c.execute("select body from sessions where id=?", (SESSION_ID,)).fetchone()
        msgs = json.loads(b)["messages"]
        A = [m for m in msgs if m.get("role") == "Assistant" and (m.get("text") or "").strip()]
        c.close()
        return A[-1]["text"][-n:] if A else "(无 Assistant 文本)"
    except Exception as e:
        return "(读取失败: %s)" % e


def main():
    argv = sys.argv[1:]
    if argv and argv[0] == "--approve":
        x = int(argv[1]) if len(argv) >= 3 else None
        y = int(argv[2]) if len(argv) >= 3 else None
        print(json.dumps(do_approve(x, y), ensure_ascii=False))
        return

    print("=== InsCode 巡检 %s ===" % now())
    if not ins_running():
        print("STATE=NOT_RUNNING")
        return

    d, s = check_db(), check_stream()
    print("inflight = %s | stream: size=%s mtime=%s age=%ss"
          % (d["inflight"], s["size"], s["mtime"], s["age_sec"]))
    lt = d.get("last_turn") or {}
    if lt:
        print("last_turn: id=%s stop=%s plan=%s rounds=%s tools=%s ended=%s"
              % (lt.get("turn_id"), lt.get("stop_reason"), lt.get("taotoken_plan"),
                 lt.get("rounds"), lt.get("tool_call_count"), hhmm(lt.get("ended_at") or 0)))
    print("最近审批记录（新→旧）: %s" % json.dumps(d["tail"], ensure_ascii=False))

    if d["waiting"]:
        w = round((time.time() * 1000 - (d["pending_since"] or 0)) / 1000.0)
        print("STATE=WAITING_APPROVAL  (id=%s tool=%s，已挂起 %d 秒 ≈ %.1f 分钟)"
              % (d["tail"][0]["id"], d["tail"][0]["tool"], w, w / 60.0))
        print("（历史遗留 pending 行 %d 条，是追加式记录造成的噪音，不用管）" % d["stale_pending"])
        cap = capture_dialog()
        print("--- 审批卡片 OCR 全文（多帧拼接，%d 行）---" % len(cap["lines"]))
        for t in cap["lines"]:
            print(t)
        a = analyse(cap["lines"] + cap["raw_lines"])
        print("--- SOP 自动核验 ---")
        print("destructive_hits = %s" % (a["destructive_hits"] or "无（未见 rm/del/清理类命令）"))
        print("candidate_dirs   = %s" % a["candidate_dirs"])
        print("dir_exists       = %s" % json.dumps(a["dir_exists"], ensure_ascii=False))
        if a["target_files"]:
            print("target_files     = %s" % json.dumps(a["file_exists"], ensure_ascii=False))
        pos = find_allow(cap["base_png"], cap["hwnd"])
        print("allow_button_png_xy = %s" % (pos,))
        print("evidence_png = %s" % cap["base_png"])
        print("→ 判定安全后执行：inscode_patrol.py --approve%s"
              % ((" %d %d" % pos) if pos else ""))
        return

    if d["inflight"]:
        print("STATE=%s" % ("WORKING" if s["age_sec"] < 300 else "STALLED"))
        return

    stop = (lt or {}).get("stop_reason")
    ok = stop in ("Stopped", "Complete", "complete", "completed", "stop", "Success")
    print("STATE=%s (stop_reason=%s)" % ("IDLE_DONE" if ok else "IDLE_ERROR", stop))
    print("--- 最后一轮回复尾部 ---")
    print(last_report(1800))


if __name__ == "__main__":
    main()
