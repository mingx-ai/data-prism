import {randomBytes} from 'node:crypto';
import {existsSync,writeFileSync,readFileSync} from 'node:fs';
const secret=()=>randomBytes(48).toString('base64url');
if(!existsSync('.env')){writeFileSync('.env',`SOURCE_KEY=${secret()}\nJDBC_GATEWAY_TOKEN=${secret()}\nJDBC_GATEWAY_URL=http://127.0.0.1:8081\nPRISM_ADMIN_USER=admin\nPRISM_ADMIN_PASSWORD=${secret()}\n`,{mode:0o600});console.log('已创建 .env。登录账号为 admin，密码保存在 PRISM_ADMIN_PASSWORD。请备份 SOURCE_KEY。')}else { let existing=readFileSync('.env','utf8'); if(!/^PRISM_ADMIN_PASSWORD=/m.test(existing)){existing+='\nPRISM_ADMIN_USER=admin\nPRISM_ADMIN_PASSWORD='+secret()+'\n';writeFileSync('.env',existing,{mode:0o600});console.log('已添加服务器管理员凭据，原有密钥保持不变。')}else console.log('.env 已存在，保留全部配置。'); }
if(!existsSync('.dev.vars'))writeFileSync('.dev.vars',readFileSync('.env','utf8'),{mode:0o600});
