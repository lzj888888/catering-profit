# -*- coding: utf-8 -*-
# R215 补丁：云函数来源校验（P0）+ 前端 no_shop 引导与 tabBar 上下文（P1）
# 纪律：两阶段写入 —— 先校验「每个锚点在目标文件内命中恰好 1 次」，全部通过才统一落盘；
#       任一不符则一个文件都不写并响亮退出。行尾按各文件自身 eol 归一，写回用字节（防翻译）。
import os, sys, io

ROOT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit'

EDITS = []


def E(rel, old, new):
    EDITS.append((rel, old, new))


# ================= P0-1 · payExpireNotify =================
E(r'cloudfunctions/payExpireNotify/index.js',
  "const { ok } = common;\n",
  "const { ok, fail, ERROR_CODES } = common;\n")

E(r'cloudfunctions/payExpireNotify/index.js',
  "// ⚠️ 订阅消息发送需模板 ID + 用户授权（requestSubscribeMessage），本函数当前返回待通知列表，\n"
  "//   实际推送由云调用 openapi.subscribeMessage.send 完成——未配置模板 ID 时跳过发送，仅登记。\n",
  "// ⚠️ 订阅消息发送需模板 ID + 用户授权（requestSubscribeMessage），本函数当前返回待通知列表，\n"
  "//   实际推送由云调用 openapi.subscribeMessage.send 完成——未配置模板 ID 时跳过发送，仅登记。\n"
  "// 🔴 R215 加固：exports.main 加来源校验（有用户 OPENID 即拒）—— 此前它可被任意已登录用户\n"
  "//   从小程序端直接调用，拉走 shop_entitlement 全表（user_id + expire_at）。\n"
  "//   守卫 = tools/check_fn_public_surface.js 的 C-②（逐条点名本函数必须自保）。\n"
  "// 🔴 R215 触发器：同目录 config.json 声明 triggers（每天 10:00）—— ⚠️ 触发器要在部署后\n"
  "//   **单独「上传触发器」**才生效（普通部署不带它）；未接订阅消息前，本函数只把扫描结果\n"
  "//   写进云端日志（不推送），供上线后核对触发器是否真的跑起来。\n")

E(r'cloudfunctions/payExpireNotify/index.js',
  "exports.main = async () => {\n  const now = nowUtc();\n",
  "exports.main = async () => {\n"
  "  // 🔴 R215：本函数是**定时任务**，绝不是业务接口 —— 此前 exports.main 无任何来源校验，\n"
  "  //   而它扫的是 shop_entitlement **全表**并回 user_id + expire_at ⇒ 任意已登录用户\n"
  "  //   在小程序端 callFunction({ name: 'payExpireNotify' }) 即可拉到别人的付费状态。\n"
  "  //   判据 = **有用户 OPENID 即客户端调用 ⇒ 拒绝**；定时触发器与控制台「测试」都没有\n"
  "  //   用户上下文（OPENID 为空）⇒ 运维面不受影响。\n"
  "  const ctx = cloud.getWXContext();\n"
  "  if (ctx && ctx.OPENID) return fail(ERROR_CODES.FORBIDDEN);\n"
  "\n"
  "  const now = nowUtc();\n")

# ================= P0-2 · smokeTest =================
E(r'cloudfunctions/smokeTest/index.js',
  "exports.main = async (event) => {\n  const out = {\n",
  "exports.main = async (event) => {\n"
  "  // 🔴 R215 加固：本函数是**诊断探针**（会建集合、往 probe_tmp 写数据），不是业务接口 ——\n"
  "  //   此前无任何来源校验 ⇒ 任意已登录用户可从小程序端调用它写库。\n"
  "  //   判据 = **有用户 OPENID 即客户端调用 ⇒ 拒绝**；云控制台「测试」/ cli 调用无 OPENID ⇒ 放行。\n"
  "  //   守卫 = tools/check_fn_public_surface.js 的 C-②。\n"
  "  const wxCtx = cloud.getWXContext();\n"
  "  if (wxCtx && wxCtx.OPENID) return { code: 'FORBIDDEN', msg: 'smokeTest 仅限云控制台 / cli 调用（R215 加固）' };\n"
  "\n"
  "  const out = {\n")

