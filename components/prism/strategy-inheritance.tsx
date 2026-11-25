import {Button} from '@/components/ui/button';
import {type Strategy,strategyPaths} from '@/lib/prism/model';
const labels:Record<string,string>={dimensions:'校验维度',mode:'比对范围',alignment:'对齐方式',limit:'比对行数',ignorePrecision:'忽略精度差异',tolerance:'允许误差',ignoredValues:'特殊空值',ignoredColumns:'忽略字段',filter:'筛选条件',order:'排序字段',key:'唯一键'};
export function StrategyInheritance({value,onChange}:{value:Strategy;onChange:(s:Strategy)=>void}){
 const paths=value.specified||strategyPaths.filter(path=>{const v=path.split('.').reduce((o:any,k)=>o?.[k],value);return v!==undefined&&v!==null&&(typeof v!=='string'||v.trim())&&(!Array.isArray(v)||v.length)});
 return <section className="sort-field-picker"><p className="section-note">下方展示实际生效配置。未单独指定的项目会随统一策略更新；修改后只覆盖对应项目。</p><div className="button-row" style={{flexWrap:'wrap'}}>{paths.map(path=><Button key={path} variant="outline" size="sm" onClick={()=>onChange({...value,specified:paths.filter(p=>p!==path)})}>{labels[path]||path.replace('sql.','SQL · ').replace('.baseline',' · 基准').replace('.target',' · 目标')} · 恢复继承</Button>)}</div></section>;
}
