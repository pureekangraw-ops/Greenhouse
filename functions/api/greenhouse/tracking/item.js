import {handleTrackingRead} from '../../../../src/greenhouse/tracking-read.mjs';
export async function onRequest({request}) {return handleTrackingRead(request,{item:true});}
