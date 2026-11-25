import type {Comparison,Source,TableRef,Plan} from './model';
export type CatalogNamespace={namespaceMode?:'project'|'schema';project?:string};
function configuredNamespace(source:Source){
 let params=new URLSearchParams();
 if(source.type==='maxcompute')try{params=new URL(source.jdbcUrl.slice('jdbc:odps:'.length)).searchParams}catch{}
 return {catalog:source.catalog.trim()||(params.get('project')||'').trim(),schema:(params.get('schema')||'').trim()||source.schema.trim()};
}
function mappedNamespace(schema:string,previous:Source|undefined,next:Source|undefined):string{
 if(!previous||!next)return schema;
 const {catalog:oldCatalog,schema:oldSchema}=configuredNamespace(previous),nextNamespace=configuredNamespace(next);
 const nextDefault=next.type==='mysql'?(nextNamespace.catalog||nextNamespace.schema):next.type==='maxcompute'?(nextNamespace.schema||nextNamespace.catalog):nextNamespace.schema;
 // ODPS two-tier metadata and MySQL expose the project/database as TABLE_SCHEM.
 // Lakehouse workspace is supplied separately by the connection, never as a schema.
 const usesCatalog=previous.type!=='lakehouse'&&!!oldCatalog&&schema===oldCatalog;
 const usesDefault=!!oldSchema&&schema===oldSchema;
 if(usesCatalog||usesDefault||!schema)return nextDefault||schema;
 return schema;
}

export type ProjectMappingChange={groupId:string;sourceId:string;side:'baselineId'|'targetId';project:string;count:number};
export function reconcileProjectMappings(plan:Plan,sources:Source[],catalogs:Record<string,CatalogNamespace>){
 const changes:ProjectMappingChange[]=[],conflicts:string[]=[];
 const groups=plan.groups.map(group=>{
  let mappings=group.mappings;
  for(const side of ['baselineId','targetId'] as const){
   const source=sources.find(s=>s.id===group[side]),info=catalogs[group[side]];
   if(source?.type!=='maxcompute'||info?.namespaceMode!=='project'||!info.project?.trim())continue;
   const project=info.project.trim(),field=side==='baselineId'?'baselineSchema':'targetSchema';
   const count=mappings.filter(m=>m[field]!==project).length;
   // Never collapse distinct selected baseline rows into one hidden mapping.
   if(side==='baselineId'&&new Set(mappings.map(m=>m.baselineTable)).size!==mappings.length){
    conflicts.push('比对组中的基准表存在重名，无法统一到 Project「'+project+'」；请先取消重复的基准表映射。');continue;
   }
   if(!count)continue;
   mappings=mappings.map(m=>m[field]===project?m:{...m,[field]:project});
   changes.push({groupId:group.id,sourceId:source.id,side,project,count});
  }
  return mappings===group.mappings?group:{...group,mappings};
 });
 return {plan:changes.length?{...plan,groups}:plan,changes,conflicts};
}
export function replaceGroupSource(group:Comparison,side:'baselineId'|'targetId',sourceId:string,keepMappings=true,sources:Source[]=[]):Comparison{
 if(group[side]===sourceId)return group;
 const previous=sources.find(s=>s.id===group[side]),next=sources.find(s=>s.id===sourceId);
 const field=side==='baselineId'?'baselineSchema':'targetSchema';
 let mappings=keepMappings?group.mappings.map(m=>({...m,[field]:mappedNamespace(m[field],previous,next)})):[];
 if(side==='baselineId'&&new Set(mappings.map(m=>JSON.stringify([m.baselineSchema,m.baselineTable]))).size!==mappings.length)mappings=group.mappings;
 return {...group,[side]:sourceId,mappings};
}
export function catalogWithMappings(tables:TableRef[],group:Comparison):TableRef[]{
 const known=new Set(tables.map(t=>JSON.stringify([t.schema,t.name])));
 return [...tables,...group.mappings.filter(m=>!known.has(JSON.stringify([m.baselineSchema,m.baselineTable]))).map(m=>({schema:m.baselineSchema,name:m.baselineTable}))];
}
