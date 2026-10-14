const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('/tmp/vessel-fe-review/pw/node_modules/playwright-core');
(async()=>{
 const config=JSON.parse(fs.readFileSync('/tmp/vessel-fe-review/config.json','utf8'));
 assert.equal(config.container,'vessel-fe-review-20261014');assert.equal(config.db,'vesselfe');
 const base='http://127.0.0.1:48651',out='/tmp/vessel-fe-review/shots/shell-wave3-probes';
 fs.mkdirSync(out,{recursive:true});assert.equal(fs.readdirSync(out).length,0);
 const report={sourceCommit:'b54bba08ded5681aaaefc350131cb2e3b073fab7',scope:'Synthetic module throw and focused skip-link probes, separate from the clean 76-state matrix',shots:[],checks:[],expectedInjectedErrors:[],errors:[],blocked:[]};
 const browser=await chromium.launch({headless:true,executablePath:'/nix/store/ll2lvrd9795hpa0yr20p207h8vif1ax0-chromium-151.0.7922.137/bin/chromium'});
 try{for(const theme of ['graphite','paper'])for(const [name,width,height] of [['desktop',1440,900],['mobile',390,844]]){
  const tag=`${theme}-${name}`,context=await browser.newContext({viewport:{width,height},locale:'en-US',timezoneId:'UTC',reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage();
  await page.addInitScript(theme=>{localStorage.setItem('vessel.appearance',JSON.stringify({themeId:theme,custom:{},saved:[],draft:null}));globalThis.__shellBoundaryProbe=true},theme);
  for(const event of ['pageerror','console'])page.on(event,msg=>{if(event==='console'&&msg.type()!=='error')return;const text=event==='console'?msg.text():msg.message;(text.includes('Synthetic shell boundary probe')?report.expectedInjectedErrors:report.errors).push(`${tag}: ${text.replaceAll(config.token,'[redacted]')}`)});
  await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==base||/^\/api\/venues\//.test(u.pathname)||/^\/api\/accounts\/[^/]+\/(instruments|candles|market-context|market-stream|sync)$/.test(u.pathname)){report.blocked.push(`${tag}: ${u.pathname}`);return route.abort()};if(/\/assets\/PlaysPage-[^/]+\.js$/.test(u.pathname))return route.fulfill({status:200,contentType:'application/javascript',body:"export function PlaysPage(){if(globalThis.__shellBoundaryProbe)throw new Error('Synthetic shell boundary probe');return 'Synthetic recovery confirmed'}"});return route.continue()});
  await page.goto(base);await page.getByLabel('API token').fill(config.token);await page.getByRole('button',{name:'Connect',exact:true}).click();await page.getByRole('region',{name:'Overview summary',exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
  await page.getByRole('link',{name:'Skip to content',exact:true}).focus();await page.screenshot({path:path.join(out,`${tag}-skip-link.png`)});report.shots.push(`${tag}-skip-link.png`);
  await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement?.id),'workspace-content');assert.equal(new URL(page.url()).hash,'');report.checks.push(`${tag}: skip focuses main without route change`);
  if(name==='mobile')await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('link',{name:'Plays',exact:true}).click();await page.getByRole('heading',{name:'This page could not be displayed.'}).waitFor();await page.screenshot({path:path.join(out,`${tag}-page-boundary.png`)});report.shots.push(`${tag}-page-boundary.png`);
  assert(!(await page.locator('body').innerText()).includes('Synthetic shell boundary probe'));report.checks.push(`${tag}: boundary hides injected message`);
  await page.evaluate(()=>{globalThis.__shellBoundaryProbe=false});await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByText('Synthetic recovery confirmed',{exact:true}).waitFor();
  if(name==='mobile')await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('link',{name:'Overview',exact:true}).click();await page.getByRole('region',{name:'Overview summary',exact:true}).waitFor();report.checks.push(`${tag}: retry and navigation recover`);
  await context.close();
 }}finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2))}
 assert.equal(report.errors.length,0);assert.equal(report.blocked.length,0);assert.equal(report.shots.length,8);console.log(`Passed ${report.checks.length} checks, ${report.shots.length} screenshots; ${report.expectedInjectedErrors.length} expected injected errors only`);
})().catch(e=>{console.error(e);process.exitCode=1});
