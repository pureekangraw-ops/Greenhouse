import {handleTrackingRead} from '../../../src/greenhouse/tracking-read.mjs';
// Intentionally unconfigured: a future entrypoint must explicitly inject trusted
// reader and verified owner session ports. Environment binding presence is not auth.
export async function onRequest({request}) {return handleTrackingRead(request);}
