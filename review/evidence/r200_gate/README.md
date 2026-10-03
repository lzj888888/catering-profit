# R200 门禁与回灌归档 ——底部 tabBar 守卫（`tools/check_tabbar.js`）

> 结论先行：**128/128 通过 · RC=0 · miss=0**（索引 3266 项 · 缓存 59 键 · 耗时 137.6s）
> ⚠️ 门禁本轮跑了**三次**：源码版 205.7s（128 项）→ 回灌修守卫后 131.4s（索引 3263）
> → 文档入库后 137.6s（索引 3266）。🔴 **入库即须过闸**：`suite-tracked`（R92）会扫 `git ls-files`，文档也在扫描面。
> **变异回灌 10/10 全部符合预期**：组 A（该红）7 条**全部点名到目标断言**，组 B（不该红）3 条**零误报**，
> 还原后 `失败数=0 / crash=False` 且**三个被变异文件字节完全还原**（md5 逐一对上）。

## 一、为什么立这个守卫（R199 自发现的缺口）

R199 落地了底部三入口 tabBar，但**全仓零机器判据守它**。两类错误会静默失效：

| 层 | 缺陷 | 后果 | 既有守卫为何不报 |
|---|---|---|---|
| **结构** | `list` 少两项 / `pagePath` 不在 `pages` / 图标文件不在盘 / 路径重复 / `text` 空 | tabBar画不出来、画错、或点击无反应 | R44（`check_pages.js`）虽把 `tabBar.list` 的 `pagePath` 并入 `declared`，但**只查文件在不在** |
| **跳转** |用 `navigateTo` / `reLaunch` 跳到 tabBar 页 | **直接失败**（微信限制：tabBar 页只能 `switchTab`） | 既有死链检查**只验「目标文件存在」、不验跳转方式** ⇒ 把某页改成 tabBar 页后，全部原有跳转运维静默失效 |

**这是 R199 交付时自己写下的「明确未落」第2 条**，本轮兑现。

## 二、判据结构（16 断言，四段）

| 段 | 内容 | 防的是 |
|---|---|---|
| **S 扫描面非退化** | S1 `pages` ≥20 · S2 `tabBar` 结构在场 · S3 `list` ≥2 · S4 `pages/**/*.js` ≥20 | **扫空 ⇒ 恒绿**（R182「上限类判据」同族） |
| **A 结构合法性** | A1 list≥2 · A2 每个 `pagePath ∈ pages` · A3 `text` 非空 · A4 四个图标文件都在盘 · A5 路径不重复 · A6 ≤5 上限 | 结构层静默失效 |
| **B 跳转方式（核心）** | B1 tabBar 页不得被 `navigateTo`/`reLaunch`/`redirectTo` 跳 · B2 `switchTab` 目标须是 tabBar 页 · B3 每 tab 至少一处 `switchTab` 入口 | **把某页改成 tabBar 页后原有跳转运维静默失效** |
| **C 自反锚点** | C1 首页与「我的」在 `list` 内（关键锚点）· C2 上限常量 5 ≤ 微信硬上限 5 | 「改阈值以绕过」类削弱变异自红（§12.3） |

> 🔴 **B 段特意做了双向**（§13.2）：B1 管「非 switchTab 不许跳 tab 页」，
> B2 管「switchTab 不许跳非 tab 页」—— 只写前者的话，把 `switchTab` 拿来跳普通页这类错没人报。

## 三、变异回灌（10 条，技能 `mutation-backfill`）

```
基线绿 OK（16 通过 / 0 失败）
A1  用 navigateTo 跳 tabBar 页（R199 前的旧写法）      ✅ 有效红（点名 B1）
A2  用 reLaunch 跳 tabBar 页（「我的」页登出回首页）  ✅ 有效红（点名 B1）
A3  图标文件不在盘（打包漏了 images/tab）             ✅ 有效红（点名 A4）
A4  selectedIconPath 缺失（选中态不显示图标）         ✅ 有效红（点名 A4）
A5  tabBar 只剩 2 项（≥2 临界值）                    ✅ 不误报   ← 组 B
A5b tabBar.list 写坏（残留尾项致 JSON 非法）         ✅ 有效红（点名 S0）
A6  tabBar 路径重复（两个 tab 指同一页）              ✅ 有效红（点名 A5）
A7  text 为空（tab 只有图标没字）                    ✅ 有效红（点名 A3）
B1  跳非 tabBar 页（带 query 参数）                  ✅ 不误报   ← 组 B
B2  tabBar 外页面加一行注释（纯无害改动）            ✅ 不误报   ← 组 B
还原后 失败数=0 crash=False ；还原字节 ≡ 注入前 True
```

**判据口径**：组 A 必须**点名到目标断言**（坑6：噪音红不算数）；
组 B 必须**不出现**目标断言（证明不是见字就红）。

