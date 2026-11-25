/* Candidate tool declaration and ingress adapter. Not registered in any live tool list. */
import {createMealPhotoAttachment,PHOTO_MAX_BYTES} from './meal-photo-attachment.mjs';
import {createOwnerPhotoTransaction} from './firebase-photo-transaction.mjs';
import Calendar from '../../fitplan/core.js';

const allowedMime=new Set(['image/jpeg','image/png','image/webp']);
export const PHOTO_ATTACH_TOOL=Object.freeze({
 name:'formday_attach_meal_photo',
 description:'Attach the user-authorized original image to one already saved, independently verified completed meal ID and date. Never creates a meal or replaces a different photo. Retry only the same meal and original file after uncertainty.',
 inputSchema:{type:'object',additionalProperties:false,required:['mealId','date','file'],
  properties:{mealId:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'},date:{type:'string',description:'Korea local date YYYY-MM-DD'},
   file:{type:'object',additionalProperties:false,required:['file_id','download_url'],
    properties:{file_id:{type:'string'},download_url:{type:'string'},mime_type:{type:'string'},file_name:{type:'string'}}}}},
 annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},
 _meta:{'openai/fileParams':['file']}
});
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
/**
 * Required production dependencies from existing Sites host:
 * resolvePrincipal() must verify the actual ChatGPT session/account binding and
 * refresh the existing Firebase user credential as needed.
 * resolveAuthorizedFile(ref, principal, {maxBytes}) MUST attest that the file_id
 * and temporary URL were supplied/authorized by the host for this exact invocation.
 * It must securely retrieve only that file, enforce redirect/egress and streaming
 * byte limits; never treat arbitrary model/user URLs as authorized file references.
 * No generic fetch fallback is implemented. The host should consume its documented
 * file input facility, not require the user to share URLs, tokens, or file bytes.
 * authorizePhoto and decodeImage are mandatory; see attachment core contract.
 * This factory is intentionally not wired into the historical MCP gateway.
 */
export function createPhotoFileHandler({resolvePrincipal,resolveAuthorizedFile,authorizePhoto,decodeImage,transactionFactory=createOwnerPhotoTransaction}={}){
 check([resolvePrincipal,resolveAuthorizedFile,authorizePhoto,decodeImage,transactionFactory].every(x=>typeof x==='function'),'PHOTO_HOST_NOT_READY');
 return async function attachFromHost(input){
  check(input&&Object.keys(input).sort().join(',')==='date,file,mealId'&&typeof input.mealId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(input.mealId)&&Calendar.validDate(input.date),'INVALID_ATTACHMENT_INPUT');
  const ref=input.file;
  check(ref&&Object.keys(ref).every(k=>['file_id','download_url','mime_type','file_name'].includes(k))&&typeof ref.file_id==='string'&&ref.file_id.startsWith('file_')&&ref.file_id.length<=256&&typeof ref.download_url==='string'&&ref.download_url.length<=8192,'INVALID_HOST_FILE_REFERENCE');
  // No URL is ever followed directly here, even when it has an HTTPS scheme.
  const principal=await resolvePrincipal();
  const withOwnerTransaction=await transactionFactory({principal});
  const resolved=await resolveAuthorizedFile(Object.freeze({...ref}),principal,{maxBytes:PHOTO_MAX_BYTES});
  check(resolved&&resolved.fileId===ref.file_id&&allowedMime.has(resolved.mime)&&resolved.bytes instanceof Uint8Array&&resolved.bytes.byteLength>=12&&resolved.bytes.byteLength<=PHOTO_MAX_BYTES,'INVALID_OR_UNAUTHORIZED_HOST_FILE');
  if(ref.mime_type!==undefined)check(ref.mime_type===resolved.mime,'HOST_FILE_MIME_MISMATCH');
  const core=createMealPhotoAttachment({principal,withOwnerTransaction,decodeImage,
   authorizePhoto:meta=>authorizePhoto({...meta,fileId:ref.file_id})});
  return core.attach({mealId:input.mealId,date:input.date,bytes:resolved.bytes,mime:resolved.mime});
 };
}
