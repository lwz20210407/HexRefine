import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {patchTransitionMeshKeyword} from '../dist/transitionmesh-keyword-patch.js';
import {generateTransitionMeshV11Request} from '../dist/transitionmesh-v11-request.js';

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

async function main() {
  const [hostPath, candidatePath, requestPath, outputPath, ...extra] = process.argv.slice(2);
  if (!hostPath || !candidatePath || !requestPath || !outputPath || extra.length) {
    throw new Error('Usage: node scripts/patch-transitionmesh.mjs host.k candidate.k|request.json selection.json NEW_OUTPUT_DIRECTORY|--preview');
  }
  const [host, candidate, text] = await Promise.all([
    fs.readFile(hostPath), fs.readFile(candidatePath), fs.readFile(requestPath, 'utf8'),
  ]);
  const request = JSON.parse(text.replace(/^\uFEFF/,''));
  if (!request || request.schemaVersion !== 1
      || !(request.autoSelect===true ? !('replaceElementIds' in request)
        : !('autoSelect' in request) && Array.isArray(request.replaceElementIds))
      || Object.keys(request).some(k=>!['schemaVersion','replaceElementIds','autoSelect','expectedHostSha256'].includes(k)))
    throw new Error('expected schemaVersion=1 and exactly one of replaceElementIds or autoSelect:true');
  const hostSha256 = sha256(host), candidateSha256 = sha256(candidate);
  if (request.expectedHostSha256 !== undefined && request.expectedHostSha256 !== hostSha256)
    throw new Error('host SHA-256 does not match the selection');
  const preview=outputPath==='--preview';
  const generated=path.extname(candidatePath).toLowerCase()==='.json';
  const candidateText=candidate.toString('utf8');
  const keyword=generated
    ? generateTransitionMeshV11Request(JSON.parse(candidateText.replace(/^\uFEFF/,''))).files['mesh.k']
    :candidateText;
  const result = patchTransitionMeshKeyword(host.toString('utf8'),keyword,
      request.autoSelect===true?'auto':request.replaceElementIds);
  const info={ok:true,hostSha256,candidateSha256,candidateSource:generated?'transitionmesh-v11':'keyword',
    candidateKeywordSha256:sha256(keyword),...result.report};
  if (preview) {
    console.log(JSON.stringify({...info,preview:true,output:null}));
    return;
  }
  const output = path.resolve(outputPath);
  await fs.mkdir(output);
  const report = {...info,output};
  await fs.writeFile(path.join(output,'mesh.k'),result.keyword,{flag:'wx'});
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify(report));
}

main().catch(error => {
  console.error(JSON.stringify({ok:false,error:error.message}));
  process.exitCode=1;
});
