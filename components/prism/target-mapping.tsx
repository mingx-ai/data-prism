'use client';
import {targetSchemaChoices} from '@/lib/prism/catalog-view';
import type {TableRef,Mapping} from '@/lib/prism/model';
import {SelectBox} from './shared';

export function TargetSchemaSelect({tables,mapping,onChange}:{tables:TableRef[];mapping:Mapping;onChange:(schema:string)=>void}){
 const schemas=targetSchemaChoices(tables,mapping.targetSchema,mapping.targetTable);
 const selected=schemas.includes(mapping.targetSchema);
 return <SelectBox label="请选择目标 Schema" value={selected?JSON.stringify(mapping.targetSchema):''}
  options={schemas.map(schema=>({value:JSON.stringify(schema),label:schema||'默认 Schema'}))}
  onChange={value=>{
   // Base UI may emit null while its registered options change. This control has no clear action.
   // JSON string values distinguish the real empty namespace ("\"\"") from that reset ("").
   if(value)onChange(JSON.parse(value));
  }}/>
}

export function TargetTableCandidates({tables,mapping,onSelect}:{tables:TableRef[];mapping:Mapping;onSelect:(table:TableRef)=>void}){
 if(mapping.targetTable)return null;
 const candidates=tables.filter(t=>t.name===mapping.baselineTable);
 if(!candidates.length)return <div className="catalog-match-hint"><small>请选择目标 Schema，再选择需要对比的目标表。</small></div>;
 return <div className="catalog-match-hint target-candidate-hint">
  <small>{candidates.length>1?'多个 Schema 中存在同名表，请选择目标位置：':'找到与基准同名的表，可直接关联：'}</small>
  <div className="catalog-candidates">{candidates.map(t=><button type="button" className="text-btn" key={JSON.stringify([t.schema,t.name])} onClick={()=>onSelect(t)}>关联 {t.schema||'默认 Schema'}.{t.name}</button>)}</div>
 </div>;
}
