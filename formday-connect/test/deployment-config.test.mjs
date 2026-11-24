import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOAuthStorageConfig} from '../src/deployment-config.mjs';
test('deployment rejects OAuth Admin storage in the existing health-data project',()=>{
 assert.throws(()=>validateOAuthStorageConfig({projectId:'healthy-df79f',account:{project_id:'healthy-df79f'}}),/prohibited/);
 assert.throws(()=>validateOAuthStorageConfig({projectId:'isolated-oauth-test',account:{project_id:'healthy-df79f'}}),/prohibited/);
});
test('deployment requires matching isolated project and credentials',()=>{
 assert.throws(()=>validateOAuthStorageConfig({}));
 assert.throws(()=>validateOAuthStorageConfig({projectId:'isolated-oauth-test',account:{project_id:'other-project'}}),/mismatch/);
 assert.equal(validateOAuthStorageConfig({projectId:'isolated-oauth-test',account:{project_id:'isolated-oauth-test'}}),'isolated-oauth-test');
});
