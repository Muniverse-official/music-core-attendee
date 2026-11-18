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

  // The scoped API selects the public round. Sorting must not trigger a
  // second, expensive winner-data request by clicking the newest round.
}

new MutationObserver(mutations=>{
  if(mutations.some(m=>m.type==='childList'))schedule();
}).observe(list,{childList:true});

document.querySelectorAll('[data-program]').forEach(button=>button.addEventListener('click',()=>{
  syncSheetLink();
  schedule();
},{capture:true}));

syncSheetLink();
schedule();
document.documentElement.dataset.roundOrder='latest-first-safe';
document.documentElement.dataset.sheetLinks='disabled';
})();
