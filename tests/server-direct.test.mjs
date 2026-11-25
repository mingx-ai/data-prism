import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
let dir,handle,save,plan,source,run,bootstrap,testEnv;
before(async()=>{dir=await mkdtemp(join(tmpdir(),'prism-direct-'));process.env.PRISM_WEB_DATA=dir;process.env.SOURCE_KEY='test-only-in-process-encryption-key';process.env.JDBC_GATEWAY_URL='';const file=join(dir,'api.mjs');await build({stdin:{contents:"export * from './lib/prism/server';export {env as testEnv} from './selfhost/runtime';",resolveDir:resolve('.')},outfile:file,bundle:true,platform:'node',target:'node22',format:'esm',alias:{'cloudflare:workers':resolve('selfhost/runtime.ts'),'next/server':resolve('selfhost/runtime.ts')},external:['node:sqlite']});({handle,save,testEnv}=await import(pathToFileURL(file).href))});after(async()=>{await rm(dir,{recursive:true,force:true})});
async function request(path,body,method=body?'POST':'GET',headers={}){const r=await handle(new Request('http://prism.local/api/'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined}));return {status:r.status,data:r.headers.get('Content-Type')?.includes('application/json')?await r.json():await r.text()};}
test('state is persisted and demo sources are not claimed to be connected',async()=>{bootstrap=(await request('bootstrap')).data;assert.equal(bootstrap.plans.length,4);assert.equal(bootstrap.sources.length,3);assert.equal(bootstrap.runs.length,3);assert.equal(bootstrap.gatewayConfigured,false);assert.ok(bootstrap.sources.every(s=>s.demo&&s.status==='untested'))});
test('cross-origin changes rejected without opening a listener',async()=>{assert.equal((await request('sources',{},'POST',{origin:'http://evil.invalid'})).status,403)});
test('password encrypted in SQLite and never echoed to client',async()=>{const r=await request('sources',{name:'MySQL reader',type:'mysql',jdbcUrl:'jdbc:mysql://localhost:3306/test',catalog:'test',schema:'test',username:'reader',password:'plaintext-must-not-appear'});assert.equal(r.status,200);source=r.data;assert.equal(source.hasPassword,true);assert.ok(!('password'in source));assert.ok(!('secret'in source));const db=new DatabaseSync(join(dir,'prism.sqlite'),{readOnly:true});const payload=db.prepare('SELECT payload FROM records WHERE id=?').get(source.id).payload;assert.ok(!payload.includes('plaintext-must-not-appear'));assert.ok(JSON.parse(payload).secret);db.close();assert.equal((await request('sources/'+source.id+'/test',{})).status,400);assert.equal((await request('sources/'+source.id+'/catalog')).status,400)});
test('plan copy, validation and override priorities are persisted',async()=>{plan=structuredClone(bootstrap.plans.find(p=>p.id==='demo-audit-plan-v1'));plan.id='new';plan.name='Audit integration';const bad=structuredClone(plan);bad.strategy.limit='10001';assert.equal((await request('plans',bad)).status,400);plan=(await request('plans',plan)).data;assert.notEqual(plan.id,'demo-audit-plan-v1');assert.equal(plan.strategy.tolerance,'${epsilon}');assert.equal(plan.strategy.alignment,undefined)});
test('ignored differences retain raw values, rules, deltas and resolved thresholds',async()=>{const started=await request('plans/'+plan.id+'/run',{});assert.equal(started.status,200);for(let i=0;i<100;i++){run=(await request('runs/'+started.data.id)).data;if(['completed','failed'].includes(run.status))break;await new Promise(r=>setTimeout(r,10))}assert.equal(run.status,'completed');assert.equal(run.completedTables,2);assert.ok(run.results.every(r=>r.status==='passed'),JSON.stringify(run.results));const amount=run.results.find(r=>r.dimension==='data'&&r.baselineTable==='audit_amounts');assert.equal(amount.strategy.alignment,'position');assert.equal(amount.ignoredDifferences[0].key,'第 5 行');assert.equal(amount.ignoredCount,1);assert.equal(amount.ignoredDifferences[0].baseline,'1.234567');assert.equal(amount.ignoredDifferences[0].target,'1.2345');assert.equal(amount.ignoredDifferences[0].delta,'0.000067');assert.equal(amount.ignoredDifferences[0].ruleValue,'0.0001');const nulls=run.results.find(r=>r.dimension==='data'&&r.baselineTable==='audit_nulls');assert.equal(nulls.ignoredDifferences[0].baseline,null);assert.equal(nulls.ignoredDifferences[0].target,'\\N');assert.equal(nulls.ignoredDifferences[0].rule,'null_equivalence');const schema=run.results.find(r=>r.dimension==='schema'&&r.baselineTable==='audit_amounts');assert.equal(schema.ignoredCount,2);assert.ok(schema.ignoredDifferences.every(d=>d.rule==='schema_precision'));assert.equal(amount.baseline.rows.length,100)});
test('audit pagination and full NDJSON download reflect the same evidence',async()=>{const result=run.results.find(r=>r.dimension==='schema'&&r.baselineTable==='audit_amounts');const query='runs/'+run.id+'/audit?resultId='+encodeURIComponent(result.id);const a=await request(query+'&page=1&pageSize=1'),b=await request(query+'&page=2&pageSize=1');assert.equal(a.data.total,2);assert.equal(a.data.items.length,1);assert.equal(b.data.items.length,1);assert.notEqual(a.data.items[0].column,b.data.items[0].column);const downloaded=await request(query+'&download=1');assert.equal(downloaded.status,200);assert.equal(downloaded.data.split('\n').filter(Boolean).length,2)});
test('editing and deleting a plan never changes the historical audit snapshot',async()=>{plan.strategy.tolerance='0';plan.strategy.alignment='key';plan.name='Modified';assert.equal((await request('plans',plan)).status,200);const history=(await request('runs/'+run.id)).data;assert.equal(history.snapshot.strategy.tolerance,'${epsilon}');assert.equal(history.snapshot.strategy.alignment,undefined);assert.equal(history.snapshot.variables.find(v=>v.name==='epsilon').value,'0.0001');assert.equal(history.name,'Audit integration');assert.equal((await request('plans/'+plan.id,undefined,'DELETE')).status,200);assert.equal((await request('runs/'+run.id)).data.results.length,6)});
test('source in use cannot be deleted, unused source can be deleted',async()=>{assert.equal((await request('sources/demo-mc',undefined,'DELETE')).status,400);assert.equal((await request('sources/'+source.id,undefined,'DELETE')).status,200)});

