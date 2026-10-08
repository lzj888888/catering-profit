R241 · 「外部数据到达」预置复测套件
=====================================

【目的】
  李老师即将发来京东 / 美团外卖数据。本目录是**预先备好的复测夹具**——
  数据一到，两条命令即可得到「能不能进、会被认成什么、卡在哪一步」，
  不用临场写脚本。

【文件】
  probe_incoming.py            第 1 步：用 openpyxl 把 xlsx 真实结构 dump 成 JSON
  probe_incoming.js            第 2 步：拿真表头喂 **生产解析器**，输出识别面结论
  sample_dump_selftest.json    自测样本（**非真实数据**，用于证明脚本本身可跑）
  probe_incoming.out.txt       自测样本的运行输出（同样非真实数据）
  README.txt                   本文件

【怎么用（数据到了执行这两条）】
  1) "C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe" \
       review/evidence/r241_next/probe_incoming.py <你的账单.xlsx> [销量表.xlsx]
     ⇒ 生成 incoming_dump.json（含每个 sheet 名 / 行数 / 前 8 行原文）

  2) "C:/Users/lzj/.workbuddy/binaries/node/versions/22.22.2-3/node.exe" \
       review/evidence/r241_next/probe_incoming.js
     ⇒ 打印每个 sheet 的 detectPlatform / detectDishShape / 是否被 index.js 阻断

【脚本自带的四条纪律】
  ① **require 生产解析器**（cloudfunctions/importSalesBill/service.js），不手写等价公式
  ② **平台白名单从 index.js 源码抽取**（正则），不手抄 —— 源码改了脚本跟着改
  ③ **先跑正样本基线**（假淘宝/假美团表头）证明脚本不是恒绿（R182 自失效护栏）；
     并断言「白名单键数 ≥ 2」防扫描面退化
  ④ 加载 service.js 需要 `xlsx`（云函数依赖，本地未装）⇒ 脚本**自建 stub 并打
     `Module._resolveFilename` 补丁**（注意：`module.paths.push` 无效，因为
     `require('xlsx')` 发生在 service.js 的模块作用域里，用的是它自己的 paths）

【自测样本实测结论（`sample_dump_selftest.json`，非真实数据）】
  构造：一张「账单明细」sheet（列名含 结算金额 + 商家应收款 两平台的识别列）
      + 一张「商品销量」sheet（列名 日期/门店编号/商品名称/销量/销售额）
  结果：
    · 账单 sheet ⇒ detectPlatform = "taobao"
      ⚠️ 该表**同时含美团的识别列（商家应收款）**，但 `detectPlatform` 命中第一个就返回
         ⇒ 这正是 R240 记录的「**误判静默**」形态：认了一个就停，不做歧义告警。
      ⇒ sheet 名「账单明细」不在白名单（淘宝要「外卖账单明细」）⇒ **按 index.js 判据阻断**。
    · 销量 sheet ⇒ detectDishShape = "waimai_goods"（形态 C）
      ⇒ **形态 C 是能判出的**（前提是列名凑齐 商品名称|菜品名称 + 商品销量|销量 + 销售额）。
      ⇒ 但 detectPlatform = null ⇒ 同样被 index.js 判据阻断。
  通过 3 / 失败 0（基线全绿）。

【⚠️ 边界（务必按此看待本目录的结论）】
  · 自测样本的列名是**我按常识构造的**，**不是京东的真实列名** ——
    真实结论一律以李老师发来的文件跑出的 `incoming_dump.json` 为准。
  · probe_incoming.py 走 openpyxl、云端生产走 `xlsx` 库 ⇒ **两条不同的路**（R181m 教训），
    dump 只用于「看清真实列名」，识别面结论一律以第 2 步（生产解析器）为准。
  · 本目录**零业务代码改动**，只新增只读脚本与样本。
