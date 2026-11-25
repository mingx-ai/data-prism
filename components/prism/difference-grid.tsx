'use client';
import {Fragment,useMemo,useState} from 'react';
import {Checkbox} from '@/components/ui/checkbox';
import {Button} from '@/components/ui/button';
import {Table,TableHeader,TableRow,TableHead,TableBody,TableCell} from '@/components/ui/table';
import {type Result,type DataDiffRow} from '@/lib/prism/model';
import {differenceRows,differenceColumns,cellText} from '@/lib/prism/difference-rows';
import {jsonDiff,type JsonPart} from '@/lib/prism/json-diff';
import {Notice,Pager,SearchBox} from './shared';

export function DifferenceGrid({result}:{result:Result}){
  const rows=useMemo(()=>differenceRows(result),[result]);
  const [onlyChanged,setOnlyChanged]=useState(false),[search,setSearch]=useState(''),[page,setPage]=useState(1),[size,setSize]=useState(10);
  const [expanded,setExpanded]=useState<{row:DataDiffRow;column:string}|null>(null);
  const allColumns=useMemo(()=>differenceColumns(rows),[rows]);
  const changed=new Set(rows.flatMap(r=>r.changedColumns));
  const columns=allColumns.filter(c=>(!onlyChanged||changed.has(c))&&c.toLowerCase().includes(search.toLowerCase()));
  const total=result.differentRowCount;
  return <div className="paired-differences">
    <div className="paired-toolbar"><div><h3>差异记录对照</h3><p>{total===undefined?'已留存 '+rows.length+' 组':'共 '+total+' 组差异记录，留存 '+rows.length+' 组'} · {result.differenceCount} 处差异</p></div><div className="paired-controls"><label><Checkbox checked={onlyChanged} onCheckedChange={v=>setOnlyChanged(!!v)}/>仅差异字段</label><SearchBox value={search} onChange={setSearch} placeholder="搜索字段名称…"/></div></div>
    <div className="paired-legend"><span><i className="baseline-swatch"/>基准差异值</span><span><i className="target-swatch"/>目标差异值</span><span>相同值保持白底 · JSON 仅实际变化内容高亮 · 点击长内容查看全文</span></div>
    {rows.some(r=>r.partial)&&<Notice>这是旧版报告，未保存完整差异行。仅展示已留存的字段值，“未留存”不代表 NULL；重新执行计划后可查看完整的两行对照。</Notice>}
    {columns.length?<div className="paired-table-wrap"><Table className="paired-table"><TableHeader><TableRow><TableHead className="pair-key">{result.strategy.alignment==='position'?'排序后行号':'对齐键'}</TableHead><TableHead className="pair-source">来源</TableHead>{columns.map(c=><TableHead key={c} title={c}>{c}</TableHead>)}</TableRow></TableHeader><TableBody>
      {rows.slice((page-1)*size,page*size).map(row=><Fragment key={row.key}><TableRow className="pair-first"><TableCell className="pair-key" rowSpan={2}><b>{row.key}</b><small>{row.reason}</small></TableCell><Source side="baseline" name={result.baselineName}/>{columns.map(c=><Cell key={c} row={row} side="baseline" column={c} onExpand={()=>setExpanded({row,column:c})}/>)}</TableRow><TableRow className="pair-last"><Source side="target" name={result.targetName}/>{columns.map(c=><Cell key={c} row={row} side="target" column={c} onExpand={()=>setExpanded({row,column:c})}/>)}</TableRow></Fragment>)}
    </TableBody></Table></div>:<Notice>没有匹配的字段，请调整字段搜索或显示范围。</Notice>}
    <Pager total={rows.length} page={page} size={size} onPage={setPage} onSize={v=>{setSize(v);setPage(1)}}/>
    {total!==undefined&&total>rows.length&&<p className="section-note">完整校验已执行；此处最多保留前 100 组完整差异行，未展示的记录仍计入差异总数。</p>}
    {expanded&&<section className="paired-full-value" aria-label="单元格完整内容"><div><h4>{expanded.row.key} · {expanded.column}</h4><Button variant="ghost" onClick={()=>setExpanded(null)}>收起全文</Button></div><div className="paired-full-columns">{(['baseline','target'] as const).map(side=><div key={side}><b>{side==='baseline'?'基准':'目标'} · {side==='baseline'?result.baselineName:result.targetName}</b><pre tabIndex={0}>{jsonValue(expanded.row,side,expanded.column)}</pre></div>)}</div></section>}
  </div>;
}
function Source({side,name}:{side:'baseline'|'target';name:string}){return <TableCell className="pair-source"><span>{side==='baseline'?'基准':'目标'}</span><small title={name}>{name}</small></TableCell>;}
function Cell({row,side,column,onExpand}:{row:DataDiffRow;side:'baseline'|'target';column:string;onExpand:()=>void}){
  const text=cellText(row,side,column),changed=row.changedColumns.includes(column),long=text.length>72||text.includes('\n'),json=changed?jsonDiff(cellText(row,'baseline',column),cellText(row,'target',column)):null;
  return <TableCell className={changed&&!json?'pair-changed pair-'+side:''} data-different={changed||undefined} title={changed?'差异字段：'+column:undefined}>
    {json?.equivalent&&<small className="muted block">仅 JSON 键序或格式不同</small>}
    {long?<button className="pair-long-value" onClick={onExpand} aria-label={'查看'+(side==='baseline'?'基准':'目标')+' '+row.key+' '+column+' 的完整内容'}><span className="pair-long-text">{json?jsonParts(json[side],side,120):text.slice(0,120)}</span><span className="pair-long-action">查看全文</span></button>:<span className={row[side]===null||!Object.hasOwn(row[side]??{},column)||row[side]?.[column]===null?'pair-empty-value':''}>{json?jsonParts(json[side],side):text}</span>}
  </TableCell>;
}

function jsonParts(parts:JsonPart[],side:'baseline'|'target',limit=Infinity){let remaining=limit;return parts.map((part,i)=>{const text=part.text.slice(0,Math.max(0,remaining));remaining-=text.length;return part.changed?<mark key={i} style={{background:side==='baseline'?'#ffe0d6':'#d3f4e7',color:side==='baseline'?'#8a2818':'#075c40',borderRadius:3}}>{text}</mark>:<Fragment key={i}>{text}</Fragment>;});}
function jsonValue(row:DataDiffRow,side:'baseline'|'target',column:string){const json=row.changedColumns.includes(column)?jsonDiff(cellText(row,'baseline',column),cellText(row,'target',column)):null;return json?jsonParts(json[side],side):cellText(row,side,column);}
