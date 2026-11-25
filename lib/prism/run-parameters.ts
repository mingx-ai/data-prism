import {type Plan,globalStrategy} from './model';

// Override only declared values on a detached execution snapshot.
export function planForRun(plan:Plan,input:unknown):Plan{
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>k!=='variables'))throw Error('执行参数格式不正确');
  const overrides=(input as {variables?:unknown}).variables;
  const result=structuredClone(plan);result.strategy=globalStrategy(result.strategy);
  if(overrides===undefined)return result;
  if(!overrides||typeof overrides!=='object'||Array.isArray(overrides))throw Error('计划变量必须为名称和值组成的对象');
  for(const [name,value] of Object.entries(overrides)){
    const variable=result.variables.find(v=>v.name===name);
    if(!variable)throw Error('计划中不存在变量：'+name);
    if(typeof value!=='string')throw Error('变量值必须为文本：'+name);
    variable.value=value;
  }
  return result;
}
