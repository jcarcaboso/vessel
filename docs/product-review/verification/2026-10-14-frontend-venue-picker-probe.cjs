const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
(async()=>{
 const c=JSON.parse(fs.readFileSync('/tmp/vessel-fe-review/config.json','utf8'));
 assert.equal(c.container,'vessel-fe-review-20261014');assert.equal(c.db,'vesselfe');
 const base=process.env.CAPTURE_URL,out=process.env.CAPTURE_OUT;assert.equal(new URL(base).hostname,'127.0.0.1');assert.ok(out);fs.mkdirSync(out,{recursive:true});assert.equal(fs.readdirSync(out).length,0);
 const report={source:process.env.CAPTURE_SOURCE_REF,status:'running',checks:[],shots:[],errors:[],blocked:[]};
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
 try{for(const theme of ['graphite','paper'])for(const [size,width,height]of[['desktop',1440,900],['mobile',390,844]]){
  const tag=`${theme}-${size}`,ctx=await browser.newContext({viewport:{width,height},locale:'en-US',timezoneId:'UTC',reducedMotion:'reduce',serviceWorkers:'block'}),page=await ctx.newPage();
  await page.addInitScript(theme=>localStorage.setItem('vessel.appearance',JSON.stringify({themeId:theme,custom:{},saved:[],draft:null})),theme);
  page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text().replaceAll(c.token,'[redacted]'))});page.on('pageerror',e=>report.errors.push(e.message.replaceAll(c.token,'[redacted]')));
  await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==base||!['GET','HEAD'].includes(r.request().method())||/^\/api\/venues\//.test(u.pathname)||/^\/api\/accounts\/[^/]+\/(instruments|candles|market-context|market-stream|sync)$/.test(u.pathname)){report.blocked.push(u.pathname);return r.abort()}return r.continue()});
  await page.goto(base);await page.getByLabel('API token').fill(c.token);await page.getByRole('button',{name:'Connect',exact:true}).click();await page.getByRole('region',{name:'Overview summary',exact:true}).waitFor();await page.evaluate(()=>location.hash='accounts');await page.getByRole('button',{name:'Add account',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Add an account'});await dialog.waitFor();assert.equal(await dialog.getByRole('radio').count(),5);const rh=dialog.getByRole('radio',{name:'Lighter · Robinhood · read-only perps',exact:true});await dialog.getByText('Lighter · Robinhood',{exact:true}).click();assert.equal(await rh.isChecked(),true);await dialog.getByText('Read-only perps · USDG',{exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
  const box=await dialog.boundingBox();assert.ok(box&&box.x>=-1&&box.x+box.width<=width+1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const file=`${tag}-robinhood-venue-picker.png`;await page.screenshot({path:path.join(out,file),animations:'disabled',caret:'hide'});report.shots.push(file);report.checks.push(`${tag}: five bundled venue options, RH selected, USDG label, bounded dialog and no page overflow`);await ctx.close();
 }assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);report.status='passed'}catch(e){report.status='failed';report.failure=e.message.replaceAll(c.token,'[redacted]');throw e}finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n')}
 console.log('Passed',report.checks.length,'venue picker states; no writes or external requests');
})().catch(e=>{console.error(e.message);process.exitCode=1});
