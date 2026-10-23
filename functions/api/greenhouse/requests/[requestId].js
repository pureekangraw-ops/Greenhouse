import { handleOwnerRequestRead } from '../../../../src/greenhouse/request-owner-http.mjs';

export async function onRequest({request, params}) {
  return handleOwnerRequestRead(request, params.requestId);
}
