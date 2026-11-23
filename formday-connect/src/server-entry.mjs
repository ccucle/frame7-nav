/* FORMDAY Connect HTTPS-backed Node server. Fails closed on missing secrets.
 * Only the Render reverse proxy terminates TLS, so FORMDAY_CONNECT_ORIGIN must
 * be the real public HTTPS origin. No OAuth state is written to disk.
 */
import {createFormdayHttpServer} from "./node-http.mjs";
import {readFileSync} from "node:fs";
import {initializeApp,cert} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {createFirestoreOAuthStore} from "./oauth-firestore-store.mjs";
import {createFormdayRuntime} from "./server-runtime.mjs";
import {validateOAuthStorageConfig} from "./deployment-config.mjs";

function required(name){
 const v=process.env[name];
 if(!v||!v.trim())throw Error("Missing required server config: "+name);
 return v;
}
function configure(){
 const account=JSON.parse(required("FORMDAY_CONNECT_FIREBASE_SERVICE_ACCOUNT_JSON"));
 const projectId=validateOAuthStorageConfig({account,
  projectId:required("FORMDAY_OAUTH_STORAGE_PROJECT_ID")});
 const firebase=initializeApp({
  credential:cert(account),projectId
 },"formday-connect-oauth");
 const consentScript=readFileSync(
  new URL("./oauth-consent-browser.mjs",import.meta.url),"utf8");
 const origin=required("FORMDAY_CONNECT_ORIGIN");
 return {origin,app:createFormdayRuntime({
  origin,oauthStore:createFirestoreOAuthStore(getFirestore(firebase)),
  oauthEncryptionKey:required("FORMDAY_OAUTH_ENCRYPTION_KEY"),
  firebaseApiKey:required("FORMDAY_FIREBASE_WEB_API_KEY"),
  consentScript
 })};
}
const {origin,app}=configure();
const port=Number(process.env.PORT||3000);
if(!Number.isInteger(port)||port<1||port>65535)throw Error("Invalid port");
const server=createFormdayHttpServer({origin,app});
server.listen(port,"0.0.0.0");
