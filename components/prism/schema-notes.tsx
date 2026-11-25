import type {Result} from '@/lib/prism/model';
import {Table,TableHeader,TableRow,TableHead,TableBody,TableCell} from '@/components/ui/table';
import {Notice} from './shared';

export function SchemaNotes({result}:{result:Result}){return <div><Notice>scale 表示小数位数，例如 DECIMAL(10,2) 的 scale 为 2。字符串和整数不比较这个属性。下面仅记录驱动返回值的口径差异，不计入结构差异或策略忽略；DECIMAL 的真实精度与小数位仍会校验。</Notice><div className="panel diff-panel"><Table><TableHeader><TableRow><TableHead>字段</TableHead><TableHead>属性</TableHead><TableHead>基准驱动值</TableHead><TableHead>目标驱动值</TableHead><TableHead>处理说明</TableHead></TableRow></TableHeader><TableBody>{(result.schemaNotes||[]).map((n,i)=><TableRow key={i}><TableCell>{n.key}</TableCell><TableCell>{n.column}</TableCell><TableCell>{String(n.baseline)}</TableCell><TableCell>{String(n.target)}</TableCell><TableCell>{n.reason}</TableCell></TableRow>)}</TableBody></Table></div><p className="section-note">共 {result.schemaNoteCount} 项说明，展示前 {(result.schemaNotes||[]).length} 项；各字段原始元数据保留在本次结果证据中。</p></div>;}

export function LegacySchemaNotice({result}:{result:Result}){return result.ignoredDifferences.some(d=>d.rule==='schema_scale_not_applicable')?<Notice>此历史报告把不适用的 scale 驱动返回值计入了“已忽略差异”，不代表字段类型或实际小数位有变化。新版将其单列为“元数据说明”；重新执行后按新口径统计，历史记录保持不变。</Notice>:null;}
