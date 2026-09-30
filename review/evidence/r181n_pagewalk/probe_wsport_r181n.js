// _r181n_wsprobe.js —— 逐个端口试 WebSocket 升级，只有自动化服务会 OPEN
const ports = [9431, 9432, 9420, 9421, 9422, 39721];
(async () => {
  for (const p of ports) {
    await new Promise((res) => {
      let done = false;
      const finish = (msg) => { if (!done) { done = true; console.log(p, msg); res(); } };
      try {
        const w = new WebSocket('ws://127.0.0.1:' + p);
        w.onopen = () => { finish('OPEN'); try { w.close(); } catch (e) {} };
        w.onerror = () => finish('ERR');
        setTimeout(() => finish('TIMEOUT'), 2500);
      } catch (e) { finish('THROW ' + e.message); }
    });
  }
  console.log('done');
})();
