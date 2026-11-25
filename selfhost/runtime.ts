import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const dir=resolve(process.env.PRISM_WEB_DATA||'data/web');mkdirSync(dir,{recursive:true,mode:0o700});
const sqlite=new DatabaseSync(resolve(dir,'prism.sqlite'));
sqlite.exec('PRAGMA journal_mode=WAL');sqlite.exec('PRAGMA busy_timeout=5000');
sqlite.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
const migrationDir=resolve(process.env.PRISM_MIGRATIONS||'drizzle');
for(const name of readdirSync(migrationDir).filter(n=>n.endsWith('.sql')).sort()){
if(sqlite.prepare('SELECT name FROM _migrations WHERE name=?').get(name))continue;
sqlite.exec('BEGIN');try{sqlite.exec(readFileSync(resolve(migrationDir,name),'utf8'));sqlite.prepare('INSERT INTO _migrations VALUES (?,?)').run(name,new Date().toISOString());sqlite.exec('COMMIT')}catch(e){sqlite.exec('ROLLBACK');throw e}}
class Statement{
 values:any[]=[];constructor(public sql:string){}
 bind(...values:any[]){this.values=values;return this}
 async first<T>(){return (sqlite.prepare(this.sql).get(...this.values)||null) as T|null}
 async all<T>(){return {results:sqlite.prepare(this.sql).all(...this.values) as T[]}}
 async run(){const r=sqlite.prepare(this.sql).run(...this.values);return {success:true,meta:{changes:Number(r.changes)}}}
}
export const env={...process.env,DB:{prepare:(sql:string)=>new Statement(sql),async batch(items:Statement[]){sqlite.exec('BEGIN');try{const results=[];for(const s of items)results.push(await s.run());sqlite.exec('COMMIT');return results}catch(e){sqlite.exec('ROLLBACK');throw e}}}};
export function after(task:(()=>Promise<unknown>)|Promise<unknown>){setImmediate(()=>{Promise.resolve(typeof task==='function'?task():task).catch(e=>console.error('Background execution failed:',e instanceof Error?e.message:'unknown'));})}
