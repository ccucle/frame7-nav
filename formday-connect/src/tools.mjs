/**
 * FORMDAY Connect read-only MCP tool definitions and strict dispatcher.
 * Host integration must inject a verified principal and a Firestore read adapter.
 * No tools accept uid, arbitrary Firestore paths, secrets, or write operations.
 */
import {createReader} from "./reader.mjs";

const dateRangeProps={
  from:{type:"string",pattern:"^\\d{4}-\\d{2}-\\d{2}$",description:"KST calendar date YYYY-MM-DD"},
  to:{type:"string",pattern:"^\\d{4}-\\d{2}-\\d{2}$",description:"KST calendar date YYYY-MM-DD"},
  limit:{type:"integer",minimum:1,maximum:150,default:50}
};
const params=(properties={})=>({type:"object",properties,additionalProperties:false});

export const READ_TOOLS=Object.freeze([
  {name:"formday_status",title:"FORMDAY 연결 상태",
    description:"확인된 Google 사용자 UID의 FORMDAY 캘린더 및 IRON MODE 클라우드 기록 존재 여부를 조회합니다.",
    inputSchema:params()},
  {name:"formday_workouts",title:"웨이트 운동 기록",
    description:"완료 또는 부분 완료된 IRON MODE 실제 운동 세션을 읽습니다. 워밍업은 운동량에 합산하지 않습니다.",
    inputSchema:params({...dateRangeProps,includeUnfinished:{type:"boolean",default:false}})},
  {name:"formday_routines",title:"훈련 루틴 목록",
    description:"기존 IRON MODE 루틴·프로그램과 종목별 목표 중량·반복 횟수를 읽습니다.",
    inputSchema:params({limit:dateRangeProps.limit})},
  {name:"formday_calendar",title:"캘린더 일정",
    description:"FORMDAY 일정의 원본 날짜와 상태를 조회합니다. 반복 규칙을 임의로 확장하지 않습니다.",
    inputSchema:params({...dateRangeProps,includeSamples:{type:"boolean",default:false}})},
  {name:"formday_meals",title:"식단 기록",
    description:"기록된 식사를 조회합니다. 검증되지 않은 칼로리나 영양소를 추정하지 않습니다.",
    inputSchema:params({...dateRangeProps})},
  {name:"formday_weight_history",title:"체중 기록",
    description:"완료된 체중 측정값과 체지방률을 조회합니다.",
    inputSchema:params({...dateRangeProps})}
].map(tool=>Object.freeze({...tool,annotations:{
  readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false
}})));
const TOOL_METHODS=Object.freeze({
  formday_status:"status",
  formday_workouts:"workouts",
  formday_routines:"routines",
  formday_calendar:"calendar",
  formday_meals:"meals",
  formday_weight_history:"weightHistory"
});
export function createDispatcher({verifiedUid,loadDocument}){
  const reader=createReader({verifiedUid,loadDocument});
  return async function dispatch(toolName,args={}){
    const spec=READ_TOOLS.find(x=>x.name===toolName);
    if(!spec)throw Error("승인되지 않은 FORMDAY 도구입니다.");
    if(args===null||typeof args!=="object"||Array.isArray(args))
      throw Error("도구 입력은 객체여야 합니다.");
    for(const key of Object.keys(args)){
      if(!Object.prototype.hasOwnProperty.call(spec.inputSchema.properties,key))
        throw Error("지원하지 않는 도구 입력 항목입니다.");
      const v=args[key],type=spec.inputSchema.properties[key].type;
      if(typeof v!==type.replace("integer","number")||(type==="integer"&&!Number.isInteger(v)))
        throw Error("도구 입력 형식이 올바르지 않습니다.");
    }
    return reader[TOOL_METHODS[toolName]](args);
  };
}
