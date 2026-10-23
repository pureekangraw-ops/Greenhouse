import {handleLocalAITest} from '../../../src/greenhouse/local-ai-test.mjs';
// No provider/session is provisioned here. Runtime destination and owner approval
// must be supplied through the existing authorized integration before enabling.
export async function onRequest({request}) {return handleLocalAITest(request);}
