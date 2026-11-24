/* Firebase Secure Token API — exchange a user's refresh token for a short
 * lived Firebase ID token, subject to the existing Firestore user rules.
 *
 * Never include the refresh token in a URL, log, exception text, or MCP result.
 */
export function createFirebaseRefresh({apiKey,fetchImpl=fetch}={}){
 if(typeof apiKey!=="string"||apiKey.length<20||apiKey.length>200)
  throw Error("Configured Firebase public Web API key is required");
 return async function refreshFirebaseToken(refreshToken){
  if(typeof refreshToken!=="string"||refreshToken.length<20||refreshToken.length>12000)
   throw Error("Missing Firebase refresh credential");
  const body=new URLSearchParams({
   grant_type:"refresh_token",refresh_token:refreshToken
  });
  let response;
  try{
   response=await fetchImpl(
    "https://securetoken.googleapis.com/v1/token?key="+encodeURIComponent(apiKey),
    {method:"POST",headers:{"content-type":"application/x-www-form-urlencoded",
      "accept":"application/json"},body:body.toString(),redirect:"error",
      signal:AbortSignal.timeout(9000)}
   );
  }catch{throw Error("Firebase token exchange unavailable");}
  if(!response.ok)throw Error("Firebase token refresh rejected");
  const raw=await response.text();
  if(raw.length>20000)throw Error("Firebase token response exceeded maximum size");
  let result;
  try{result=JSON.parse(raw);}catch{throw Error("Firebase token response invalid");}
  if(typeof result.id_token!=="string"||result.id_token.length<150||
     typeof result.refresh_token!=="string"||result.refresh_token.length<20||
     typeof result.user_id!=="string"||!/^[A-Za-z0-9_-]{6,128}$/.test(result.user_id)||
     // Secure Token responses use the project number; ID-token aud/iss are
     // verified independently against the textual project ID by the caller.
     (result.project_id!=="188014722362"&&result.project_id!=="healthy-df79f"))
   throw Error("Firebase token response did not match the configured project");
  return {idToken:result.id_token,refreshToken:result.refresh_token,userId:result.user_id};
 };
}
