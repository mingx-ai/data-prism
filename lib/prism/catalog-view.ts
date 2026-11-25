import type {TableRef,Mapping} from './model';
export const tableIdentity=(t:TableRef)=>JSON.stringify([t.schema,t.name]);
export function orderedCatalog(tables:TableRef[],mappings:Mapping[],search='',schema?:string){
  const normalize=(value:string)=>value.replace(/\s/g,'').toLowerCase();
  const query=normalize(search);
  const selected=new Set(mappings.map(m=>JSON.stringify([m.baselineSchema,m.baselineTable])));
  return tables.filter(t=>(schema===undefined||schema===t.schema)&&normalize(t.schema+'.'+t.name).includes(query))
    .sort((a,b)=>Number(selected.has(tableIdentity(b)))-Number(selected.has(tableIdentity(a))));
}
export function matchingTarget(table:TableRef,targets:TableRef[]):TableRef|undefined{
  const matches=targets.filter(t=>t.name===table.name);
  return matches.find(t=>t.schema===table.schema)??(matches.length===1?matches[0]:undefined);
}

export function targetSchemaChoices(tables:TableRef[],currentSchema:string,currentTable=''){
 const schemas=new Set(tables.map(t=>t.schema));
 // Keep saved namespaces visible, but do not invent a default namespace for an empty mapping.
 if(currentSchema||currentTable)schemas.add(currentSchema);
 return [...schemas].sort((a,b)=>a.localeCompare(b));
}

export function targetInSchema(mapping:Pick<Mapping,'baselineTable'|'targetTable'>,schema:string,tables:TableRef[],sameSource=false){
 const name=mapping.targetTable||(!sameSource?mapping.baselineTable:'');
 const match=name?tables.find(t=>t.schema===schema&&t.name===name):undefined;
 return {targetSchema:schema,targetTable:match?.name||''};
}

export function catalogMatch(tables:TableRef[],schema:string,name:string){
 if(!name)return {kind:'unselected' as const,candidates:[] as TableRef[]};
 if(tables.some(t=>t.schema===schema&&t.name===name))return {kind:'found' as const,candidates:[] as TableRef[]};
 const sameName=tables.filter(t=>t.name===name);
 if(sameName.length)return {kind:'other-schema' as const,candidates:sameName};
 const normalized=(s:string)=>s.trim().toLowerCase();
 const similar=tables.filter(t=>normalized(t.name)===normalized(name));
 return {kind:similar.length?'similar' as const:'missing' as const,candidates:similar};
}
