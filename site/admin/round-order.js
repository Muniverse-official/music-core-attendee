(() => {
'use strict';
const list=document.getElementById('roundList');
if(!list)return;
const initialized=new Set();
let sorting=false;
function program(){return document.querySelector('[data-program][aria-pressed="true"]')?.dataset.program||'music_core'}
function numberOf(button){const text=button.querySelector('strong')?.textContent||'';const m=text.match(/^\s*([0-9]+)\s*회(?:차)?(?:\s|$)/);return m?Number(m[1]):-1}
function titleOf(button){return button.querySelector('strong')?.textContent||''}
function sortLatestFirst(){
  if(sorting)return;
  sorting=true;
  const buttons=[...list.querySelectorAll(':scope > .round-item')];
  const ranked=buttons.map((button,index)=>({button,index,n:numberOf(button),title:titleOf(button)}));
  ranked.sort((a,b)=>b.n-a.n||b.title.localeCompare(a.title,'ko',{numeric:true})||a.index-b.index);
  const fragment=document.createDocumentFragment();
  ranked.forEach(x=>fragment.append(x.button));
  list.append(fragment);
  sorting=false;
  const p=program();
  if(!initialized.has(p)){
    initialized.add(p);
    const first=ranked[0]?.button||null;
    const selected=list.querySelector('.round-item[aria-pressed="true"]');
    if(first&&selected!==first){
      list.scrollTop=0;
      queueMicrotask(()=>first.click());
    }else if(first){
      list.scrollTop=0;
    }
  }
}
new MutationObserver(mutations=>{
  if(sorting)return;
  if(mutations.some(m=>m.type==='childList'))queueMicrotask(sortLatestFirst);
}).observe(list,{childList:true});
document.querySelectorAll('[data-program]').forEach(button=>button.addEventListener('click',()=>{
  const p=button.dataset.program;
  if(p)initialized.delete(p);
},{capture:true}));
queueMicrotask(sortLatestFirst);
document.documentElement.dataset.roundOrder='latest-first';
})();
