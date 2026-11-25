import type {ColumnInfo,ColumnPair} from './model';
export type SortField={name:string;direction:'ASC'|'DESC'};
export const selectableField=(name:string)=>/^[A-Za-z_][A-Za-z_0-9]*$/.test(name);
export function parseKeyFields(value:string):string[]|null{
  if(!value.trim())return [];
  const names:string[]=[],seen=new Set<string>();
  for(const part of value.split(',')){
    const match=/^\s*(?:`([A-Za-z_][A-Za-z_0-9]*)`|([A-Za-z_][A-Za-z_0-9]*))\s*$/.exec(part);
    if(!match)return null;
    const name=match[1]||match[2];
    if(seen.has(name.toLowerCase()))return null;
    seen.add(name.toLowerCase());names.push(name);
  }
  return names;
}
export function mergeColumns(baseline:ColumnInfo[],target:ColumnInfo[]):ColumnPair[]{
  const map=new Map<string,ColumnPair>();
  for(const column of baseline)map.set(column.name.toLowerCase(),{name:column.name,baseline:column});
  for(const column of target){const key=column.name.toLowerCase();map.set(key,{...(map.get(key)||{name:column.name}),target:column});}
  return [...map.values()];
}
export function parseSortFields(order:string):SortField[]|null{
  if(!order.trim())return [];
  const fields:SortField[]=[],seen=new Set<string>();
  for(const part of order.split(',')){
    const match=/^\s*(?:`([A-Za-z_][A-Za-z_0-9]*)`|([A-Za-z_][A-Za-z_0-9]*))(?:\s+(ASC|DESC))?\s*$/i.exec(part);
    if(!match)return null;
    const name=match[1]||match[2];if(seen.has(name.toLowerCase()))return null;seen.add(name.toLowerCase());
    fields.push({name,direction:(match[3]?.toUpperCase()||'ASC') as SortField['direction']});
  }
  return fields;
}
export const formatSortFields=(fields:SortField[])=>fields.map(f=>`${f.name} ${f.direction}`).join(', ');
export function moveSortField(fields:SortField[],index:number,delta:number):SortField[]{
  const next=[...fields],destination=index+delta;
  if(index<0||index>=fields.length||destination<0||destination>=fields.length)return next;
  [next[index],next[destination]]=[next[destination],next[index]];return next;
}
