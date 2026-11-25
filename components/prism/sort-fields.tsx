'use client';
import {useState} from 'react';
import {ArrowUp,ArrowDown,Trash2} from 'lucide-react';
import {Checkbox} from '@/components/ui/checkbox';
import {Button} from '@/components/ui/button';
import type {ColumnPair} from '@/lib/prism/model';
import {parseSortFields,formatSortFields,moveSortField,selectableField,type SortField} from '@/lib/prism/field-options';
import {SelectBox,TextField,Notice,SearchBox,Pager} from './shared';

export function SortFields({value,onChange,columns}:{value:string;onChange:(value:string)=>void;columns:ColumnPair[]}){
  const [search,setSearch]=useState(''),[page,setPage]=useState(1),[size,setSize]=useState(10);
  const selected=parseSortFields(value),write=(fields:SortField[])=>onChange(formatSortFields(fields));
  const available=columns.filter(c=>c.name.toLowerCase().includes(search.toLowerCase()));
  const exists=(name:string)=>columns.some(c=>c.name.toLowerCase()===name.toLowerCase()&&c.baseline&&c.target);
  return <section className="sort-field-picker"><h4>排序字段</h4><p className="section-note">勾选两侧共有字段，按下方顺序排序。每个字段可单独选择升序或降序。</p>
    {selected===null?<Notice>当前排序包含变量或不能转换为勾选项的写法，已保留原配置。可在下方手动编辑，或<Button variant="outline" onClick={()=>onChange('')}>清空后使用字段勾选</Button></Notice>:<>
      <div className="sort-selected">{selected.map((field,i)=><div className="sort-selected-row" key={field.name.toLowerCase()}><span className="sort-priority">{i+1}</span><code>{field.name}</code>{!exists(field.name)&&<small>两侧未同时找到此字段</small>}<SelectBox label={field.name+' 排序方向'} value={field.direction} onChange={direction=>write(selected.map((f,j)=>j===i?{...f,direction:direction as 'ASC'|'DESC'}:f))} options={[{value:'ASC',label:'升序 ↑'},{value:'DESC',label:'降序 ↓'}]}/><Button variant="ghost" size="icon-sm" aria-label={'提高 '+field.name+' 排序优先级'} disabled={i===0} onClick={()=>write(moveSortField(selected,i,-1))}><ArrowUp size={14}/></Button><Button variant="ghost" size="icon-sm" aria-label={'降低 '+field.name+' 排序优先级'} disabled={i===selected.length-1} onClick={()=>write(moveSortField(selected,i,1))}><ArrowDown size={14}/></Button><Button variant="ghost" size="icon-sm" aria-label={'移除排序字段 '+field.name} onClick={()=>write(selected.filter((_,j)=>j!==i))}><Trash2 size={14}/></Button></div>)}{!selected.length&&<p className="section-note">尚未勾选排序字段，请选择用于排序的字段。</p>}</div>
      <SearchBox value={search} onChange={v=>{setSearch(v);setPage(1)}} placeholder="搜索可排序字段…"/>
      <div className="sort-candidates">{available.slice((page-1)*size,page*size).map(c=>{const checked=selected.some(f=>f.name.toLowerCase()===c.name.toLowerCase()),enabled=!!(c.baseline&&c.target&&selectableField(c.name));return <label key={c.name}><Checkbox aria-label={'排序选择 '+c.name} checked={checked} disabled={!enabled&&!checked} onCheckedChange={v=>write(v?[...selected,{name:c.name,direction:'ASC'}]:selected.filter(f=>f.name.toLowerCase()!==c.name.toLowerCase()))}/><code>{c.name}</code><small>{enabled?c.baseline?.type:!selectableField(c.name)?'需在自定义 SQL 中排序':'仅一侧存在'}</small></label>;})}</div><Pager total={available.length} page={page} size={size} onPage={setPage} onSize={setSize}/>
    </>}
    <details open={selected===null}><summary>手动编辑排序 / 使用变量</summary><TextField label="排序表达式" value={value} onChange={onChange} placeholder="ts DESC, id ASC" hint="自定义数据 SQL 的 ORDER BY 优先于这里的排序配置。"/></details>
  </section>;
}
