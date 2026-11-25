import {decimalDelta} from './decimal';
type Node={start:number;end:number;kind:string;value?:string;items?:Node[];fields?:Map<string,{keyStart:number;node:Node}>};
export type JsonPart={text:string;changed:boolean};
// Retain token offsets and number text: JSON.parse alone rounds large integers.
function parse(text:string):Node|null{
 let i=0;const ws=()=>{while(/[\t\n\r ]/.test(text[i]??'x'))i++};
 function string(){const start=i++;while(i<text.length){const c=text[i++];if(c==='"')return JSON.parse(text.slice(start,i)) as string;if(c==='\\')i++;}throw Error();}
 function value(depth:number):Node{if(depth>200)throw Error();ws();const start=i,c=text[i];let n:Node;
  if(c==='{'||c==='['){i++;n={start,end:0,kind:c==='{'?'object':'array',...(c==='{'?{fields:new Map()}:{items:[]})};ws();const close=c==='{'?'}':']';if(text[i]!==close)while(true){ws();if(c==='{'){const keyStart=i;if(text[i]!=='"')throw Error();const key=string();if(n.fields!.has(key))throw Error();ws();if(text[i++]!==':')throw Error();n.fields!.set(key,{keyStart,node:value(depth+1)});}else n.items!.push(value(depth+1));ws();if(text[i]!==',')break;i++;}if(text[i++]!==close)throw Error();
  }else if(c==='"'){n={start,end:0,kind:'string',value:string()};}
  else{const m=text.slice(i).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);if(!m)throw Error();i+=m[0].length;n={start,end:0,kind:/^-?\d/.test(m[0])?'number':'literal',value:m[0]};}
  n.end=i;return n;
 }
 try{const n=value(0);ws();return i===text.length&&['object','array'].includes(n.kind)?n:null;}catch{return null;}
}
function same(a:Node,b:Node):boolean{if(a.kind!==b.kind)return false;if(a.fields&&b.fields)return a.fields.size===b.fields.size&&[...a.fields].every(([k,v])=>b.fields!.has(k)&&same(v.node,b.fields!.get(k)!.node));if(a.items&&b.items)return a.items.length===b.items.length&&a.items.every((v,i)=>same(v,b.items![i]));if(a.kind==='number')try{return decimalDelta(a.value!,b.value!)==='0';}catch{return a.value===b.value;}return a.value===b.value;}
export function jsonEquivalent(a:unknown,b:unknown):boolean{if(typeof a!=='string'||typeof b!=='string')return false;const aa=parse(a),bb=parse(b);return !!aa&&!!bb&&same(aa,bb);}
export function jsonDiff(a:string,b:string):{baseline:JsonPart[];target:JsonPart[];equivalent:boolean}|null{
 const aa=parse(a),bb=parse(b);if(!aa||!bb)return null;const ar:number[][]=[],br:number[][]=[];
 function walk(x:Node,y:Node){if(same(x,y))return;if(x.fields&&y.fields){for(const [k,v] of x.fields){const other=y.fields.get(k);if(other)walk(v.node,other.node);else ar.push([v.keyStart,v.node.end]);}for(const [k,v] of y.fields)if(!x.fields.has(k))br.push([v.keyStart,v.node.end]);}else if(x.items&&y.items){for(let i=0;i<Math.max(x.items.length,y.items.length);i++){const l=x.items[i],r=y.items[i];if(l&&r)walk(l,r);else if(l)ar.push([l.start,l.end]);else br.push([r.start,r.end]);}}else{ar.push([x.start,x.end]);br.push([y.start,y.end]);}}
 walk(aa,bb);
 function parts(text:string,ranges:number[][]):JsonPart[]{let i=0;const out:JsonPart[]=[];for(const [start,end] of ranges.sort((a,b)=>a[0]-b[0])){if(start>i)out.push({text:text.slice(i,start),changed:false});out.push({text:text.slice(start,end),changed:true});i=end;}if(i<text.length)out.push({text:text.slice(i),changed:false});return out;}
 return {baseline:parts(a,ar),target:parts(b,br),equivalent:same(aa,bb)};
}
