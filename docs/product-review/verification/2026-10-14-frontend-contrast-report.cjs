const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),{execFileSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
(async()=>{
 const repo=path.resolve(process.argv[2]),out=process.argv[3],req=createRequire(path.join(repo,'frontend/package.json')),ts=req('typescript');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'vessel-contrast-'));
 for(const file of ['themes','generator']){
  const src=fs.readFileSync(path.join(repo,'frontend/src/features/settings',file+'.ts'),'utf8').replaceAll("'./themes'","'./themes.mjs'");
  fs.writeFileSync(path.join(temp,file+'.mjs'),ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
 }
 const {themes,contrastChecks}=await import(pathToFileURL(path.join(temp,'themes.mjs'))),{generatePalette}=await import(pathToFileURL(path.join(temp,'generator.mjs')));
 const result={sourceCommit:execFileSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),scope:'configured palette contrast, not a complete rendered accessibility audit',themes:themes.map(({id,scheme,colors})=>({id,scheme,checks:contrastChecks(colors)})),generated:[],failures:[]};
 for(const t of result.themes)for(const c of t.checks)if(c.ratio<c.minimum)result.failures.push({theme:t.id,...c});
 function seeded(seed){return()=>{seed=(seed+0x6d2b79f5)|0;let t=Math.imul(seed^(seed>>>15),1|seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296}}
 for(const scheme of ['dark','light']){const random=seeded(scheme==='dark'?7:11);let margin=Infinity;for(let i=0;i<500;i++){const p=generatePalette(scheme,random);assert.equal(p.scheme,scheme);for(const c of contrastChecks(p.colors)){margin=Math.min(margin,c.ratio-c.minimum);if(c.ratio<c.minimum)result.failures.push({scheme,palette:i,...c})}}result.generated.push({scheme,palettes:500,minimumContrastMargin:margin})}
 fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');assert.deepEqual(result.failures,[]);console.log(result.themes.length,'themes;',result.themes.reduce((n,t)=>n+t.checks.length,0),'pairs; 1000 generated palettes; 0 failures')
})().catch(e=>{console.error(e);process.exitCode=1});
