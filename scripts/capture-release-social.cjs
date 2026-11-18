// Social-card composition of the actual release capture, not a fictional dashboard.
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {ROOT,STEM}=require('./capture-release-media.cjs');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:630},deviceScaleFactor:1});
  const image=(name)=>'data:image/jpeg;base64,'+fs.readFileSync(path.join(ROOT,'docs',STEM+'-'+name+'.jpg')).toString('base64');
  const logo='data:image/png;base64,'+fs.readFileSync(path.join(ROOT,'site/stormdesk-icon-192.png')).toString('base64');
  await page.setContent(`<!doctype html><style>*{box-sizing:border-box}body{margin:0;background:#10171c;color:#f3f7fa;font-family:Arial,sans-serif;width:1200px;height:630px;overflow:hidden;background:radial-gradient(ellipse at 85% 15%,#294955 0%,#10171c 57%)}.brand{position:absolute;left:48px;top:38px;display:flex;align-items:center;gap:14px;font-weight:700;font-size:26px}.brand img{width:50px;height:50px;border-radius:10px}.copy{position:absolute;left:48px;top:139px;width:380px}.eyebrow{color:#8fcede;font-weight:700;letter-spacing:2.5px;font-size:12px}h1{font-size:62px;line-height:1.04;letter-spacing:-2.5px;margin:22px 0 25px}p{font-size:21px;line-height:1.55;color:#b8c7ce;margin:0}.link{display:inline-block;margin-top:30px;border:1px solid #42616e;border-radius:12px;padding:13px 20px;font-size:20px;color:#a9e2f2;font-weight:bold}.screen{position:absolute;left:447px;top:76px;width:735px;height:515px;border:1px solid #54727f;border-radius:16px;box-shadow:0 30px 70px #0008;overflow:hidden}.screen>img{width:100%;height:100%;object-fit:cover}.badge{position:absolute;right:33px;top:35px;color:#b9dbe7;font-size:12px;letter-spacing:1.4px}.picker{position:absolute;left:887px;top:222px;width:275px;height:373px;border:1px solid #9eb6bf;border-radius:11px;overflow:hidden;box-shadow:-20px 15px 45px #0008;background:#22282d}.picker img{position:absolute;width:798px;max-width:none;left:-515px;top:-44px}.note{position:absolute;left:48px;bottom:22px;font-size:11px;color:#91a3ac}</style><div class="brand"><img src="${logo}">StormDesk</div><div class="copy"><div class="eyebrow">YOUR WEATHER. YOUR WAY.</div><h1>Make your<br>desk yours.</h1><p>Move gauges and menus.<br>Choose your perfect theme.<br>Keep your weather in view.</p><div class="link">mystormdesk.com ↗</div></div><div class="badge">CUSTOM LAYOUTS · 20 THEMES · HOOKECHO RADAR</div><div class="screen"><img src="${image('weather')}"></div><div class="picker"><img src="${image('layout-picker')}"></div><div class="note">Actual StormDesk interface · illustrated with demo weather</div>`);
  await page.locator('.picker img').evaluate(e=>e.decode());
  const dest=path.join(ROOT,'docs',STEM+'-social.jpg');await page.screenshot({path:dest,type:'jpeg',quality:91});
  fs.copyFileSync(dest,path.join(ROOT,'marketing/images',STEM+'-social.jpg'));console.log(dest);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
