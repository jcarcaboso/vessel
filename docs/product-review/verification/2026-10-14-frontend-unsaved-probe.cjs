const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
(async()=>{
 const c=JSON.parse(fs.readFileSync('/tmp/vessel-fe-review/config.json','utf8'));
 assert.equal(c.container,'vessel-fe-review-20261014');assert.equal(c.db,'vesselfe');
 const base='http://127.0.0.1:48651',out=process.env.PROBE_OUT;assert.ok(out);fs.mkdirSync(out,{recursive:true});assert.equal(fs.readdirSync(out).length,0);
 const report={source:process.env.PROBE_SOURCE,status:'running',checks:[],shots:[],dialogs:[],errors:[],expectedErrors:[],blocked:[]};
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
 try { for(const theme of ['graphite','paper'])for(const [size,width,height] of [['desktop',1440,900],['mobile',390,844]]){
  const tag=`${theme}-${size}`,ctx=await browser.newContext({viewport:{width,height},locale:'en-US',timezoneId:'UTC',reducedMotion:'reduce',serviceWorkers:'block'}),page=await ctx.newPage();
  await page.addInitScript(theme=>{localStorage.setItem('vessel.appearance',JSON.stringify({themeId:theme,custom:{},saved:[],draft:null}));localStorage.setItem('vessel.chart.preferences.v1',JSON.stringify({live:false,schemaVersion:2}))},theme);
  let failReview=true;page.on('pageerror',e=>report.errors.push(`${tag}: ${e.message.replaceAll(c.token,'[redacted]')}`));
  page.on('console',m=>{if(m.type()==='error')(m.text().includes('503')?report.expectedErrors:report.errors).push(`${tag}: ${m.text().replaceAll(c.token,'[redacted]')}`)});
  await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==base||/^\/api\/venues\//.test(u.pathname)||/^\/api\/accounts\/[^/]+\/(instruments|candles|market-context|market-stream|sync)$/.test(u.pathname)){report.blocked.push(u.pathname);return r.abort()};if(failReview&&/\/assets\/ReviewPage-[^/]+\.js$/.test(u.pathname)){failReview=false;return r.fulfill({status:503,contentType:'application/javascript',body:'Synthetic failed chunk'})}return r.continue()});
  const go=async hash=>{await page.evaluate(h=>location.hash=h,hash)};
  const connect=async()=>{await page.getByLabel('API token').fill(c.token);await page.getByRole('button',{name:'Connect',exact:true}).click();await page.getByRole('button',{name:"Disconnect Synthetic Owner's session",exact:true,includeHidden:true}).waitFor({state:'attached'})};
  const decision=async(action,type,accept)=>{
   let timer;const seen=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error(`Missing ${type} dialog`)),10000);page.once('dialog',async d=>{try{assert.equal(d.type(),type);report.dialogs.push({tag,type,message:d.message(),accept});await (accept?d.accept():d.dismiss());resolve()}catch(e){reject(e)}})});
   try{await Promise.all([seen,action()])}finally{clearTimeout(timer)}
  };
  await page.goto(base);await connect();await go('settings');
  let unexpected=0;const rejectUnexpected=async d=>{unexpected++;await d.dismiss()};page.on('dialog',rejectUnexpected);
  await page.getByRole('button',{name:'Disconnect session',exact:true}).click();await page.getByLabel('API token').waitFor();assert.equal(unexpected,0);page.off('dialog',rejectUnexpected);
  report.checks.push(`${tag}: clean disconnect has no confirmation`);
  await connect();await go('plays');await page.getByRole('button',{name:'New play',exact:true}).click();await page.getByLabel('Play title',{exact:true}).fill('Unsaved native guard probe');
  await go('settings');await page.getByRole('button',{name:'Disconnect session',exact:true}).waitFor();
  await decision(()=>page.getByRole('button',{name:'Disconnect session',exact:true}).click(),'confirm',false);
  if(size==='mobile')await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await decision(()=>page.getByRole('button',{name:"Disconnect Synthetic Owner's session",exact:true}).click(),'confirm',false);
  if(size==='mobile')await page.getByRole('button',{name:'Close navigation',exact:true}).click();
  await go('plays');assert.equal(await page.getByLabel('Play title',{exact:true}).inputValue(),'Unsaved native guard probe');report.checks.push(`${tag}: cancelling both disconnect controls retains hidden Plays draft and session`);
  await go('settings');await decision(()=>page.evaluate(()=>window.location.reload()),'beforeunload',false);
  await go('plays');assert.equal(await page.getByLabel('Play title',{exact:true}).inputValue(),'Unsaved native guard probe');report.checks.push(`${tag}: cancelled real reload retains draft across routes`);
  await go('review');await page.getByRole('heading',{name:'This page could not be loaded.'}).waitFor();
  await decision(()=>page.getByRole('button',{name:'Reload browser',exact:true}).click(),'beforeunload',false);await page.getByRole('heading',{name:'This page could not be loaded.'}).waitFor();
  report.checks.push(`${tag}: module fallback reload is protected by native unload warning`);
  await page.screenshot({path:path.join(out,`${tag}-protected-load-fallback.png`)});report.shots.push(`${tag}-protected-load-fallback.png`);
  await go('plays');assert.equal(await page.getByLabel('Play title',{exact:true}).inputValue(),'Unsaved native guard probe');
  await page.screenshot({path:path.join(out,`${tag}-retained-draft.png`)});report.shots.push(`${tag}-retained-draft.png`);
  await go('settings');await decision(()=>page.getByRole('button',{name:'Disconnect session',exact:true}).click(),'confirm',true);await page.getByLabel('API token').waitFor();
  await connect();await go('plays');await page.getByRole('button',{name:'New play',exact:true}).click();assert.equal(await page.getByLabel('Play title',{exact:true}).inputValue(),'');report.checks.push(`${tag}: accepted disconnect clears draft, reconnect starts blank`);
  await ctx.close();
 }
 assert.equal(report.errors.length,0);assert.equal(report.blocked.length,0);report.status='passed';
 }catch(e){report.status='failed';report.failure=e.message.replaceAll(c.token,'[redacted]');throw e}finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2))}
 console.log('Passed',report.checks.length,'checks and',report.shots.length,'screenshots');
})().catch(e=>{console.error(e.message);process.exitCode=1});
