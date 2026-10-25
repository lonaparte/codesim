const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const { createRequire } = require('node:module');
const root = path.resolve(process.env.SOURCE_ROOT || '.');
const req = createRequire(path.join(root, 'frontend/package.json'));
const { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } = req('@vscode/test-electron');
const { chromium } = require('playwright-core');
const output = path.resolve('results');
fs.mkdirSync(output, {recursive: true});
const result = {sha: cp.execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding:'utf8'}).trim(), checks: [], errors: []};
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 120000) { const end = Date.now()+timeout; let error; while (Date.now()<end) {try {const v=await fn(); if(v)return v;}catch(e){error=e;} await wait(300);} throw Error('Timeout: '+(error?.message||fn.toString())); }
async function command(name) {const r=await fetch('http://127.0.0.1:9333/'+name); if(!r.ok)throw Error(await r.text());return r.json().catch(()=>null);}
async function frameFor(page, selector) {return until(async()=>{for(const f of page.frames())if(await f.locator(selector).count())return f;});}
function check(name, pass, detail) {result.checks.push({name, pass:!!pass, detail});console.log('CHECK', JSON.stringify(result.checks.at(-1)));}
async function instrument(frame) {
  await frame.evaluate(()=>{
    window.qa={messages:[], counts:{}, chunks:0, samples:{}, final:null, longTasks:[], renders:0, firstChunk:null, firstPaint:null, started:null};
    new PerformanceObserver(list=>window.qa.longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask'});
    new MutationObserver(()=>{window.qa.renders++;if(window.qa.firstChunk!==null && window.qa.firstPaint===null && document.querySelector('.chart-line')?.getAttribute('points'))window.qa.firstPaint=performance.now();}).observe(document.body,{subtree:true,attributes:true,childList:true});
    window.addEventListener('message',e=>{
      const m=e.data;if(!m?.type)return;const q=window.qa;q.counts[m.type]=(q.counts[m.type]||0)+1;
      if(m.type==='simulation.started'){q.started=performance.now();q.samples={};q.chunks=0;q.firstChunk=null;q.firstPaint=null;q.renders=0;q.longTasks=[];q.final=null;}
      if(m.type==='simulation.chunk'){q.chunks++;q.firstChunk??=performance.now();for(const s of m.signals||[]){const x=q.samples[s.id]??={time:[],values:[]};x.time.push(...s.time);x.values.push(...s.values);}}
      if(m.type==='systemSnapshot'){q.lastSnapshot=m.snapshot;q.messages.push({type:m.type,reason:m.reason,bytes:JSON.stringify(m).length,signals:m.snapshot?.signals?.length});if(q.started!==null && m.snapshot?.signals?.length){const final=m.snapshot.signals;q.final={at:performance.now(),signals:final.length,points:final[0]?.time.length,streamEqualsFinal:final.every(s=>JSON.stringify(s.time)===JSON.stringify(q.samples[s.id]?.time)&&JSON.stringify(s.values)===JSON.stringify(q.samples[s.id]?.values))};}}
    });
  });
}
async function main() {
 const exe=await downloadAndUnzipVSCode('1.143.1');
 result.vscode='1.143.1';result.node=process.version;result.python=cp.execFileSync('python',['--version'],{encoding:'utf8'}).trim();
 const userData=path.resolve('.qa-user'), extensions=path.resolve('.qa-extensions');
 fs.mkdirSync(path.join(userData,'User'),{recursive:true});
 const python=cp.execFileSync('python',['-c','import sys;print(sys.executable)'],{encoding:'utf8'}).trim();
 fs.writeFileSync(path.join(userData,'User/settings.json'),JSON.stringify({'python.defaultInterpreterPath':python,'security.workspace.trust.enabled':false,'workbench.startupEditor':'none','telemetry.telemetryLevel':'off','workbench.sideBar.location':'left','window.zoomLevel':-1,'workbench.secondarySideBar.defaultVisibility':'hidden'}));
 const [cli,...cliArgs]=resolveCliArgsFromVSCodeExecutablePath(exe);
 cp.execFileSync(cli,[...cliArgs,'--no-sandbox','--user-data-dir',userData,'--extensions-dir',extensions,'--install-extension','ms-python.python'],{stdio:'inherit',timeout:240000});
 const host=runTests({vscodeExecutablePath:exe,extensionDevelopmentPath:path.join(root,'frontend'),extensionTestsPath:path.resolve(__dirname,'host.cjs'),launchArgs:[root,'--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--skip-welcome','--skip-release-notes','--disable-workspace-trust','--remote-debugging-port=9222','--user-data-dir',userData,'--extensions-dir',extensions]});
 host.catch(e=>result.errors.push('host: '+e.message));
 let browser,page;
 try {
  await until(()=>command('status'));
  browser=await chromium.connectOverCDP('http://127.0.0.1:9222');
  page=await until(()=>browser.contexts()[0].pages().find(p=>/workbench/.test(p.url())));
  page.on('pageerror',e=>result.errors.push(e.message));
  await page.setViewportSize({width:1800,height:1200});
  const viewer=await frameFor(page,'.toolbar-topology');await instrument(viewer);
  await viewer.getByRole('button',{name:'Start Python backend',exact:true}).click();
  await until(()=>viewer.locator('select[aria-label="System class"] option').count().then(n=>n>=9));
  check('real Python backend starts',true);
  await viewer.getByRole('combobox',{name:'System class'}).selectOption('VSGSMIBSystem');
  await until(()=>viewer.evaluate(()=>window.qa.lastSnapshot?.system?.className?.endsWith('.VSGSMIBSystem')));
  await command('closePanel');
  const node=viewer.locator('.react-flow__node').first();
  await node.scrollIntoViewIfNeeded();
  const before=await node.getAttribute('style');const box=await node.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+40,box.y+box.height/2+45,{steps:12});await page.mouse.up();
  await wait(300);const dragged=await node.getAttribute('style');check('topology drag changes position',before!==dragged,{before,dragged});
  const nodeId=await node.getAttribute('data-id');
  await command('signals');const signals=await frameFor(page,'.toolbar-signals');await instrument(signals);
  await wait(500);check('opening Signals preserves topology',await viewer.locator('.react-flow__node[data-id="'+nodeId+'"]').getAttribute('style')===dragged);
  const begin=Date.now();await signals.getByRole('button',{name:'Simulate',exact:true}).click();
  await until(()=>signals.evaluate(()=>window.qa.final!==null),240000);
  await until(()=>signals.getByRole('button',{name:'Simulate',exact:true}).isEnabled());await command('closePanel');await wait(700);
  result.simulation=await signals.evaluate(()=>({chunks:qa.chunks,final:qa.final,renders:qa.renders,firstPaintMs:qa.firstPaint-qa.firstChunk,longTasks:qa.longTasks,wallMs:qa.final.at-qa.started}));
  result.simulation.totalMs=Date.now()-begin;
  check('streamed data matches final snapshot',result.simulation.final.streamEqualsFinal,result.simulation);
  check('four default plots render',await signals.locator('.plot-card').count()===4);
  check('waveform paths render',await signals.locator('.chart-line').count()>0);
  check('simulation preserves topology drag',await viewer.locator('.react-flow__node[data-id="'+nodeId+'"]').getAttribute('style')===dragged);
  result.viewer=await viewer.evaluate(()=>({counts:qa.counts,snapshots:qa.messages}));
  check('viewer receives no streaming chunks',!result.viewer.counts['simulation.chunk'],result.viewer);
  await page.screenshot({path:path.join(output,'simulation.png')});
  const range=await signals.locator('.time-controls output').innerText();
  await signals.getByTitle('Zoom in horizontally').click();const zoom=await signals.locator('.time-controls output').innerText();
  check('zoom changes time range',range!==zoom,{range,zoom});
  await signals.getByRole('button',{name:'Reset',exact:true}).click();check('reset restores time range',await signals.locator('.time-controls output').innerText()===range);
  await signals.getByRole('button',{name:'Create & add',exact:true}).click();check('derived signal is added',await signals.locator('.signal-panel-heading span').innerText()==String(result.simulation.final.signals+1));
  await signals.getByRole('button',{name:'Small signal',exact:true}).first().click();
  await until(()=>signals.evaluate(()=>!!qa.lastSnapshot?.smallSignal),180000);
  await signals.locator('.results-tabs').getByRole('button',{name:'Small signal',exact:true}).click();
  await wait(400);await command('closePanel');
  check('small-signal snapshot received',await signals.evaluate(()=>!!qa.lastSnapshot?.smallSignal));
  await page.screenshot({path:path.join(output,'small-signal.png')});
  await viewer.getByRole('button',{name:'Stop Python backend',exact:true}).click();
  check('backend stopped',await until(()=>viewer.getByRole('button',{name:'Start Python backend',exact:true}).count()));
 } catch(e) {result.errors.push(e.stack);if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw e;}
 finally {fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log('QA_RESULT',JSON.stringify(result));await command('done').catch(()=>{});if(browser)await browser.close();await host;}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
