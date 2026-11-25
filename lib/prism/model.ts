export type SourceType = 'maxcompute' | 'lakehouse' | 'mysql';
export type Dimension = 'schema' | 'count' | 'data';
export type State = 'queued' | 'running' | 'paused' | 'pausing' | 'cancelling' | 'completed' | 'failed' | 'cancelled';
export type Variable = {name:string; value:string; type:'string'|'number'|'identifier'};
export type SqlPair = {baseline:string; target:string};
export type Strategy = {ignoreJsonKeyOrder?:boolean;ignoreTimeDifference?:boolean;timeToleranceSeconds?:string;specified?:string[];dimensions:Dimension[]; mode:'sample'|'full'; alignment?:'position'|'key'; limit:string; ignorePrecision:boolean; tolerance:string; ignoredValues:string[]; ignoredColumns?:string[]; filter:string; fallbackFilter:string; order:string; fallbackOrder:string; key:string; sql:Record<Dimension,SqlPair>};
export type Source = {id:string; name:string; type:SourceType; jdbcUrl:string; username:string; catalog:string; schema:string; driver:string; demo:boolean; status:'untested'|'connected'|'error'; testedAt?:string; error?:string; hasPassword?:boolean; password?:string; secret?:string; properties?:Record<string,string>};
export type ColumnInfo = {name:string;type:string;nullable:boolean;precision:number;scale:number};
export type ColumnPair = {name:string;baseline?:ColumnInfo;target?:ColumnInfo};
export type TableRef = {name:string; schema:string; catalog?:string; columns?:string[]};
export type Mapping = {frozen?:boolean;id:string; baselineTable:string; baselineSchema:string; targetTable:string; targetSchema:string; override:boolean; strategy:Strategy};
export type Comparison = {id:string; baselineId:string; targetId:string; mappings:Mapping[]};
export type Plan = {tags?:string[];id:string; name:string; description:string; createdAt:string; updatedAt:string; groups:Comparison[]; variables:Variable[]; strategy:Strategy; demo?:boolean};
export type Diff = {key:string; column:string; baseline:unknown; target:unknown; reason:string};
export type DataDiffRow = {key:string; baseline:Record<string,unknown>|null; target:Record<string,unknown>|null; changedColumns:string[]; reason:string; partial?:boolean};
export type IgnoredDiff = Diff & {rule:string; ruleValue:string; delta?:string};
export type Evidence = {sql:string; parameters:Record<string,unknown>; columns:string[]; rows:Record<string,unknown>[]; rowCount:string; capturedAt:string; durationMs:number; truncated?:boolean};
export type ExecutionTrace = {sourceId:string;sourceName:string;operation:string;sql:string;at:string;parameters:unknown[]};
export type Result = {id:string; groupId:string; baselineTable:string; baselineSchema:string; targetTable:string; targetSchema:string; baselineName:string; targetName:string; dimension:Dimension; status:'passed'|'different'|'error'|'skipped'; summary:string; baseline?:Evidence; target?:Evidence; differences:Diff[]; ignoredDifferences:IgnoredDiff[]; rowDifferences?:DataDiffRow[]; differentRowCount?:number; schemaNotes?:Diff[]; schemaNoteCount?:number; executionTrace?:ExecutionTrace[]; differenceCount:number; ignoredCount:number; durationMs:number; strategy:Strategy; error?:string};
export type RunProgress = {stage:string;message:string;at:string;startedAt:string;groupId?:string;mappingId?:string;dimension?:Dimension;baselineTable?:string;baselineSchema?:string;targetTable?:string;targetSchema?:string;side?:'baseline'|'target';sourceName?:string;sql?:string;rows?:string};
export type Run = {progress?:RunProgress;progressEvents?:RunProgress[];gatewayObservedAt?:string;executor?:{active:number;queued:number;capacity:number};id:string; planId:string; name:string; status:State; demo:boolean; startedAt:string; finishedAt?:string; updatedAt:string; totalTables:number; completedTables:number; currentTable?:string; results:Result[]; snapshot:Plan; error?:string; remoteId?:string; demoToken?:string};
export const types:Record<SourceType,{name:string;letter:string;color:string;driver:string;url:string}>={
  maxcompute:{name:'MaxCompute',letter:'M',color:'orange',driver:'com.aliyun.odps.jdbc.OdpsDriver',url:'jdbc:odps:https://service.cn-hangzhou.maxcompute.aliyun.com/api?project=your_project&enableLimit=false'},
  lakehouse:{name:'云器 Lakehouse',letter:'Y',color:'purple',driver:'com.clickzetta.client.jdbc.ClickZettaDriver',url:'jdbc:clickzetta://your_instance.cn-shanghai-alicloud.api.clickzetta.com/your_workspace?virtualCluster=default'},
  mysql:{name:'MySQL',letter:'m',color:'blue',driver:'com.mysql.cj.jdbc.Driver',url:'jdbc:mysql://localhost:3306/your_database?useCursorFetch=true&useSSL=true'},
};
export const dimensionNames:Record<Dimension,string>={schema:'表结构',count:'行数',data:'数据'};
export function defaultStrategy():Strategy{return {dimensions:['schema','count','data'],mode:'sample',alignment:'position',limit:'100',ignorePrecision:false,tolerance:'0',ignoreJsonKeyOrder:false,ignoreTimeDifference:false,timeToleranceSeconds:'1',ignoredValues:[],filter:'',fallbackFilter:'',order:'',fallbackOrder:'',key:'',sql:{schema:{baseline:'',target:''},count:{baseline:'',target:''},data:{baseline:'',target:''}}};}
export function newPlan():Plan{const now=new Date().toISOString();return {id:crypto.randomUUID(),name:'',description:'',createdAt:now,updatedAt:now,groups:[],variables:[{name:'ds',value:now.slice(0,10),type:'string'}],strategy:globalStrategy(defaultStrategy())};}
export function metrics(run?:Run){if(!run)return {passed:0,issues:0,errors:0,total:0,rate:0};const groups=new Map<string,Result[]>();for(const r of run.results){const key=r.groupId+'|'+r.id.split(':')[0];groups.set(key,[...(groups.get(key)||[]),r]);}let passed=0,issues=0,errors=0;for(const rs of groups.values()){if(rs.some(r=>r.status==='error'))errors++;else if(rs.some(r=>r.status==='different'))issues++;else if(rs.every(r=>r.status==='passed'))passed++;}return {passed,issues,errors,total:run.totalTables,rate:run.totalTables?Math.round(passed/run.totalTables*1000)/10:0};}
export function executableTables(p:Plan){return p.groups.reduce((n,g)=>n+g.mappings.filter(m=>!m.frozen).length,0)}
export function totalTables(p:Plan){return p.groups.reduce((a,g)=>a+g.mappings.length,0)}
export const strategyPaths=['dimensions','mode','alignment','limit','ignorePrecision','tolerance','ignoreJsonKeyOrder','ignoreTimeDifference','timeToleranceSeconds','ignoredValues','ignoredColumns','filter','order','key',...(['schema','count','data'] as const).flatMap(d=>['sql.'+d+'.baseline','sql.'+d+'.target'])];
const pathValue=(s:any,path:string)=>path.split('.').reduce((v,k)=>v?.[k],s);
const setPath=(s:any,path:string,value:any)=>{const keys=path.split('.');let node=s;for(const key of keys.slice(0,-1))node=node[key]??(node[key]={});node[keys[keys.length-1]]=value;};
const specifiedValue=(v:unknown)=>v!==undefined&&v!==null&&(typeof v!=='string'||!!v.trim())&&(!Array.isArray(v)||v.length>0);
export const tableOnlyPaths=['filter','order','alignment','key'];
export function globalStrategy(strategy:Strategy):Strategy{
 const result=structuredClone(strategy);for(const key of [...tableOnlyPaths,'fallbackFilter','fallbackOrder'])delete (result as any)[key];return result;
}
export function effectiveStrategy(p:Plan,m:Mapping):Strategy{
 const result:Strategy={...globalStrategy(p.strategy),filter:'',order:'',alignment:'position' as const,key:'',fallbackFilter:'',fallbackOrder:''};delete result.specified;
 if(!m.override)return result;
 if(!m.strategy.specified&&m.strategy.alignment===undefined)result.alignment='key';
 for(const path of strategyPaths){const v=pathValue(m.strategy,path);if((!m.strategy.specified||m.strategy.specified.includes(path))&&specifiedValue(v))setPath(result,path,structuredClone(v));}
 return result;
}
export function tableStrategyChanges(stored:Strategy,before:Strategy,after:Strategy):Strategy{
 const result=structuredClone(stored),specified=new Set(stored.specified||strategyPaths.filter(path=>specifiedValue(pathValue(stored,path))));
 for(const path of strategyPaths)if(JSON.stringify(pathValue(before,path))!==JSON.stringify(pathValue(after,path))){const v=pathValue(after,path);setPath(result,path,v);if(specifiedValue(v))specified.add(path);else specified.delete(path);}
 result.specified=[...specified];return result;
}
export function resolveValue(value:string,vars:Variable[]){return value.replace(/\$\{([A-Za-z_]\w*)\}/g,(_,n)=>{const v=vars.find(v=>v.name===n);if(!v)throw Error('未定义变量：'+n);return v.value;});}
export function validatePlan(p:Plan,sources:Source[]){
  if(!p.name?.trim())throw Error('请填写测试计划名称');
  if(!p.groups?.length)throw Error('请添加至少一组数据源比对');
  const names=new Set<string>();for(const v of p.variables){if(!/^[A-Za-z_]\w*$/.test(v.name)||names.has(v.name)||['table','schema','limit'].includes(v.name))throw Error('变量名称重复、无效或使用了内置名称：'+v.name);names.add(v.name);if(v.type==='number'&&!/^-?\d+(\.\d+)?$/.test(v.value))throw Error('数值变量格式不正确：'+v.name);if(v.type==='identifier'&&!/^[A-Za-z_]\w*$/.test(v.value))throw Error('标识符变量只能包含字母、数字、下划线');}
  for(const g of p.groups){const a=sources.find(s=>s.id===g.baselineId),b=sources.find(s=>s.id===g.targetId);if(!a||!b)throw Error('请选择有效的数据源');if(a.demo!==b.demo)throw Error('演示数据源不能与真实数据源混合比对');if(!g.mappings.length)throw Error('每组比对至少选择一张表');for(const m of g.mappings){if(!m.baselineTable||!m.targetTable)throw Error('请为每张基准表选择目标表');if(m.frozen!==undefined&&typeof m.frozen!=='boolean')throw Error('表冻结状态无效');if(m.frozen)continue;if(m.strategy.specified!==undefined&&(!Array.isArray(m.strategy.specified)||m.strategy.specified.some(path=>!strategyPaths.includes(path))))throw Error('表级覆盖项无效');const s=effectiveStrategy(p,m);if(s.ignoredColumns!==undefined&&(!Array.isArray(s.ignoredColumns)||s.ignoredColumns.some(c=>typeof c!=='string'||!c.trim())))throw Error('忽略字段必须为字段名称列表');if(!s.dimensions.length)throw Error('至少启用一种校验维度');if(s.alignment!==undefined&&!['position','key'].includes(s.alignment))throw Error('数据对齐方式无效');if(s.mode==='sample'){const limit=Number(resolveValue(s.limit,p.variables));if(!Number.isInteger(limit)||limit<1||limit>10000)throw Error('抽样行数必须为 1–10000 的整数');}if(s.ignoreTimeDifference){const seconds=resolveValue(s.timeToleranceSeconds??'1',p.variables);if(!/^\d+(\.\d+)?$/.test(seconds)||!Number.isFinite(Number(seconds)))throw Error('时间差阈值必须为非负秒数');}const t=Number(resolveValue(s.tolerance,p.variables));if(!Number.isFinite(t)||t<0)throw Error('精度误差必须为非负数');for(const value of [s.filter,s.fallbackFilter,s.order,s.fallbackOrder,...((s.alignment??'key')==='key'?[s.key]:[]),...s.ignoredValues])resolveValue(value,p.variables);}}
}