# ================= P1-1 · app.js =================
E(r'app.js',
  "    shop_id: '',          // 店铺 ID（页面首次 getShopContext 后写入；所有请求自动携带 commit）\n"
  "    shop_name: '',\n"
  "    switches: { inventorySwitchOn: false, amortizeSwitchOn: false },\n",
  "    shop_id: '',          // 店铺 ID（页面首次 getShopContext 后写入；所有请求自动携带 commit）\n"
  "    shop_name: '',\n"
  "    switches: { inventorySwitchOn: false, amortizeSwitchOn: false },\n"
  "    // 🔴 R215：店铺上下文是否**已加载过**（含「已加载但无店铺」）—— 见 utils/api.js::ensureShop。\n"
  "    //   旧判据只看 shop_id 非空 ⇒ 无店铺态（no_shop）每进一页就重拉一次，且调用方无从判断\n"
  "    //   「已加载但无店铺」与「还没拉过」的区别。\n"
  "    shopLoaded: false,\n"
  "    // 🔴 R215：无店铺态（服务端 getShopContext 出参 no_shop）—— 用户把店铺**主动删空**时的状态。\n"
  "    no_shop: false,\n"
  "    // R215：本次会话是否已弹过「还没有店铺」引导（避免在三个 tab 间来回切时重复打扰）\n"
  "    noShopPrompted: false,\n")

E(r'app.js',
  "    this.globalData.switches = ctx.switches || { inventorySwitchOn: false, amortizeSwitchOn: false };\n  },\n",
  "    this.globalData.switches = ctx.switches || { inventorySwitchOn: false, amortizeSwitchOn: false };\n"
  "    // R215：无店铺态与「已加载」标志 —— 单源写入点就在这里（页面不得各自判断）\n"
  "    this.globalData.no_shop = !!ctx.no_shop;\n"
  "    this.globalData.shopLoaded = true;\n"
  "  },\n")

# ================= P1-2 · utils/api.js =================
E(r'utils/api.js',
  "  async ensureShop() {\n"
  "    const app = getApp && getApp();\n"
  "    if (app && app.globalData && app.globalData.shop_id) {\n"
  "      return app.globalData;\n"
  "    }\n",
  "  async ensureShop() {\n"
  "    const app = getApp && getApp();\n"
  "    const g = (app && app.globalData) || {};\n"
  "    // 🔴 R215：判据由「shop_id 非空」改为「本次会话是否已加载过」——\n"
  "    //   无店铺态（no_shop，用户把店删空）的 shop_id **恒为空**，旧判据把它当成「还没拉过」，\n"
  "    //   于是每进一页就重发一次 getShopContext，且调用方拿不到「已加载但无店铺」这个事实。\n"
  "    //   标志由单源 app.setShopContext 写入。\n"
  "    if (g.shopLoaded) return app.globalData;\n")

# ================= P1-3 · pages/index/index.js =================
E(r'pages/index/index.js',
  "const app = getApp();\n",
  "const app = getApp();\nconst shopGuard = require('../../utils/shopGuard.js');\n")

E(r'pages/index/index.js',
  "      const ctx = await api.call('getShopContext', {});\n"
  "      app.setShopContext(ctx);\n"
  "      this.setData({ shopName: ctx.shop_name || '', loading: false });\n",
  "      const ctx = await api.call('getShopContext', {});\n"
  "      app.setShopContext(ctx);\n"
  "      // R215：无店铺态（用户把店删空）⇒ 弹一次引导送往店铺页。\n"
  "      //   ⚠️ 本页**保持「每次 onShow 都直拉」的语义**（不切到带缓存的 ensureShop），\n"
  "      //   否则在设置页改完店铺名回首页会看到旧名 —— 那是「页面读缓存」的回退。\n"
  "      if (ctx.no_shop) shopGuard.promptNoShop();\n"
  "      this.setData({ shopName: ctx.shop_name || '', loading: false });\n")

# ================= P1-4 · pages/m3/hub.js =================
E(r'pages/m3/hub.js',
  "const { TERMS } = require('../../miniprogram/i18n/terms.js');\n",
  "const { TERMS } = require('../../miniprogram/i18n/terms.js');\nconst shopGuard = require('../../utils/shopGuard.js');\n")

E(r'pages/m3/hub.js',
  "  onShow() {\n    ui.setTitle(TERMS.hub.title);\n    this.loadCount();\n  },\n",
  "  onShow() {\n    ui.setTitle(TERMS.hub.title);\n    this.boot();\n  },\n"
  "\n"
  "  // 🔴 R215：本页是 tabBar 页 ⇒ **冷启动直达**时 app.globalData 尚空，必须先确保店铺上下文，\n"
  "  //   否则 loadCount 的 getCostCard 会带空 shop_id 发请求（表现为「卡片数不显示」，且静默）。\n"
  "  //   上下文失败不阻塞本页导航（四个分区入口与上下文无关）。\n"
  "  async boot() {\n"
  "    try { await shopGuard.ensureShop(); } catch (e) { /* 静默：导航功能不受影响 */ }\n"
  "    this.loadCount();\n"
  "  },\n")

