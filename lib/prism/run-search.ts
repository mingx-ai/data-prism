import type {Run} from './model';
export function matchesRun(run:Run,search:string):boolean{
 const query=search.trim().toLowerCase();
 return [run.name,run.id,...(run.snapshot?.variables||[]).flatMap(v=>[v.name,v.value,v.name+'='+v.value])].some(value=>value.toLowerCase().includes(query));
}
