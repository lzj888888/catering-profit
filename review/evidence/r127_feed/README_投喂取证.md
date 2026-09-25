round127 · M3 v1.2 P0 投喂 InsCode —— 投喂前守卫核查 + 投喂取证
=================================================================
时间：2026-09-25 22:43–22:58
会话：831bd65c-70cb-4600-8fb6-7ebe07886768   (working_dir = C:\Users\lzj\WorkBuddy\Claw\catering-profit)
投喂前 HEAD：0f665ce（= 远端 dev）
本轮投喂包：specs/dev-specs/delivery/批次M3v1.2_P0_提示词_可直接复制.txt
载荷字符数：9811（含 10 个非 BMP 字符 🔴/⚠️ 等）；UTF-8 字节 18690

一、投喂前：发现并修掉载荷的三处硬伤（否则必然翻车）
-----------------------------------------------------------------
这是投喂技能「第 7 号坑」的第三次印证：**我方给的禁改清单与仓库既有守卫打架**。
若照原样投出，InsCode 要么被卡死，要么为了"让门禁变绿"去改 tools/ 或 specs/（真破坏）。

(1) 术语第三处路径写错
    原文：① `i18n/terms.js` ② `specs/dev-specs/i18n/terms.js` ③ `miniprogram/utils/input.js` 的 `t`
    实测：`miniprogram/utils/input.js` 与 `utils/input.js` **都不存在**（两个都试了）。
    真相：真实双副本是 `miniprogram/i18n/terms.js` ≡ `specs/dev-specs/i18n/terms.js`（各 57039 B）；
          第三处不是某个共享文件，而是**每个页面自己的 `data.t` 块**
          （`const { TERMS } = require('../../miniprogram/i18n/terms.js')` 后逐键显式映射，
           见 pages/card/edit.js:8 与 :27-31）。wxml 里 `t.x` 漏映射 ⇒ 取到空串（round108 事故）。
    ⇒ 已按实测改写红线第 5 条。

(2) 「绝不要改 specs/」与 K11 守卫互斥 —— 会让新页面永远出不来文案
    `specs/dev-specs/prototype/check_error_codes.js:527-533` K11：两份 terms.js 必须**逐字一致**，
    且"以后者（specs 侧）为准同步"。而任何新可见文案都必须进 terms.js。
    ⇒ 若禁改 specs/，InsCode 无法交付任何新页面。
    ⇒ 已把**唯一例外**写进载荷：允许改 `miniprogram/i18n/terms.js` + `specs/dev-specs/i18n/terms.js`
      （并要求 `diff -q` 自证一致），其余 specs/ 一律禁改。

(3) 未预告 R101 会变红 —— InsCode 会去"修"它
    `tools/check_page_manifest.js`（R101）的单源是
    `specs/dev-specs/上线材料_提审材料包_v1.md` §4，判据是「提审材料 ≡ app.json::pages」**双向逐条**
    （Q2 页面全集口径 N、Q3 声明 N ≡ 实算、Q4 §4 表格集合 ≡ app.json 集合、Q6 全仓"N 个页面"陈述 ≡ N）。
    ⇒ 往 app.json 加 2 个页面，R101 **必然红**，而修法在 specs/ 下。
    ⇒ 已新增第八节明示：这是预期内、由门禁方收码后同步；**你不要修、不要碰 specs/tools**。

二、投喂前：把「本批次必须绿的守卫」一并列清（也写进载荷第八节）
-----------------------------------------------------------------
· R44 tools/check_pages.js         app.json 声明 ↔ pages/ 下 .js/.wxml 双向；孤儿页判红
                                   ⇒ 新增两页必须登记进 app.json，四件套与 pages/card/* 同构
· tools/check_flow_entry_and_fold.js B3-①  wx.navigateTo 等目标页必须已在 app.json::pages 注册
· tools/check_doc_id_write.js      锚点：saveMaterial/index.js 的
                                   `doc(exist._id || m.id).update({`（实测 :66）写法**一字不能改**
                                   （可往 data 里加字段）
· 不要新增 tools/ 下任何文件（含 selftest）——套件数/断言数声明处归门禁方，加文件会连环越界
· tools/check_theme_color.js       新 wxss 不得引入已下线色值（旧橘黄 #ff6b35 等）
· tools/check_wxml_structure.js    <input> 自闭合标签不得写在属性集合中间
· tools/check_terms_forbidden.js   新增文案不得含禁用词；不得硬编码中文进 .wxml

已实测确认**无风险**的两点：
· saveMaterial/selftest.js 仅 32 行、**不**断言 material 的字段集合
  ⇒ 往 validate.js/index.js 加 category/aliases/remark 三个字段不会打红它。
· check_data_contract.js 全文**未**引用 saveMaterial / shop_material（扫过，零命中）。

三、投喂（全程零人工，含两段自检 + 三步判据）
-----------------------------------------------------------------
1) 第一段自检 · 剪贴板跨进程：进程 A 写、进程 B 读，**9811 字符逐字一致**（含 10 个非 BMP 字符
   ⇒ 技能坑 1c 的 UTF-16 代理对修复在真实载荷上复验通过）。
2) 第二段自检 · 注入：`chord(Ctrl+V)` 返回 True；UIA 读输入框 **55 → 9811（= 载荷长度）**
   ⇒ SendInput 真实生效，不是假绿。
3) 发送前**眼见为实**：全屏截图确认载荷确实在 InsCode 底部聊天输入框里（见 feed_paste_check.png）。
   ⚠️ 这一步救了一次：首次截图（更早那次）整屏空白 —— 因为 InsCode 窗口那一瞬间是**最小化**态，
   UIA 读到的 EditControl rect 是 (-31692,-30981) 离屏坐标，而 UIA 仍能读写它的值。
   ⇒ 若照"长度一致"就按 Enter，等于往一个最小化窗口里盲发。**长度一致 ≠ 落点正确。**
4) 发送：`send_vk(Enter)` down/up 均返回 1。

四、投喂结果（硬判据，不靠截图）
-----------------------------------------------------------------
                          发送前      发送后
  Assistant(非空)            604        604
  User(非空)                  16        **17  (+1)**   ★
  messages 总数             1770       **1771 (+1)**
  inflight_turn                0        **1**          ★ 已开工
  最后一条 User 与本载荷同源  ——        ✅（头 "店算 · M3 v1.2 …"）
  输入框 len                9811       9811（UI 清空滞后，属正常，见技能坑 9）

五、守卫前置核查的证据来源
-----------------------------------------------------------------
· tools/check_page_manifest.js:45  LIST_REL = 'specs/dev-specs/上线材料_提审材料包_v1.md'
· specs/dev-specs/prototype/check_error_codes.js:527-533  K11 双副本
· cloudfunctions/saveMaterial/index.js:66  doc(exist._id || m.id)
· cloudfunctions/saveCostCard/index.js:238 / syncCostCard/index.js:139  input_type: 1（硬编码，本批要改）
· pages/card/{edit,index,version}.{js,wxml,json,wxss}  四件套同构参照

六、未闭环（如实标注）
-----------------------------------------------------------------
· 本文件落盘时 InsCode 仍在跑（inflight_turn=1），**产出尚未回来、尚未复核**。
  收码后必须走：git diff 逐行 → 受保护区（common/、initDb/、tools/）git status 为空 →
  门禁复跑 → 自己复算锚点（不采信其自测表）→ 再补 R101 的提审材料同步。
· R101 提审材料同步（specs/dev-specs/上线材料_提审材料包_v1.md §4 + 页面全集口径 N + 全仓 N 陈述）
  **尚未执行**，等页面路径定稿后由门禁方做。