# ================= P1-5 · pages/mine/index.js =================
E(r'pages/mine/index.js',
  "const { TERMS } = require('../../miniprogram/i18n/terms.js');\n",
  "const { TERMS } = require('../../miniprogram/i18n/terms.js');\nconst shopGuard = require('../../utils/shopGuard.js');\n")

E(r'pages/mine/index.js',
  "  onShow() {\n"
  "    ui.setTitle(TERMS.exp.mineTitle);\n"
  "    const app = getApp();\n"
  "    this.setData({\n"
  "      shopName: (app.globalData && app.globalData.shop_name) || '',\n"
  "      avatarUrl: wx.getStorageSync('user_avatar') || '',\n"
  "      nickname: wx.getStorageSync('user_nickname') || '',\n"
  "    });\n"
  "  },\n",
  "  // 🔴 R215：本页是 tabBar 页 ⇒ 冷启动直达时补拉店铺上下文（无店铺态会弹引导并返回 null）。\n"
  "  //   取 shop_name 前必须先 await，否则读到的是空 globalData（表现为「店铺名空白」）。\n"
  "  async onShow() {\n"
  "    ui.setTitle(TERMS.exp.mineTitle);\n"
  "    try { await shopGuard.ensureShop(); } catch (e) { /* 静默：本页其余入口不依赖上下文 */ }\n"
  "    const app = getApp();\n"
  "    this.setData({\n"
  "      shopName: (app.globalData && app.globalData.shop_name) || '',\n"
  "      avatarUrl: wx.getStorageSync('user_avatar') || '',\n"
  "      nickname: wx.getStorageSync('user_nickname') || '',\n"
  "    });\n"
  "  },\n")

E(r'pages/mine/index.js',
  "        if (app && app.globalData) app.globalData.shop_id = '';\n",
  "        if (app && app.globalData) {\n"
  "          // R215：登出后会话标志必须一起清 —— 否则下次进入时 ensureShop 命中「已加载」\n"
  "          //   而返回上一账号的上下文（跨账号串档）。\n"
  "          app.globalData.shop_id = '';\n"
  "          app.globalData.shop_name = '';\n"
  "          app.globalData.shopLoaded = false;\n"
  "          app.globalData.no_shop = false;\n"
  "          app.globalData.noShopPrompted = false;\n"
  "        }\n")

E(r'pages/mine/index.js',
  "  onPullDownRefresh() { this.onShow(); wx.stopPullDownRefresh(); },\n",
  "  onPullDownRefresh() { this.onShow().then(() => wx.stopPullDownRefresh()); },\n")


def read_bytes(p):
    with open(p, 'rb') as f:
        return f.read()


def main():
    # ---------- 阶段 1：全部锚点先校验（不做任何写入） ----------
    problems = []
    plans = []          # (abs, raw_bytes, eol, new_text)
    for rel, old, new in EDITS:
        p = os.path.join(ROOT, rel)
        if not os.path.exists(p):
            problems.append('文件不存在：' + rel)
            continue
        raw = read_bytes(p)
        txt = raw.decode('utf-8')
        eol = '\r\n' if '\r\n' in txt else '\n'
        o = old.replace('\n', eol)
        n = new.replace('\n', eol)
        cnt = txt.count(o)
        if cnt != 1:
            problems.append('锚点命中 %d 次（须恰为 1）：%s :: %r' % (cnt, rel, old[:60]))
            continue
        plans.append((p, rel, txt, eol, o, n))

    if problems:
        print('ABORT —— 锚点校验未通过，一个文件都没写：')
        for x in problems:
            print('  - ' + x)
        return 1

    # ---------- 阶段 2：统一落盘 ----------
    written = {}
    for p, rel, txt, eol, o, n in plans:
        if p in written:
            txt = written[p]
        txt2 = txt.replace(o, n)
        # 自检：替换后必须仍在（防"替换被吃掉"）
        if txt2.count(n) < 1:
            print('ABORT —— 替换后自检失败：' + rel)
            return 1
        written[p] = txt2

    for p, txt in written.items():
        with open(p, 'wb') as f:
            f.write(txt.encode('utf-8'))
    print('OK —— 共写入 %d 个文件 / %d 处锚点' % (len(written), len(plans)))
    for p in sorted(written):
        print('  · ' + os.path.relpath(p, ROOT).replace('\\', '/'))
    return 0


sys.exit(main())
