'use strict';
// Optional Chromium check of both login UIs with a disposable API fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs'), http = require('node:http'), os = require('node:os'), path = require('node:path');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname,'../public');
const chrome = process.env.MAJOR2_CHROMIUM || path.join(os.homedir(),'.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell');
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'erp-browser-'));
const profile = {source:'erp',email:'student@mit.asia',name:'Test Student',class:'CS&D',division:'2',year:'4',roll_no:'42'};
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
let mode='erp',logins=0,ws,chromeProcess,id=0;
const pending = new Map(), errors = [];
function rpc(method,params={}) {return new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params}));});}
async function evaluate(expression) {const result=await rpc('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result?.value;}
async function until(expression) {for(let i=0;i<100;i++){if(await evaluate(expression))return;await sleep(80);}throw new Error('Timed out: '+expression);}
async function input(selector,value) {await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
async function submit(selector) {await evaluate(`document.querySelector(${JSON.stringify(selector)}).requestSubmit()`);}
async function click(selector) {await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);}
async function main() {
  const api = http.createServer(async(req,res)=>{
    if (req.url.includes('/api/')) {
      const route=req.url.split('/api/')[1];
      let body='';for await(const chunk of req)body+=chunk;
      let data={ok:true,classes:[],sets:[],drawings:[],submissions:[],progress:[]},status=200;
      if(route==='auth/config')data={ok:true,student_auth:mode,email_domains:['mit.asia']};
      if(route==='login') {
        logins++;const values=JSON.parse(body);
        if(values.password==='fixture-password')data={ok:true,role:values.role,username:values.email||values.username,name:'Test Student',token:'fixture-lab-session',profile:values.role==='student'&&mode==='erp'?profile:null};
        else {status=401;data={ok:false,error:'Invalid college ERP email or password.'};}
      }
      if(route==='me')data={ok:true,role:'student',name:'Test Student',username:profile.email,profile};
      res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));return;
    }
    const file=path.join(root,decodeURIComponent(req.url.split('?')[0]));
    try {const bytes=fs.readFileSync(file.endsWith('/')?file+'index.html':file);res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(bytes);}
    catch(_){res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
  const port=api.address().port;
  const reservation=http.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const debugPort=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  try {
    chromeProcess=spawn(chrome,['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+debugPort,'--user-data-dir='+temp,'about:blank'],{stdio:'ignore'});
    chromeProcess.on('error',error=>errors.push(error.message));
    let pages;
    for(let i=0;i<80;i++){try{pages=await(await fetch('http://127.0.0.1:'+debugPort+'/json/list')).json();if(pages.length)break;}catch(_){}await sleep(100);}
    assert.ok(pages?.length,'Chromium started');
    ws=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
    await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
    ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const item=pending.get(message.id);if(item){pending.delete(message.id);message.error?item.reject(new Error(message.error.message)):item.resolve(message.result);}}else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);});
    await rpc('Runtime.enable');await rpc('Page.enable');
    await rpc('Page.navigate',{url:'http://127.0.0.1:'+port+'/major2/#/login/student'});
    await until("!!document.querySelector('#auth-username')");
    assert.equal(await evaluate("document.querySelector('#auth-username').type"),'email');
    assert.equal(await evaluate("document.querySelector('label[for=auth-username]').textContent"),'College ERP email');
    assert.equal(await evaluate("!!document.querySelector('.auth-demo')"),false);
    await input('#auth-username','student@example.com');await input('#auth-password','fixture-password');await submit('#login-form');
    await until("!document.querySelector('#auth-username-error').hidden");assert.equal(logins,0);
    await input('#auth-username','student@mit.asia');await input('#auth-password','wrong');await submit('#login-form');
    await until("!document.querySelector('#auth-request-error').hidden");
    assert.match(await evaluate("document.querySelector('#auth-request-error').textContent"),/Invalid college ERP email/);
    await input('#auth-password','fixture-password');await submit('#login-form');
    await until("location.hash==='#/home' && !!document.querySelector('[data-action=account]')");
    const session=await evaluate("JSON.parse(localStorage.getItem('educad_session'))");
    assert.deepEqual(session.profile,profile);assert.equal(session.password,undefined);
    await click('[data-action=account]');await until("!!document.querySelector('dialog[open]')");
    const account=await evaluate("document.querySelector('dialog[open]').textContent");
    for(const text of ['College ERP email','CS&D','Division','Year','42'])assert.ok(account.includes(text),text);
    // Staff switches continue to use local username fields and demo assistance.
    await evaluate("localStorage.removeItem('educad_session');location.hash='/login/teacher'");
    await until("document.querySelector('#auth-username')?.type==='text'");assert.equal(await evaluate("!!document.querySelector('.auth-demo')"),true);
    mode='demo';await evaluate("localStorage.setItem('educad_session',JSON.stringify({role:'guest',token:'guest'}));location.hash='/login/student'");
    await until("document.querySelector('#auth-username')?.type==='text' && document.querySelector('form')?.getAttribute('aria-label')==='Student sign-in'");
    assert.equal(await evaluate("!!document.querySelector('.auth-demo')"),true);
    mode='erp';await evaluate("localStorage.removeItem('educad_session')");await rpc('Page.navigate',{url:'http://127.0.0.1:'+port+'/login.html'});
    await until("document.querySelector('#username')?.type==='email'");
    assert.match(await evaluate("document.querySelector('#demo-hint').textContent"),/@mit.asia/);
    await input('#username','student@mit.asia');await input('#password','fixture-password');await submit('#login-form');
    await until("location.pathname==='/student.html'");
    assert.deepEqual(await evaluate("JSON.parse(localStorage.getItem('educad_session')).profile"),profile);
    await until("document.querySelector('#lab-who')?.textContent.includes('CS&D')");
    assert.deepEqual(errors,[]);
    console.log('PASS ERP browser: email/domain validation, rejected credentials, profile session/account display, staff and demo modes, original login/student workspace.');
  } finally {
    ws?.close();chromeProcess?.kill('SIGTERM');
    if(chromeProcess&&chromeProcess.exitCode===null)await new Promise(resolve=>chromeProcess.once('exit',resolve));
    await new Promise(resolve=>api.close(resolve));fs.rmSync(temp,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
