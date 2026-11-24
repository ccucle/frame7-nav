/* AES-256-GCM encryption for Firebase refresh tokens at rest.
 * FORMDAY_OAUTH_ENCRYPTION_KEY must be a 32-byte random base64url secret.
 * Never expose key or encrypted credential to MCP tools, browser, logs, or GitHub.
 */
import {randomBytes,createCipheriv,createDecipheriv} from "node:crypto";

export function createCredentialVault(keyText){
 if(typeof keyText!=="string"||!(/^[A-Za-z0-9_-]{43}$/).test(keyText))
  throw Error("OAuth encryption key must be a private 256-bit base64url secret");
 const key=Buffer.from(keyText,"base64url");
 if(key.length!==32)throw Error("OAuth vault key size invalid");
 const AAD=Buffer.from("FORMDAY_CONNECT_OAUTH_V1","utf8");
 return Object.freeze({
  async seal(clear){
   if(typeof clear!=="string"||clear.length<20||clear.length>12000)
    throw Error("Invalid Firebase refresh credential");
   const nonce=randomBytes(12);
   const cipher=createCipheriv("aes-256-gcm",key,nonce);
   cipher.setAAD(AAD);
   const encrypted=Buffer.concat([cipher.update(clear,"utf8"),cipher.final()]);
   const tag=cipher.getAuthTag();
   return "v1."+nonce.toString("base64url")+"."+tag.toString("base64url")+
    "."+encrypted.toString("base64url");
  },
  async open(sealed){
   if(typeof sealed!=="string"||sealed.length>17000)throw Error("Invalid encrypted credential");
   const parts=sealed.split(".");
   if(parts.length!==4||parts[0]!=="v1")throw Error("Unknown credential cipher format");
   const nonce=Buffer.from(parts[1],"base64url"),tag=Buffer.from(parts[2],"base64url"),
     content=Buffer.from(parts[3],"base64url");
   if(nonce.length!==12||tag.length!==16||content.length<20)
    throw Error("Invalid encrypted credential parts");
   try{
    const decipher=createDecipheriv("aes-256-gcm",key,nonce);
    decipher.setAAD(AAD);decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(content),decipher.final()]).toString("utf8");
   }catch{throw Error("Credential decrypt failed");}
  }
 });
}
