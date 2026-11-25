import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
let dir,view;
before(async()=>{
  dir=await mkdtemp(join(tmpdir(),'prism-diff-grid-'));
  await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {RunVariables} from './components/prism/run-variables';export const renderVariables=(run,compact)=>renderToStaticMarkup(React.createElement(RunVariables,{run,compact}));export {matchesRun} from './lib/prism/run-search';import {DifferenceGrid} from './components/prism/difference-grid';import {EvidenceTable} from './components/prism/evidence-table';export const renderEvidence=(evidence)=>renderToStaticMarkup(React.createElement(EvidenceTable,{evidence}));import {SortFields} from './components/prism/sort-fields';import {KeyFields} from './components/prism/key-fields';export const renderKey=(value,columns)=>renderToStaticMarkup(React.createElement(KeyFields,{value,columns,onChange:()=>{}}));import {StrategyForm} from './components/prism/strategy-form';export const renderStrategy=(value,compact)=>renderToStaticMarkup(React.createElement(StrategyForm,{value,compact,columns:[],onChange:()=>{}}));export * from './lib/prism/field-options';export const renderSort=(value,columns)=>renderToStaticMarkup(React.createElement(SortFields,{value,columns,onChange:()=>{}}));export * from './lib/prism/difference-rows';export * from './lib/prism/difference-html';export * from './lib/prism/json-diff';export * from './lib/prism/plan-tags';export * from './lib/prism/run-progress';import {TargetSchemaSelect,TargetTableCandidates} from './components/prism/target-mapping';export const renderSchemaSelect=props=>renderToStaticMarkup(React.createElement(TargetSchemaSelect,props));export const renderTargetCandidates=props=>renderToStaticMarkup(React.createElement(TargetTableCandidates,props));import {CatalogMatchHint} from './components/prism/catalog-match';export const renderCatalogHint=(props)=>renderToStaticMarkup(React.createElement(CatalogMatchHint,props));import {RunProgressPanel} from './components/prism/run-progress';export const renderProgress=(run,lastFetchedAt)=>renderToStaticMarkup(React.createElement(RunProgressPanel,{run,lastFetchedAt}));import {PlanTagFilter} from './components/prism/plan-tags';export const renderTagFilter=(available,selected,mode)=>renderToStaticMarkup(React.createElement(PlanTagFilter,{available,selected,mode,onChange:()=>{},onMode:()=>{}}));export const render=result=>renderToStaticMarkup(React.createElement(DifferenceGrid,{result}));`,resolveDir:resolve('.')},outfile:join(dir,'view.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',alias:{'@':resolve('.')},jsx:'automatic'});
  view=(await import(pathToFileURL(join(dir,'view.cjs')).href)).default;
});
after(async()=>rm(dir,{recursive:true,force:true}));
function fixture(){return {dimension:'data',strategy:{alignment:'position'},baselineName:'MC',targetName:'CZ',differenceCount:1,differentRowCount:1,differences:[],rowDifferences:[{key:'第 120 行',baseline:{id:'120',amount:'1.23',note:'before'},target:{id:'120',amount:'1.23001',note:'after'},changedColumns:['note'],reason:'字段值不一致'}]};}
test('paired view renders full context but highlights only declared differences',()=>{
  const r=fixture(),html=view.render(r);
  assert.equal((html.match(/data-different="true"/g)||[]).length,2);
  assert.ok(html.includes('rowSpan="2"'));
  assert.ok(html.includes('第 120 行'));
  assert.ok(html.includes('1.23001'));
  assert.ok(!/class="pair-changed[^>]*>[^<]*1\.23/.test(html));
  assert.ok(html.includes('仅差异字段'));
});
test('legacy field evidence stays partial rather than borrowing unmatched preview rows',()=>{
  const r={...fixture(),rowDifferences:undefined,differences:[{key:'["9007199254740993"]',column:'note',baseline:'a',target:'b',reason:'字段值不一致'}],baseline:{rows:[{id:'wrong',other:'unrelated'}]}};
  const [row]=view.differenceRows(r);assert.equal(row.partial,true);assert.deepEqual(row.baseline,{note:'a'});assert.equal(view.cellText(row,'baseline','other'),'未留存');assert.ok(!view.render(r).includes('unrelated'));
});
test('missing records, missing fields, NULL and empty text remain distinct',()=>{
  const row={key:'x',baseline:{empty:'',n:null},target:null,changedColumns:['empty','n'],reason:'目标缺少记录'};
  assert.equal(view.cellText(row,'target','n'),'记录不存在');assert.equal(view.cellText(row,'baseline','n'),'NULL');assert.equal(view.cellText(row,'baseline','absent'),'字段不存在');assert.equal(view.cellText(row,'baseline','empty'),'空字符串');
});
test('HTML export uses paired highlights and safely retains expandable long content',()=>{
  const r=fixture();r.rowDifferences[0].target.note='<script>alert(1)</script>'+('long'.repeat(80));
  const html=view.differenceHtml(r);
  assert.equal((html.match(/class="pair-baseline"/g)||[]).length,1);assert.equal((html.match(/class="pair-target"/g)||[]).length,1);
  assert.ok(html.includes('<details>'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('1.23001'));assert.ok(view.render(r).includes('查看目标 第 120 行 note 的完整内容'));
});

test('sort selection preserves direction, priority and manual variables',()=>{const fields=view.parseSortFields('`ts` desc, id');assert.deepEqual(fields,[{name:'ts',direction:'DESC'},{name:'id',direction:'ASC'}]);assert.equal(view.formatSortFields(view.moveSortField(fields,1,-1)),'id ASC, ts DESC');assert.equal(fields[0].name,'ts');assert.equal(view.parseSortFields('${order_fields}'),null);assert.equal(view.parseSortFields('id ASC, ID DESC'),null);assert.deepEqual(view.parseSortFields(''),[]);assert.equal(view.parseSortFields('id; DROP TABLE x'),null)});
test('field references merge both sides and sorting UI labels unavailable fields',()=>{const columns=view.mergeColumns([{name:'ID',type:'BIGINT',nullable:false},{name:'left_only',type:'STRING',nullable:true}],[{name:'id',type:'BIGINT',nullable:false},{name:'right_only',type:'STRING',nullable:true}]);assert.equal(columns.length,3);assert.ok(columns[0].baseline&&columns[0].target);const html=view.renderSort('ID DESC',columns);assert.ok(html.includes('ID 排序方向'));assert.ok(html.includes('仅一侧存在'));assert.ok(html.includes('排序选择 ID'));assert.ok(view.renderSort('${order_fields}',columns).includes('清空后使用字段勾选'));});

test('table strategy hides fallbacks and exposes field exclusion checkboxes',()=>{const strategy={dimensions:['data'],mode:'sample',limit:'100',filter:'',fallbackFilter:'',order:'id ASC',fallbackOrder:'id',alignment:'position',ignoredColumns:['note'],ignoredValues:[],ignorePrecision:false,tolerance:'0',sql:{schema:{},count:{},data:{}}};const html=view.renderStrategy(strategy,true);assert.ok(!html.includes('字段缺失时的备用筛选'));assert.ok(!html.includes('排序备用字段'));assert.ok(html.includes('忽略对比 note'));const common=view.renderStrategy(strategy,false);assert.ok(!common.includes('筛选与对齐规则'));assert.ok(!common.includes('字段缺失时的备用筛选'));});


test('key picker retains composite keys, unavailable selections and manual variables',()=>{
  assert.deepEqual(view.parseKeyFields('`Order_ID`, item_id'),['Order_ID','item_id']);
  assert.equal(view.parseKeyFields('${key_fields}'),null);
  assert.equal(view.parseKeyFields('id, ID'),null);
  assert.deepEqual(view.parseKeyFields(''),[]);
  const columns=view.mergeColumns([{name:'Order_ID',type:'BIGINT'},{name:'left_only',type:'STRING'}],[{name:'order_id',type:'BIGINT'}]);
  const html=view.renderKey('Order_ID, item_id',columns);
  assert.ok(html.includes('已选 2 个字段'));
  assert.match(html,/aria-checked="true"[^>]*aria-label="对齐键选择 Order_ID"/);
  assert.match(html,/aria-checked="true"[^>]*aria-label="对齐键选择 item_id"/);
  assert.ok(html.includes('两侧未同时找到此字段'));
  assert.ok(view.renderKey('item_id',undefined).includes('对齐键选择 item_id'));
  assert.ok(view.renderKey('${key_fields}',columns).includes('${key_fields}'));
  assert.ok(view.renderKey('',columns).includes('未勾选时沿用排序字段'));
});


test('raw evidence bounds long values and provides full-text actions without losing adjacent cells',()=>{
 const html=view.renderEvidence({columns:['payload','next','empty','nil'],rows:[{payload:'<script>'+('x'.repeat(300)),next:'neighbor',empty:'',nil:null}]});
 assert.ok(html.includes('查看第 1 行 payload 的全文'));assert.ok(html.includes('查看全文'));assert.ok(html.includes('neighbor'));assert.ok(html.includes('空字符串'));assert.ok(html.includes('NULL'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('x'.repeat(150)));
});


test('execution variables use snapshot values, preserve empty values and expose long content',()=>{
 const run={id:'run-123',name:'daily',snapshot:{variables:[{name:'ds',value:'2026-09-09',type:'string'},{name:'empty',value:'',type:'string'},{name:'long',value:'<script>'+('x'.repeat(100)),type:'string'},{name:'fourth',value:'visible-on-expand',type:'string'}]}};
 const html=view.renderVariables(run,true);assert.ok(html.includes('2026-09-09'));assert.ok(html.includes('空字符串'));assert.ok(html.includes('查看全文'));assert.ok(html.includes('展开其余 1 个变量'));assert.ok(!html.includes('<script>'));assert.ok(view.matchesRun(run,'ds=2026-09-09'));assert.ok(view.matchesRun(run,'RUN-123'));assert.ok(!view.matchesRun(run,'2026-09-08'));assert.ok(view.renderVariables({snapshot:{variables:[]}},true).includes('未配置计划变量'));assert.ok(view.renderVariables({},true).includes('未留存变量信息'));
});


test('JSON comparison ignores recursive object order but preserves arrays, types and exact numbers',()=>{
 assert.equal(view.jsonEquivalent('{"k1":"v1","k2":{"x":1,"y":2}}','{"k2":{"y":2,"x":1},"k1":"v1"}'),true);
 for(const [a,b] of [['[1,2]','[2,1]'],['{"x":1}','{"x":"1"}'],['{}','{"x":null}'],['{"x":9007199254740993}','{"x":9007199254740992}'],['{"x":1,"x":2}','{"x":2}'],['{"x":1} trailing','{"x":1}']])assert.equal(view.jsonEquivalent(a,b),false);
 assert.equal(view.jsonEquivalent('{"x":1.0}','{"x":1}'),true);
});
test('JSON differences highlight only changed values in both page and offline report',()=>{
 const r=fixture();r.rowDifferences[0].baseline.note='{"same":"safe","nested":{"x":"before"},"missing":1}';r.rowDifferences[0].target.note='{"nested":{"x":"after"},"same":"safe"}';
 const diff=view.jsonDiff(r.rowDifferences[0].baseline.note,r.rowDifferences[0].target.note);
 assert.deepEqual(diff.baseline.filter(p=>p.changed).map(p=>p.text),['"before"','"missing":1']);
 for(const html of [view.render(r),view.differenceHtml(r)]){assert.ok(html.includes('<mark'));assert.ok(!html.includes('class="pair-changed'));assert.ok(!/<mark[^>]*>[^<]*safe/.test(html));}
 const malicious=view.jsonDiff('{"x":"<script>"}','{"x":"ok"}');assert.equal(malicious.baseline.filter(p=>p.changed)[0].text,'"<script>"');
 r.rowDifferences[0].baseline.note='{"x":"<script>"}';r.rowDifferences[0].target.note='{"x":"ok"}';assert.ok(!view.differenceHtml(r).includes('<script>'));assert.ok(!view.render(r).includes('<script>'));
});


test('plan tags normalize and support any/all filters including older plans',()=>{
 assert.deepEqual(view.normalizeTags([' UAT ','回归','UAT','']),['UAT','回归']);assert.deepEqual(view.normalizeTags(undefined),[]);
 const a={tags:['UAT','回归']},b={tags:['UAT']};assert.equal(view.matchesTags(a,['UAT','回归'],'all'),true);assert.equal(view.matchesTags(b,['UAT','回归'],'all'),false);assert.equal(view.matchesTags(b,['UAT','回归'],'any'),true);assert.equal(view.matchesTags({},[]),true);assert.equal(view.matchesTags({},['UAT']),false);
 assert.deepEqual(new Set(view.availableTags([a,b,{}])),new Set(['UAT','回归']));
 const html=view.renderTagFilter(['UAT','回归'],['UAT'],'any');assert.ok(html.includes('aria-pressed="true"'));assert.ok(html.includes('清空标签筛选'));assert.ok(html.includes('回归'));
});


test('live progress distinguishes active step, queued dimensions and terminal omissions',()=>{
 const now=Date.now(),at=new Date(now-45000).toISOString();const run={status:'running',updatedAt:at,progress:{groupId:'g',mappingId:'m',dimension:'data',side:'target',stage:'querying',message:'等待数据库返回',sql:'SELECT * FROM target WHERE ds = ?',startedAt:at,at},progressEvents:[],executor:{active:2,capacity:2,queued:1}};
 assert.match(view.pendingDimension(run,'g','m','data'),/执行中.*目标侧.*等待数据库返回/);assert.equal(view.pendingDimension(run,'g','other','data'),'等待前序校验');assert.equal(view.pendingDimension({...run,status:'failed'},'g','other','data'),'本次未执行');assert.equal(view.pendingDimension({...run,status:'queued'},'g','other','data'),'排队中');
 const html=view.renderProgress(run,now);assert.ok(html.includes('45 秒'));assert.ok(html.includes('没有上报新进展'));assert.ok(html.includes('SELECT * FROM target'));assert.ok(html.includes('最近成功刷新'));
 assert.ok(view.renderProgress(run,now-20000).includes('进度刷新中断'));assert.ok(view.renderProgress({...run,progress:undefined},now).includes('旧版 JDBC 服务'));
});


test('catalog warnings identify retained mapping and offer explicit alternatives without claiming absence',()=>{
 const props={tables:[{schema:'actual',name:'orders'}],schema:'old',name:'orders',sourceId:'cloud',workspace:'uat',onSelect:()=>{}};
 const html=view.renderCatalogHint(props);assert.ok(html.includes('uat.old.orders'));assert.ok(html.includes('其他 Schema'));assert.ok(html.includes('改为 actual.orders'));assert.ok(html.includes('校验已保存的表映射'));assert.ok(!html.includes('新环境目录中未找到'));
 assert.equal(view.renderCatalogHint({...props,name:''}),'');assert.equal(view.renderCatalogHint({...props,schema:'actual'}),'');
});


test('unselected target schema is explicit and same-name candidates include their namespace',()=>{
 const tables=[{schema:'public',name:'orders'},{schema:'dws',name:'orders'}];
 const mapping={baselineTable:'orders',targetTable:'',targetSchema:''};
 const props={tables,mapping,onChange:()=>{},onSelect:()=>{}};
 const schema=view.renderSchemaSelect(props);assert.ok(schema.includes('请选择目标 Schema'));assert.ok(!schema.includes('默认 Schema'));
 const candidates=view.renderTargetCandidates(props);assert.ok(candidates.includes('多个 Schema'));assert.ok(candidates.includes('关联 public.orders'));assert.ok(candidates.includes('关联 dws.orders'));assert.ok(!candidates.includes('未找到'));
 assert.equal(view.renderTargetCandidates({...props,mapping:{...mapping,targetTable:'orders',targetSchema:'dws'}}),'');
 const realDefault=view.renderSchemaSelect({...props,tables:[{schema:'',name:'orders'}]});assert.ok(realDefault.includes('默认 Schema'));
 const savedDefault=view.renderSchemaSelect({...props,mapping:{...mapping,targetTable:'orders'}});assert.ok(savedDefault.includes('默认 Schema'));
 const missing=view.renderTargetCandidates({...props,mapping:{...mapping,baselineTable:'other'}});assert.ok(missing.includes('请选择目标 Schema'));
});

test('MaxCompute diagnostics distinguish stale project mappings from actual three-tier schemas',()=>{
 const props={tables:[{name:'orders',schema:'new_project'}],sourceType:'maxcompute',namespaceMode:'project',workspace:'new_project',schema:'old_project',name:'orders',sourceId:'mc'};
 const twoTier=view.renderCatalogHint(props);assert.ok(twoTier.includes('old_project.orders'));assert.ok(twoTier.includes('当前数据源 Project：new_project'));assert.ok(!twoTier.includes('new_project.old_project.orders'));assert.ok(!twoTier.includes('其他 Schema'));
 const legacy=view.renderCatalogHint({...props,namespaceMode:undefined});assert.ok(!legacy.includes('new_project.old_project.orders'));assert.ok(legacy.includes('确认项目的命名空间模式'));
 const threeTier=view.renderCatalogHint({...props,namespaceMode:'schema',schema:'business'});assert.ok(threeTier.includes('new_project.business.orders'));
 const sameNameSchema=view.renderCatalogHint({...props,tables:[],namespaceMode:'schema',schema:'new_project'});assert.ok(sameNameSchema.includes('new_project.new_project.orders'));
});
