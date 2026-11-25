'use client';
import {useState} from 'react';
import {Tag,Plus,X} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {type Plan} from '@/lib/prism/model';
import {normalizeTags} from '@/lib/prism/plan-tags';
import {api} from '@/lib/prism/client';
import {Notice,SelectBox} from './shared';
export function PlanTagFilter({available,selected,mode,onChange,onMode}:{available:string[];selected:string[];mode:'any'|'all';onChange:(tags:string[])=>void;onMode:(mode:'any'|'all')=>void}){
 if(!available.length&&!selected.length)return null;
 return <div className="plan-tag-filter"><div className="plan-tag-filter-controls"><span className="plan-tag-filter-label"><Tag size={15}/><b>标签筛选</b></span><SelectBox value={mode} onChange={v=>onMode(v as 'any'|'all')} label="标签匹配方式" options={[{value:'any',label:'匹配任一标签'},{value:'all',label:'同时包含全部标签'}]}/></div><div className="plan-tags">{[...new Set([...available,...selected])].map(t=><button key={t} className={'plan-tag '+(selected.includes(t)?'selected':'')} aria-pressed={selected.includes(t)} onClick={()=>onChange(selected.includes(t)?selected.filter(x=>x!==t):[...selected,t])}>{t}</button>)}</div>{selected.length>0&&<button className="text-btn" onClick={()=>onChange([])}>清空标签筛选（{selected.length}）</button>}</div>;
}
export function PlanTagsDialog({plan,available,onClose,onSaved}:{plan:Plan;available:string[];onClose:()=>void;onSaved:(plan:Plan)=>void}){
 const [tags,setTags]=useState(plan.tags||[]),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 function add(){try{if(!draft.trim())return;setTags(normalizeTags([...tags,draft]));setDraft('');setError('')}catch(e){setError((e as Error).message)}}
 async function save(){setBusy(true);setError('');try{const next=normalizeTags(draft.trim()?[...tags,draft]:tags);onSaved(await api<Plan>('plans/'+encodeURIComponent(plan.id)+'/tags',{tags:next}));}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <Dialog open onOpenChange={v=>!v&&!busy&&onClose()}><DialogContent><DialogHeader><DialogTitle>编辑计划标签</DialogTitle><DialogDescription>{plan.name} · 可选择已有标签，或输入新标签。最多 20 个，每个最多 40 字。</DialogDescription></DialogHeader>{error&&<Notice error>{error}</Notice>}<div className="plan-tags">{tags.map(t=><button key={t} className="plan-tag selected" disabled={busy} onClick={()=>setTags(tags.filter(x=>x!==t))} aria-label={'移除标签 '+t}>{t}<X size={12}/></button>)}{!tags.length&&<span className="muted">尚未添加标签</span>}</div><div className="tag-create"><input aria-label="新标签名称" placeholder="输入自定义标签，如 UAT、回归测试…" value={draft} maxLength={40} disabled={busy} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();add()}}}/><Button variant="outline" disabled={busy||!draft.trim()} onClick={add}><Plus size={14}/>添加</Button></div><div className="tag-options" aria-label="已有标签">{available.map(t=><label key={t}><Checkbox checked={tags.includes(t)} disabled={busy} onCheckedChange={checked=>{try{setTags(normalizeTags(checked?[...tags,t]:tags.filter(x=>x!==t)));setError('')}catch(e){setError((e as Error).message)}}}/>{t}</label>)}{!available.length&&<span className="muted">保存后，标签可在其他计划中直接选择。</span>}</div><DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>取消</Button><Button className="primary-btn" onClick={save} disabled={busy}>{busy?'正在保存…':'保存标签'}</Button></DialogFooter></DialogContent></Dialog>;
}
