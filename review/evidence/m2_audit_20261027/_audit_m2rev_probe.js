'use strict';
const path=require('path');const ROOT=__dirname;
const TOASTS=[];
global.wx={getSystemInfoSync:()=>({windowWidth:375}),showToast:o=>TOASTS.push(o.title),showModal:()=>{},navigateTo:()=>{},navigateBack:()=>{},cloud:{callFunction:async()=>{throw new Error('x')}}};
let PAGE=null;global.Page=o=>{PAGE=o};global.getApp=()=>({globalData:{shop_id:'a'}});
const api=require(path.join(ROOT,'utils','api.js'));
const svc=require(path.join(ROOT,'cloudfunctions','calcSandbox','service.js'));
const val=require(path.join(ROOT,'cloudfunctions','calcSandbox','validate.js'));
let LAST=[];
api.call=async(n,p)=>{const arr=p.clean_array||[];const rejected=[];const rows=arr.map((c,i)=>{const v=val.validateClean(c&&typeof c==='object'?c:{});if(v.error){rejected.push({index:i,code:v.error,msg:v.msg});return null;}LAST.push(svc.calcSandbox(v.clean));return svc.calcSandbox(v.clean);});if(rejected.length===arr.length)throw Object.assign(new Error('all'),{code:rejected[0].code});return {rows,rejected};};
api.toastError=e=>TOASTS.push('ERR');
require(path.join(ROOT,'subpkg','tools','sandbox','matrix.js'));
function np(){const i=Object.create(PAGE);i.data=JSON.parse(JSON.stringify(PAGE.data));i.setData=function(p,cb){for(const k in p){const ks=k.split('.');let o=this.data;for(let j=0;j<ks.length-1;j++)o=o[ks[j]];o[ks[ks.length-1]]=p[k];}if(cb)cb();};return i;}
(async()=>{
  // P1: buildSumOf 是否退化成硬编码 fallback
  const p=np();p.onLoad({mode:'reverse'});
  p.setData({presetIdx:1,cityIdx:2,global:Object.assign({},p.data.global,{area:40,buildDecorYuan:'50000',buildDecorYears:3,buildEquipYuan:'80000',buildEquipYears:5})});
  console.log('global.buildDecorYuan =',p.data.global.buildDecorYuan,'| buildItems =',JSON.stringify(p.buildItems()));
  console.log('buildSumOf() =',JSON.stringify(p.buildSumOf()));
  console.log('terms 里的写法     =',JSON.stringify(require(path.join(ROOT,'miniprogram','i18n','terms.js')).TERMS.matrix.buildSumText));
  console.log('data.t 里有没有 buildSumText 键 =', ('buildSumText' in p.data.t));

  // P2: 现金卡是否忽略老板填的装修
  p.setData({cash:Object.assign({},p.data.cash,{rentYuan:3000,budgetYuan:300000,equipYuan:80000,stockYuan:10000})});
  await p.onGenerate();
  console.log('\n现金卡 partsText =',p.data.cashRes.partsText);
  console.log('（页面上方老板填的装修 = 5 万；现金卡里的装修应该也是 5 万才是同一笔钱）');
  console.log('设备重复输入：老板在「开店要投多少」填 equip=80000，还得在现金卡再填一次 equipYuan');

  // P3: 引擎已算出的「房租占比」指标是否被页面消费
  LAST=[];
  const p2=np();p2.onLoad({mode:'reverse'});
  p2.setData({presetIdx:1,cityIdx:0,dims:{rent:[28000],labor:[2],margin:[55],target:[0,10000]},global:Object.assign({},p2.data.global,{area:40})});
  await p2.onGenerate();
  const r=LAST[0];
  console.log('\n=== 引擎出参里自带的房租占比/指标（matrix 页是否消费？）===');
  console.log('indicators_at_target =',JSON.stringify(r.indicators_at_target,null,1));
  console.log('matrix.js 里是否出现 indicators_at_* =', /indicators_at_/.test(require('fs').readFileSync(path.join(ROOT,'subpkg','tools','sandbox','matrix.js'),'utf8')));
  console.log('matrix.wxml 里是否出现 indicators_at_* =', /indicators_at_/.test(require('fs').readFileSync(path.join(ROOT,'subpkg','tools','sandbox','matrix.wxml'),'utf8')));
  console.log('结论卡 =',JSON.stringify(p2.data.result.insight));
  console.log('房租占比（页面自算 rent/targetMonthly）=',p2.data.result.rows[0].rentPct,'%（无任何阈值判定）');
})();