test('full paired evidence and metadata notes persist outside lightweight run summaries',async()=>{const copy=structuredClone(run);copy.id='paired-evidence-save';copy.results[0].rowDifferences=[{key:'第 120 行',baseline:{id:'120',note:'old'},target:{id:'120',note:'new'},changedColumns:['note'],reason:'字段值不一致'}];copy.results[0].differentRowCount=1;copy.results[0].schemaNotes=[{key:'id',column:'scale',baseline:0,target:1,reason:'不适用'}];copy.results[0].schemaNoteCount=1;await save('run',copy);const fetched=(await request('runs/'+copy.id)).data;assert.deepEqual(fetched.results[0].rowDifferences,copy.results[0].rowDifferences);assert.deepEqual(fetched.results[0].schemaNotes,copy.results[0].schemaNotes);const summary=(await request('bootstrap')).data.runs.find(r=>r.id===copy.id).results[0];assert.equal(summary.rowDifferences,undefined);assert.equal(summary.schemaNotes,undefined);assert.equal(summary.differentRowCount,1)});

test('table structure endpoint uses source identity and validates the selected table',async()=>{const selected=(await request('sources/demo-mc/catalog')).data.tables[0];const good=await request('sources/demo-mc/columns',{schema:selected.schema,table:selected.name});assert.equal(good.status,200);assert.equal(good.data.demo,true);assert.equal(good.data.columns.find(c=>c.name==='id').type,'BIGINT');assert.equal((await request('sources/demo-mc/columns',{schema:'wrong',table:'ods_order_info'})).status,400);assert.equal((await request('sources/demo-mc/columns',{schema:'default',table:''})).status,400);assert.equal((await request('sources/no-such-source/columns',{schema:'default',table:'ods_order_info'})).status,400);assert.ok(!JSON.stringify(good.data).includes('password'));});

