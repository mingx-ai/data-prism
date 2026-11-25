'use client';
import {useState} from 'react';
import {Checkbox} from '@/components/ui/checkbox';
import {Button} from '@/components/ui/button';
import type {ColumnPair} from '@/lib/prism/model';
import {parseKeyFields,selectableField} from '@/lib/prism/field-options';
import {Notice,TextField,SearchBox,Pager} from './shared';

export function KeyFields({value,onChange,columns}:{value:string;onChange:(value:string)=>void;columns?:ColumnPair[]}){
  const [search,setSearch]=useState(''),[page,setPage]=useState(1),[size,setSize]=useState(10);
  const selected=parseKeyFields(value);
  const fields=new Map((columns||[]).map(c=>[c.name.toLowerCase(),c]));
  for(const name of selected||[])if(!fields.has(name.toLowerCase()))fields.set(name.toLowerCase(),{name});
  const available=[...fields.values()].filter(c=>c.name.toLowerCase().includes(search.toLowerCase()));
  return <section className="sort-field-picker"><h4>数据对齐键（唯一键 / 复合键）</h4>
    <p className="section-note">勾选一个字段作为唯一键，或多个字段组成复合键。两侧查询结果中的键必须非空，且组合值唯一；勾选不会自动保证唯一性。</p>
    {selected===null?<Notice>当前对齐键包含变量或无法转换为勾选项的写法，已保留原配置。可在下方手动编辑，或<Button variant="outline" onClick={()=>onChange('')}>清空后使用字段勾选</Button></Notice>:<>
      <p className="section-note">{selected.length?`已选 ${selected.length} 个字段：${selected.join(' + ')}`:'未勾选时沿用排序字段作为对齐键，仍需满足非空且唯一。'}</p>
      {!columns&&<p className="section-note">表结构加载后可勾选两侧共有字段；已保存的选择保留，可取消。</p>}
      <SearchBox value={search} onChange={v=>{setSearch(v);setPage(1)}} placeholder="搜索对齐键字段…"/>
      <div className="sort-candidates">{available.slice((page-1)*size,page*size).map(c=>{
        const checked=selected.some(n=>n.toLowerCase()===c.name.toLowerCase()),enabled=!!(c.baseline&&c.target&&selectableField(c.name));
        return <label key={c.name.toLowerCase()}><Checkbox aria-label={'对齐键选择 '+c.name} checked={checked} disabled={!enabled&&!checked} onCheckedChange={v=>onChange((v===true?[...selected,c.name]:selected.filter(n=>n.toLowerCase()!==c.name.toLowerCase())).join(', '))}/><code>{c.name}</code><small>{enabled?c.baseline?.type:!columns?'待加载表结构':!selectableField(c.name)?'请手动配置':'两侧未同时找到此字段'}</small></label>;
      })}</div>
      <Pager total={available.length} page={page} size={size} onPage={setPage} onSize={setSize}/>
      {selected.length>0&&<Button variant="ghost" onClick={()=>onChange('')}>清空对齐键</Button>}
    </>}
    <details open={selected===null}><summary>手动编辑对齐键 / 使用变量</summary><TextField label="对齐键字段" value={value} onChange={onChange} placeholder="order_id, item_id" hint="多个字段用英文逗号分隔；自定义 SQL 需返回这些字段。"/></details>
  </section>;
}
