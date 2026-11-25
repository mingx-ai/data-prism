'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Table,TableHeader,TableRow,TableHead,TableBody,TableCell} from '@/components/ui/table';
import type {Evidence} from '@/lib/prism/model';
export const evidenceText=(value:unknown)=>value===null||value===undefined?'NULL':typeof value==='object'?JSON.stringify(value):String(value);
export function EvidenceTable({evidence}:{evidence:Evidence}){
 const [expanded,setExpanded]=useState<{row:number;column:string;text:string}|null>(null);
 return <><div className="evidence-table"><Table><TableHeader><TableRow>{evidence.columns.map(c=><TableHead key={c}>{c}</TableHead>)}</TableRow></TableHeader><TableBody>{evidence.rows.map((r,i)=><TableRow key={i}>{evidence.columns.map(c=>{const text=evidenceText(r[c]);return <TableCell key={c}><div className="raw-cell">{text.length>100||text.includes('\n')?<button className="pair-long-value" aria-label={'查看第 '+(i+1)+' 行 '+c+' 的全文'} onClick={()=>setExpanded({row:i+1,column:c,text})}><span className="pair-long-text">{text.slice(0,100)}</span><span className="pair-long-action">查看全文</span></button>:<span>{text===''?'空字符串':text}</span>}</div></TableCell>})}</TableRow>)}</TableBody></Table></div>{expanded&&<section className="paired-full-value"><div><h4>第 {expanded.row} 行 · {expanded.column}</h4><Button variant="ghost" onClick={()=>setExpanded(null)}>收起全文</Button></div><pre className="parameter-block" tabIndex={0}>{expanded.text}</pre></section>}</>;
}