test('parameterized runs use isolated values without modifying saved plan defaults',async()=>{
  const original=structuredClone(bootstrap.plans.find(p=>p.id==='demo-audit-plan-v1'));
  const started=await request('plans/'+original.id+'/run',{variables:{epsilon:'0'}});
  assert.equal(started.status,200);
  assert.equal(started.data.snapshot.variables.find(v=>v.name==='epsilon').value,'0');
  assert.equal(started.data.snapshot.variables.find(v=>v.name==='biz_date')?.value,original.variables.find(v=>v.name==='biz_date')?.value);
  let finished;
  for(let i=0;i<100;i++){
    finished=(await request('runs/'+started.data.id)).data;
    if(['completed','failed'].includes(finished.status))break;
    await new Promise(r=>setTimeout(r,10));
  }
  assert.equal(finished.status,'completed');
  const amount=finished.results.find(r=>r.dimension==='data'&&r.baselineTable==='audit_amounts');
  assert.ok(amount.differenceCount>0);
  const state=(await request('bootstrap')).data;
  assert.deepEqual(state.plans.find(p=>p.id===original.id).variables,original.variables);
  const normal=await request('plans/'+original.id+'/run',{});
  assert.equal(normal.status,200);
  assert.deepEqual(normal.data.snapshot.variables,original.variables);
  for(let i=0;i<100;i++){
    const r=(await request('runs/'+normal.data.id)).data;
    if(['completed','failed'].includes(r.status))break;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal((await request('runs/'+started.data.id)).data.snapshot.variables.find(v=>v.name==='epsilon').value,'0');
});

test('execution rejects unknown variables, changed types and invalid override values before queuing',async()=>{
  const id='demo-audit-plan-v1',before=(await request('bootstrap')).data.runs.length;
  for(const body of [{variables:{unknown:'1'}},{variables:{epsilon:1}},{variables:{epsilon:'bad'}},{variables:[]},{variables:null},{strategy:{}}]){
    assert.equal((await request('plans/'+id+'/run',body)).status,400,JSON.stringify(body));
  }
  assert.equal((await request('bootstrap')).data.runs.length,before);
});

test('source transfer excludes credentials and imports selected copies without passwords',async()=>{
  const raw={...source,id:crypto.randomUUID(),name:'Portable source',jdbcUrl:'jdbc:mysql://user:embedded@localhost:3306/test?password=url-secret&useSSL=true&access_key=key-secret',password:'plain-secret',secret:'encrypted-secret',properties:{password:'property-secret',accessKeySecret:'key-property',queryTimeout:'90',virtualCluster:'compute'}};
  await save('source',raw);
  const exported=await request('transfer/export',{kind:'sources',ids:[raw.id]});assert.equal(exported.status,200);
  const text=JSON.stringify(exported.data);for(const secret of ['embedded','url-secret','key-secret','plain-secret','encrypted-secret','property-secret','key-property'])assert.ok(!text.includes(secret));
  assert.equal(exported.data.items[0].jdbcUrl,'jdbc:mysql://localhost:3306/test?useSSL=true');
  exported.data.items[0].password='injected-password';exported.data.items[0].secret='injected-secret';exported.data.items[0].properties.password='injected-property';
  const imported=await request('transfer/import',{file:exported.data,ids:[raw.id],bindings:{}});assert.equal(imported.status,200);assert.equal(imported.data.count,1);
  const state=(await request('bootstrap')).data;const copy=state.sources.find(s=>s.name===raw.name&&s.id!==raw.id);assert.ok(copy);assert.equal(copy.hasPassword,false);assert.equal(copy.properties.queryTimeout,'90');assert.ok(!JSON.stringify(copy).includes('injected'));
  assert.match((await request('sources/'+copy.id+'/test',{})).data.error,/尚未配置密码/);
  assert.equal((await request('sources',{...copy,password:'new-local-password'})).status,200);
  const db=new DatabaseSync(join(dir,'prism.sqlite'),{readOnly:true});const stored=JSON.parse(db.prepare('SELECT payload FROM records WHERE id=?').get(copy.id).payload);assert.ok(stored.secret);assert.ok(!JSON.stringify(stored).includes('new-local-password'));db.close();
});

test('plan transfer remaps sources and IDs while retaining variables and independent rules',async()=>{
  const original=bootstrap.plans.find(p=>p.id==='demo-audit-plan-v1');
  const exported=(await request('transfer/export',{kind:'plans',ids:[original.id]})).data;
  assert.ok(exported.sources.every(s=>Object.keys(s).sort().join(',')==='id,name,type'));
  const bindings=Object.fromEntries(exported.sources.map(s=>[s.id,s.id]));
  const count=(await request('bootstrap')).data.plans.length;
  assert.equal((await request('transfer/import',{file:exported,ids:[original.id],bindings:{}})).status,400);
  assert.equal((await request('bootstrap')).data.plans.length,count);
  const result=await request('transfer/import',{file:exported,ids:[original.id],bindings});assert.equal(result.status,200);
  const copy=(await request('bootstrap')).data.plans.find(p=>p.name===original.name&&p.id!==original.id);assert.ok(copy);assert.deepEqual(copy.variables,original.variables);const expected=structuredClone(original.strategy);for(const key of ['filter','order','key','alignment','fallbackFilter','fallbackOrder'])delete expected[key];assert.deepEqual(copy.strategy,expected);assert.notEqual(copy.groups[0].id,original.groups[0].id);assert.notEqual(copy.groups[0].mappings[0].id,original.groups[0].mappings[0].id);assert.equal(copy.groups[0].baselineId,original.groups[0].baselineId);
});

test('configuration import validates the whole selected batch before writing any record',async()=>{
  const sourceId=(await request('bootstrap')).data.sources.find(s=>!s.demo).id;
  const file=(await request('transfer/export',{kind:'sources',ids:[sourceId]})).data;
  file.items.push({...file.items[0],id:'bad',jdbcUrl:'invalid'});
  const before=(await request('bootstrap')).data.sources.length;
  assert.equal((await request('transfer/import',{file,ids:file.items.map(s=>s.id),bindings:{}})).status,400);
  assert.equal((await request('bootstrap')).data.sources.length,before);
  assert.equal((await request('transfer/import',{file,ids:[sourceId],bindings:{}})).status,200);
  assert.equal((await request('bootstrap')).data.sources.length,before+1);
});

test('frozen tables stay in snapshots but do not execute; thawing affects only later runs',async()=>{
 const p=structuredClone(bootstrap.plans.find(p=>p.id==='demo-audit-plan-v1'));p.id='freeze-copy';p.name='Freeze integration';p.groups[0].mappings[0].frozen=true;
 let saved=(await request('plans',p)).data;
 const started=await request('plans/'+saved.id+'/run',{variables:{epsilon:'0.0001'}});assert.equal(started.status,200);assert.equal(started.data.totalTables,1);assert.equal(started.data.snapshot.groups[0].mappings.length,2);
 let r;for(let i=0;i<100;i++){r=(await request('runs/'+started.data.id)).data;if(['completed','failed'].includes(r.status))break;await new Promise(resolve=>setTimeout(resolve,10));}
 assert.equal(r.status,'completed');assert.equal(r.completedTables,1);assert.equal(r.results.length,3);assert.ok(r.results.every(x=>x.baselineTable==='audit_nulls'));
 saved.groups[0].mappings[0].frozen=false;assert.equal((await request('plans',saved)).status,200);assert.equal((await request('runs/'+r.id)).data.snapshot.groups[0].mappings[0].frozen,true);
 const thawed=await request('plans/'+saved.id+'/run',{});assert.equal(thawed.data.totalTables,2);
 for(let i=0;i<100;i++){const next=(await request('runs/'+thawed.data.id)).data;if(['completed','failed'].includes(next.status)){assert.equal(next.completedTables,2);break}await new Promise(resolve=>setTimeout(resolve,10));}
 saved.groups[0].mappings.forEach(m=>m.frozen=true);assert.equal((await request('plans',saved)).status,200);
 const all=await request('plans/'+saved.id+'/run',{});assert.equal(all.status,400);assert.match(all.data.error,/所有表均已冻结/);
});

test('plan tags update independently and persist through export without rewriting plan rules or run history',async()=>{
 const original=(await request('bootstrap')).data.plans.find(p=>p.id==='demo-audit-plan-v1');
 const beforeRun=(await request('bootstrap')).data.runs.find(r=>r.planId===original.id);
 const changed=await request('plans/'+original.id+'/tags',{tags:[' UAT ','回归','UAT','']});
 assert.equal(changed.status,200);assert.deepEqual(changed.data.tags,['UAT','回归']);
 for(const key of ['name','groups','strategy','variables','createdAt'])assert.deepEqual(changed.data[key],original[key]);
 const stored=(await request('bootstrap')).data.plans.find(p=>p.id===original.id);assert.deepEqual(stored.tags,['UAT','回归']);
 if(beforeRun)assert.deepEqual((await request('runs/'+beforeRun.id)).data.snapshot.tags,beforeRun.snapshot.tags);
 const exported=(await request('transfer/export',{kind:'plans',ids:[original.id]})).data;assert.deepEqual(exported.items[0].tags,['UAT','回归']);
 const imported=await request('transfer/import',{file:exported,ids:[original.id],bindings:Object.fromEntries(exported.sources.map(s=>[s.id,s.id]))});assert.equal(imported.status,200);
 const copies=(await request('bootstrap')).data.plans.filter(p=>p.id!==original.id&&p.name===original.name);assert.ok(copies.some(p=>JSON.stringify(p.tags)===JSON.stringify(['UAT','回归'])));

 for(const tags of ['bad',[123],['x'.repeat(41)],Array.from({length:21},(_,i)=>String(i))])assert.equal((await request('plans/'+original.id+'/tags',{tags})).status,400);
 assert.equal((await request('plans/missing-plan/tags',{tags:['x']})).status,400);
 assert.deepEqual((await request('plans/'+original.id+'/tags',{tags:[]})).data.tags,[]);
});


test('same-source plans save, export, import and start with distinct table mappings',async()=>{
 const p=structuredClone(bootstrap.plans.find(p=>p.id==='demo-audit-plan-v1'));p.id='same-source-new';p.name='同源不同表';
 p.groups=p.groups.slice(0,1);const g=p.groups[0];g.targetId=g.baselineId;g.mappings=g.mappings.slice(0,1);g.mappings[0].targetTable='audit_nulls';
 const saved=await request('plans',p);assert.equal(saved.status,200);
 const file=(await request('transfer/export',{kind:'plans',ids:[saved.data.id]})).data;assert.equal(file.sources.length,1);
 const imported=await request('transfer/import',{file,ids:[saved.data.id],bindings:{[g.baselineId]:g.baselineId}});assert.equal(imported.status,200);
 const started=await request('plans/'+saved.data.id+'/run',{});assert.equal(started.status,200);assert.equal(started.data.snapshot.groups[0].targetId,g.baselineId);assert.equal(started.data.snapshot.groups[0].mappings[0].targetTable,'audit_nulls');
});


test('paused real runs refresh gateway progress and retain logs outside bootstrap summaries',async()=>{
 const real=structuredClone(run);real.id='live-progress-test';real.remoteId=real.id;real.demo=false;real.status='paused';await save('run',real);
 const originalFetch=globalThis.fetch,oldUrl=testEnv.JDBC_GATEWAY_URL,oldToken=testEnv.JDBC_GATEWAY_TOKEN;
 const at=new Date().toISOString(),progress={stage:'querying',message:'等待数据库返回',groupId:'g',mappingId:'m',dimension:'data',side:'target',at,startedAt:at,sql:'SELECT * FROM t'};
 try{testEnv.JDBC_GATEWAY_URL='http://127.0.0.1:8081';testEnv.JDBC_GATEWAY_TOKEN='test-only';let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({...real,status:'running',progress,progressEvents:[progress],gatewayObservedAt:at,executor:{active:1,queued:0,capacity:2}})};
 const fresh=await request('runs/'+real.id);assert.equal(fresh.status,200);assert.equal(calls,1);assert.equal(fresh.data.status,'running');assert.deepEqual(fresh.data.progress,progress);assert.equal(fresh.data.progressEvents.length,1);
 const summary=(await request('bootstrap')).data.runs.find(r=>r.id===real.id);assert.equal(summary.progress.stage,'querying');assert.equal(summary.progressEvents,undefined);
 }finally{globalThis.fetch=originalFetch;if(oldUrl===undefined)delete testEnv.JDBC_GATEWAY_URL;else testEnv.JDBC_GATEWAY_URL=oldUrl;if(oldToken===undefined)delete testEnv.JDBC_GATEWAY_TOKEN;else testEnv.JDBC_GATEWAY_TOKEN=oldToken;}
});

