#!/usr/bin/env node
/**
 * R298 · B2 补漏：全命中点键位生成器（与新版守卫同口径）
 *
 * 形态三桶（互斥）：
 *   IDENT   = `<标识符> * 100`
 *   PAREN   = `) * 100`
 *   LITERAL = `<数字字面量> * 100`
 * 🔴 本轮实证：只做 IDENT+PAREN 会漏掉 `448 * 100`（字面量元→分）⇒ 78 处只看到 77 处。
 *    故本生成器额外用 `\*\s*100` 总数对账，三桶不穷尽 ⇒ 打印告警（该告警已写进守卫判据）。
 *
 * 键 = `<相对路径>|<形态>|<归一化匹配文本>|#<同键序号>`
 *   · 归一化 = 空白折叠成单空格（排版改动不触发重登记）
 *   · #N = 同文件同键按位置序（结构增删会移位 ⇒ fail-closed 要求重登记）
 *   · 键**不含行号**（行号随无关编辑漂移）；定位靠守卫失败时回显 live 行号
 *
 * 运行：node review/evidence/r298_b2_money/scan_all.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SKIP_DIRS = ['node_modules', 'miniprogram_npm', '.git', '.workbuddy', '_probe_tmp',
  'prototype', 'review', 'specs', 'tools'];

function walkJs(dir, out) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (SKIP_DIRS.indexOf(e.name) >= 0) continue; walkJs(p, out); }
    else if (e.name.endsWith('.js') && e.name.indexOf('cx_') !== 0) out.push(p);
  }
  return out;
}
function stripComments(src) {
  const s = String(src);
  const noBlock = s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return noBlock.split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l)).join('\n');
}
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const FORMS = [
  ['IDENT', /([A-Za-z_$][A-Za-z0-9_$.]*)\s*\*\s*100(?!\d)/g],
  ['PAREN', /\)\s*\*\s*100(?!\d)/g],
  ['LITERAL', /(\d+(?:\.\d+)?)\s*\*\s*100(?!\d)/g],
];
const RE_ANY = /\*\s*100(?!\d)/g;

const files = walkJs(ROOT, []);
let totalAny = 0;
let covered = 0;
const mismatched = [];
const rows = [];

for (const f of files) {
  let src = '';
  try { src = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  const code = stripComments(src);
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const found = [];
  for (const [form, re] of FORMS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code)) !== null) found.push({ pos: m.index, form, expr: norm(m[0]), at: m.index });
  }
  found.sort((a, b) => a.pos - b.pos);
  RE_ANY.lastIndex = 0;
  let na = 0;
  let m2;
  while ((m2 = RE_ANY.exec(code)) !== null) na++;
  totalAny += na;
  covered += found.length;
  if (na !== found.length) mismatched.push(rel + '(any=' + na + ',三桶=' + found.length + ')');

  const seen = {};
  for (const h of found) {
    const base = rel + '|' + h.form + '|' + h.expr;
    seen[base] = (seen[base] || 0) + 1;
    // 该命中所在行（live，仅供人工登记时定位）
    const line = code.slice(0, h.pos).split('\n').length;
    const end = code.indexOf('\n', h.pos);
    const text = norm(code.slice(code.lastIndexOf('\n', h.pos - 1) + 1, end < 0 ? undefined : end));
    rows.push({ key: base + '|#' + seen[base], rel, line, text });
  }
}

console.log('/* 扫描面 = ' + files.length + ' 个 .js');
console.log('   `* 100` 出现总数 = ' + totalAny + ' ；三桶覆盖 = ' + covered + ' ；未归入 = ' + (totalAny - covered)); 
if (mismatched.length) console.log('   ⚠️ 未被三桶穷尽的文件：' + mismatched.join(' ; '));
console.log('*/');
console.log('/* 键位总数 = ' + rows.length + ' */');
rows.forEach((r) => console.log('  ' + r.key + '\n      L' + r.line + '  ' + r.text.slice(0, 150)));
