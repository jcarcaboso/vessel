const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('/tmp/vessel-fe-review/pw/node_modules/playwright-core');
(async()=>{
 const c=JSON.parse(fs.readFileSync('/tmp/vessel-fe-review/config.json','utf8'));assert.equal(c.container,'vessel-fe-review-20261014');assert.equal(c.db,'vesselfe');
 const base='http://127.0.0.1:48651',out='/tmp/vessel-fe-review/shots/shell-wave3-load-fallback-probes';fs.mkdirSync(out,{recursive:true});assert.equal(fs.readdirSync(out).length,0);
 const report={source:'f02bd15697466694448dd9c47730749260987865',status:'running',checks:[],shots:[],expectedInjectedErrors:[],unexpectedErrors:[],blocked:[],attempts:{}};
 const browser=await chromium.launch({headless:true,executablePath:'/nix/store/ll2lvrd9795hpa0yr20p207h8vif1ax0-chromium-151.0.7922.137/bin/chromium'});
 try{for(const theme of ['graphite','paper'])for(const [size,width,height] of [['desktop',1440,900],['mobile',390,844]]){
  const tag=`${theme}-${size}`,context=await browser.newContext({viewport:{width,height},locale:'en-US',timezoneId:'UTC',reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage();
  await page.addInitScript(theme=>{localStorage.setItem('vessel.appearance',JSON.stringify({themeId:theme,custom:{},saved:[],draft:null}));localStorage.setItem('vessel.chart.preferences.v1',JSON.stringify({live:false,schemaVersion:2}))},theme);
  let attempts=0,injecting=false;
  const record=text=>(injecting?report.expectedInjectedErrors:report.unexpectedErrors).push(`${tag}: ${text.replaceAll(c.token,'[redacted]')}`);
  page.on('console',m=>{if(m.type()==='error')record(m.text())});page.on('pageerror',e=>record(e.message));
  await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==base||/^\/api\/venues\//.test(u.pathname)||/^\/api\/accounts\/[^/]+\/(instruments|candles|market-context|market-stream|sync)$/.test(u.pathname)){report.blocked.push(`${tag}: ${u.pathname}`);return route.abort()};if(/\/assets\/ReviewPage-[^/]+\.js$/.test(u.pathname)){attempts++;if(attempts===1)return route.fulfill({status:503,contentType:'application/javascript',body:'Transient synthetic chunk failure'})}return route.continue()});
  await page.goto(base);await page.getByLabel('API token').fill(c.token);await page.getByRole('button',{name:'Connect',exact:true}).click();await page.getByRole('region',{name:'Overview summary',exact:true}).waitFor();
  await page.evaluate(()=>{location.hash='plays'});await page.getByRole('button',{name:'New play',exact:true}).click();await page.getByLabel('Play title',{exact:true}).fill('Unsaved browser retry probe');
  injecting=true;await page.evaluate(()=>{location.hash='review'});await page.getByRole('heading',{name:'This page could not be loaded.'}).waitFor();
  await page.screenshot({path:path.join(out,`${tag}-failed-import.png`)});report.shots.push(`${tag}-failed-import.png`);
  assert.equal(await page.getByRole('button',{name:'Try again',exact:true}).count(),0);
  assert.equal(attempts,1);
  assert.match(await page.getByRole('alert').innerText(),/Reloading the browser discards unsaved work/);
  await page.evaluate(()=>{location.hash='plays'});assert.equal(await page.getByLabel('Play title',{exact:true}).inputValue(),'Unsaved browser retry probe');
  report.checks.push(`${tag}: load fallback retains shell, authentication and unsaved Plays title`);
  await page.evaluate(()=>{location.hash='review'});await page.getByRole('heading',{name:'This page could not be loaded.'}).waitFor();
  assert.equal(attempts,1);report.checks.push(`${tag}: no misleading retry, automatic import loop or automatic reload`);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByRole('button',{name:'Reload browser',exact:true}).click();
  await page.getByLabel('API token').waitFor();await page.getByLabel('API token').fill(c.token);
  await page.getByRole('button',{name:'Connect',exact:true}).click();
  await page.getByRole('region',{name:'Performance scorecard',exact:true}).waitFor({timeout:8000});injecting=false;
  assert.equal(attempts,2);report.attempts[tag]=attempts;await page.getByRole('group',{name:'Chart view',exact:true}).waitFor();
  report.checks.push(`${tag}: explicit reload and reconnect loads real Review with Chart view group`);
  await page.screenshot({path:path.join(out,`${tag}-reloaded.png`)});report.shots.push(`${tag}-reloaded.png`);
  await context.close();
 }
 assert.equal(report.unexpectedErrors.length,0);assert.equal(report.blocked.length,0);report.status='passed';
 }catch(e){report.status='failed';report.failure=String(e.message).replaceAll(c.token,'[redacted]');throw e}finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2))}
 console.log('Passed',report.checks.length,'checks and',report.shots.length,'screenshots');
})().catch(e=>{console.error(e.message);process.exitCode=1});
