(() => {
'use strict';
const list=document.getElementById('roundList');
if(!list)return;

const publicLink=document.getElementById('publicLink');
let sheetLink=document.getElementById('sheetLink');
if(!sheetLink&&publicLink){
  sheetLink=document.createElement('a');
  sheetLink.id='sheetLink';
  sheetLink.target='_blank';
  sheetLink.rel='noopener noreferrer';
  publicLink.after(sheetLink);
}

const initialized=new Set();
let scheduled=false;

function program(){
  return document.querySelector('[data-program][aria-pressed="true"]')?.dataset.program||'music_core';
}
function syncSheetLink(){if(sheetLink)sheetLink.hidden=true}
function numberOf(button){
  const text=button.querySelector('strong')?.textContent||'';
  const m=text.match(/^\s*([0-9]+)\s*회(?:차)?(?:\s|$)/);
  return m?Number(m[1]):-1;
}
function titleOf(button){
  return button.querySelector('strong')?.textContent||'';
}
function schedule(){
  if(scheduled)return;
  scheduled=true;
  requestAnimationFrame(()=>{
    scheduled=false;
    sortLatestFirst();
    syncSheetLink();
  });
}
function sortLatestFirst(){
  const buttons=[...list.querySelectorAll(':scope > .round-item')];
  if(!buttons.length)return;

  const ranked=buttons
    .map((button,index)=>({button,index,n:numberOf(button),title:titleOf(button)}))
    .sort((a,b)=>b.n-a.n||b.title.localeCompare(a.title,'ko',{numeric:true})||a.index-b.index);

  const alreadySorted=buttons.every((button,index)=>button===ranked[index].button);
  if(!alreadySorted){
    const fragment=document.createDocumentFragment();
    ranked.forEach(x=>fragment.append(x.button));
    list.append(fragment);
  }

  const p=program();
  if(!initialized.has(p)){
    initialized.add(p);
    const first=ranked[0]?.button||null;
    const selected=list.querySelector('.round-item[aria-pressed="true"]');
    list.scrollTop=0;
    if(first&&selected!==first){
      setTimeout(()=>{
        if(document.body.contains(first))first.click();
      },0);
    }
  }
}

new MutationObserver(mutations=>{
  if(mutations.some(m=>m.type==='childList'))schedule();
}).observe(list,{childList:true});

document.querySelectorAll('[data-program]').forEach(button=>button.addEventListener('click',()=>{
  const p=button.dataset.program;
  if(p)initialized.delete(p);
  syncSheetLink(p);
  schedule();
},{capture:true}));

syncSheetLink();
schedule();
document.documentElement.dataset.roundOrder='latest-first-safe';
document.documentElement.dataset.sheetLinks='disabled';
})();
