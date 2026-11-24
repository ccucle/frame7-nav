/* Keep touch/click focus restoration from drawing keyboard-only focus rings. */
(function(){
  'use strict';
  const page=document.documentElement;
  const navigationKeys=new Set(['Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown']);
  const usePointer=()=>{page.dataset.fdInput='pointer';};
  usePointer();

  // Capture before a control opens a dialog or restores focus after closing it.
  for(const event of ['pointerdown','mousedown','touchstart']){
    document.addEventListener(event,usePointer,{capture:true,passive:true});
  }
  document.addEventListener('keydown',event=>{
    if(event.altKey||event.ctrlKey||event.metaKey||event.isComposing)return;
    // Typing on the phone's software keyboard must not enable button rings.
    if(navigationKeys.has(event.key))page.dataset.fdInput='keyboard';
  },true);
})();
