import { chromium } from 'playwright';
const OUT='/tmp/claude-0/-home-user-pickled-jews/20922e66-1f36-55e2-bb3f-1987a5bf553c/scratchpad';
const URL='file:///home/user/pickled_jews/brand/guide.html';
const b = await chromium.launch();
const p = await b.newPage({viewport:{width:375,height:900}});
await p.goto(URL,{waitUntil:'load'}); await p.waitForTimeout(1500);
// are wide tables inside an overflow-x scroll container?
const res = await p.evaluate(()=>{
  const out=[]; document.querySelectorAll('table').forEach((t,i)=>{
    let el=t.parentElement, found=null, depth=0;
    while(el && depth<4){ const cs=getComputedStyle(el);
      if(cs.overflowX==='auto'||cs.overflowX==='scroll'){ found=el.tagName.toLowerCase()+'.'+(el.className||'')+' overflowX='+cs.overflowX; break; }
      el=el.parentElement; depth++; }
    out.push({i, contained: !!found, wrapper: found});
  });
  const n=out.length, c=out.filter(o=>o.contained).length;
  return {total:n, contained:c, sample: out.slice(0,3), uncontained: out.filter(o=>!o.contained).slice(0,5)};
});
console.log('TABLES:', res.total, 'contained in overflow-x scroller:', res.contained);
console.log('sample:', JSON.stringify(res.sample,null,1));
console.log('UNCONTAINED:', JSON.stringify(res.uncontained));
await b.close();
