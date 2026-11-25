import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {timingSafeEqual} from 'node:crypto';
import {handle} from '../lib/prism/server';
const host=process.env.PRISM_WEB_BIND||'127.0.0.1',port=Number(process.env.PORT||3001),root=resolve(process.env.PRISM_STATIC_DIR||'dist-selfhost/public');
const password=process.env.PRISM_ADMIN_PASSWORD,user=process.env.PRISM_ADMIN_USER||'admin';
if(!password&&!['127.0.0.1','localhost','::1'].includes(host))throw Error('非本机监听必须设置 PRISM_ADMIN_PASSWORD');
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2','.json':'application/json'};
createServer(async(req,res)=>{try{
res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('Cache-Control','no-store');
if(password){const expected='Basic '+Buffer.from(user+':'+password).toString('base64'),actual=req.headers.authorization||'';if(actual.length!==expected.length||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected))){res.writeHead(401,{'WWW-Authenticate':'Basic realm="Prism data validation", charset="UTF-8"'});res.end('需要登录 Prism 工作空间');return}}
const origin='http://'+(req.headers.host||'localhost:'+port);const url=new URL(req.url||'/',origin);
if(url.pathname.startsWith('/api/')){const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>4*1024*1024){res.writeHead(413);res.end('请求超过 4 MB');return}chunks.push(chunk)}const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value)headers.set(key,Array.isArray(value)?value.join(','):value);
// TLS terminates at the configured reverse proxy. Compare host for CSRF; do not trust arbitrary forwarded origins.
const suppliedOrigin=headers.get('origin');if(suppliedOrigin){if(new URL(suppliedOrigin).host!==url.host){res.writeHead(403);res.end('{"error":"请求来源不受信任"}');return}headers.set('origin',url.origin)}
const request=new Request(url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method||'GET')?undefined:Buffer.concat(chunks)});const response=await handle(request);response.headers.forEach((v,k)=>res.setHeader(k,v));res.writeHead(response.status);if(response.body)Readable.fromWeb(response.body as any).pipe(res);else res.end();return}
let file=resolve(root,'.'+decodeURIComponent(url.pathname));if(!file.startsWith(root+sep)&&file!==root){res.writeHead(403);res.end();return}if(file===root)file=resolve(root,'index.html');try{if((await stat(file)).isDirectory())file=resolve(file,'index.html')}catch{if(extname(file)){res.writeHead(404);res.end();return}file=resolve(root,'index.html')}
const content=await readFile(file);res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');if(file.includes('/assets/'))res.setHeader('Cache-Control','public,max-age=31536000,immutable');res.writeHead(200);res.end(content);
}catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e instanceof Error?e.message:'服务器错误'}))}}).listen(port,host,()=>console.log(`Prism platform: http://${host}:${port}`));
