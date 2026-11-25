import type {Plan} from './model';
export function normalizeTags(value:unknown):string[]{
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.some(t=>typeof t!=='string'))throw Error('标签必须为文字列表');
 const tags=[...new Set(value.map(t=>t.trim()).filter(Boolean))];
 if(tags.length>20||tags.some(t=>t.length>40||/[\u0000-\u001f\u007f]/.test(t)))throw Error('每个计划最多 20 个标签，每个标签最多 40 字，不能包含控制字符');
 return tags;
}
export function availableTags(plans:Plan[]):string[]{return [...new Set(plans.flatMap(p=>p.tags||[]))].sort((a,b)=>a.localeCompare(b,'zh-CN'));}
export function matchesTags(plan:Plan,selected:string[],mode:'any'|'all'='any'):boolean{return !selected.length||(mode==='all'?selected.every(t=>plan.tags?.includes(t)):selected.some(t=>plan.tags?.includes(t)));}
