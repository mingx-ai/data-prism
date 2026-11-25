'use client';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Table,TableHeader,TableRow,TableHead,TableBody,TableCell} from '@/components/ui/table';
import {api} from '@/lib/prism/client';
import type {Mapping,Strategy,ColumnInfo} from '@/lib/prism/model';
import {mergeColumns,selectableField} from '@/lib/prism/field-options';
import {StrategyForm} from './strategy-form';
import {Loading,Notice,SearchBox,Pager} from './shared';

type Structure={columns:ColumnInfo[]};
export function TableStrategy({mapping,baselineId,targetId,value,onChange,enabled}:{mapping:Mapping;baselineId:string;targetId:string;value:Strategy;onChange:(s:Strategy)=>void;enabled:boolean}){
  const [left,setLeft]=useState<ColumnInfo[]>([]),[right,setRight]=useState<ColumnInfo[]>([]),[errors,setErrors]=useState<string[]>([]),[busy,setBusy]=useState(true),[retry,setRetry]=useState(0);
  const [search,setSearch]=useState(''),[page,setPage]=useState(1),[size,setSize]=useState(10);
  useEffect(()=>{let alive=true;setBusy(true);setErrors([]);setLeft([]);setRight([]);setPage(1);
    const read=(id:string,schema:string,table:string)=>table?api<Structure>('sources/'+encodeURIComponent(id)+'/columns',{schema,table}):Promise.reject(new Error('尚未选择目标表'));
    Promise.allSettled([read(baselineId,mapping.baselineSchema,mapping.baselineTable),read(targetId,mapping.targetSchema,mapping.targetTable)]).then(results=>{if(!alive)return;setLeft(results[0].status==='fulfilled'?results[0].value.columns:[]);setRight(results[1].status==='fulfilled'?results[1].value.columns:[]);setErrors(results.flatMap((r,i)=>r.status==='rejected'?[(i===0?'基准':'目标')+'结构读取失败：'+(r.reason?.message||String(r.reason))]:[]));setBusy(false);});
    return ()=>{alive=false};
  },[baselineId,targetId,mapping.baselineSchema,mapping.baselineTable,mapping.targetSchema,mapping.targetTable,retry]);
  const columns=mergeColumns(left,right),filtered=columns.filter(c=>c.name.toLowerCase().includes(search.toLowerCase()));
  const type=(c?:ColumnInfo)=>c?(c.type==='DECIMAL'?`${c.type}(${c.precision},${c.scale})`:c.type):'—';
  return <><section className="table-field-reference"><div className="section-heading"><div><h3>表结构参考</h3><p>{mapping.baselineSchema}.{mapping.baselineTable} → {mapping.targetSchema}.{mapping.targetTable||'未选择'}</p></div><Button variant="outline" disabled={busy} onClick={()=>setRetry(n=>n+1)}>刷新结构</Button></div>
    <p className="section-note">基准 {left.length} 个字段 · 目标 {right.length} 个字段。可参考类型和可空性配置筛选；插入字段后继续填写运算符和值。</p>
    {errors.map(e=><Notice key={e} error>{e}</Notice>)}
    {busy?<Loading label="正在读取两侧表结构…"/>:<><SearchBox value={search} onChange={v=>{setSearch(v);setPage(1)}} placeholder="搜索字段名称…"/><div className="field-reference-table"><Table><TableHeader><TableRow><TableHead>字段</TableHead><TableHead>基准类型 / 可空</TableHead><TableHead>目标类型 / 可空</TableHead><TableHead>筛选条件</TableHead></TableRow></TableHeader><TableBody>{filtered.slice((page-1)*size,page*size).map(c=><TableRow key={c.name}><TableCell><code>{c.name}</code>{(!c.baseline||!c.target)&&<small className="field-side-note">{c.baseline?'仅基准侧':'仅目标侧'}</small>}</TableCell><TableCell>{type(c.baseline)}<small className="field-side-note">{c.baseline?(c.baseline.nullable?'允许 NULL':'非空'):'未找到字段'}</small></TableCell><TableCell>{type(c.target)}<small className="field-side-note">{c.target?(c.target.nullable?'允许 NULL':'非空'):'未找到字段'}</small></TableCell><TableCell><Button variant="ghost" disabled={!enabled||!selectableField(c.name)} onClick={()=>onChange({...value,filter:value.filter+(value.filter&&!/\s$/.test(value.filter)?' ':'')+'`'+c.name+'`'})} aria-label={'将 '+c.name+' 插入筛选条件'}>插入字段</Button></TableCell></TableRow>)}</TableBody></Table></div>{!filtered.length&&<p className="section-note">没有匹配的字段。</p>}<Pager total={filtered.length} page={page} size={size} onPage={setPage} onSize={setSize}/></>}
  </section>{enabled?<StrategyForm value={value} onChange={onChange} compact columns={!busy&&!errors.length?columns:undefined}/>:<Notice>当前继承统一策略。开启“启用独立策略”后，可参考上方结构配置本表的筛选和排序。</Notice>}</>;
}
