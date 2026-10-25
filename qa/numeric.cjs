const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const beforeRoot = path.resolve(process.env.BEFORE_ROOT || path.join(__dirname, '../codesim-before'));
const afterRoot = path.resolve(process.env.AFTER_ROOT || path.join(__dirname, '../codesim'));
const ts = require(path.join(afterRoot,'frontend/node_modules/typescript'));
require.extensions['.ts'] = (mod,file) => mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const before = require(path.join(beforeRoot,'frontend/webview/src/model/signalModel.ts'));
const after = require(path.join(afterRoot,'frontend/webview/src/model/signalModel.ts'));
const math = require(path.join(afterRoot,'frontend/webview/src/model/chartMath.ts'));
const flow = require(path.join(afterRoot,'frontend/webview/src/model/flowModel.ts'));
const oldFlow = require(path.join(beforeRoot,'frontend/webview/src/model/flowModel.ts'));
const chunks = Array.from({length:200},(_,c)=>Array.from({length:24},(_,s)=>({id:'signal-'+s,label:'Signal '+s,time:Array.from({length:250},(_,i)=>(c*250+i)*0.0001),values:Array.from({length:250},(_,i)=>Math.sin((c*250+i)*0.01+s))})));
function runBefore(){let data=[];for(let i=0;i<chunks.length;i++)data=before.mergeSimulationSignals(data,chunks[i],i===0);return data;}
function runAfter(){const b=new after.SimulationSignalBuffer();let data;for(let i=0;i<chunks.length;i++){b.append(chunks[i],i===0);data=b.take();}return data;}
const old=runBefore(), current=runAfter();assert.deepEqual(current,old);
const timing={before:[],after:[]};
for(let i=0;i<5;i++){for(const [label,fn] of i%2?[['after',runAfter],['before',runBefore]]:[['before',runBefore],['after',runAfter]]){global.gc?.();const t=performance.now();fn();timing[label].push(performance.now()-t);}}
const median=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];
const buffer=new after.SimulationSignalBuffer();buffer.append(chunks[0],true);const first=buffer.take();buffer.append(chunks[1],false);const second=buffer.take();assert.notEqual(first[0],second[0]);assert.equal(first[0].values,second[0].values);assert.equal(first[0].values.length,500);assert.equal(chunks[0][0].values.length,250);assert.equal(buffer.take(),undefined);buffer.reset();assert.equal(buffer.pending,false);
const values=[3,4,1];assert.equal(math.arrayStats(values).minimum,1);values.push(-5,8);assert.equal(math.arrayStats(values).minimum,-5);assert.equal(math.arrayStats(values).maximum,8);
const time=Array.from({length:10000},(_,i)=>i);const spikes=Array(10000).fill(0);spikes[1234]=100;spikes[5678]=-100;const picks=math.decimateIndices(time,spikes,0,time.length,600);assert(picks.includes(1234)&&picks.includes(5678));assert.deepEqual(math.visibleIndexRange(time,time.length,2300,2400),[2300,2401]);
assert(math.decimatedPath([0,1,2,3],[0,1,NaN,3],x=>x,y=>y,600).split('M').length===3);
const nodes=[{id:'a',position:{x:0,y:0},data:{component:{kind:'bus'}}},{id:'b',position:{x:200,y:0},data:{component:{kind:'bus'}}}];const edges=[{id:'ab',source:'a',target:'b',data:{label:'A-B'}}];
const oriented=flow.orientFlowEdges(nodes,edges);assert.equal(flow.orientFlowEdges(nodes,oriented),oriented);assert.notEqual(oldFlow.orientFlowEdges(nodes,oriented),oriented);
const result={workload:{signals:24,chunks:200,pointsPerChunk:250,pointsPerSignal:50000},dataEqual:true,timingMs:timing,medianMs:{before:median(timing.before),after:median(timing.after)},speedup:median(timing.before)/median(timing.after),checks:['stream equality','array/descriptor identity','no mutation of incoming chunks','reset/pending','incremental extrema','spike preservation','visible binary search','path gaps','topology identity']};
fs.writeFileSync(path.join(__dirname,'numeric-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
