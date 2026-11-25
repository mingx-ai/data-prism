import type {Run,Dimension} from './model';
export const activeRun=(run:Run)=>['queued','running','pausing','paused','cancelling'].includes(run.status);
export function pendingDimension(run:Run,groupId:string,mappingId:string,dimension:Dimension):string{
 const p=run.progress;
 if(!activeRun(run))return '本次未执行';
 if(run.status==='paused')return '已暂停';
 if(p?.groupId===groupId&&p.mappingId===mappingId&&p.dimension===dimension)return (run.status==='cancelling'?'取消中 · ':'执行中 · ')+(p.side==='baseline'?'基准侧 · ':p.side==='target'?'目标侧 · ':'')+p.message;
 return run.status==='queued'?'排队中':'等待前序校验';
}
