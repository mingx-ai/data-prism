'use client';
import {useRef,useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {type Source,type Plan,types} from '@/lib/prism/model';
import {readTransfer,type TransferFile,type TransferKind} from '@/lib/prism/transfer';
import {api} from '@/lib/prism/client';
import {Notice,SearchBox,SelectBox} from './shared';

export function ConfigTransfer({kind,sources,plans,onClose,onImported}:{kind:TransferKind;sources:Source[];plans:Plan[];onClose:()=>void;onImported:(message:string)=>void}){
 const [mode,setMode]=useState<'export'|'import'>('export'),[file,setFile]=useState<TransferFile|null>(null),[ids,setIds]=useState<string[]>([]),[bindings,setBindings]=useState<Record<string,string>>({}),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lock=useRef(false);
 const items=mode==='export'?(kind==='sources'?sources.filter(s=>!s.demo):plans):file?.items||[];
 const visible=items.filter(i=>i.name.toLowerCase().includes(search.toLowerCase()));
 const needed=new Set(kind==='plans'&&file?file.items.filter(i=>ids.includes(i.id)).flatMap(p=>p.groups.flatMap((g:any)=>[g.baselineId,g.targetId])):[]);
 async function read(selected:File|undefined){setError('');setFile(null);setIds([]);setBindings({});if(!selected)return;try{if(selected.size>10*1024*1024)throw Error('文件不能超过 10 MB');const parsed=readTransfer(JSON.parse(await selected.text()));if(parsed.kind!==kind)throw Error('请选择'+(kind==='sources'?'数据源':'测试计划')+'配置文件');if(kind==='plans'&&parsed.items.some(p=>!Array.isArray(p.groups)))throw Error('计划比对组格式不正确');setFile(parsed);setIds(parsed.items.map(i=>i.id));setBindings(Object.fromEntries((parsed.sources||[]).filter(ref=>sources.some(s=>s.id===ref.id&&s.type===ref.type)).map(s=>[s.id,s.id])))}catch(e){setError((e as Error).message)}}
 async function submit(){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{
  if(mode==='export'){
   const output=await api<TransferFile>('transfer/export',{kind,ids});
   const url=URL.createObjectURL(new Blob([JSON.stringify(output,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='prism-'+kind+'-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }else{
   const result=await api<{count:number}>('transfer/import',{file,ids,bindings});
   onImported('已导入 '+result.count+' 个'+(kind==='sources'?'数据源，请编辑补填密码后验证连接。':'测试计划。'));onClose();
  }
 }catch(e){setError((e as Error).message)}finally{lock.current=false;setBusy(false)}}
 return <Dialog open onOpenChange={v=>!v&&!busy&&onClose()}><DialogContent className="wide-dialog" showCloseButton={!busy}><DialogHeader><DialogTitle>{kind==='sources'?'数据源':'测试计划'}导入 / 导出</DialogTitle><DialogDescription>选择部分或全部配置，以 JSON 文件迁移。导入创建新记录，不覆盖现有配置。</DialogDescription></DialogHeader>
 <fieldset disabled={busy} className="dialog-scroll grid gap-4"><div className="button-row">{(['export','import'] as const).map(m=><Button key={m} variant={mode===m?'default':'outline'} onClick={()=>{setMode(m);setIds([]);setFile(null);setError('');setSearch('')}}>{m==='export'?'导出配置':'导入配置'}</Button>)}</div>
 <Notice>{kind==='sources'?'仅迁移真实数据源配置，不包含密码、密钥及凭据属性。导入后需补填密码。':'包含计划变量、统一及表级策略、表映射；不包含执行历史和数据源密码。导入时确认数据源对应关系。'}</Notice>
 {mode==='import'&&<label>选择配置文件<input type="file" accept=".json,application/json" aria-label="选择配置文件" onChange={e=>void read(e.target.files?.[0])}/></label>}
 <div className="button-row"><Button variant="outline" onClick={()=>setIds(items.map(i=>i.id))}>全选</Button><Button variant="ghost" onClick={()=>setIds([])}>清空选择</Button><span>已选 {ids.length} / {items.length} 项</span></div>
 <SearchBox value={search} onChange={setSearch} placeholder="搜索配置名称…"/>
 <div className="transfer-items">{visible.map(i=><label key={i.id}><Checkbox aria-label={'选择配置 '+i.name} checked={ids.includes(i.id)} onCheckedChange={v=>setIds(previous=>v===true?[...previous,i.id]:previous.filter(id=>id!==i.id))}/><span>{i.name}<small>{i.id}</small></span></label>)}{!visible.length&&<p className="section-note">没有可选择的配置。</p>}</div>
 {mode==='import'&&kind==='plans'&&file?.sources.filter(s=>needed.has(s.id)).map(ref=><div key={ref.id}><p>{ref.name} · {types[ref.type].name}</p><SelectBox label={'对应数据源 '+ref.name} value={bindings[ref.id]||''} onChange={id=>setBindings(previous=>({...previous,[ref.id]:id}))} options={sources.filter(s=>s.type===ref.type).map(s=>({value:s.id,label:s.name+(s.demo?'（演示）':'')+' · '+s.id.slice(0,8)}))}/></div>)}
 </fieldset>{error&&<Notice error>{error}</Notice>}<DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>关闭</Button><Button disabled={busy||!ids.length||(mode==='import'&&[...needed].some(id=>!bindings[id as string]))} onClick={()=>void submit()}>{busy?'处理中…':mode==='export'?'导出所选配置':'导入所选配置'}</Button></DialogFooter></DialogContent></Dialog>;
}
