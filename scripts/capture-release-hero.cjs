// Record real customization actions, then build the website's small looping GIF.
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {openCapture, ROOT, STEM} = require('./capture-release-media.cjs');
(async()=>{
  const out=path.join(ROOT,'shots/release-4121/hero');fs.mkdirSync(out,{recursive:true});
  const c=await openCapture({recordVideo:out}),p=c.page;
  const start=(Date.now()-c.videoStartedAt)/1000;
  const pause=ms=>p.waitForTimeout(ms);
  try {
    await pause(1000);
    await p.locator('#desk-customize').click();await pause(1100);
    await p.getByLabel('Arrange',{exact:true}).selectOption('gauges');await pause(400);
    await p.getByLabel('Move Wind earlier',{exact:true}).click();await pause(350);
    await p.getByLabel('Move Wind earlier',{exact:true}).click();await pause(800);
    await p.getByLabel('Navigation location',{exact:true}).selectOption('left');
    await p.getByRole('button',{name:'Done',exact:true}).click();await pause(1400);
    await p.locator('#desk-customize').click();await p.locator('[data-customize-tab="themes"]').click();await pause(1200);
    await p.locator('[data-theme-choice="abyss"]').click();await pause(700);
    await p.getByRole('button',{name:'Done',exact:true}).click();await pause(1400);
    await p.locator('#desk-customize').click();await p.locator('[data-customize-tab="themes"]').click();
    await p.locator('[data-theme-choice="copper"]').click();await pause(600);
    await p.getByRole('button',{name:'Done',exact:true}).click();await pause(1400);
    await c.reset();await pause(1300);
    const duration=(Date.now()-c.videoStartedAt)/1000-start;
    const video=p.video(),filename=await video.path();await c.close();
    fs.writeFileSync(path.join(out,'recording.json'),JSON.stringify({filename,start,duration,errors:c.errors},null,2));
    const destination=path.join(ROOT,'docs',STEM+'-hero.gif');
    const filter='fps=6,scale=960:672:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle';
    const proc=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-ss',String(start),'-i',filename,'-t',String(Math.min(duration,15)),'-vf',filter,'-loop','0',destination],{encoding:'utf8'});
    if(proc.status!==0)throw new Error(proc.stderr);
    fs.copyFileSync(destination,path.join(ROOT,'marketing/images',STEM+'-hero.gif'));
    console.log(JSON.stringify({destination,start,duration,bytes:fs.statSync(destination).size,errors:c.errors}));
  } catch(e){await c.close().catch(()=>{});throw e;}
})().catch(e=>{console.error(e);process.exitCode=1;});
