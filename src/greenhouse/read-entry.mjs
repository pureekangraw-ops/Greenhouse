import {WorkerEntrypoint} from 'cloudflare:workers';
import {createPrivateStationRead} from '../hub/greenhouse-mcp.mjs';
// Existing public transport and queue lifecycle stay on the default export.
export {default} from '../pixie/transport-worker.mjs';

// Reachability is a private capability held only by explicitly bound callers.
// A deployment must also declare the station-wide grant; this source change
// installs no grant, public route, binding, credential or producer connector.
export class GreenhouseRead extends WorkerEntrypoint {
 fetch(request) {
  return createPrivateStationRead({db:this.env.PIXIE_DB,grantSource:this.env.GREENHOUSE_STATION_READ})(request);
 }
}
