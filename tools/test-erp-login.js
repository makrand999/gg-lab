'use strict';
// Disposable ERP fixture: exercises the real C++ HTTP adapter and SQLite API.
const assert = require('node:assert/strict');
const {spawn, spawnSync} = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'educad-erp-'));
const password = 'fixture-only &+= ERP password';
const children = [], sessions = new Map(), calls = [];
let mode = 'ok', course = 'CS&D Sem VII Div-2', foreignRequests = 0;
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = server => new Promise(resolve => server.close(resolve));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function send(res, status, body, headers = {}) {
  res.writeHead(status, {'Content-Type':'application/json', ...headers});
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
async function start(extra = {}, db = path.join(dir, 'lab.db')) {
  const reservation = http.createServer();
  const port = await listen(reservation);
  await close(reservation);
  const server = spawn(path.join(root, 'backend/build/educad-server'), [String(port)], {
    env:{...process.env,EDUCAD_ROOT:path.join(root,'public'),EDUCAD_DB:db,
      EDUCAD_STUDENT_AUTH:'erp',EDUCAD_ERP_EMAIL_DOMAINS:'mit.asia',...extra},
    stdio:['ignore','pipe','pipe']
  });
  children.push(server);
  let output = '', errors = '';
  server.stdout.on('data', data => { output += data; });
  server.stderr.on('data', data => { errors += data; });
  for (let i=0;i<100;i++) {
    const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
    if (match) return 'http://127.0.0.1:'+match[1];
    if (server.exitCode !== null) throw new Error('Server exited: '+errors);
    await sleep(50);
  }
  throw new Error('Backend did not start: '+errors);
}
async function api(base, route, body, token, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base+'/api/'+route, {method,
    headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,data:await response.json(),headers:response.headers};
}
function sql(db, query) {
  const result = spawnSync('python3',['-c','import sqlite3,json,sys; print(json.dumps(sqlite3.connect(sys.argv[1]).execute(sys.argv[2]).fetchall()))',db,query],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  return JSON.parse(result.stdout);
}
async function main() {
  const foreign = http.createServer((req,res)=>{foreignRequests++;send(res,200,{});});
  const foreignPort = await listen(foreign);
  const mock = http.createServer(async (req,res)=>{
    let body = ''; for await (const chunk of req) body += chunk;
    calls.push({path:req.url,cookie:req.headers.cookie||'',method:req.method});
    if (req.url === '/j_spring_security_check') {
      assert.equal(req.method,'POST');
      assert.equal(req.headers['content-type'],'application/x-www-form-urlencoded');
      const form = new URLSearchParams(body);
      if (form.get('j_password') !== password) return send(res,302,'',{Location:'/login.htm?login_error=1'});
      if (mode==='offline') return send(res,521,{});
      if (mode==='external') return send(res,302,'',{Location:'http://127.0.0.1:'+foreignPort+'/steal'});
      const cookie = 'test-session-'+sessions.size;
      sessions.set(cookie,form.get('j_username'));
      return send(res,302,'',{Location:'/stu_studentDashboard.htm','Set-Cookie':'JSESSIONID='+cookie+'; HttpOnly; Path=/'});
    }
    if (req.url==='/stu_studentDashboard.htm') return send(res,200,'<html>Student</html>');
    const cookie = req.headers.cookie?.match(/JSESSIONID=([^;]+)/)?.[1];
    if (!sessions.has(cookie)||mode==='expired') return send(res,302,'',{Location:'/login.htm'});
    if (mode==='html') return send(res,200,'<html>Login</html>');
    if (mode==='empty') return send(res,200,[]);
    if (mode==='malformed') return send(res,200,'{broken');
    if (req.url==='/stu_getStudentDashboardDetails.json') return send(res,200,{profileDetails:{
      firstName:mode==='nameless'?null:'Student',lastName:mode==='nameless'?null:'Example',
      emailId:mode==='mismatch'?'another@mit.asia':sessions.get(cookie),courseName:course,rollNo:'42',
      ...(mode==='explicit'?{year:'3',division:'B',className:'Computer Science'}:{})}});
    if (req.url==='/stu_getStudentPersonalinfo.json') {
      if (mode==='profile-down') return send(res,503,{});
      return send(res,200,[{studentId:'123',middleName:mode==='nameless'?null:'Test',Gender:'fixture',
        mobileNo:'private-contact-must-not-be-stored',adharcardNo:'private-id-must-not-be-stored'}]);
    }
    send(res,404,{});
  });
  const mockPort = await listen(mock);
  let tls;
  try {
    const db = path.join(dir,'lab.db');
    const seeded = spawnSync(path.join(root,'backend/build/educad-seed'),[path.join(root,'tools/users.json'),db],{encoding:'utf8'});
    assert.equal(seeded.status,0,seeded.stderr);
    const base = await start({EDUCAD_ERP_URL:'http://127.0.0.1:'+mockPort});
    const credentials = {role:'student',email:'student@mit.asia',password};
    let result = await api(base,'auth/config');
    assert.equal(result.data.student_auth,'erp');assert.deepEqual(result.data.email_domains,['mit.asia']);
    assert.equal((await api(base,'auth/config',undefined,undefined,'POST')).status,405);
    assert.equal((await api(base,'login',{role:'student',username:'student',password:'learn123'})).status,400);
    const count = calls.length;
    assert.equal((await api(base,'login',{...credentials,email:'student@example.com'})).status,400);
    assert.equal((await api(base,'login',{...credentials,email:'bad-email'})).status,400);
    assert.equal(calls.length,count,'Invalid email never reaches ERP');
    result = await api(base,'login',{...credentials,email:' Student@MIT.ASIA ',name:'Spoofed',division:'Spoofed',year:'Spoofed'});
    assert.equal(result.status,200);assert.ok(result.data.token);
    const firstToken=result.data.token, profile=result.data.profile;
    assert.equal(profile.name,'Student Test Example');
    assert.equal(profile.email,'student@mit.asia');assert.equal(profile.class,'CS&D');
    assert.equal(profile.division,'2');assert.equal(profile.year,'4');assert.equal(profile.semester,7);
    assert.equal(profile.year_source,'course_semester');assert.equal(profile.student_id,'123');
    assert.equal((await api(base,'me',undefined,firstToken)).data.profile.name,profile.name);
    const drawing=await api(base,'drawings',{title:'ERP saved work',data:{entities:[]}},firstToken);
    assert.equal(drawing.status,201);
    course='CS&D Sem VIII Div-3';
    result=await api(base,'login',credentials);
    assert.equal(result.status,200);assert.notEqual(result.data.token,firstToken);
    assert.equal(result.data.profile.division,'3');
    assert.equal((await api(base,'drawings',undefined,result.data.token)).data.drawings[0].title,'ERP saved work');
    assert.equal((await api(base,'me',undefined,firstToken)).data.profile.division,'3','Existing sessions see synced profile');
    assert.equal(sql(db,"SELECT count(*) FROM users WHERE username='student@mit.asia'")[0][0],1);
    assert.equal(sql(db,"SELECT pass_hash FROM users WHERE username='student@mit.asia'")[0][0],'');
    assert.equal((await api(base,'logout',{},result.data.token)).status,200);
    assert.equal((await api(base,'me',undefined,result.data.token)).status,401);
    result=await api(base,'login',{...credentials,password:'incorrect'});
    assert.equal(result.status,401);assert.equal(result.data.token,undefined);
    for(const [state,status] of [['offline',503],['expired',401],['html',401],['empty',502],['malformed',502],['nameless',502],['mismatch',502],['profile-down',503],['external',503]]) {
      mode=state; result=await api(base,'login',credentials);
      assert.equal(result.status,status,state);assert.equal(result.data.token,undefined,state);
    }
    assert.equal(foreignRequests,0,'Cross-origin redirects are never followed');
    mode='explicit';result=await api(base,'login',credentials);
    assert.equal(result.data.profile.class,'Computer Science');
    assert.equal(result.data.profile.division,'B');assert.equal(result.data.profile.year,'3');
    mode='ok';course='Unstructured course label';result=await api(base,'login',credentials);
    assert.equal(result.data.profile.division,null);assert.equal(result.data.profile.year,null);
    assert.equal(result.data.profile.class,course);
    // Concurrent sign-ins must not share ERP cookies or student identities.
    const users=await Promise.all(['alice','bob'].map(user=>api(base,'login',{...credentials,email:user+'@mit.asia'})));
    assert.deepEqual(users.map(user=>user.data.profile.email),['alice@mit.asia','bob@mit.asia']);
    assert.equal((await api(base,'drawings',undefined,users[0].data.token)).data.drawings.length,0);
    const insecure=await start({EDUCAD_ERP_URL:'http://erp.mit.asia'},path.join(dir,'insecure.db'));
    assert.equal((await api(insecure,'login',credentials)).status,503);
    // A self-signed ERP certificate must fail before credentials are transmitted.
    const generated=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(dir,'key.pem'),'-out',path.join(dir,'cert.pem'),'-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
    assert.equal(generated.status,0);
    let tlsRequests=0;
    tls=https.createServer({key:fs.readFileSync(path.join(dir,'key.pem')),cert:fs.readFileSync(path.join(dir,'cert.pem'))},(req,res)=>{tlsRequests++;send(res,200,{});});
    const tlsPort=await listen(tls);
    const secure=await start({EDUCAD_ERP_URL:'https://localhost:'+tlsPort},path.join(dir,'secure.db'));
    assert.equal((await api(secure,'login',credentials)).status,503);assert.equal(tlsRequests,0);
    const teacher=await api(base,'login',{role:'teacher',username:'teacher',password:'teach123'});
    assert.equal(teacher.status,200,'Staff auth remains available');
    const demo=await start({EDUCAD_STUDENT_AUTH:'demo'},db);
    const local=await api(demo,'login',{role:'student',username:'student',password:'learn123'});
    assert.equal(local.status,200);assert.equal((await api(base,'me',undefined,local.data.token)).status,401,'ERP mode rejects old demo student sessions');
    for(const file of fs.readdirSync(dir).filter(file=>file.includes('.db'))) {
      const bytes=fs.readFileSync(path.join(dir,file));
      for(const secret of [password,'private-contact-must-not-be-stored','private-id-must-not-be-stored','test-session-'])
        assert.equal(bytes.includes(Buffer.from(secret)),false,'No ERP secrets/extra PII in '+file);
    }
    console.log('PASS ERP login: verification, profile mapping/sync, stable accounts, saves, logout, domain enforcement, isolation, failures, redirects, TLS, staff/demo separation, and credential minimization.');
  } finally {
    for(const child of children)child.kill('SIGTERM');
    await Promise.all(children.map(child=>child.exitCode!==null?Promise.resolve():new Promise(resolve=>child.once('exit',resolve))));
    await close(mock);await close(foreign);if(tls)await close(tls);
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
