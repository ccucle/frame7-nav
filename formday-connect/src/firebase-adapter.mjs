/**
 * FORMDAY Connect: Firebase Admin read-only adapter.
 * This is server-side only. Never import into FORMDAY's static web app.
 * Firebase Admin bypasses Firestore Security Rules: enforce an exact path allowlist.
 *
 * Caller must initialize firebase-admin separately with secret credentials through
 * a trusted runtime. Never commit a service account JSON, private key, or token.
 */
const PATH=/^users\/[A-Za-z0-9_-]{6,128}\/formday_sync\/(?:calendar|iron)$/;
export function createFirestoreAdapter(firestore){
  if(!firestore||typeof firestore.doc!=="function")
    throw Error("Firebase Admin Firestore 연결이 설정되지 않았습니다.");
  return async function loadDocument(path){
    if(typeof path!=="string"||!PATH.test(path))
      throw Error("승인되지 않은 Firestore 읽기 경로입니다.");
    const snapshot=await firestore.doc(path).get();
    return snapshot.exists?snapshot.data():null;
  };
}
