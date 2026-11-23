/* FORMDAY free cloud-file backup, no network upload or automatic sync. */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.FormdayBackup=api;
  if(root.document)api.init(root);
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function makeBackup(core,storage,clock){
    if(!core||!core.makeStore||!storage)throw Error('브라우저 저장소를 사용할 수 없습니다.');
    const loaded=core.makeStore(storage).load();
    if(loaded.error)throw Error('현재 기록을 읽을 수 없습니다. 원본을 덮어쓰지 않았습니다. 먼저 기존 기록 오류를 해결해 주세요.');
    if(!loaded.data)throw Error('아직 저장된 실제 기록이 없습니다. 먼저 운동·식단·체중 일정을 저장해 주세요.');
    const state=core.normalizeState(loaded.data),d=clock||new Date(),pad=n=>String(n).padStart(2,'0');
    const filename='FORMDAY-backup-'+d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'_'+pad(d.getHours())+pad(d.getMinutes())+'.json';
    const payload={app:'formday',version:core.VERSION,exportedAt:d.toISOString(),...state};
    const text=JSON.stringify(payload,null,2);
    return {filename,text,eventCount:state.events.length,foodCount:state.customFoods.length,sampleCount:state.events.filter(e=>e.isSample).length};
  }
  function init(root){
    const doc=root.document,button=doc.getElementById('cloud-backup');
    if(!button||button.dataset.backupReady)return;
    button.dataset.backupReady='1';
    let dialog;
    const q=s=>dialog.querySelector(s);
    function status(message,error){
      const p=q('[data-fdb-status]');p.textContent=message;p.dataset.error=error?'true':'false';
    }
    function download(file){
      const blob=new Blob([file.text],{type:'application/json;charset=utf-8'});
      const url=root.URL.createObjectURL(blob);
      const link=doc.createElement('a');link.href=url;link.download=file.filename;
      doc.body.appendChild(link);link.click();link.remove();
      root.setTimeout(()=>root.URL.revokeObjectURL(url),1500);
    }
    function snapshot(){return makeBackup(root.FormdayCore,root.localStorage,new Date());}
    function refresh(){
      try{
        const file=snapshot();
        q('[data-fdb-count]').textContent=file.eventCount+'개 일정 · 내 식품 '+file.foodCount+'개';
        q('[data-fdb-samples]').textContent=file.sampleCount?'체험용 샘플 '+file.sampleCount+'개가 포함됩니다. 실제 기록만 보관하려면 사이트에서 샘플을 먼저 지우세요.':'운동·식단·체중·영양 목표와 내 식품을 백업합니다.';
        for(const b of dialog.querySelectorAll('[data-fdb-share],[data-fdb-download]'))b.disabled=false;
      }catch(e){
        q('[data-fdb-count]').textContent='백업할 기록 확인 필요';
        q('[data-fdb-samples]').textContent=e.message;
        for(const b of dialog.querySelectorAll('[data-fdb-share],[data-fdb-download]'))b.disabled=true;
      }
      status('백업 파일이 클라우드에 저장됐는지는 파일 앱에서 직접 확인해 주세요.',false);
    }
    function open(){
      if(!dialog){
        dialog=doc.createElement('dialog');
        dialog.id='fd-cloud-dialog';dialog.className='fdb-dialog';
        dialog.setAttribute('aria-labelledby','fdb-title');
        dialog.innerHTML=[
          '<header class="fdb-header"><div><span class="fdb-kicker">무료 · 파일 백업</span><h2 id="fdb-title">클라우드에 기록 백업</h2><p>별도 서버 가입이나 유료 요금제 없이 기록 파일을 보관합니다.</p></div><button type="button" data-fdb-close aria-label="닫기">×</button></header>',
          '<div class="fdb-body"><div class="fdb-records"><strong>이 브라우저의 저장된 기록</strong><span data-fdb-count></span><small data-fdb-samples></small></div>',
          '<div class="fdb-steps"><strong>아이폰에서 iCloud Drive에 저장</strong><ol><li><b>공유해서 저장</b> 선택</li><li>공유 메뉴에서 <b>파일에 저장</b> 선택</li><li><b>iCloud Drive</b>를 저장 위치로 선택</li><li>파일 앱에서 백업 파일 확인</li></ol><p>공유가 지원되지 않으면 다운로드한 파일을 파일 앱에서 iCloud Drive나 Google Drive로 옮길 수 있습니다.</p></div>',
          '<div class="fdb-actions"><button type="button" data-fdb-share class="fdb-primary">공유해서 저장</button><button type="button" data-fdb-download class="fdb-secondary">백업 파일 다운로드</button><button type="button" data-fdb-restore class="fdb-secondary">백업 파일로 복원</button></div>',
          '<p data-fdb-status class="fdb-status" role="status" aria-live="polite"></p>',
          '<p class="fdb-warning">이 파일에는 개인 건강 기록이 포함되고 파일 자체는 암호화되지 않습니다. 공개 링크로 공유하지 마세요. <b>자동 백업이나 실시간 기기 동기화 기능이 아닙니다.</b> 파일 앱에서 실제 저장 여부를 확인해야 합니다.</p></div>'
        ].join('');
        doc.body.appendChild(dialog);
        q('[data-fdb-close]').onclick=()=>dialog.close();
        q('[data-fdb-download]').onclick=()=>{
          try{download(snapshot());status('다운로드를 요청했습니다. 파일이 실제 저장됐는지 확인해 주세요.',false);}
          catch(e){status(e.message,true);}
        };
        q('[data-fdb-share]').onclick=async()=>{
          let f;try{f=snapshot();}catch(e){status(e.message,true);return;}
          try{
            if(typeof root.File!=='function'||!root.navigator||typeof root.navigator.share!=='function'||typeof root.navigator.canShare!=='function')throw Error('UNSUPPORTED');
            const file=new root.File([f.text],f.filename,{type:'application/json'});
            if(!root.navigator.canShare({files:[file]}))throw Error('UNSUPPORTED');
            await root.navigator.share({files:[file],title:'FORMDAY 기록 백업'});
            status('공유 메뉴를 사용했습니다. iCloud Drive 또는 Google Drive의 파일 목록에서 실제 저장 여부를 확인해 주세요.',false);
          }catch(e){
            if(e.name==='AbortError'){status('공유를 취소했습니다. 아직 백업이 저장되지 않았을 수 있습니다.',false);return;}
            if(['UNSUPPORTED','TypeError','NotAllowedError'].includes(e.message)||['TypeError','NotAllowedError'].includes(e.name)){
              try{download(f);status('공유가 지원되지 않아 다운로드했습니다. 파일 앱에서 클라우드로 옮겨 주세요.',false);}
              catch(err){status('공유 또는 다운로드에 실패했습니다. '+err.message,true);}
            }else status('공유를 완료하지 못했습니다. 다운로드 버튼을 이용해 주세요.',true);
          }
        };
        q('[data-fdb-restore]').onclick=()=>{dialog.close();doc.getElementById('import-btn')?.click();};
      }
      refresh();
      if(typeof dialog.showModal==='function')dialog.showModal();
      else dialog.setAttribute('open','');
    }
    button.addEventListener('click',open);
  }
  return {makeBackup,init};
});