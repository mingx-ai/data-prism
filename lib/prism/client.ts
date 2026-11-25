import {reportHtml} from './report-html';
import type {Run} from './model';
export async function api<T=any>(path:string,body?:unknown,method=body?'POST':'GET'):Promise<T>{const r=await fetch('/api/'+path,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const value:any=await r.json();if(!r.ok)throw Error(value.error||'请求失败');return value;}
export function formatTime(value?:string){return value?new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'—';}
export function download(name:string,content:string,type:string){const u=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
export function downloadReport(r:Run,format:'html'|'json'){
 if(format==='json')return download(r.name+'-'+r.id.slice(0,8)+'.json',JSON.stringify(r,null,2),'application/json');
 download(r.name+'-'+r.id.slice(0,8)+'.html',reportHtml(r),'text/html;charset=utf-8');
}

export function formatDuration(milliseconds:number):string{return Number.isFinite(milliseconds)?Number((Math.max(0,milliseconds)/1000).toFixed(3))+' 秒':'—';}
