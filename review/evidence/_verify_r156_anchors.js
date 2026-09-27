// _verify_r156_anchors.js —— R156 改动面「应有锚点」全量核对
// 起因：本轮我犯了一个错 —— 把**同一个文件的两个 Edit 并行**发出，后者整体覆盖前者，
//   表现为「Edit 返回成功、文件却只落了一处」。语法校验查不出来（少一段代码语法仍合法）。
//   本脚本把"应该存在的每一段"逐条点出来，命中数必须恰为 1。
const fs = require('fs');
const ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit/';

const SPEC = {
  'pages/card/index.js': [
    ['置顶 state 初始化', 'pinned: [],'],
    ['置顶文案注入', 'pinOn: TERMS.card.pinOn,'],
    ['load 读店铺置顶', 'pinned = Array.isArray(sc.pinned_cards) ? sc.pinned_cards : [];'],
    ['list 映射带排序键', 'updated_at: Number(c.updated_at) || 0,'],
    ['load 回写 pinned', 'this.setData({ all, categoryOptions, tagOptions, pinned, loading: false });'],
    ['applyFilter 打标记', 'const marked = list.map((c) => Object.assign({}, c, { pinned: pins.indexOf(c.card_code) >= 0 }));'],
    ['applyFilter 调排序', 'this.setData({ list: this.sortList(marked) });'],
    ['sortList 定义', 'sortList(list) {'],
    ['onPin 定义', 'async onPin(e) {'],
    ['onPin 写库', "await api.call('saveShopSetting', { pinned_cards: pins, client_request_id: 'pc_' + Date.now() });"],
    ['onPin 失败回滚', 'this.setData({ pinned: backup });'],
  ],
  'pages/card/index.wxml': [
    ['置顶标记', 'class="tag tag-pin" wx:if="{{item.pinned}}"'],
    ['置顶按钮', 'catchtap="onPin" data-code="{{item.card_code}}"'],
  ],
  'pages/card/index.wxss': [['置顶标记样式', '.tag-pin {']],

  'pages/material/index.js': [
    ['置顶 state 初始化', 'pinned: [],'],
    ['置顶文案注入', 'pinOn: TERMS.card.pinOn,'],
    ['load 读店铺置顶', 'pinned = Array.isArray(sc.pinned_materials) ? sc.pinned_materials : [];'],
    ['list 映射带排序键', 'updated_at: Number(m.updated_at) || 0,'],
    ['load 回写 pinned', 'this.setData({ all, catOptions, pinned, loading: false });'],
    ['applyFilter 打标记', 'const marked = list.map((m) => Object.assign({}, m, { pinned: pins.indexOf(m.id) >= 0 }));'],
    ['sortList 定义', 'sortList(list) {'],
    ['onPin 定义', 'async onPin(e) {'],
    ['onPin 写库', "await api.call('saveShopSetting', { pinned_materials: pins, client_request_id: 'pm_' + Date.now() });"],
  ],
  'pages/material/index.wxml': [
    ['置顶标记', 'class="tag tag-pin" wx:if="{{item.pinned}}"'],
    ['置顶按钮', 'data-id="{{item.id}}" catchtap="onPin"'],
  ],
  'pages/material/index.wxss': [['置顶标记样式', '.tag-pin {']],

  'pages/card/edit.js': [
    ['进入时刻哨兵', 'this._loadedAt = Date.now();'],
    ['onShow 消费回传', 'onShow() {'],
    ['回传哨兵判定', 'if (this._loadedAt && p.at < this._loadedAt) return;'],
    ['挂起机制', 'else this._pendingPick = p;'],
    ['选原料跳转', 'goPickMaterial(e) {'],
    ['独立选择页 URL', "wx.navigateTo({ url: '/pages/material/pick?idx=' + idx });"],
    ['按 id 填行', 'applyPickedMaterial(idx, materialId) {'],
    ['load 末尾补做', 'this.applyPickedMaterial(Number(p.idx), p.id);'],
    ['规格行工厂', 'function freshSpecRows() {'],
    ['data 用工厂', 'specRows: freshSpecRows(),'],
    ['横幅 state', "savedName: '',"],
    ['防连击 state', 'saving: false,'],
    ['编辑态判定', 'const wasEdit = this.data.isEdit;'],
    ['新增态走连续录入', 'this.afterSaved(card.name);'],
    ['编辑态回列表', 'setTimeout(() => wx.navigateBack(), 600);'],
    ['afterSaved 定义', 'afterSaved(name) {'],
    ['重置 card_code（防覆盖）', "card_code: '',"],
    ['返回列表出口', 'backToList() { wx.navigateBack(); },'],
    ['横幅文案注入', 'savedOk: TERMS.card.savedOk,'],
  ],
  'pages/card/edit.wxml': [
    ['选原料改跳转', 'bindtap="goPickMaterial"'],
    ['原生 picker 已换掉（注释在位）', '原生 `<picker>`（只能滚）→ **独立选择页**'],
    ['横幅', 'class="saved-bar" wx:if="{{savedName}}"'],
    ['返回出口', 'bindtap="backToList"'],
  ],
  'pages/card/edit.wxss': [['横幅样式', '.saved-bar {']],

  'pages/material/edit.js': [
    ['横幅 state', "savedName: '',"],
    ['防连击 state', 'saving: false,'],
    ['编辑态判定', 'const wasEdit = this.data.isEdit;'],
    ['新增态走连续录入', 'this.afterSaved(material.name);'],
    ['afterSaved 定义', 'afterSaved(name) {'],
    ['重置 id（防覆盖）', "id: '',"],
    ['单位回默认', 'purchase_unit: TERMS.card.matUnitDefault,'],
    ['换算提示重算', '}, () => this.refreshUnitHint());'],
    ['返回列表出口', 'backToList() { wx.navigateBack(); },'],
    ['横幅文案注入', 'savedOk: TERMS.card.savedOk,'],
  ],
  'pages/material/edit.wxml': [['横幅', 'class="saved-bar" wx:if="{{savedName}}"']],
  'pages/material/edit.wxss': [['横幅样式', '.saved-bar {']],

  'cloudfunctions/getCostCard/service.js': [['排序键出参', 'updated_at: doc.updated_at != null']],
  'cloudfunctions/getCardVersions/service.js': [['排序键出参（跨函数同口径）', 'updated_at: doc.updated_at != null']],
  'cloudfunctions/getMaterial/service.js': [['排序键出参', 'updated_at: doc.updated_at != null']],
  'cloudfunctions/saveShopSetting/validate.js': [
    ['置顶校验器', 'function normPinList(v, field)'],
    ['置顶上限', 'const PIN_LIMIT = 50;'],
    ['两个置顶键出参', 'pinned_cards: pc.value, pinned_materials: pm.value,'],
  ],
  'cloudfunctions/saveShopSetting/index.js': [
    ['写 pinned_cards', 'if (v.pinned_cards !== undefined) patch.pinned_cards = v.pinned_cards;'],
    ['写 pinned_materials', 'if (v.pinned_materials !== undefined) patch.pinned_materials = v.pinned_materials;'],
    ['回读 pinned_cards', 'pinned_cards: v.pinned_cards !== undefined ? v.pinned_cards'],
    ['回读 pinned_materials', 'pinned_materials: v.pinned_materials !== undefined ? v.pinned_materials'],
  ],
  'cloudfunctions/getShopContext/index.js': [
    ['下发 pinned_cards', 'pinned_cards: Array.isArray(shop.pinned_cards) ? shop.pinned_cards : [],'],
    ['下发 pinned_materials', 'pinned_materials: Array.isArray(shop.pinned_materials) ? shop.pinned_materials : [],'],
  ],
  'app.json': [['注册选择页', '"pages/material/pick",']],
  'pages/material/pick.js': [['置顶组读出', 'pinned = Array.isArray(sc.pinned_materials) ? sc.pinned_materials : [];']],
  'specs/dev-specs/上线材料_提审材料包_v1.md': [
    ['页面数标题', '## 四、功能页面清单（18 页'],
    ['页面全集口径', '共登记 **18** 个页面'],
    ['登记行', '| 15 | `pages/material/pick` |'],
  ],
  'tools/selftest_r85.js': [['A15 白名单登记', '/^cloudfunctions\\/getShopContext\\//,']],
};

let missing = 0, dup = 0, total = 0;
for (const f of Object.keys(SPEC)) {
  const p = ROOT + f;
  if (!fs.existsSync(p)) { console.log('!! 文件不存在: ' + f); missing++; continue; }
  const s = fs.readFileSync(p, 'utf8');
  for (const [label, needle] of SPEC[f]) {
    total++;
    const n = s.split(needle).length - 1;
    if (n === 0) { missing++; console.log('缺  ' + f + '  「' + label + '」  找不到: ' + needle.slice(0, 56)); }
    else if (n > 1) { dup++; console.log('重  ' + f + '  「' + label + '」  命中 ' + n + ' 次: ' + needle.slice(0, 56)); }
  }
  // 选择页哨兵：文件存在即证明（pick.js 里没有字面 marker，用文件存在性代替）
}
console.log('');
console.log('共核对 ' + total + ' 条锚点：缺失 ' + missing + ' / 重复 ' + dup);
process.exitCode = (missing || dup) ? 1 : 0;
