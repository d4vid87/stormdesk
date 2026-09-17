const menu=document.querySelector('.menu'),links=document.querySelector('.nav-links');
menu?.addEventListener('click',()=>{const open=links.classList.toggle('open');menu.setAttribute('aria-expanded',String(open))});
links?.addEventListener('click',()=>{links.classList.remove('open');menu?.setAttribute('aria-expanded','false')});
