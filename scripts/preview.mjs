import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {MockBucket} from './mock-bucket.mjs';
execFileSync(process.execPath,['scripts/build.mjs']);
const {default:worker}=await import('../dist/server/index.js');const env={BUCKET:new MockBucket()};
http.createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);const request=new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(body.length?{body}: {})});const response=await worker.fetch(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500);res.end('Erreur');}}).listen(Number(process.env.PORT||process.argv[process.argv.indexOf('--port')+1]||3000),'0.0.0.0');
