// miniprogram/config/env.js
// 复审节点①·点4：wx.cloud.init 只允许从本文件取值（core/06 §1.3.1 铁律）。
// ❌ 禁止在业务代码硬编码环境 ID 字面量（如 'catering-dev' / 'catering-prod'）。
//
// 真实环境 ID 在「建 dev / prod 双环境」后，由云开发控制台获取并替换下方占位符：
//   dev  → 形如 catering-dev-xxxxxx（控制台给出的真实环境 ID，非短名）
//   prod → 形如 catering-prod-xxxxxx
// ❌ 严禁照抄规范示例里的短名 'catering-dev' / 'catering-prod'：
//    wx.cloud.init 传别名可能解析不到真实环境，导致所有云调用失败。
// 占位符 'catering-dev-xxxxxxxx' / 'catering-prod-xxxxxxxx' 仅为结构占位，上线前必须替换。

module.exports = {
  ENV_MAP: {
    dev: 'catering-dev-xxxxxxxx',   // TODO(用户): 替换为控制台真实环境 ID（catering-dev-xxxxxx）
    prod: 'catering-prod-xxxxxxxx', // TODO(用户): 替换为控制台真实环境 ID（catering-prod-xxxxxx）
  },

  // 当前激活环境：开发期 'dev'；发布切 'prod'。
  ACTIVE_ENV: 'dev',

  /**
   * 取当前环境 ID。小程序端可结合 wx.getAccountInfoSync().miniProgram.envVersion 自动判定 dev/prod。
   * 云函数内一律用 cloud.DYNAMIC_CURRENT_ENV，不引用任何环境 ID 常量（core/06 §1.3.1）。
   */
  getEnv() {
    return this.ENV_MAP[this.ACTIVE_ENV] || this.ENV_MAP.dev;
  },
};
