import {generateThreadedShaft,generateThreadedNut,helicalThreadRadius,
  type HelicalThreadProfile,type ThreadedSolidResult} from "../../src/index.js";
const profile:HelicalThreadProfile={rootRadius:4.2,majorRadius:5,pitch:1.5,handedness:"right"};
const shaft:ThreadedSolidResult=generateThreadedShaft({profile,length:3,stepsPerTurn:32,
  coreRadius:3.6,radiusSegments:6,arcSegments:8,surfaceLayers:4});
const nut:ThreadedSolidResult=generateThreadedNut({profile,length:3,stepsPerTurn:32,
  acrossFlats:17,clearance:.1,angularSegments:48,radialLayers:6});
const radius:number=helicalThreadRadius(0,0,profile);
void [shaft,nut,radius];
// @ts-expect-error Handedness is explicit, not inferred from the sign of pitch.
const invalid:HelicalThreadProfile={...profile,handedness:"auto"};
void invalid;
