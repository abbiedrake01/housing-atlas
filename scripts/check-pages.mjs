import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';

// Serve the built files under a GitHub project-site prefix, without SPA fallbacks.
const root=path.resolve('dist');
const server=createServer(async(req,res)=>{
 try{
  const pathname=new URL(req.url,'http://local').pathname;
  if(!pathname.startsWith('/housing-atlas/')){res.writeHead(404).end();return}
  let file=path.resolve(root,pathname.slice('/housing-atlas/'.length)||'index.html');
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}
  if(!(await stat(file)).isFile()){res.writeHead(404).end();return}
  res.writeHead(200).end(await readFile(file));
 }catch{res.writeHead(404).end()}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 const base=`http://127.0.0.1:${server.address().port}/housing-atlas/`;
 const html=await (await fetch(base)).text();
 assert.match(html,/<div id="root"><\/div>/);
 const urls=[...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m=>new URL(m[1],base));
 urls.push(new URL('housing.json',base));
 urls.push(new URL('regression.json',base));
 for(const url of urls){const r=await fetch(url);assert.equal(r.status,200,url.href);assert.ok(url.pathname.startsWith('/housing-atlas/'));}
 const cssURL=new URL('fonts/nunito.css',base);const css=await(await fetch(cssURL)).text();
 for(const [,font] of css.matchAll(/url\(([^)]+)\)/g)){const r=await fetch(new URL(font,cssURL));assert.equal(r.status,200,font);}
 const data=await(await fetch(new URL('housing.json',base))).json();assert.equal(data.providers.length,1076);assert.ok(data.providers.some(p=>p.tenures.LCHO.scores[0]!==null));
 const source=await readFile('app/page.tsx','utf8');assert.ok(source.includes('fetch(`${import.meta.env.BASE_URL}housing.json`)'));assert.ok(source.includes('href={import.meta.env.BASE_URL}'));
 console.log('Pages subdirectory check passed: document, JS, CSS, fonts, favicon and housing data.');
}finally{await new Promise(resolve=>server.close(resolve))}
