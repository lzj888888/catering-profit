R240 模块评估 —— 「接新平台 / 接外部数据」面实证
======================================================

【为什么做】
李老师准备发【京东 + 美团外卖】的真实数据过来，问「这几个模块跑下来还有哪里需要升级或者改善」。
本目录 = 对「数据接入面」的机器取证（不读码猜、不手算），用于把"隐患"变成"可复现的具体问题"。
配套报告：review/NOTE_2026-10-08_round240_数据接入面评估与升级清单.md

【怎么跑（可复现）】
  ① 平台识别面探针（纯函数 · 11 断言）：
     NODE_PATH="C:/Users/lzj/AppData/Local/Temp/inscode/stubmods" \
       node review/evidence/r240_module_review/probe_platform.js
     → probe_platform.out.txt     （预期 rc=0 / 11 通过 0 失败）
     ⚠️ stub 说明：cloudfunctions/importSalesBill/service.js 顶部 require('xlsx')（云函数本地依赖），
        故用 stubmods/xlsx 占位以便加载纯函数；**探针不调用 bufferToMatrix / xlsx 分支**。

  ② 平台耦合面扫描（加一家平台要动几处）：
     python review/evidence/r240_module_review/scan_platform_coupling.py
     → coupling_scan.txt

【实测结论摘要（详见 out/scan 两文件）】
  · 正样本基线：淘宝表头 → taobao ✅／美团表头 → meituan ✅（证明探针不是恒 null 的假绿）
  · 识别条件 = 单列名硬依赖：去掉「结算金额」/「商家应收款」=> 立刻认不出（null）
  · 白名单 sheet 名：taobao✅ / meituan✅ / eleme⛔ / other⛔ / jd⛔
      ⚠️ 前端 IMPORT_PLATFORM_OPTIONS 里却有 eleme ⇒ 「看着支持、实际阻断」
  · 京东式表若含「结算金额」/「商家应收款」⇒ 被【误判】成 taobao/meituan（下一节实证其静默性）
  · 形态 C 判定：美团式列名 ✅ 判为 waimai_goods；假设京东式列名 ❌ 判不出（null）
  · 形态 C 取列白名单 = ['日期','门店编号','商品名称','销量','销售额']；列名不在表内 ⇒ **静默取 0，不报错**
  · 淘宝格式表若缺「退单」列 ⇒ 退款行被当正常单照收（实测 5000 分，零告警）⇒ 同类「误判后不报错」
  · 耦合面：加一家平台 = 5 个业务文件（service/index/validate/billParse/gradeGate）
              + 前端选项 + 文案双副本 + 4 个测试文件

【本轮未做的事】
  - 未改任何业务代码 / 规范 / 守卫 / 配置（审计轮不动，建议留在 NOTE §7 等拍板）
  - 未拿京东真样例 ⇒ 探针里 4 组京东列名为【假设】，只用于证明"不含那两个专有列名必然认不出"；
    真样例到手后把 JD_VARIANTS 换成真列名复测
  - 未跑 xlsx 分支（本目录只测解析器的判定逻辑，不测二进制读取）

【自纠留痕】
  探针首跑 9/11，两条红均为【我方判据写错】：
    ① 形态 C 断言拿 'C' 比，实际枚举值是 'waimai_goods'（常量名 ≠ 值）
    ② 第 6 节 sheet 写成数组，契约是 { rows: [...] } ⇒ 解析空
  修正后 11/11，产品代码零改动。⇒ 再次印证「守卫红先怀疑自己」。
