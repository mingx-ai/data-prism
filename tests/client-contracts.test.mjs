import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
let dir,model,demo,client,decimal,catalogView,report,time,sourceSwitch;
before(async()=>{dir=await mkdtemp(join(tmpdir(),'prism-contract-'));for(const name of ['model','demo','client','decimal','catalog-view','report-html','time-tolerance','source-switch'])await build({entryPoints:['lib/prism/'+name+'.ts'],outfile:join(dir,name+'.mjs'),bundle:true,platform:'node',target:'node22',format:'esm'});sourceSwitch=await import(pathToFileURL(join(dir,'source-switch.mjs')).href);time=await import(pathToFileURL(join(dir,'time-tolerance.mjs')).href);report=await import(pathToFileURL(join(dir,'report-html.mjs')).href);catalogView=await import(pathToFileURL(join(dir,'catalog-view.mjs')).href);model=await import(pathToFileURL(join(dir,'model.mjs')).href);demo=await import(pathToFileURL(join(dir,'demo.mjs')).href);client=await import(pathToFileURL(join(dir,'client.mjs')).href);decimal=await import(pathToFileURL(join(dir,'decimal.mjs')).href)});after(async()=>rm(dir,{recursive:true,force:true}));
test('exact decimal calculations do not lose the threshold boundary',()=>{assert.equal(decimal.decimalDelta('1.234567','1.2345'),'0.000067');assert.equal(decimal.decimalDelta('9007199254740993.000001','9007199254740993.000000'),'0.000001');assert.ok(decimal.decimalWithin('100.123456','100.123459','0.000003'));assert.ok(!decimal.decimalWithin('100.123456','100.123459','0.000002'));assert.equal(decimal.decimalDelta('1e2','99.0'),'1')});
test('table rules override plan rules and copied parameters stay independent',()=>{const p=demo.auditDemoPlan(),m=p.groups[0].mappings[0];assert.equal(model.effectiveStrategy(p,m).ignorePrecision,p.strategy.ignorePrecision);m.override=true;m.strategy.tolerance='0.05';m.strategy.specified.push('tolerance');assert.equal(model.effectiveStrategy(p,m).tolerance,'0.05');const copy=structuredClone(p);copy.variables[0].value='changed';assert.notEqual(copy.variables[0].value,p.variables[0].value)});
test('a passed audit example retains precision and null differences',()=>{const p=demo.auditDemoPlan(),r=demo.completedDemo(p);assert.equal(model.metrics(r).passed,2);assert.equal(r.results.reduce((n,r)=>n+r.ignoredCount,0),4);assert.ok(r.results.every(r=>r.status==='passed'));assert.equal(r.results.find(r=>r.dimension==='data'&&r.baselineTable==='audit_nulls').ignoredDifferences[0].target,'\\N')});
test('downloadable HTML and JSON retain ignored evidence and escape untrusted content',async()=>{const r=demo.completedDemo(demo.auditDemoPlan());r.name='<script>alert(1)</script>';let link;globalThis.document={createElement(){link={click(){}};return link}};client.downloadReport(r,'html');const html=await (await fetch(link.href)).text();assert.ok(html.includes('已忽略差异'));assert.ok(html.includes('absolute_tolerance'));assert.ok(html.includes('0.000067'));assert.ok(html.includes('null_equivalence'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>alert'));client.downloadReport(r,'json');const data=await (await fetch(link.href)).json();assert.equal(data.results.reduce((n,r)=>n+r.ignoredDifferences.length,0),4);delete globalThis.document});

test('global filter and alignment are ignored including stale variables',()=>{const p=demo.auditDemoPlan(),m=p.groups[0].mappings[0];p.strategy.filter='${removed_filter}';p.strategy.key='${removed_key}';p.strategy.order='${removed_order}';p.strategy.alignment='invalid';p.strategy.fallbackFilter='${removed_fallback}';assert.doesNotThrow(()=>model.validatePlan(p,demo.demoSources));m.override=false;const effective=model.effectiveStrategy(p,m);assert.equal(effective.filter,'');assert.equal(effective.order,'');assert.equal(effective.key,'');assert.equal(effective.alignment,'position');});

test('selected tables precede pagination and schema identity is preserved',()=>{const tables=[{schema:'ods',name:'a'},{schema:'ods',name:'b'},{schema:'dwd',name:'a'},{schema:'dwd',name:'c'}];const mappings=[{baselineSchema:'dwd',baselineTable:'a'},{baselineSchema:'dwd',baselineTable:'c'}];assert.deepEqual(catalogView.orderedCatalog(tables,mappings).slice(0,2),tables.slice(2));assert.deepEqual(catalogView.orderedCatalog(tables,mappings,'a'),[tables[2],tables[0]]);assert.deepEqual(catalogView.orderedCatalog(tables,mappings,'','ods'),tables.slice(0,2));assert.deepEqual(catalogView.orderedCatalog(tables,mappings,' \t dwd . a \n'),[tables[2]]);assert.deepEqual(catalogView.orderedCatalog(tables,mappings,'　a　'),[tables[2],tables[0]]);assert.equal(tables[0].schema,'ods');assert.deepEqual(catalogView.orderedCatalog(tables,[]),tables)});
test('multi-schema target mapping prefers exact schema and leaves ambiguous names unselected',()=>{const targets=[{schema:'ods',name:'orders'},{schema:'dwd',name:'orders'}];assert.equal(catalogView.matchingTarget({schema:'dwd',name:'orders'},targets),targets[1]);assert.equal(catalogView.matchingTarget({schema:'project',name:'orders'},targets),undefined);assert.equal(catalogView.matchingTarget({schema:'project',name:'orders'},targets.slice(0,1)),targets[0])});

test('target schema options remain stable when selecting an existing schema and distinguish an unset schema',()=>{
 const tables=[{schema:'public',name:'orders'},{schema:'dws',name:'orders'},{schema:'dws',name:'items'}];
 assert.deepEqual(catalogView.targetSchemaChoices(tables,''),['dws','public']);
 assert.deepEqual(catalogView.targetSchemaChoices(tables,'dws'),catalogView.targetSchemaChoices(tables,''));
 assert.deepEqual(catalogView.targetSchemaChoices(tables,'public','orders'),['dws','public']);
 assert.deepEqual(catalogView.targetSchemaChoices(tables,'missing','orders'),['dws','missing','public']);
 assert.deepEqual(catalogView.targetSchemaChoices(tables,'','retained_table'),['','dws','public']);
 assert.deepEqual(catalogView.targetSchemaChoices([{schema:'',name:'orders'},...tables],''),['','dws','public']);
 assert.deepEqual(catalogView.targetSchemaChoices([],''),[]);
 assert.deepEqual(catalogView.targetSchemaChoices([],'dws'),['dws']);
 assert.deepEqual(tables.map(t=>t.schema),['public','dws','dws']);
});

test('explicit target schema choice resolves a blank ambiguous mapping without replacing a custom table choice',()=>{
 const tables=[{schema:'public',name:'orders'},{schema:'dws',name:'orders'},{schema:'dws',name:'custom_orders'},{schema:'dws',name:'Orders'},{schema:'',name:'orders'}];
 const mapping={baselineSchema:'project',baselineTable:'orders',targetSchema:'',targetTable:''};
 const original=structuredClone(mapping);
 assert.deepEqual(catalogView.targetInSchema(mapping,'dws',tables),{targetSchema:'dws',targetTable:'orders'});
 assert.deepEqual(catalogView.targetInSchema(mapping,'public',tables),{targetSchema:'public',targetTable:'orders'});
 assert.deepEqual(catalogView.targetInSchema(mapping,'',tables),{targetSchema:'',targetTable:'orders'});
 assert.deepEqual(catalogView.targetInSchema(mapping,'missing',tables),{targetSchema:'missing',targetTable:''});
 assert.deepEqual(catalogView.targetInSchema({...mapping,targetTable:'custom_orders'},'dws',tables),{targetSchema:'dws',targetTable:'custom_orders'});
 assert.deepEqual(catalogView.targetInSchema({...mapping,targetTable:'custom_orders'},'public',tables),{targetSchema:'public',targetTable:''});
 assert.deepEqual(catalogView.targetInSchema({...mapping,targetTable:'ORDERS'},'dws',tables),{targetSchema:'dws',targetTable:''});
 assert.deepEqual(catalogView.targetInSchema({...mapping,baselineTable:'ORDERS'},'dws',tables),{targetSchema:'dws',targetTable:''});
 assert.deepEqual(mapping,original);
});

test('same-source comparisons keep blank target tables unselected when changing schema',()=>{
 const tables=[{schema:'dws',name:'orders'},{schema:'dws',name:'orders_copy'}];
 const mapping={baselineSchema:'dws',baselineTable:'orders',targetSchema:'',targetTable:''};
 assert.deepEqual(catalogView.targetInSchema(mapping,'dws',tables,true),{targetSchema:'dws',targetTable:''});
 assert.deepEqual(catalogView.targetInSchema({...mapping,targetTable:'orders_copy'},'dws',tables,true),{targetSchema:'dws',targetTable:'orders_copy'});
});

test('table-level rules drop hidden fallbacks while preserving ignored fields',()=>{const p=demo.auditDemoPlan(),m=p.groups[0].mappings[0];m.override=true;m.strategy={...p.strategy,fallbackFilter:'old_filter',fallbackOrder:'old_order',ignoredColumns:['amount']};const effective=model.effectiveStrategy(p,m);assert.equal(effective.fallbackFilter,'');assert.equal(effective.fallbackOrder,'');assert.deepEqual(effective.ignoredColumns,['amount']);assert.equal(m.strategy.fallbackOrder,'old_order');});

test('new plans use ds and table overrides inherit omitted values while keeping explicit false and zero',()=>{
 const fresh=model.newPlan();assert.equal(fresh.strategy.filter,undefined);assert.equal(fresh.variables[0].name,'ds');assert.equal(fresh.strategy.order,undefined);assert.equal(fresh.strategy.key,undefined);
 const p=demo.auditDemoPlan(),m=p.groups[0].mappings[0];m.override=true;m.strategy={...model.defaultStrategy(),specified:[]};
 assert.equal(model.effectiveStrategy(p,m).ignorePrecision,true);
 const before=model.effectiveStrategy(p,m);m.strategy=model.tableStrategyChanges(m.strategy,before,{...before,ignorePrecision:false,tolerance:'0',order:'ts DESC'});
 let merged=model.effectiveStrategy(p,m);assert.equal(merged.ignorePrecision,false);assert.equal(merged.tolerance,'0');assert.equal(merged.filter,'');assert.equal(merged.order,'ts DESC');
 p.strategy.limit='25';assert.equal(model.effectiveStrategy(p,m).limit,'25');
 m.strategy=model.tableStrategyChanges(m.strategy,merged,{...merged,order:''});assert.equal(model.effectiveStrategy(p,m).order,'');
 p.strategy.sql.data={baseline:'global baseline',target:'global target'};
 merged=model.effectiveStrategy(p,m);m.strategy=model.tableStrategyChanges(m.strategy,merged,{...merged,sql:{...merged.sql,data:{baseline:'',target:'table target'}}});
 assert.equal(model.effectiveStrategy(p,m).sql.data.baseline,'global baseline');assert.equal(model.effectiveStrategy(p,m).sql.data.target,'table target');
});


test('HTML report leads with per-table summary and execution variables before grouped evidence',()=>{
 const run=demo.completedDemo(demo.auditDemoPlan());run.snapshot.variables[0].value='2026-09-14';
 const html=report.reportHtml(run);
 assert.ok(html.includes('<strong>100<small>%</small>'));
 assert.ok(html.indexOf('<section class="overview">')<html.indexOf('<h2>本次执行变量</h2>'));
 assert.ok(html.indexOf('<h2>本次执行变量</h2>')<html.indexOf('id="table-0"'));
 assert.ok(html.includes('2026-09-14'));assert.equal((html.match(/class="panel table-detail"/g)||[]).length,2);
 assert.ok(html.includes('href="#table-1"'));assert.ok(html.includes('absolute_tolerance'));assert.ok(html.includes('SQL、绑定参数与原始查询结果'));assert.ok(html.includes('null_equivalence'));
 assert.ok(!html.includes('<script'));assert.ok(!html.includes('<link'));
 const frozenId=run.snapshot.groups[0].mappings[0].id;run.snapshot.groups[0].mappings[0].frozen=true;run.results=run.results.filter(r=>!r.id.startsWith(frozenId+':'));run.totalTables=1;run.completedTables=1;
 const frozen=report.reportHtml(run);assert.ok(frozen.includes('冻结跳过'));assert.ok(frozen.includes('<strong>100<small>%</small>'));
 run.status='cancelled';run.results=run.results.filter(r=>r.dimension==='schema');run.completedTables=0;
 const partial=report.reportHtml(run);assert.ok(partial.includes('<strong>0<small>%</small>'));assert.ok(partial.includes('未执行'));
});


test('time tolerance uses exact seconds and inherits independently of numeric precision',()=>{
 assert.equal(time.timeDeltaSeconds('2026-06-29 17:54:04','2026-06-29 17:54:04.637'),'0.637');
 assert.equal(time.timeDeltaSeconds('2026-09-11T08:29:22.616Z','2026-09-11T08:29:22.509Z'),'0.107');
 assert.equal(time.timeDeltaSeconds('2026-09-11T16:29:22+08:00','2026-09-11T08:29:22Z'),'0');
 assert.equal(time.timeDeltaSeconds('2026-02-30 08:29:22','2026-03-02 08:29:22'),null);assert.equal(time.timeDeltaSeconds('2026-09-11 08:29:22','2026-09-11T08:29:22Z'),null);
 const p=demo.auditDemoPlan(),m=p.groups[0].mappings[0];p.strategy.ignoreTimeDifference=true;p.strategy.timeToleranceSeconds='${seconds}';p.variables.push({name:'seconds',value:'0.5',type:'number'});assert.doesNotThrow(()=>model.validatePlan(p,demo.demoSources));assert.equal(model.effectiveStrategy(p,m).ignoreTimeDifference,true);
 const before=model.effectiveStrategy(p,m);m.strategy=model.tableStrategyChanges(m.strategy,before,{...before,ignoreTimeDifference:false});assert.equal(model.effectiveStrategy(p,m).ignoreTimeDifference,false);
 p.strategy.timeToleranceSeconds='-1';assert.throws(()=>model.validatePlan(p,demo.demoSources),/时间差阈值/);
});


test('switching data sources preserves all mapping rules and missing catalog entries',()=>{
 const p=demo.auditDemoPlan(),g=p.groups[0];g.mappings[0].frozen=true;g.mappings[0].strategy.timeToleranceSeconds='0.5';
 const original=structuredClone(g),changed=sourceSwitch.replaceGroupSource(g,'baselineId','new-environment');
 assert.equal(changed.baselineId,'new-environment');assert.equal(changed.targetId,g.targetId);assert.deepEqual(changed.mappings,original.mappings);assert.deepEqual(g,original);
 const catalog=[{schema:'new_schema',name:g.mappings[0].baselineTable}];const visible=sourceSwitch.catalogWithMappings(catalog,changed);
 assert.equal(visible.length,3);assert.ok(visible.some(t=>t.schema===g.mappings[0].baselineSchema&&t.name===g.mappings[0].baselineTable));assert.equal(catalog.length,1);
 assert.deepEqual(sourceSwitch.replaceGroupSource(g,'targetId','new-target',false).mappings,[]);
 assert.deepEqual(sourceSwitch.replaceGroupSource(g,'targetId',g.targetId,false).mappings,g.mappings);
});


test('switching environments translates configured namespaces on only the changed side',()=>{
 const g=demo.auditDemoPlan().groups[0];g.mappings[0].baselineSchema='old_project';g.mappings[0].frozen=true;
 g.mappings[1].baselineSchema='custom_schema';const original=structuredClone(g);
 const old={id:g.baselineId,type:'maxcompute',catalog:'old_project',schema:''};
 const next={id:'new',type:'maxcompute',catalog:'new_project',schema:''};
 let changed=sourceSwitch.replaceGroupSource(g,'baselineId','new',true,[old,next]);
 assert.equal(changed.mappings[0].baselineSchema,'new_project');assert.equal(changed.mappings[1].baselineSchema,'custom_schema');
 assert.equal(changed.mappings[0].targetSchema,g.mappings[0].targetSchema);assert.equal(changed.mappings[0].frozen,true);assert.deepEqual(changed.mappings[0].strategy,g.mappings[0].strategy);assert.deepEqual(g,original);
 old.type=next.type='mysql';assert.equal(sourceSwitch.replaceGroupSource(g,'baselineId','new',true,[old,next]).mappings[0].baselineSchema,'new_project');
 old.type=next.type='lakehouse';old.schema='old_schema';next.schema='new_schema';g.mappings[0].baselineSchema='old_schema';
 assert.equal(sourceSwitch.replaceGroupSource(g,'baselineId','new',true,[old,next]).mappings[0].baselineSchema,'new_schema');
 next.schema='';assert.equal(sourceSwitch.replaceGroupSource(g,'baselineId','new',true,[old,next]).mappings[0].baselineSchema,'old_schema');
 old.id=g.targetId;g.mappings[0].targetSchema='old_schema';next.schema='new_schema';
 changed=sourceSwitch.replaceGroupSource(g,'targetId','new',true,[old,next]);assert.equal(changed.mappings[0].targetSchema,'new_schema');assert.equal(changed.mappings[0].baselineSchema,'old_schema');
});

test('JSON key order tolerance defaults off and supports independent table overrides',()=>{
 assert.equal(model.defaultStrategy().ignoreJsonKeyOrder,false);
 const p=demo.auditDemoPlan(),m=p.groups[0].mappings[0];p.strategy.ignoreJsonKeyOrder=true;
 const effective=model.effectiveStrategy(p,m);assert.equal(effective.ignoreJsonKeyOrder,true);
 m.override=true;m.strategy=model.tableStrategyChanges(m.strategy,effective,{...effective,ignoreJsonKeyOrder:false});
 assert.equal(model.effectiveStrategy(p,m).ignoreJsonKeyOrder,false);assert.ok(m.strategy.specified.includes('ignoreJsonKeyOrder'));
 assert.doesNotThrow(()=>model.validatePlan(p,demo.demoSources));
});


test('catalog mismatch diagnostics distinguish schema, name variants and unselected mappings',()=>{
 const tables=[{schema:'ods',name:'orders'},{schema:'dwd',name:'orders'},{schema:'ods',name:'TripData'}];
 assert.equal(catalogView.catalogMatch(tables,'ods','orders').kind,'found');
 const other=catalogView.catalogMatch(tables,'old_schema','orders');assert.equal(other.kind,'other-schema');assert.deepEqual(other.candidates.map(t=>t.schema),['ods','dwd']);
 assert.equal(catalogView.catalogMatch(tables,'ods','tripdata ').kind,'similar');
 assert.equal(catalogView.catalogMatch(tables,'ods','missing').kind,'missing');assert.equal(catalogView.catalogMatch(tables,'ods','').kind,'unselected');
 assert.equal(tables[2].name,'TripData');
});

test('switching MaxCompute sources resolves projects specified only in JDBC URLs',()=>{
 const g=demo.auditDemoPlan().groups[0];g.mappings[0].baselineSchema='old_project';
 const old={id:g.baselineId,type:'maxcompute',catalog:'',schema:'',jdbcUrl:'jdbc:odps:https://example.invalid/api?project=old_project'};
 const next={id:'next',type:'maxcompute',catalog:'',schema:'',jdbcUrl:'jdbc:odps:https://example.invalid/api?project=new_project'};
 assert.equal(sourceSwitch.replaceGroupSource(g,'baselineId',next.id,true,[old,next]).mappings[0].baselineSchema,'new_project');
 next.jdbcUrl+='&schema=custom';assert.equal(sourceSwitch.replaceGroupSource(g,'baselineId',next.id,true,[old,next]).mappings[0].baselineSchema,'custom');
 next.jdbcUrl=next.jdbcUrl.replace('schema=custom','schema=%20');next.schema='form_schema';assert.equal(sourceSwitch.replaceGroupSource(g,'baselineId',next.id,true,[old,next]).mappings[0].baselineSchema,'form_schema');
 assert.equal(g.mappings[0].baselineSchema,'old_project');
});

test('verified two-tier catalogs repair copied and already-stale mappings without losing rules or frozen tables',()=>{
 const p=demo.auditDemoPlan(),g=p.groups[0];g.mappings.forEach(m=>{m.baselineSchema='old_project';m.targetSchema='dws'});g.mappings[0].frozen=true;
 const before=structuredClone(p),sources=[{id:g.baselineId,type:'maxcompute'},{id:g.targetId,type:'lakehouse'}];
 const catalogs={[g.baselineId]:{namespaceMode:'project',project:'new_project'},[g.targetId]:{namespaceMode:'project',project:'should_not_apply'}};
 const result=sourceSwitch.reconcileProjectMappings(p,sources,catalogs);
 assert.equal(result.changes.length,1);assert.equal(result.changes[0].count,2);assert.deepEqual(result.conflicts,[]);
 result.plan.groups[0].mappings.forEach((m,i)=>{assert.equal(m.baselineSchema,'new_project');assert.deepEqual({...m,baselineSchema:'old_project'},before.groups[0].mappings[i]);});
 assert.deepEqual(p,before);assert.equal(sourceSwitch.reconcileProjectMappings(result.plan,sources,catalogs).plan,result.plan);
 // A missing table is retained under the current project, never removed or silently unfrozen.
 assert.equal(result.plan.groups[0].mappings.length,2);assert.equal(result.plan.groups[0].mappings[0].frozen,true);
});

test('project reconciliation uses actual namespace mode and handles both sides of same-source plans',()=>{
 const p=demo.auditDemoPlan(),g=p.groups[0];g.targetId=g.baselineId;
 const sources=[{id:g.baselineId,type:'maxcompute'}];
 for(const info of [{},{namespaceMode:'schema',project:'next'},{namespaceMode:'project',project:''}])assert.equal(sourceSwitch.reconcileProjectMappings(p,sources,{[g.baselineId]:info}).plan,p);
 assert.equal(sourceSwitch.reconcileProjectMappings(p,sources,{}).plan,p);
 const changed=sourceSwitch.reconcileProjectMappings(p,sources,{[g.baselineId]:{namespaceMode:'project',project:'next'}});
 assert.equal(changed.changes.length,2);assert.ok(changed.plan.groups[0].mappings.every(m=>m.baselineSchema==='next'&&m.targetSchema==='next'));
});

test('project reconciliation does not collapse distinct baseline mappings with duplicate table names',()=>{
 const p=demo.auditDemoPlan(),g=p.groups[0];g.mappings[1].baselineTable=g.mappings[0].baselineTable;g.mappings[1].baselineSchema='other_schema';
 const result=sourceSwitch.reconcileProjectMappings(p,[{id:g.baselineId,type:'maxcompute'}],{[g.baselineId]:{namespaceMode:'project',project:'next'}});
 assert.equal(result.plan,p);assert.equal(result.changes.length,0);assert.match(result.conflicts[0],/重名/);
});

test('source switching keeps colliding baseline rows distinct and verified projects reject existing duplicates',()=>{
 const p=demo.auditDemoPlan(),g=p.groups[0];g.mappings[0].baselineSchema='old';g.mappings[1].baselineSchema='next';g.mappings[1].baselineTable=g.mappings[0].baselineTable;
 const previous={id:g.baselineId,type:'maxcompute',catalog:'old',schema:''},next={id:'new-id',type:'maxcompute',catalog:'next',schema:''};
 const switched=sourceSwitch.replaceGroupSource(g,'baselineId',next.id,true,[previous,next]);assert.equal(switched.baselineId,next.id);assert.deepEqual(switched.mappings,g.mappings);
 g.mappings.forEach(m=>m.baselineSchema='next');
 const result=sourceSwitch.reconcileProjectMappings(p,[previous],{[previous.id]:{namespaceMode:'project',project:'next'}});assert.equal(result.changes.length,0);assert.match(result.conflicts[0],/重名/);
});
