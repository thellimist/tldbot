/**
 * Registrar Exports.
 *
 * GoDaddy public endpoint provides free availability + premium/auction detection.
 */

export { RegistrarAdapter, RateLimiter } from './base.js';
export {
  GodaddyPublicAdapter,
  godaddyPublicAdapter,
  getGodaddyCircuitState,
  resetGodaddyCircuit,
  type GodaddySuggestion,
} from './godaddy-public.js';