test('catalog forwards only validated MaxCompute namespace metadata and keeps legacy and demo responses usable',async()=>{
 const mc=await request('sources',{name:'Catalog MC',type:'maxcompute',jdbcUrl:'jdbc:odps:https://service.example/api?project=resolved_project',catalog:'',schema:'',username:'catalog-reader',password:'test-only-catalog-password'});
 const lake=await request('sources',{name:'Catalog Lakehouse',type:'lakehouse',jdbcUrl:'jdbc:clickzetta://instance.example/analytics',catalog:'analytics',schema:'dws',username:'catalog-reader',password:'test-only-catalog-password'});
 assert.equal(mc.status,200);assert.equal(lake.status,200);
 const originalFetch=globalThis.fetch,oldUrl=testEnv.JDBC_GATEWAY_URL,oldToken=testEnv.JDBC_GATEWAY_TOKEN;
 const tables=[{name:'orders',schema:'resolved_project',catalog:''}];let payload,calls=0;
 try{
  testEnv.JDBC_GATEWAY_URL='http://127.0.0.1:8081';testEnv.JDBC_GATEWAY_TOKEN='test-only';
  globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'http://127.0.0.1:8081/catalog');assert.equal(options.method,'POST');return Response.json(payload);};
  for(const namespaceMode of ['project','schema']){
   payload={tables,schemas:['resolved_project'],namespaceMode,project:'resolved_project',password:'must-not-forward',secret:'must-not-forward',unrelated:{value:'must-not-forward'}};
   const result=await request('sources/'+mc.data.id+'/catalog');assert.equal(result.status,200);
   assert.deepEqual(result.data,{tables,demo:false,namespaceMode,project:'resolved_project'});
  }
  // Older runners and incomplete/invalid metadata must not break table selection.
  for(const extra of [{},{namespaceMode:'unknown',project:'resolved_project'},{namespaceMode:'project',project:123},{namespaceMode:'project',project:' '},{namespaceMode:'schema'}]){
   payload={tables,...extra};const result=await request('sources/'+mc.data.id+'/catalog');assert.equal(result.status,200);assert.deepEqual(result.data,{tables,demo:false});
  }
  payload={tables,namespaceMode:'project',project:'must-not-forward'};
  assert.deepEqual((await request('sources/'+lake.data.id+'/catalog')).data,{tables,demo:false});
  const beforeDemo=calls,demo=await request('sources/demo-mc/catalog');assert.equal(demo.status,200);assert.equal(demo.data.demo,true);assert.ok(demo.data.tables.length);assert.deepEqual(Object.keys(demo.data).sort(),['demo','tables']);assert.equal(calls,beforeDemo);
 }finally{
  globalThis.fetch=originalFetch;if(oldUrl===undefined)delete testEnv.JDBC_GATEWAY_URL;else testEnv.JDBC_GATEWAY_URL=oldUrl;if(oldToken===undefined)delete testEnv.JDBC_GATEWAY_TOKEN;else testEnv.JDBC_GATEWAY_TOKEN=oldToken;
 }
});