## 四、🔴 回灌真的抓出了两个问题（都不是被测代码错）

### 4.1 两条变异是**无效红（崩溃红）**⇒ 逼出守卫一个真缺陷

A5 / A5b 首版都写成「把 `list` 删成 `]`」⇒ **JSON 直接非法** ⇒
守卫走的是 `console.error + process.exit(1)`，**既无汇总行也无失败项**
⇒ 回灌判据只能记成「崩溃红（无效）」，**查不出真因**。

**修法**（R66 形态要求：段标题下必须有断言 + 末尾必须有汇总行）：
配置非法 / 文件缺失两条早退路径**全部改走标准输出**：

```
===== R200 · 底部 tabBar 守卫 =====
❌ S0 app.json 解析失败（配置非法，判据无法运行）：<message>
===== R200 · 底部 tabBar 守卫：0 通过 / 1 失败 =====
```

⇒ 修完 A5b 立刻从「崩溃红（无效）」变成「**有效红且点名 S0**」。
🔴 **通用律：守卫的任何退出路径都必须打出汇总行** ——
否则「配置写坏了」这种最常见的真实故障，恰恰是判据最说不清的时候。

### 4.2 变异体本身写错（技能坑 14：变异太弱/太强与守卫太弱长得一样）

A2 首版把锚点打在 `pages/index/index.js`（但 `reLaunch` 那行在 `pages/mine/index.js`）
⇒ **锚点命中 0**；B2 首版拿 `app.json` 里出现 2 次的 `"pages/m3/hub",` 当锚点
⇒ **命中 2次**。两者都被「锚点必须恰为 1」这条 fail-closed 拦下，**一个字节都没写**。

### 4.3 行尾是混的（本仓特征，技能「附带坑」）

`app.json` / `pages/index/index.js` 是 **CRLF**，而 `pages/mine/index.js` 是 **LF**
⇒ 锚点写死任一种都会有一半命中 0。
✅ 脚本按**目标文件自身行尾**运行时替换（`eol_of()`），`--dry` 预检逐条打印命中数与 eol，**10/10 命中才正式跑**。

### 4.4 还原用字节而非文本（技能坑 15）

备份 `read_bytes()` / 还原 `write_bytes()`，绝不经过文本换行翻译
⇒ 还原后 `git status --porcelain` 对三个被变异文件**零残留 `M`**，
`md5sum` 与注入前逐字节相同（`app.json` = `65d84352…`）。

## 五、六处同步面（技能 `gate-suite-checklist`）

| # | 位置 | 改了什么 |
|---|---|---|
| 1 | `verify_all.js::SUITES` **末尾** | 追加 `['tabbar', 'tools/check_tabbar.js']`（R92 对序号有依赖，只许追加末尾） |
| 2 | `verify_all.js` 头注「串联」 | 127 → **128** |
| 3 | `verify_all.js` 头注注释块 | 补R200 根因与判据段（人读面不能撒谎） |
| 4 | 重启键 §1.1 一键校验入口行 | 串 **128** 个套件 + 追加守卫一句话说明 |
| 5 | 重启键「套件数会漂」行| 「现 **128**；」+ **演进链尾部追加 `→ 128（R200：…）`**（技能标注「最容易漏的一处」） |
| 6 | 重启键 §1.1 断言数声明行 | 追加 `` `check_tabbar`=16 ``，计数 **四十二者 → 四十三者** |
| 7（按需） | `tools/check_suite_assert_counts.js::CASES` | 追加 `{ key: 'check_tabbar', rel: 'tools/check_tabbar.js' }`（**下划线形**，§15.4：连字符会被解析正则裂解） |

**顺手修掉一处过期陈述**：重启键 round48 那条静态自检记录写着
「**零 `switchTab`**（app.json 未配 tabBar，若有 switchTab 必运行时失败）」
—— 这是 round48 **当时的实然**，R199 已推翻它。
🔴 按技能 §15.3「改一处 ≠ 改完」：那是**历史轮次记录**（不该改写历史事实），
但必须加括注标明已变，否则后人照它去判断会得出错误结论。

## 六、门禁判据与通道

```bash
PY="C:/Users/lzj/.workbuddy/binaries/python/versions/3.13.12/python.exe"
out=$(NODE_OPTIONS="--require .../review/evidence/r194_gate/gitcache_preload.js" \
      "$PY" review/evidence/r194_gate/run_gate3.py 2>&1); rc=$?
```

- 🔴 漏传 `NODE_OPTIONS` ⇒ 9 个套件假红。
- 🔴 每次 `git add -A` 之后必须按序跑 `mk_git_keys.py` → `mk_force.py` → `mk_fix_py_keys.py`（③ 漏了则 `check_docx_derive` 单套件红）。
- 本轮节点：源码改完 128/128（205.7s）→ 回灌修守卫 → 文档入库后复跑 128/128（131.4s，索引 3263）。
