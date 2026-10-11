import fs from 'node:fs/promises';
import path from 'node:path';
import {generateRectangularGradedMesh,generateCircularGradedMesh,generateRectangularGradedQuadMesh,generateCircularGradedQuadMesh,generateCylindricalGradedMesh,
  generateUniformReinforcedMesh,meshToLsdynaMixedKeyword,parseNativeLsdynaMixedKeyword,
  meshToLsdynaKeyword,meshToLsdynaShellKeyword,parseMeshText,minElementEdgeLength} from '../dist/index.js';

async function main() {
  const [inputPath,outputPath,...extra]=process.argv.slice(2);
  if (!inputPath || !outputPath || extra.length) throw new Error('Usage: node scripts/generate-graded-mesh.mjs request.json NEW_OUTPUT_DIRECTORY');
  const request=JSON.parse(await fs.readFile(path.resolve(inputPath),'utf8'));
  const generators=new Map([['rectangular-solid',generateRectangularGradedMesh],['circular-solid',generateCircularGradedMesh],
    ['rectangular-quad',generateRectangularGradedQuadMesh],['circular-quad',generateCircularGradedQuadMesh],['cylindrical-solid',generateCylindricalGradedMesh],
    ['reinforced-uniform',generateUniformReinforcedMesh]]);
  if (request.schemaVersion!==1 || !generators.has(request.kind) || !request.parameters) {
    throw new Error('Expected schemaVersion=1, a supported mesh kind, and parameters');
  }
  const result=generators.get(request.kind)(request.parameters);
  const mixed=result.model,mesh=result.mesh??result.concreteMesh,shell=mesh.kind==='Q1';
  const keyword=mixed?meshToLsdynaMixedKeyword(mixed,{coordinateFormat:'compact'})
    :(shell?meshToLsdynaShellKeyword:meshToLsdynaKeyword)(mesh,{coordinateFormat:'compact'});
  const back=mixed?parseNativeLsdynaMixedKeyword(keyword):parseMeshText(keyword,'mesh.k');
  const expectedNodes=mixed?.nodes??mesh.nodes;
  const connectivityMatches=mixed
    ?JSON.stringify(back.solids)===JSON.stringify(mixed.solids)&&JSON.stringify(back.beams)===JSON.stringify(mixed.beams)
    :JSON.stringify(back.elements)===JSON.stringify(mesh.elements);
  if (!connectivityMatches || back.nodes.length!==expectedNodes.length) {
    throw new Error('Generated keyword connectivity failed read-back validation');
  }
  const tolerance=minElementEdgeLength(mesh)*1e-8;
  let coordinateError=0;
  back.nodes.forEach((p,i)=>p.forEach((v,a)=>{coordinateError=Math.max(coordinateError,Math.abs(v-expectedNodes[i][a]));}));
  if(coordinateError>tolerance)throw new Error('Keyword coordinate rounding exceeds the mesh-scale tolerance');
  const out=path.resolve(outputPath);
  const report={schemaVersion:1,kind:request.kind,implementation:'typescript-native',runtimeDependencies:['node'],
    input:request.parameters,plan:result.plan,quality:result.quality,
    nodes:expectedNodes.length,elements:mixed?mixed.solids.length+mixed.beams.length:mesh.elements.length,
    elementCounts:mixed?{solid:mixed.solids.length,beam:mixed.beams.length}:{[shell?'shell':'solid']:mesh.elements.length},
    meshFile:path.join(out,'mesh.k'),readbackMaximumCoordinateError:coordinateError,
    solverKeywords:mixed?'NODE + ELEMENT_SOLID + ELEMENT_BEAM only; no materials, sections, loads, or coupling cards':shell?'NODE + ELEMENT_SHELL only; no physical thickness, material, or boundary conditions'
      :'NODE + ELEMENT_SOLID only; no materials, loads, or symmetry conditions'};
  // Reserve a new output directory only after generation and validation succeed.
  await fs.mkdir(path.dirname(out),{recursive:true});
  await fs.mkdir(out);
  await fs.writeFile(report.meshFile,keyword,{flag:'wx'});
  if(result.parentElementIds)await fs.writeFile(path.join(out,'lineage.json'),JSON.stringify({parentElementIds:result.parentElementIds,coreParentIds:result.coreParentIds}),{flag:'wx'});
  if(result.nodeSets)await fs.writeFile(path.join(out,'node_sets.json'),JSON.stringify(result.nodeSets),{flag:'wx'});
  if(result.cellSets)await fs.writeFile(path.join(out,'cell_sets.json'),JSON.stringify(result.cellSets),{flag:'wx'});
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});
  process.stdout.write(JSON.stringify(report)+'\n');
}

main().catch(error=>{
  process.stderr.write(JSON.stringify({ok:false,error:error.message})+'\n');
  process.exitCode=1;
});
