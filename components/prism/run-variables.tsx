import type {Run,Variable} from '@/lib/prism/model';
const display=(value:string)=>value===''?'空字符串':value;
function VariableValue({variable}:{variable:Variable}){
 const text=display(variable.value);
 return <div className="run-variable"><span>{variable.name}</span>{text.length>64||text.includes('\n')?<details><summary>{text.slice(0,64)}… <em>查看全文</em></summary><pre>{text}</pre></details>:<code>{text}</code>}</div>;
}
export function RunVariables({run,compact=false}:{run:Run;compact?:boolean}){
 const variables=run.snapshot?.variables;
 if(!variables)return <span className="muted">未留存变量信息</span>;
 if(!variables.length)return <span className="muted">未配置计划变量</span>;
 const ordered=[...variables].sort((a,b)=>Number(['ds','biz_date'].includes(b.name))-Number(['ds','biz_date'].includes(a.name)));
 const visible=compact?ordered.slice(0,3):ordered;
 return <div className={'run-variables'+(compact?' compact':'')} aria-label="本次执行变量">{visible.map(v=><VariableValue key={v.name} variable={v}/>)}{compact&&ordered.length>3&&<details className="run-variable-more"><summary>展开其余 {ordered.length-3} 个变量</summary>{ordered.slice(3).map(v=><VariableValue key={v.name} variable={v}/>)}</details>}</div>;
}
