// miniprogram/config/env.js
// 复审节点①·点4：wx.cloud.init 只允许从本文件取值（core/06 §1.3.1 铁律）。
// ❌ 禁止在业务代码硬编码环境 ID 字面量（如 'catering-dev' / 'catering-prod'）。
//
// 真实环境 ID 在「建 dev / prod 双环境」后，由云开发控制台获取并替换下方占位符：
//   dev  → 形如 catering-dev-xxxxxx（控制台给出的真实环境 ID，非短名）
//   prod → 形如 catering-prod-xxxxxx
// 注：dev 也可以是微信侧默认免费环境（ID 形如 cloud1-xxxxxx，名字不含 "dev" 字样）。
//     这种环境下云函数 initDb 走「DEV_ENV_ID 精确白名单」放行（见 initDb/collections.js 的 gate）。
// ❌ 严禁照抄规范示例里的短名 'catering-dev' / 'catering-prod'：
//    wx.cloud.init 传别名可能解析不到真实环境，导致所有云调用失败。
// 占位符 'catering-dev-xxxxxxxx' / 'catering-prod-xxxxxxxx' 仅为结构占位，上线前必须替换。
//
// 2026-09-19 加固（占位符静默回落缺口）：
//   此前 getEnv() 对「ACTIVE_ENV 指向的环境 ID 仍是占位符」没有任何防护 —— 一旦有人把
//   ACTIVE_ENV 切成 'prod' 而真实 prod 环境尚未建/ID 未填，getEnv() 会把
//   'catering-prod-xxxxxxxx' 这个不存在的环境 ID 交给 wx.cloud.init ⇒ 全站云调用失败且无告警。
//   现改为：识别占位符 ⇒ 回落 dev + console.error 醒目告警（不静默、不白屏），并提供
//   envStatus() 供启动自检与守卫读取。守卫：tools/check_env_ready.js（第 66 套件）。

module.exports = {
  ENV_MAP: {
    dev: 'cloud1-d4gphpoxy337f2a25', // 真实 dev 环境 ID（微信侧免费环境，控制台短名 cloud1；2026-09-14 定）
    prod: 'catering-prod-xxxxxxxx', // TODO(用户): 替换为控制台真实环境 ID（catering-prod-xxxxxx）
  },

  // 当前激活环境：开发期 'dev'；发布切 'prod'。
  ACTIVE_ENV: 'dev',

  // 占位符特征：环境 ID 未替换时的形态（含 xxxxxxxx，或为空/非字符串）。
  PLACEHOLDER_RE: /xxxxxxxx|^\s*$/,

  /**
   * 判断一个环境 ID 是否仍是「未配置」占位符。
   * fail-closed：无法判定（非字符串/空）一律视为占位符。
   */
  isPlaceholder(id) {
    return typeof id !== 'string' || this.PLACEHOLDER_RE.test(id);
  },

  /**
   * 取当前环境 ID。小程序端可结合 wx.getAccountInfoSync().miniProgram.envVersion 自动判定 dev/prod（发布前需填入真实 prod ID）。
   * - 目标环境已配置 ⇒ 原样返回（行为与此前一致）；
   * - 目标环境仍是占位符 ⇒ **回落 dev 并 console.error 告警**（绝不静默把占位符交给 wx.cloud.init）。
   * 云函数内一律用 cloud.DYNAMIC_CURRENT_ENV，不引用任何环境 ID 常量（core/06 §1.3.1）。
   */
  getEnv() {
    const active = this.ACTIVE_ENV;
    const id = this.ENV_MAP[active];
    if (!this.isPlaceholder(id)) return id;
    console.error(
      '[ENV_FALLBACK] ACTIVE_ENV=' + active + ' 的环境 ID 尚未配置（占位符/缺失），已回落 dev。' +
      '上线前必须在控制台建 prod 环境并把 ENV_MAP.prod 换成真实环境 ID，否则生产数据会写入开发库。'
    );
    return this.ENV_MAP.dev;
  },

  /**
   * 环境就绪状态（供启动自检 / 守卫 / 排查使用，不影响运行时行为）。
   * @returns {{active:string, envId:string, isPlaceholder:boolean, fellBack:boolean, devReady:boolean}}
   */
  envStatus() {
    const active = this.ACTIVE_ENV;
    const raw = this.ENV_MAP[active];
    const ph = this.isPlaceholder(raw);
    return {
      active,
      envId: ph ? this.ENV_MAP.dev : raw,
      isPlaceholder: ph,
      fellBack: ph,
      devReady: !this.isPlaceholder(this.ENV_MAP.dev),
    };
  },
};
