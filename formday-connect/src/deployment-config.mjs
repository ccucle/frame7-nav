import {FIREBASE_PROJECT} from './firebase-rest.mjs';

// Validate before initializing Admin or contacting any database. OAuth state
// must live outside the existing health-data project. IAM isolation still
// requires operator verification; a different project ID alone is not proof.
export function validateOAuthStorageConfig({projectId,account}={}){
 if(typeof projectId!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId))
  throw Error('A separate OAuth storage project must be configured');
 if(projectId===FIREBASE_PROJECT||account?.project_id===FIREBASE_PROJECT)
  throw Error('OAuth Admin storage in the existing FORMDAY project is prohibited');
 if(account?.project_id!==projectId)
  throw Error('OAuth storage credential project mismatch');
 return projectId;
}
