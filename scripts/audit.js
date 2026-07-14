import { execSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function walk(d,a){for(const n of readdirSync(d)){const p=join(d,n);if(n==='node_modules'||n.startsWith('.'))continue;const s=statSync(p);if(s.isDirectory())walk(p,a);else if(n.endsWith('.js'))a.push(p);}}
const files=[];walk(join(root,'src'),files);walk(join(root,'public/js'),files);
let fail=0;for(const f of files){try{execSync('node --check "'+f+'"',{stdio:'pipe'});}catch{console.error('FAIL',f);fail++;}}
console.log(fail?fail+' errors':'OK '+files.length+' files');process.exit(fail?1:0);
