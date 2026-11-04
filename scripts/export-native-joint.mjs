import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {meshToLsdynaMixedKeyword,parseNativeLsdynaMixedKeyword} from '../dist/lsdyna-mixed.js';
const root=path.resolve(process.argv[2]??'');
const model=JSON.parse(fs.readFileSync(path.join(root,'mesh.json'),'utf8'));
const target=path.join(root,'model.k');
if(fs.existsSync(target))throw new Error('Refusing to overwrite model.k');
let text=meshToLsdynaMixedKeyword(model,{coordinatePrecision:12,coordinateFormat:'compact'});
text=text.replace('*KEYWORD','*KEYWORD\n$ Repository analytical joint; not independent CAD; units mm.');
const read=parseNativeLsdynaMixedKeyword(text);
if(JSON.stringify(read.solids)!==JSON.stringify(model.solids)||read.nodes.length!==model.nodes.length)throw new Error('K readback mismatch');
let error=0;for(let i=0;i<read.nodes.length;i++)for(let a=0;a<3;a++)error=Math.max(error,Math.abs(read.nodes[i][a]-model.nodes[i][a]));
if(error>1e-10)throw new Error('K coordinate loss');
fs.writeFileSync(target,text,{flag:'wx'});
console.log(JSON.stringify({nodes:read.nodes.length,elements:read.solids.length,maximumCoordinateDifference:error,
 sha256:createHash('sha256').update(text).digest('hex')}));
