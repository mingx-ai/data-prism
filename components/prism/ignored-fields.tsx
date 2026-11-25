'use client';
import {useState} from 'react';
import {Checkbox} from '@/components/ui/checkbox';
import {Button} from '@/components/ui/button';
import type {ColumnPair} from '@/lib/prism/model';
import {SearchBox,Pager} from './shared';

export function IgnoredFields({value,onChange,columns}:{value:string[];onChange:(v:string[])=>void;columns?:ColumnPair[]}){
  const [search,setSearch]=useState(''),[page,setPage]=useState(1),[size,setSize]=useState(10);
  const names=[...new Map([...(columns||[]).map(c=>[c.name.toLowerCase(),c.name] as const),...value.map(c=>[c.toLowerCase(),c] as const)]).values()];
  const shown=names.filter(n=>n.toLowerCase().includes(search.toLowerCase()));
  return <section className="sort-field-picker"><h4>忽略对比的字段</h4><p className="section-note">已选 {value.length} 个字段。仅跳过数据值对比；表结构、行数、排序及对齐键检查仍然生效。被跳过的实际差异保留在忽略明细中。</p>
    {!columns&&<p className="section-note">表结构加载后可勾选字段；已保存的选择保留，可取消。</p>}
    <SearchBox value={search} onChange={v=>{setSearch(v);setPage(1)}} placeholder="搜索忽略字段…"/>
    <div className="sort-candidates">{shown.slice((page-1)*size,page*size).map(name=><label key={name.toLowerCase()}><Checkbox aria-label={'忽略对比 '+name} checked={value.some(v=>v.toLowerCase()===name.toLowerCase())} onCheckedChange={v=>onChange(v?[...value,name]:value.filter(x=>x.toLowerCase()!==name.toLowerCase()))}/><code>{name}</code></label>)}</div>
    <Pager total={shown.length} page={page} size={size} onPage={setPage} onSize={setSize}/>{value.length>0&&<Button variant="ghost" onClick={()=>onChange([])}>清空忽略字段</Button>}
  </section>;
}
