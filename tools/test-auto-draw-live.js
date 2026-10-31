'use strict';
// Opt-in real-model evaluation. Uses a disposable database/server, never attaches models.
// EDUCAD_NL_MODEL=<configured model> npm run test:auto-draw:live -- <report.json>
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const child = require('node:child_process'), net = require('node:net');
const assert = require('node:assert/strict');
const A = require('../public/lib/educad-auto.js');
const CLI = require('./edc.js');
const E = require('../public/lib/educad-entities.js'), S = require('../public/lib/educad-saves.js');
const ROOT = path.resolve(__dirname, '..');
function near(a, b, tolerance = 0.02) { assert.ok(Math.abs(a - b) <= tolerance, `${a} should equal ${b}`); }
function entity(r, type) { const e = r.entities.find(e => e.type === type); assert.ok(e, `Missing ${type}`); return e; }
function point(r, name) { const p = r.entities.find(e => e.type === 'POINT' && e.caption.toLowerCase() === name.toLowerCase()); assert.ok(p, `Missing point ${name}`); return p; }
const cases = [
  {name: 'circle', text: 'Draw a circle centered at (10,20) with radius 15 mm.', check: r => { const e = entity(r, 'CIRCLE'); near(e.x, 10); near(e.y, 20); near(e.radius, 15); }},
  {name: 'triangle', text: 'Draw triangle with vertices a=(0,10), b=(30,10), c=(15,35). Close all three sides.', check: r => { ['a','b','c'].forEach(n => point(r,n)); assert.equal(r.entities.filter(e => e.type === 'SEGMENT' && e.bisCode !== 'G').length,3); }},
  {name: 'arc', text: 'Draw only a circular arc centered at (0,20), radius 10 mm, from 30 degrees to 150 degrees counterclockwise.', check: r => { const e = entity(r,'CIRCULAR_ARC'); near(e.radius,10); near(e.startAngle,30); near(e.endAngle,150); }},
  {name: 'ellipse', text: 'Draw an ellipse centered at (0,30), with horizontal semi-axis 20 mm and vertical semi-axis 10 mm, using 24 segments.', check: r => { const e = r.entities.filter(e => e.type === 'SEGMENT' && e.bisCode !== 'G'); assert.equal(e.length,24); near(Math.max(...e.map(x=>x.x)),20); near(Math.min(...e.map(x=>x.y)),20); }},
  {name: 'polyline', text: 'Draw an open polyline through a=(0,10), b=(10,25), c=(20,15), d=(30,30). Do not close it.', check: r => { assert.equal(r.entities.filter(e=>e.type==='SEGMENT' && e.bisCode !== 'G').length,3); }},
  {name: 'hatch', text: 'Draw 45-degree section hatching inside the rectangle x=0..40 and y=10..30, with spacing 5 mm. Do not draw the boundary.', check: r => { const e=r.entities.filter(e=>e.type==='SEGMENT'); assert.ok(e.length>0 && e.length<=200); for(const x of e) {assert.ok(x.x>=-0.01 && x.x2<=40.01 && x.y>=9.99 && x.y2<=30.01); near(Math.abs(x.y2-x.y),Math.abs(x.x2-x.x));} }},
  {name: 'dimension', text: 'Draw a=(0,10), b=(30,50), their segment, and a dimension showing the distance between them.', check: r => { const e=entity(r,'DIMENSION'); near(Math.hypot(e.x2-e.x,e.y2-e.y),50); }},
  {name: 'quadrant-III', text: 'Monge first-angle projection: point A is 20 mm below HP and 30 mm behind VP, x=10 mm. Draw its plan a and elevation a\' and XY datum, with explicit plan and elevation roles.', check: r => { const p=point(r,'a'),e=point(r,"a'"); near(p.x,10); near(e.x,10); near(p.y,30); near(e.y,-20); assert.equal(p.viewRole,'PLAN');assert.equal(e.viewRole,'ELEVATION'); }},
  ...[
    ['quadrant-I',20,30], ['quadrant-II',20,-30], ['quadrant-IV',-20,30], ['on-HP',0,30], ['on-VP',20,0]
  ].map(([name,height,depth])=>({name,text:`Monge first-angle point A at x=10, signed height=${height} mm (positive above HP), signed depth=${depth} mm (positive in front of VP). Draw a plan and a' elevation with explicit roles and XY datum.`,check:r=>{const p=point(r,'a'),e=point(r,"a'");near(p.x,10);near(e.x,10);near(p.y,-depth);near(e.y,height);assert.equal(p.viewRole,'PLAN');assert.equal(e.viewRole,'ELEVATION');}})),
  {name:'tilted-square',text:"Square lamina side 40 mm, edge AB along x parallel XY: A at x=0, height=10, depth=10; B at x=40, height=10, depth=10. The plane is tilted 45 degrees to HP about AB. The other two corners C and D lie further in front of VP and higher than AB. Draw closed plan a,b,c,d and elevation a',b',c',d', projectors and XY. Calculate the projected dimensions.",check:r=>{const a=point(r,'a'),c=point(r,'c'),ap=point(r,"a'"),cp=point(r,"c'");near(c.x-a.x,40);near(a.y-c.y,40/Math.sqrt(2));near(cp.y-ap.y,40/Math.sqrt(2));near(a.y,-10);near(ap.y,10);}},
  {name: 'line-inclinations', text: 'Monge first angle: AB length 75 mm, inclined 30 degrees to HP and 45 degrees to VP. A is 12 mm above HP and 10 mm in front of VP at x=0. B is to the right, higher and further in front of VP. Draw plan a,b and elevation a\',b\', both segments, and XY. Calculate exact projections.', check: r => { const a=point(r,'a'),b=point(r,'b'),ap=point(r,"a'"),bp=point(r,"b'"); const dx=bp.x-ap.x,dz=bp.y-ap.y,dy=a.y-b.y; near(Math.hypot(dx,dy,dz),75); near(dz,37.5); near(dy,75/Math.sqrt(2)); near(a.y,-10);near(ap.y,12); }},
  {name: 'complete-cube', text: 'Draw front and top views of a cube with every named vertex and every edge in both views (24 edges total), XY and 8 projectors. Cube vertices in 3D (x,depth,height): a=(0,10,10), b=(30,10,10), c=(30,40,10), d=(0,40,10), e=(0,10,40), f=(30,10,40), g=(30,40,40), h=(0,40,40). Plan names a..h at (x,-depth), elevation a\'..h\' at (x,height). Edges ab,bc,cd,da,ef,fg,gh,he,ae,bf,cg,dh. Omit zero-length projected edges. Use E for hidden edges. Explicit view roles.', check: r => { for(const n of 'abcdefgh') {point(r,n);point(r,n+"'");} assert.ok(r.entities.filter(e=>e.type==='SEGMENT').length>=16); }},
  {name:'cylinder',text:'Draw first-angle plan and elevation of a cylinder with vertical axis, diameter 30 mm and height 50 mm. Axis x=0, depth=40 mm in front of VP. Base is 10 mm above HP, top 60 mm above HP. Plan is a circle, elevation a rectangle. Add XY and centerlines with explicit view roles.',check:r=>{const circle=r.entities.find(e=>e.type==='CIRCLE' && e.viewRole==='PLAN');assert.ok(circle);near(circle.x,0);near(circle.y,-40);near(circle.radius,15);const edges=r.entities.filter(e=>e.type==='SEGMENT' && e.viewRole==='ELEVATION' && e.bisCode!=='G');assert.ok(edges.length>=4);near(Math.min(...edges.flatMap(e=>[e.x,e.x2])),-15);near(Math.max(...edges.flatMap(e=>[e.x,e.x2])),15);near(Math.min(...edges.flatMap(e=>[e.y,e.y2])),10);near(Math.max(...edges.flatMap(e=>[e.y,e.y2])),60);}},
  {name:'cone',text:'Draw first-angle plan and elevation of a cone with vertical axis, base diameter 30 mm, height 50 mm. Axis x=0, depth=40 in front of VP, base 10 above HP, apex 60 above HP. Plan is a circle, elevation a triangle. Add XY and centerlines with explicit roles.',check:r=>{const circle=r.entities.find(e=>e.type==='CIRCLE' && e.viewRole==='PLAN');assert.ok(circle);near(circle.y,-40);near(circle.radius,15);const edges=r.entities.filter(e=>e.type==='SEGMENT' && e.viewRole==='ELEVATION' && e.bisCode!=='G');assert.equal(edges.length,3);near(Math.max(...edges.flatMap(e=>[e.y,e.y2])),60);near(Math.min(...edges.flatMap(e=>[e.y,e.y2])),10);}},
  {name:'plate-holes',text:'Draw an elevation of a rectangular plate from x=-60 to 60 mm, y=10 to 30 mm. Draw two circular holes, diameter 10 mm, centered at (-30,20) and (30,20). Add dimension of the plate width. Do not hatch the holes.',check:r=>{const circles=r.entities.filter(e=>e.type==='CIRCLE');assert.equal(circles.length,2);for(const e of circles){near(e.radius,5);near(Math.abs(e.x),30);near(e.y,20);}const d=entity(r,'DIMENSION');near(Math.hypot(d.x2-d.x,d.y2-d.y),120);}},
  {name: 'vague-refusal', text: 'Draw the correct model answer for the question I have not provided.', refuse: true},
  {name: 'impossible-refusal', text: 'Draw an engineering triangle with sides 10 mm, 20 mm, 100 mm. Do not alter these lengths.', refuse: true},
  {name: 'reuse-context', text: 'Draw a circle centered at existing point a, passing through existing point b. Use their actual coordinates.', points:['a','b'], pointData:{a:{x:10,y:20},b:{x:40,y:60}}, seed: ['/point a 10 20','/point b 40 60'], check:r=>{const e=entity(r,'CIRCLE');near(e.x,10);near(e.y,20);near(e.radius,50);}},
  {name: 'unicode', text: 'Draw a circle centered at (0,20), diameter 20 mm. Add annotation “Ø20 — diamètre”.', check:r=>{near(entity(r,'CIRCLE').radius,10);assert.ok(entity(r,'TEXT').caption.includes('20'));}}
];
async function freePort() { return new Promise(resolve => {const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});}); }
async function main() {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'educad-auto-live-')), db=path.join(tmp,'test.db');
  const seed=child.spawnSync(path.join(ROOT,'backend/build/educad-seed'),[path.join(ROOT,'tools/users.json'),db]);
  assert.equal(seed.status,0);
  const port=await freePort();
  const srv=child.spawn(path.join(ROOT,'backend/build/educad-server'),[String(port)],{env:{...process.env,EDUCAD_STUDENT_AUTH: 'demo', EDUCAD_DB:db,EDUCAD_ROOT:path.join(ROOT,'public')},stdio:'ignore'});
  const url='http://127.0.0.1:'+port;
  const results=[];
  try {
    for(let i=0;i<100;i++) { try {if((await fetch(url+'/login.html')).ok)break;}catch {} await new Promise(r=>setTimeout(r,100)); }
    const login=await (await fetch(url+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'teacher',username:'teacher',password:'teach123'})})).json();
    assert.ok(login.token);
    const filter=process.argv.find(arg=>arg.startsWith('--cases='));
    const selected=filter ? filter.slice(8).split(',') : null;
    for(const c of cases.filter(c=>!selected || selected.includes(c.name))) {
      const start=Date.now(); let data, result;const attempts=[];
      try {
        const table=E.createTable();
        const base=c.seed ? A.stage(c.seed,{entities:[]},false) : {entities:[]};
        S.restoreTable(E,table,base);
        const runner=A.createRunner({table,session:()=>login,readOnly:()=>false,maxAttempts:2,
          interpret:async (session,text,points,mode,pointData,feedback)=>{
            const response=await fetch(url+'/api/interpret',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+login.token},body:JSON.stringify({text,mode,points,pointData,feedback})});
            data=await response.json();attempts.push({status:response.status,feedback,response:data});
            if (!response.ok) {const error=new Error(data.error||'request failed');error.status=response.status;throw error;}return data;
          },commit:plan=>S.restoreTable(E,table,plan)});
        result=await runner(c.text,'auto');
        if(c.refuse) {assert.equal(result.ok,false);assert.equal(data.commands.length,0);assert.ok(data.reply);assert.ok(!data.invalid_plan);}
        else {
          assert.equal(result.ok,true,result.message);
          const cli=CLI.runScript((c.seed||[]).concat(result.commands).join('\n'));assert.equal(cli.ok,true,JSON.stringify(cli.errors));
          c.check({entities:table.list()});
        }
        results.push({name:c.name,text:c.text,status:'PASS',elapsedMs:Date.now()-start,attempts,commands:data.commands,reply:data.reply});
      } catch(error) {results.push({name:c.name,text:c.text,status:'FAIL',elapsedMs:Date.now()-start,error:error.message,attempts,commands:data&&data.commands,reply:data&&data.reply});}
      console.log(results.at(-1).status+' '+c.name+' '+Math.round((Date.now()-start)/1000)+'s'+(results.at(-1).error?' '+results.at(-1).error:''));
    }
    const report={model:process.env.EDUCAD_NL_MODEL||'gemini-3.8-flash-medium',date:new Date().toISOString(),passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status==='FAIL').length,results};
    if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
    console.log(`${report.passed} passed, ${report.failed} failed`);process.exitCode=report.failed?1:0;
  } finally {srv.kill('SIGTERM');await new Promise(resolve=>{if(srv.exitCode!==null||srv.signalCode!==null)resolve();else srv.once('exit',resolve);});fs.rmSync(tmp,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
