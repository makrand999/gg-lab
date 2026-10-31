'use strict';
// Run isolated line-type checks when the collaborative browser is unavailable.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'major2-line-types-')),errors=[],pending=new Map();let ws,id=0;
const chrome=spawn(process.env.MAJOR2_CHROMIUM||'/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell',['--no-sandbox','--disable-gpu','--remote-debugging-port=9362','--user-data-dir='+path.join(out,'profile'),'about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function rpc(method,params={}){return new Promise((resolve,reject)=>{const rid=++id,timer=setTimeout(()=>{pending.delete(rid);reject(Error('Timed out: '+method));},15000);pending.set(rid,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});ws.send(JSON.stringify({id:rid,method,params}));});}
async function evaluate(expression){const r=await rpc('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function shot(name){const r=await rpc('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'));}
(async()=>{
  try{
    let tabs;for(let i=0;i<70;i++){try{tabs=await(await fetch('http://127.0.0.1:9362/json')).json();break;}catch{await sleep(50);}}
    if(!tabs)throw Error('Chromium unavailable');ws=new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
    ws.addEventListener('message',event=>{const r=JSON.parse(event.data);if(r.id){const p=pending.get(r.id);if(p){pending.delete(r.id);if(r.error)p.reject(Error(r.error.message));else p.resolve(r.result);}}else if(r.method==='Runtime.exceptionThrown')errors.push(r.params.exceptionDetails.exception?.description||r.params.exceptionDetails.text);});
    await rpc('Page.enable');await rpc('Runtime.enable');await rpc('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await rpc('Page.navigate',{url:(process.env.MAJOR2_PREVIEW_URL||'https://mitasia.in/major2/')+'#/welcome'});
    for(let i=0;i<70;i++){if(await evaluate('!!window.Major2?.mountLineTypes && !!window.Major2?.canvasPreferences && !!document.querySelector(".studio-shell")'))break;await sleep(50);}
    await evaluate(fs.readFileSync(path.join(__dirname,'check-major2-line-types.js'),'utf8'));await evaluate('__lineTypeChecks.setup()');
    for(const name of ['menuTypes','activeAnchorAndLength','previewPatterns','focusAndCircle','shortcuts','preferencesSaveReview','fallback']){const result=await evaluate(`__lineTypeChecks.run(${JSON.stringify(name)})`);console.log('PASS '+result.passed);}
    const layouts=[];for(const [width,height]of [[1280,800],[980,720],[760,844],[390,844],[320,740]]){await rpc('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});layouts.push(await evaluate('__lineTypeChecks.layout()'));}
    await rpc('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await evaluate("Major2.applyTheme('warm');document.querySelector('.student-line-type-toggle').click()");await shot('student-line-type-picker');
    const report={results:await evaluate('__lineTypeChecks.results'),layouts,errors:errors.concat(await evaluate('__lineTypeChecks.errors'))};assert.deepEqual(report.errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));console.log('Checked '+layouts.reduce((n,item)=>n+item.layouts,0)+' layouts');console.log('Artifacts: '+out);
  }catch(error){console.error(error.stack);console.error('Browser errors: '+JSON.stringify(errors));try{await shot('failure');fs.writeFileSync(path.join(out,'diagnostics.json'),JSON.stringify(await evaluate("({readyState:document.readyState,resources:performance.getEntriesByType('resource').map(r=>({name:r.name,duration:r.duration,bytes:r.transferSize})),body:document.body.innerText})"),null,2));}catch{}console.error('Artifacts: '+out);process.exitCode=1;}
  finally{ws?.close();chrome.kill('SIGTERM');}
})();
