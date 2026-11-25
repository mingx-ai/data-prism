import {spawn} from 'node:child_process';
import {existsSync,mkdirSync} from 'node:fs';
import {delimiter,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadEnvFile} from 'node:process';

// Resolve from this script so paths with spaces and other working directories work.
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
loadEnvFile('.env');
const jar=resolve('jdbc-runner/target/jdbc-runner-1.0.0.jar');
if(!existsSync(jar))throw Error('缺少 JDBC 执行引擎，请先运行 mvn -f jdbc-runner/pom.xml package，或使用完整运行包。');
const data=resolve(process.env.PRISM_DATA_DIR||'jdbc-runner/data');
mkdirSync(data,{recursive:true});
const java=process.env.JAVA_HOME?resolve(process.env.JAVA_HOME,'bin',process.platform==='win32'?'java.exe':'java'):'java';
const classpath=[jar,resolve('jdbc-runner/drivers/*')].join(delimiter);
const child=spawn(java,['-cp',classpath,'tech.prism.Runner'],{stdio:'inherit',env:{...process.env,PRISM_DATA_DIR:data}});
child.on('error',error=>{console.error('无法启动 Java，请安装 Java 17+ 并检查 JAVA_HOME / PATH。',error.message);process.exitCode=1});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',(code,signal)=>process.exit(code??(signal==='SIGINT'?130:1)));
