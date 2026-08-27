import { chromium } from 'playwright';
const OUT='/tmp/claude-0/-home-user-pickled-jews/20922e66-1f36-55e2-bb3f-1987a5bf553c/scratchpad';
const URL='file:///home/user/pickled_jews/brand/guide.html';
const b = await chromium.launch();
const p = await b.newPage({viewport:{width:1440,height:1100}, deviceScaleFactor:1});
await p.goto(URL,{waitUntil:'load'}); await p.waitForTimeout(2500);
const H = await p.evaluate(()=>document.documentElement.scrollHeight);
console.log('height', H);
// tiled scroll captures across the whole doc
const step=1100; let n=0;
for(let y=0;y<H;y+=step*3){ // sample every 3rd screen to keep count sane
  await p.evaluate(yy=>window.scrollTo(0,yy), y); await p.waitForTimeout(450);
  await p.screenshot({path:`${OUT}/B-scroll-${String(n).padStart(2,'0')}-y${y}.png`});
  n++;
}
console.log('tiles', n);
await p.evaluate(()=>window.scrollTo(0,0)); await p.waitForTimeout(400);
await p.screenshot({path:`${OUT}/B-full.png`, fullPage:true});
// responsive
for(const w of [375,768]){ const q=await b.newPage({viewport:{width:w,height:1000}});
  await q.goto(URL,{waitUntil:'load'}); await q.waitForTimeout(1500);
  await q.screenshot({path:`${OUT}/B-w${w}-top.png`});
  await q.evaluate(()=>window.scrollTo(0,6000)); await q.waitForTimeout(500);
  await q.screenshot({path:`${OUT}/B-w${w}-mid.png`}); await q.close(); }
await b.close();
