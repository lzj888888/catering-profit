R238 证据目录 —— 导入成功后的下游引导（入口说明 + 跳转去向）
================================================================

一、本目录内容
-------------
  gate_full.txt                 门禁全量输出（python 驱动 + gitcache）
                                ⚠️ 判据只认其中的「总览：N/N 套件通过」行 + 失败清单
  per_suite/*.out               153 个套件各自的原始输出
  run_gate9.py                  门禁驱动（每套件一个独立 python 进程）
  rebuild_cache.py              缓存**全量**重建（改过套件时用）
  refresh_cache_keys.py         🔴 缓存**增量**刷新（本轮新增，见下方「三」）
  git_status_before_gate.txt    门禁前工作区状态（证明门禁跑的是哪份代码）
  mut_backfill.py               变异回灌脚本（组 A 必须红 / 组 B 不得红）
  mut_backfill.out.txt          变异回灌输出
  mut_backup/*.bak              变异前的源码备份（逐条可还原）
  assert_counts_bare_node.txt   裸 node 形态的调试输出（⚠️ **不是判据**，见其文件头注）
  gitcache_rebuilt.json         缓存存档副本（派生物，已在 .gitignore 排除）

二、判据
--------
  门禁合格 = `gate_full.txt` 的「总览：N/N 套件通过」中 N == 总数，且**无失败清单**。

三、🔴 本轮实测的新坑：改过套件后**必须刷 gitcache**（此前只当"提交后动作"，实为**门禁前置**）
------------------------------------------------------------------------
  现象：单独跑 `node tools/check_modal_button_len.js` ⇒ **15/0 绿**；
        但门禁里 `check_suite_assert_counts` 报
        「A0-check_modal_button_len 实跑失败 rc≠0」+「A2 声明 15 ≠ 实跑 undefined」。
  根因：`check_suite_assert_counts` 的「实跑」一步靠 spawn 各套件取通过数；
        在沙箱里该 spawn 由 `gitcache_preload.js` 接管，**返回磁盘缓存里的结果**。
        缓存是**上一时刻**的快照 —— 改了套件却没刷缓存 ⇒ 拿到**过期结果** ⇒ **假红**。
  正解：刷缓存（**不是**改判据、**不是**改业务代码去迎合）。
        · 全量：`rebuild_cache.py`（本轮实测 18 分钟，多数时间花在与改动无关的键上）
        · 增量：`refresh_cache_keys.py`（只刷本轮真正变过的键，秒级；语义与全量脚本逐字一致）
  证据：刷新后 `check_modal_button_len` rc 1→0、`check_suite_assert_counts` rc 1→0，
        缓存 rc≠0 **归零**；重跑门禁即全绿。
  纪律：**凡改 `tools/**` 下的套件，跑门禁前先刷 gitcache**。

四、本轮改动一览（详见 review/NOTE_2026-10-08_round238_*.md）
-----------------------------------------------------------
  · pages/takeaway/index.js     成功分支 showToast → showModal + navigateTo（下游引导）
  · miniprogram/i18n/terms.js   importPickHint 22→33 字 + 新增 3 键（双副本，md5 一致）
  · specs/dev-specs/i18n/terms.js
  · tools/check_shape_machine_value.js   新增 E 组 6 条（断言 12→18）
  · tools/check_modal_button_len.js      新增页面局部别名 PAGE_ALIAS + C-⑥（断言 14→15）
  · tools/check_suite_assert_counts.js   声明同步
  · specs/dev-specs/★知识存储点_2026-09-10.md   声明同步（唯一声明处）
