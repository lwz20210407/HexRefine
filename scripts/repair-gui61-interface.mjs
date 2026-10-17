import fs from 'node:fs/promises';
import path from 'node:path';
import {generateGui61Repair} from '../dist/index.js';

async function main() {
  const [inputPath, outputPath, ...extra] = process.argv.slice(2);
  if (!inputPath || !outputPath || extra.length)
    throw new Error('Usage: node scripts/repair-gui61-interface.mjs request.json NEW_OUTPUT_DIRECTORY');
  const request = JSON.parse(await fs.readFile(path.resolve(inputPath), 'utf8'));
  const result = generateGui61Repair(request);
  const output = path.resolve(outputPath);
  await fs.mkdir(path.dirname(output), {recursive: true});
  await fs.mkdir(output); // Never overwrite a previous case or the input.
  for (const [name, text] of Object.entries(result.files))
    await fs.writeFile(path.join(output, name), text, {flag: 'wx'});
  const report = JSON.parse(result.files['report.json']);
  process.stdout.write(JSON.stringify({ok:true,output,outputNodes:report.outputNodes,outputElements:report.outputElements,quality:report.quality}) + '\n');
}
main().catch(error => { process.stderr.write(JSON.stringify({ok: false, error: error.message}) + '\n'); process.exitCode = 1; });
