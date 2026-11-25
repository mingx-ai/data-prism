import type {DataDiffRow, Result} from './model';

// Older reports contain field differences only. Never invent unchanged values
// or align their first 100 preview rows by an unverified key.
export function differenceRows(result:Result):DataDiffRow[]{
  if(result.rowDifferences)return result.rowDifferences;
  const groups=new Map<string,DataDiffRow>();
  for(const d of result.differences){
    let row=groups.get(d.key);
    if(!row){row={key:d.key,baseline:{},target:{},changedColumns:[],reason:d.reason,partial:true};groups.set(d.key,row);}
    if(d.column==='整行'){
      row.baseline=d.baseline as Record<string,unknown>|null;
      row.target=d.target as Record<string,unknown>|null;
      row.changedColumns=[...new Set([...Object.keys(row.baseline??{}),...Object.keys(row.target??{})])];
      row.partial=false;
    }else{
      if(row.baseline)row.baseline[d.column]=d.baseline;
      if(row.target)row.target[d.column]=d.target;
      if(!row.changedColumns.includes(d.column))row.changedColumns.push(d.column);
    }
  }
  return [...groups.values()];
}

export function differenceColumns(rows:DataDiffRow[]):string[]{
  return [...new Set(rows.flatMap(r=>[...Object.keys(r.baseline??{}),...Object.keys(r.target??{}),...r.changedColumns]))];
}

export function cellText(row:DataDiffRow,side:'baseline'|'target',column:string):string{
  const record=row[side];
  if(record===null)return '记录不存在';
  if(!Object.hasOwn(record,column))return row.partial?'未留存':'字段不存在';
  const value=record[column];
  if(value===null)return 'NULL';
  if(value==='')return '空字符串';
  return typeof value==='object'?JSON.stringify(value):String(value);
}
