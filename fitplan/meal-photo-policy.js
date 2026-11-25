/* Original meal photo contract. No personal records, I/O or authentication. */
(function(root){const api=(function mealPhotoPolicy(){
  "use strict";
  const MAX_BYTES=700*1024;
  const mimeTypes=["image/jpeg","image/png","image/webp"];
  function validId(id){return typeof id==="string"&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(id)}
  function validDate(date){if(typeof date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;const d=new Date(date+"T00:00:00Z");return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===date}
  function eligible(event){return !!event&&validId(event.id)&&validDate(event.date)&&event.type==="meal"&&event.repeat==="none"&&event.completed===true&&event.isSample!==true}
  function checkTarget(state,id,date){if(!validId(id)||!validDate(date)||!Array.isArray(state?.events))throw Error("식단 기록을 확인할 수 없습니다.");const matches=state.events.filter(x=>x.id===id);if(matches.length!==1||!eligible(matches[0])||matches[0].date!==date)throw Error("클라우드의 동일한 완료 식단을 찾을 수 없습니다. 식단을 먼저 동기화해 주세요.");return matches[0]}
  function checkBytes(bytes,mime){
    if(!(bytes instanceof Uint8Array)||bytes.length<12||bytes.length>MAX_BYTES)throw Error("원본 사진은 700KiB 이하만 지원합니다.");
    if(!mimeTypes.includes(mime))throw Error("JPEG, PNG, WebP 사진만 지원합니다.");
    const ascii=(offset,s)=>[...s].every((c,i)=>bytes[offset+i]===c.charCodeAt(0));
    const good=mime==="image/jpeg"?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:
      mime==="image/png"?[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v):
      ascii(0,"RIFF")&&ascii(8,"WEBP");
    if(!good)throw Error("사진의 실제 파일 형식과 표시 형식이 다릅니다.");
    return true;
  }
  function validHash(value){return typeof value==="string"&&/^[a-f0-9]{64}$/.test(value)}
  function decide(current,expected,next){
    if(current!==null&&!validHash(current)||expected!==null&&!validHash(expected)||next!==null&&!validHash(next))throw Error("사진 확인 정보가 올바르지 않습니다.");
    if(current===next)return "unchanged";
    if(current!==expected)throw Error("다른 기기에서 사진이 변경되었습니다. 다시 조회해 주세요.");
    return next===null?"delete":"write";
  }
  return Object.freeze({MAX_BYTES,mimeTypes,validId,validDate,eligible,checkTarget,checkBytes,validHash,decide});
})();if(typeof module==='object'&&module.exports)module.exports=api;else root.FormdayMealPhotoPolicy=api;})(typeof globalThis!=='undefined'?globalThis:this);
