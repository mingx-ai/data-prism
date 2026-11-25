import {jsonDiff,type JsonPart} from './json-diff';
import type {Result} from './model';
import {differenceRows,differenceColumns,cellText} from './difference-rows';
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function differenceHtml(result:Result):string{
  const rows=differenceRows(result),columns=differenceColumns(rows);
  if(!rows.length)return '<p>没有未忽略的数据差异。</p>';
  return '<p>基准、目标两行一组，普通字段仅差异单元格着色，JSON 仅实际变化内容着色。展示 '+rows.length+' / '+(result.differentRowCount??rows.length)+' 组已留存差异记录；长内容可展开。</p>'+(rows.some(r=>r.partial)?'<p>旧报告未留存完整差异行，“未留存”不代表 NULL。</p>':'')+'<div class="scroll"><table class="pair-export"><thead><tr><th>行号 / 对齐键</th><th>来源</th>'+columns.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>(['baseline','target'] as const).map(side=>'<tr>'+(side==='baseline'?'<td rowspan="2">'+esc(row.key)+'</td>':'')+'<td>'+(side==='baseline'?'基准':'目标')+'<br>'+esc(side==='baseline'?result.baselineName:result.targetName)+'</td>'+columns.map(c=>{const text=cellText(row,side,c),json=row.changedColumns.includes(c)?jsonDiff(cellText(row,'baseline',c),cellText(row,'target',c)):null;const content=json?jsonMarkup(json[side],side):esc(text);return '<td'+(row.changedColumns.includes(c)&&!json?' class="pair-'+side+'"':'')+'>'+(json?.equivalent?'<small>仅 JSON 键序或格式不同</small><br>':'')+(text.length>120?'<details><summary>'+(json?jsonMarkup(json[side],side,80):esc(text.slice(0,80)))+'…</summary><pre>'+content+'</pre></details>':content)+'</td>';}).join('')+'</tr>').join('')).join('')+'</tbody></table></div>';
}

function jsonMarkup(parts:JsonPart[],side:'baseline'|'target',limit=Infinity){let remaining=limit;return parts.map(p=>{const text=p.text.slice(0,Math.max(0,remaining));remaining-=text.length;return p.changed?'<mark style="background:'+(side==='baseline'?'#ffe0d6;color:#8a2818':'#d3f4e7;color:#075c40')+';border-radius:3px">'+esc(text)+'</mark>':esc(text);}).join('');}
