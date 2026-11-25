import {normalizeTags} from './plan-tags';
import {type Plan,type Source,types,validatePlan,globalStrategy} from './model';
export type TransferKind='sources'|'plans';
export type SourceRef=Pick<Source,'id'|'name'|'type'>;
export type TransferFile={format:'prism-config';version:1;kind:TransferKind;items:any[];sources:SourceRef[]};
const secretKey=(key:string)=>/password|passwd|pwd|passphrase|secret|token|credential|accesskey|privatekey|apikey/i.test(decodeURIComponent(key).replace(/[^a-z0-9]/gi,''));
export function safeJdbcUrl(value:string):string{
  const clean=value.replace(/(\/\/)[^/@?#]+@/g,'$1');
  const start=clean.search(/[?;]/);
  if(start<0)return clean;
  const prefix=clean.slice(0,start),separator=clean[start];
  const parameters=clean.slice(start+1).split(/[&;]/).filter(part=>{
    const equal=part.indexOf('=');return equal<0||!secretKey(part.slice(0,equal));
  }).filter(Boolean);
  return prefix+(parameters.length?separator+parameters.join(separator==='?'?'&':';'):'');
}
export function portableSource(input:Source):Source{
  if(!input||!Object.hasOwn(types,input.type)||typeof input.name!=='string'||!input.name.trim()||typeof input.jdbcUrl!=='string'||typeof input.username!=='string')throw Error('数据源配置缺少名称、类型、连接地址或用户名');
  const prefix={mysql:'jdbc:mysql:',maxcompute:'jdbc:odps:',lakehouse:'jdbc:clickzetta:'}[input.type];
  if(!input.jdbcUrl.startsWith(prefix))throw Error('JDBC 地址与数据源类型不匹配：'+input.name);
  const properties:Record<string,string>={};
  for(const [key,value] of Object.entries(input.properties||{}))if(!secretKey(key)&&typeof value==='string')properties[key]=/url|uri/i.test(key)?safeJdbcUrl(value):value;
  return {id:input.id,name:input.name,type:input.type,jdbcUrl:safeJdbcUrl(input.jdbcUrl),username:input.username,catalog:typeof input.catalog==='string'?input.catalog:'',schema:typeof input.schema==='string'?input.schema:'',driver:types[input.type].driver,properties,demo:false,status:'untested'};
}
export function exportConfig(kind:TransferKind,items:(Source|Plan)[],sources:Source[]):TransferFile{
  const ids=new Set(kind==='plans'?(items as Plan[]).flatMap(p=>p.groups.flatMap(g=>[g.baselineId,g.targetId])):[]);
  return {format:'prism-config',version:1,kind,items:kind==='sources'?(items as Source[]).map(portableSource):(items as Plan[]).map(p=>({...structuredClone(p),strategy:globalStrategy(p.strategy)})),sources:sources.filter(s=>ids.has(s.id)).map(({id,name,type})=>({id,name,type}))};
}
export function readTransfer(input:unknown):TransferFile{
  const f=input as TransferFile;
  if(!f||f.format!=='prism-config'||f.version!==1||!['sources','plans'].includes(f.kind)||!Array.isArray(f.items)||!f.items.length||f.items.length>1000||f.items.some(i=>!i||typeof i.id!=='string'||typeof i.name!=='string')||new Set(f.items.map(i=>i.id)).size!==f.items.length)throw Error('不是有效的 Prism 配置文件（支持版本 1，最多 1000 项）');
  if(f.kind==='plans'&&(!Array.isArray(f.sources)||f.sources.some(s=>!s||typeof s.id!=='string'||typeof s.name!=='string'||!Object.hasOwn(types,s.type))))throw Error('计划文件缺少有效的数据源引用');
  if(f.kind==='plans'&&f.items.some(p=>!Array.isArray(p.groups)||p.groups.some((g:any)=>!g||typeof g.baselineId!=='string'||typeof g.targetId!=='string'||!Array.isArray(g.mappings))))throw Error('计划比对组格式不正确');
  return f;
}
export function prepareImport(file:TransferFile,selectedIds:string[],bindings:Record<string,string>,sources:Source[]):(Source|Plan)[]{
  readTransfer(file);
  if(!Array.isArray(selectedIds)||!selectedIds.length||new Set(selectedIds).size!==selectedIds.length||selectedIds.some(id=>!file.items.some(i=>i.id===id)))throw Error('请选择有效的导入项目');
  return file.items.filter(i=>selectedIds.includes(i.id)).map(item=>{
    if(file.kind==='sources')return {...portableSource(item),id:crypto.randomUUID()};
    const p=structuredClone(item) as Plan;p.tags=normalizeTags(p.tags);p.strategy=globalStrategy(p.strategy);
    p.id=crypto.randomUUID();p.createdAt=p.updatedAt=new Date().toISOString();delete p.demo;
    if(!Array.isArray(p.groups))throw Error('计划比对组格式不正确');
    p.groups=p.groups.map(g=>{
      const bind=(id:string)=>{
        const ref=file.sources.find(s=>s.id===id),target=sources.find(s=>s.id===bindings?.[id]);
        if(!ref||!target||ref.type!==target.type)throw Error('请为计划选择类型一致的数据源：'+(ref?.name||id));
        return target.id;
      };
      return {...g,id:crypto.randomUUID(),baselineId:bind(g.baselineId),targetId:bind(g.targetId),mappings:g.mappings.map(m=>({...m,id:crypto.randomUUID(),strategy:m.override?{...m.strategy,fallbackFilter:'',fallbackOrder:''}:m.strategy}))};
    });
    validatePlan(p,sources);return p;
  });
}
