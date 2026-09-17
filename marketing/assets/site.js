const menu=document.querySelector('.menu'),links=document.querySelector('.nav-links');
menu?.addEventListener('click',()=>{const open=links.classList.toggle('open');menu.setAttribute('aria-expanded',String(open))});
links?.addEventListener('click',()=>{links.classList.remove('open');menu?.setAttribute('aria-expanded','false')});
const tours=document.querySelectorAll('.motion-video');
if(tours.length){
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  if(!reduced.matches) tours.forEach(tour=>tour.play().catch(()=>{}));
  reduced.addEventListener('change',()=>tours.forEach(tour=>reduced.matches?tour.pause():tour.play().catch(()=>{})));
}
