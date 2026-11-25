'use client';
import {useEffect,useState} from 'react';
import {Activity,Clock3} from 'lucide-react';
import {type Run,dimensionNames} from '@/lib/prism/model';
import {activeRun} from '@/lib/prism/run-progress';
import {formatTime} from '@/lib/prism/client';
const seconds=(now:number,at?:string)=>at&&Number.isFinite(Date.parse(at))?Math.max(0,Math.floor((now-Date.parse(at))/1000))+' 秒':'—';
export function RunProgressPanel({run,lastFetchedAt}:{run:Run;lastFetchedAt:number}){
 const [now,setNow]=useState(Date.now());const active=activeRun(run);
 useEffect(()=>{if(!active)return;const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer)},[active]);
 const p=run.progress,events=run.progressEvents||[],stale=active&&now-lastFetchedAt>10000;
 const time=active?now:Date.parse(run.finishedAt||run.updatedAt);
 if(!active&&!p&&!events.length)return null;
 return <section className="live-run-panel" aria-label="实时执行详情"><header><h3><Activity size={17}/>执行过程</h3><span className={stale?'warm-text':'muted'}>{active?(stale?'进度刷新中断 · 最近成功刷新 '+seconds(now,new Date(lastFetchedAt).toISOString())+'前':'每 1.5 秒刷新 · 最近成功刷新 '+formatTime(new Date(lastFetchedAt).toISOString())):'本次执行留存的过程记录'}</span></header>
 {run.status==='pausing'&&<p className="live-run-notice">已请求暂停，当前表完成后暂停；下方仍展示当前正在进行的操作。</p>}{run.status==='cancelling'&&<p className="live-run-notice">已请求取消，正在等待当前 JDBC 调用返回。</p>}
 {p?<><div className="live-run-current"><div><small>{p.dimension?dimensionNames[p.dimension]+'校验':'任务阶段'}{p.side?' · '+(p.side==='baseline'?'基准侧':'目标侧'):''}{p.sourceName?' · '+p.sourceName:''}</small><b>{p.message}</b>{p.baselineTable&&<span>{[p.baselineSchema,p.baselineTable].filter(Boolean).join('.')} → {[p.targetSchema,p.targetTable].filter(Boolean).join('.')}</span>}</div><div className="live-run-timing"><span><Clock3 size={13}/>当前步骤 {seconds(time,p.startedAt)}</span><span>距最近进展 {seconds(time,p.at)}</span>{p.rows!==undefined&&<strong>本步骤已处理 {p.rows} 行</strong>}</div></div>{active&&run.status!=='paused'&&time-Date.parse(p.at)>30000&&<p className="live-run-notice">当前步骤超过 30 秒没有上报新进展。可能正在等待数据库或 JDBC 驱动返回，不能仅据此判定卡死；请结合下方 SQL 和步骤记录排查。</p>}{p.sql&&<details className="live-run-sql" open><summary>当前步骤 SQL（不展开绑定参数）</summary><pre>{p.sql}</pre></details>}</>:<p className="section-note">{run.demo?'演示任务使用内置样本，无 JDBC 查询过程。':'执行服务尚未提供步骤详情；旧版 JDBC 服务需更新并重新执行，才能记录完整过程。'}</p>}
 {run.executor&&active&&<p className="section-note">JDBC 服务线程已占用 {run.executor.active} / {run.executor.capacity} · 排队任务 {run.executor.queued}{run.gatewayObservedAt?' · 服务响应时间 '+formatTime(run.gatewayObservedAt):''}</p>}
 {!!events.length&&<details className="live-run-events" open><summary>最近步骤 · {events.length} 条（最多保留 200 条）</summary><ol>{[...events].reverse().map((e,i)=><li key={i}><time>{formatTime(e.at)}</time><div><span>{e.baselineTable&&e.baselineTable+' · '}{e.dimension&&dimensionNames[e.dimension]+' · '}{e.side&&(e.side==='baseline'?'基准侧':'目标侧')+' · '}{e.message}{e.rows!==undefined?' · '+e.rows+' 行':''}</span>{e.sql&&<details><summary>查看 SQL</summary><pre>{e.sql}</pre></details>}</div></li>)}</ol></details>}
 </section>;
}
