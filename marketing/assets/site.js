const menu=document.querySelector('.menu'),links=document.querySelector('.nav-links');
menu?.addEventListener('click',()=>{const open=links.classList.toggle('open');menu.setAttribute('aria-expanded',String(open))});
links?.addEventListener('click',()=>{links.classList.remove('open');menu?.setAttribute('aria-expanded','false')});
const tour=document.querySelector('#app-tour');
if(tour){
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  if(!reduced.matches) tour.play().catch(()=>{});
  reduced.addEventListener('change',()=>{if(reduced.matches)tour.pause()});
}
