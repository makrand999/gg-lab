'use strict';
// Disposable, in-memory browser fixture. No real account or API mutations.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'public');
const mock = function () {
  const S = window.EduCADSaves;
  const teacher = { role:'teacher', username:'__teacher_workflow_audit__', name:'Teacher preview', token:'fixture-only' };
  const copy = value => JSON.parse(JSON.stringify(value));
  const db = {
    classes:[{code:'be-a-2026',title:'Engineering Graphics',nmembers:2,nsets:1,created_at:1791360000}],
    sets:[{code:'proj-01',title:'Projections 1',class_code:'be-a-2026',nquestions:2,created_at:1791360000,questions:[{prompt:'Draw the front and top views of a cube.',has_model:true,has_3d:false,check_enabled:true,model:{entities:[{type:'point',id:'p1',x:10,y:10}]}},{prompt:'Draw a triangular lamina.',has_model:false}]}],
    drawings:[{id:1,title:'Cube'},{id:2,title:'Empty drawing'}],
    submissions:[{id:1,name:'Alice',username:'alice',question_index:0,verdict:'',remarks:'',created_at:1791360000,auto:{checked:true,pass:false}},{id:2,name:'Bob',username:'bob',question_index:0,verdict:'pass',remarks:'Good work',created_at:1791360000,auto:{checked:true,pass:true}},{id:3,name:'Casey',username:'casey',question_index:1,verdict:'',remarks:'',created_at:1791360000,auto:{checked:false}}]
  };
  const calls = [], failures = {}, delays = {};
  function wrap(name, fn) {
    S[name] = (...args) => {
      calls.push({name,args:copy(args.slice(2))});
      return new Promise((resolve,reject) => setTimeout(() => {
        if (failures[name]) return reject(Object.assign(new Error('Fixture request failed'),{status:503}));
        try { resolve(copy(fn(...args.slice(2)))); } catch(error) { reject(error); }
      }, delays[name] || 10));
    };
  }
  S.currentSession = () => teacher;
  wrap('listClasses',()=>({classes:db.classes}));
  wrap('listSets',()=>({sets:db.sets}));
  wrap('listDrawings',()=>({drawings:db.drawings}));
  wrap('getClass',code=>db.classes.find(c=>c.code===code));
  wrap('listMembers',()=>({members:[{name:'Alice',username:'alice',joined_at:1791360000}]}));
  wrap('listClassSets',code=>({sets:db.sets.filter(s=>s.class_code===code)}));
  wrap('createClass',(code,title)=>{db.classes.push({code,title,nmembers:0,nsets:0,created_at:1791360000});return {code};});
  wrap('deleteClass',code=>{db.classes=db.classes.filter(c=>c.code!==code);return {ok:true};});
  wrap('deleteSet',code=>{db.sets=db.sets.filter(s=>s.code!==code);return {ok:true};});
  wrap('getSet',code=>{const s=db.sets.find(s=>s.code===code);if(!s)throw Object.assign(new Error('not found'),{status:404});return s;});
  wrap('getDrawing',id=>({title:'Drawing',data:{entities:Number(id)===2?[]:[{type:'point',id:'p1',x:10,y:10}]}}));
  wrap('createSet',(code,title,questions,class_code)=>{db.sets.push({code,title,questions,nquestions:questions.length,class_code,created_at:1791360000});return {code};});
  wrap('listSubmissions',()=>({submissions:db.submissions}));
  wrap('gradeSubmission',(id,verdict,remarks)=>{Object.assign(db.submissions.find(s=>s.id===id),{verdict,remarks});return {ok:true};});
  wrap('setQuestionCheck',(code,i,enabled)=>{db.sets.find(s=>s.code===code).questions[i].check_enabled=enabled;return {ok:true};});
  wrap('setQuestionShow3d',(code,i,enabled)=>{db.sets.find(s=>s.code===code).questions[i].show_3d=enabled;return {ok:true};});
  wrap('clearQuestionModel',(code,i)=>{const q=db.sets.find(s=>s.code===code).questions[i];q.has_model=false;delete q.model;return {ok:true};});
  wrap('setQuestionModel',(code,i,model,extra)=>{Object.assign(db.sets.find(s=>s.code===code).questions[i],{model,has_model:true,check_enabled:true,has_3d:!!extra.model3d});return {ok:true};});
  window.__teacherAudit={db,calls,failures,delays,teacher};
  window.confirm=()=>true;
  // Fail closed if an unmocked action attempts a real request.
  window.fetch=()=>Promise.reject(new Error('Real API access disabled in this fixture'));
};
const target = path.join(root, '_teacher-audit.html');
if (process.argv.includes('--clean')) { fs.rmSync(target,{force:true}); process.exit(0); }
let html = fs.readFileSync(path.join(root,'teacher.html'),'utf8');
html = html.replace('<script src="teacher.js"></script>', '<script>('+mock.toString()+')();</script>\n  <script src="teacher.js"></script>');
html = html.replace(/(href|src)="([^"?]+\.(?:js|css))"/g,'$1="$2?teacher-audit='+Date.now()+'"');
fs.writeFileSync(target,html);
console.log(target);
