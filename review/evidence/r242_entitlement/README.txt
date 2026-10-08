R242 · 用键鼠代做「开通权益」—— 全流程实测取证
================================================================
日期：2026-10-08（R242）
执行：WorkBuddy（键鼠代操云开发控制台）
环境：cloud1-d4gphpoxy337f2a25（控制台顶部实测显示 = 「我的环境（餐饮店算）」）
      与 miniprogram/config/env.js:23 dev 单源一致 ⇒ 环境正确，未改错环境。

【结论（一句话）】
  权益已开通并独立复验：expire_at 0 → 1830268799000，is_active false → true，
  source auto → manual，days_left = 449（引擎自算）。
  ⇒ R238 的「10 条通道全封死」结论适用范围需修正：封死的是**程序化通道**
    （CLI / 云函数 / HTTP API / 客户端 SDK / admin 通道），
    **GUI（键鼠代操控制台）这条路一直是通的**，R238 漏判了。

【改动的记录（唯一一条，无多记录误改风险）】
  集合 shop_entitlement / _id = 01f3430d6aaccf5d00210a16037c9db8
  user_id = u_mu6j87t1a283（与 R238/R239 探针一致）
  字段              改前          改后
  expire_at         0             1830268799000   (2027-12-31 23:59:59 GMT+8)
  source            "auto"        "manual"
  updated_at        1789710173437 1791464332109   (改时当前毫秒)

【独立复验（不采信 UI，绕开界面从云端读）】
  probe_ent_after.txt ← review/evidence/r238_entitlement/r238_probe_ent.js（原本就是只读探针）
    "ent": { "shop_id": "shop_mu6j87v1itrs", "user_id": "u_mu6j87t1a283",
             "expire_at": 1830268799000, "is_active": true,
             "source": "manual", "days_left": 449 }
  ⇒ is_active=true 即付费墙（entitlement.hasFeature 只读 expire_at）的放行判据本身。
  ⇒ days_left=449 由服务端自算，与 expire_at 交叉吻合（2026-10-08 → 2027-12-31）。

【未完成 / 受限】
  · 端到端撞墙探针 probe_wall.out.txt：automator 层 timeout（模拟器自身不健康，
    与该函数/权益无关）。getDishReview 单跑亦超时 ⇒ 未取得该路证据。
  · 因此「墙已开」依据 = payQueryEntitlement 的 is_active（判定单源），非页面级走查。

【三个字段的改法（同一套流程走三遍）】
  1. 选中字段行（点行内任意处）⇒ 行尾出现 ✏️ / 🗑
  2. 点 ✏️ ⇒ 弹「编辑字段」（字段 / 类型 / 值 + 取消·确定）
  3. 点「值」输入框 ⇒ Ctrl+A ⇒ 剪贴板写入 ⇒ Ctrl+V
  4. **回读验证**：Ctrl+A + Ctrl+C ⇒ 读剪贴板比对（不靠目视）
  5. 点绿色「确定」

【本轮新踩的坑（已固化进 win-desktop-control 技能）】
  🔴 A. SetWindowPos(TOPMOST) 只改 Z 序，**不改前台**；而 keybd_event 发的键只到
        **前台窗口** ⇒ 我前 ~10 轮所有键盘输入其实打给了**记事本**（前台被它占着），
        表现为「键盘完全失效」的假象。真正生效的置前法 = AttachThreadInput + SetForegroundWindow
        （实测 `GetForegroundWindow() == CLOUD` 才为 True）。
        ⚠️ 判据：先打印前台窗口是谁，别上来就怀疑输入法/安全软件。
  🔴 B. 用户给的坐标一律不可沿用：本轮我自己**按 Read 回显图目测**估搜索框在 y=239，
        实际 OCR 实测是 y≈271 ⇒ 焦点从来没落进输入框。
        （again：回显图有缩放，见技能坑 #31）
  🔴 C. 新版控制台（v2.0.35）与配方 17（v2.0.3）布局不同：
        集合列表在**左侧**；左侧集合搜索框中心 y≈271；页签行 y≈154。
  🔴 D. 左侧集合列表是**虚拟滚动**：滚轮与拖拽滚动条**都不生效**
        （实测 scroll 16 帧逐字节相同、拖拽只挪滚动条不滚内容）
        ⇒ 唯一可靠入口 = **搜索框筛前缀**（占位符「集合名称前缀」，前缀匹配）。
        ⚠️ 搜索框展开后会**遮住列表首行**，别据此判断"集合不存在"。
  🔴 E. 字段行的 ✏️/🗑 图标 **x 随内容长度浮动**，三行实测各不相同：
        expire_at→1339 · source→1365 · updated_at→1492
        ⇒ 必须**逐行用像素法现测**（图标原色 RGB≈(27,125,175)，条件 b>r+25），
          且 ✏️ 与 🗑 仅隔约 33px，点偏会误触**不可逆删除**。
  🔴 F. 「编辑字段」弹窗里 **string 值不加引号**（显示 auto 而非 "auto"）；
        number 值直接填整数。
  🔴 G. 弹窗控件坐标稳定可复用：值输入框 (1058,265)、绿「确定」(1240,351)
        （与配方 17.3 记录的 1246,349 吻合）。

【文件清单】
  probe_ent_after.txt   只读权益探针输出（复验判据，rc=0）
  probe_wall.js/.out.txt 端到端撞墙探针（automator timeout，见「未完成」）
  probe_reverse.js/.out.txt 用生产引擎 calcReversePrice 算建议挂牌价对照表
  reversal 对照表（堂食口径，不含平台佣金）：
    | 卡片     | 成本    | 50%    | 55%     | 60%     | 65%     |
    | 鱼香肉丝 | 12.00   | 24.00  | 26.67   | 30.00   | 34.29   |
    | 炸鸡腿   | 25.00   | 50.00  | 55.56   | 62.50   | 71.43   |
    | 肥炸鸡腿 | 480.25  | 960.50 | 1067.22 | 1200.63 | 1372.14 |  ← 成本疑似录入单位错
