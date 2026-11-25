'use client';
import {useEffect,useRef,useState} from 'react';
import {catalogMatch} from '@/lib/prism/catalog-view';
import {type TableRef,type ColumnInfo,type SourceType} from '@/lib/prism/model';
import {api} from '@/lib/prism/client';
export function CatalogMatchHint({tables,schema,name,sourceId,workspace,sourceType,namespaceMode,onSelect}:{tables:TableRef[];schema:string;name:string;sourceId:string;workspace?:string;sourceType?:SourceType;namespaceMode?:'project'|'schema';onSelect?:(t:TableRef)=>void}){
 const match=catalogMatch(tables,schema,name);
 const [check,setCheck]=useState<{busy?:boolean;error?:string;count?:number}>({});
 const mounted=useRef(true);useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false}},[]);
 if(match.kind==='found'||match.kind==='unselected')return null;
 const projectMapping=sourceType==='maxcompute'&&namespaceMode!=='schema';
 const full=(projectMapping?[schema||workspace,name]:[workspace,(namespaceMode==='schema'||sourceType==='lakehouse')?schema:schema===workspace?'':schema,name]).filter(Boolean).join('.');
 async function verify(){setCheck({busy:true});try{const r=await api<{columns:ColumnInfo[]}>('sources/'+encodeURIComponent(sourceId)+'/columns',{schema,table:name});if(mounted.current)setCheck({count:r.columns.length})}catch(e){if(mounted.current)setCheck({error:(e as Error).message})}}
 return <div className="catalog-match-hint"><small className="warm-text">当前目录未匹配到「{full}」，映射已保留。</small>
 {projectMapping&&workspace&&<small>当前数据源 Project：{workspace}。{namespaceMode==='project'?'这是两层项目（项目.表）。':'刷新表目录可确认项目的命名空间模式。'}</small>}
 {match.kind==='other-schema'?<small>{projectMapping?'当前项目目录中有同名表，请刷新目录并同步项目映射：':'其他 Schema 中有同名表，请核对表位置：'}</small>:match.kind==='similar'?<small>目录中有名称大小写或首尾空格不同的表，请核对：</small>:<small>可先刷新表目录；仍未找到时，请核对数据源的项目／数据库、Schema 和账号是否一致。</small>}
 {!!match.candidates.length&&<div className="catalog-candidates">{match.candidates.map(t=>onSelect?<button className="text-btn" key={JSON.stringify([t.schema,t.name])} onClick={()=>onSelect(t)}>改为 {t.schema||'默认 Schema'}.{t.name}</button>:<span key={JSON.stringify([t.schema,t.name])}>{t.schema}.{t.name}</span>)}</div>}
 <button className="text-btn" disabled={check.busy} onClick={verify}>{check.busy?'正在校验表结构…':'校验已保存的表映射'}</button>
 {check.count!==undefined&&<small className="green-text">此映射可读取表结构（{check.count} 个字段），但未出现在当前目录列表中；无需仅因目录提示删除映射。数据查询权限以实际执行为准。</small>}
 {check.error&&<small className="warm-text">表结构校验失败：{check.error}</small>}
 </div>;
}
