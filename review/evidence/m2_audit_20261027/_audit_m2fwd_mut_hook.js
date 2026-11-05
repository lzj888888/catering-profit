// _audit_m2fwd_mut_hook.js —— 只读取证：变异测试注入钩子（**不改磁盘上的任何文件**）。
// 用法：node -r ./_audit_m2fwd_mut_hook.js tools/check_xxx.js
//   环境变量：MUT_FILE=目标文件绝对路径片段  MUT_FROM=原串  MUT_TO=替换串
// 钩子只改**进程内读到的内容**（fs.readFileSync 返回串 + require 编译的源码），磁盘零改动。
const fs = require('fs');
const path = require('path');
const Module = require('module');

const FILE = process.env.MUT_FILE || '';
const FROM = process.env.MUT_FROM || '';
const TO = process.env.MUT_TO || '';

function apply(src) {
  if (!FILE || !FROM) return src;
  if (typeof src !== 'string') return src;
  return src.split(FROM).join(TO);
}
function hit(p) {
  return FILE && String(p).indexOf(FILE) >= 0;
}

let applied = 0;
const origRead = fs.readFileSync;
fs.readFileSync = function (p, enc) {
  const out = origRead.apply(fs, arguments);
  if (hit(p) && (enc === 'utf8' || enc === 'utf-8' || arguments.length === 1)) {
    if (typeof out === 'string' && out.indexOf(FROM) >= 0) { applied++; return apply(out); }
  }
  return out;
};

const origJs = Module._extensions['.js'];
Module._extensions['.js'] = function (module, filename) {
  if (hit(filename)) {
    const raw = origRead(filename, 'utf8');
    if (typeof raw === 'string' && raw.indexOf(FROM) >= 0) {
      applied++;
      const mutated = apply(raw);
      module._compile(mutated, filename);
      return;
    }
  }
  return origJs(module, filename);
};

process.on('exit', () => {
  if (process.env.MUT_VERBOSE) {
    process.stderr.write('[mut] 注入次数=' + applied + ' 目标=' + FILE + '\n');
  }
});
