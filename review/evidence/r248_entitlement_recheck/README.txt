R248 · 弹码前的「付费权益」确认（只读复验）
================================================================
日期：2026-10-09 12:3x
环境：dev = cloud1-d4gphpoxy337f2a25（单源 cloudfunctions/initDb/config.json::DEV_ENV_ID；本仓无 prod）
目的：李老师要求「弹码前先确认我这个手机是有权限直接体验付费项目的」⇒ 先确认，再出码。

一、结论（先说结果）
----------------------------------------------------------------
✅ **权益已开通**，付费墙会放行。

  "ent": { "code": "SUCCESS", "data": {
      "shop_id":   "shop_mu6j87v1itrs",
      "user_id":   "u_mu6j87t1a283",
      "expire_at": 1830268799000,
      "is_active": true,
      "source":    "manual",
      "days_left": 448 } }

  · expire_at = 1830268799000 = **2027-12-31 23:59:59 GMT+8**
  · source 由 R238 的 `auto`（自动建的空档）变为 **`manual`** ⇒ 确认有人按 R238 §五 改过库
  · days_left = 448（自洽：2026-10-09 → 2027-12-31）

二、为什么 is_active=true 就等于「能体验付费项目」（判据链，非推断）
----------------------------------------------------------------
  端上判据单源 = `utils/entitlement.js::isPaid(ent)` → `return !!(ent && ent.is_active);`
  各页付费分支一律写成 `if (!ent || !ent.is_active) { 拦截 }`：
    pages/card/index.js:426 · pages/month/result.js:232 · pages/takeaway/index.js:313 · pages/pay/orders.js:49
  ⇒ is_active=true ⇒ 三个已知拦截点全部放行。
  ⚠️ 另注：付费墙存在**未接线缺口**（R189：real_profit 零判据 / m3_takeaway 云端零判据 / M1「1 家店」拦截未接线），
     那些缺口方向是「本该拦而没拦」⇒ 对「体验」只会有利，不会有害。

三、前提声明（必须写明，别当成无条件结论）
----------------------------------------------------------------
  探针跑在**开发者工具模拟器**里，OPENID = **开发者工具登录的微信号**。
  R238（2026-10-08）时同一探针返回 is_active=false（source=auto）；
  本次（2026-10-09）返回 is_active=true（source=manual）⇒ 变化由人手动改库产生。
  ⇒ 本结论 = 「**IDE 登录的这个微信号**在真云上有付费权益」。
    若李老师手机 A 扫的是**另一个微信号**，则该号仍是免费档 —— **以手机 A 实测为准**。

四、可复现命令
----------------------------------------------------------------
  cd <repo>
  NODE_PATH=C:/Users/lzj/.workbuddy/binaries/node/mpauto/node_modules \
  C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-6/node.exe \
    review/evidence/r238_entitlement/r238_probe_ent.js
  通道：`cli agent start --project <repo> --auto-port 9420 --trust-project`
        （R238 §四 已证：`cli auto` 起不来，`cli agent start` 一次即通）

五、本次同时出的预览码（与此确认配套交付）
----------------------------------------------------------------
  短名   : _gui/qr_now.jpg                47896 B  md5=eb3be1cfcd6d6b8f4d4f8a40c8cf4a0d
  2x     : _gui/qr_now_x2.png             940x940  42788 B
  桌面   : C:/Users/lzj/Desktop/店算_真机预览码_R248.jpg
  出码   : 2026-10-09 12:35:56   失效≈ 13:00:56   HEAD = 1e3841b
  验码   : ✅ cv2 解出 https://mp.weixin.qq.com/a/~~GavHycOx2gY~mY9v-2cpfJgQ4dSRMriTrg~~
           （940x940 内码区 829x819 ⇒ 完整可扫、未被裁切）

六、本目录文件清单
----------------------------------------------------------------
  README.txt                本说明
  r248_probe_ent.out.txt    探针原始输出（含 getShopContext + payQueryEntitlement 全量 JSON）
