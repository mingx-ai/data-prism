'use client';
import {useRef,useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {type Plan,type Run,type Source,validatePlan} from '@/lib/prism/model';
import {planForRun} from '@/lib/prism/run-parameters';
import {api} from '@/lib/prism/client';
import {Notice,TextField} from './shared';

export function RunParameters({plan,sources,onClose,onStarted}:{plan:Plan;sources:Source[];onClose:()=>void;onStarted:(run:Run)=>void}){
  const [values,setValues]=useState(()=>Object.fromEntries(plan.variables.map(v=>[v.name,v.value])));
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const submitting=useRef(false);
  async function submit(){
    if(submitting.current)return;
    submitting.current=true;setBusy(true);setError('');
    try{
      validatePlan(planForRun(plan,{variables:values}),sources);
      const run=await api<Run>('plans/'+plan.id+'/run',{variables:values});
      onStarted(run);
    }catch(e){setError((e as Error).message)}finally{submitting.current=false;setBusy(false)}
  }
  return <Dialog open onOpenChange={open=>!open&&!busy&&onClose()}><DialogContent className="sm:max-w-xl" showCloseButton={!busy}>
    <DialogHeader><DialogTitle>带参执行 · {plan.name}</DialogTitle><DialogDescription>修改本次执行的计划变量，默认值已填入。参数仅用于本次执行，并保存在执行快照中，不修改计划。</DialogDescription></DialogHeader>
    <form onSubmit={e=>{e.preventDefault();void submit()}} className="grid gap-4">
      <fieldset disabled={busy} className="grid max-h-[55vh] gap-4 overflow-y-auto">
        {plan.variables.map(v=><TextField key={v.name} label={v.name+' · '+({string:'字符串',number:'数值',identifier:'标识符'}[v.type])} value={values[v.name]} onChange={(value:string)=>setValues(previous=>({...previous,[v.name]:value}))}/>)}
        {!plan.variables.length&&<Notice>此计划尚未定义变量，可直接执行；需要参数时，请先在编辑计划中添加变量。</Notice>}
      </fieldset>
      {error&&<Notice error>{error}</Notice>}
      <DialogFooter><Button type="button" variant="ghost" disabled={busy} onClick={()=>setValues(Object.fromEntries(plan.variables.map(v=>[v.name,v.value])))}>恢复计划默认值</Button><Button type="button" variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" disabled={busy}>{busy?'提交中…':'开始执行'}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
