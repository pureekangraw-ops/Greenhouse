import {createLiveTrackingHttp} from '../../../../src/greenhouse/tracking-read.mjs';
export async function onRequest({request,env}) {return createLiveTrackingHttp({env})(request);}
