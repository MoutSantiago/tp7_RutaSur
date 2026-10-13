/**
 * Cliente del plano de control del simulador para el panel de demo.
 * Llama a la API HTTP del simulador (ver docs/DECISIONES.md): es la única
 * parte de la web que puede disparar acciones; los datos siempre se leen de
 * MongoDB.
 */

/** @readonly URL base del simulador (API de control). */
const SIMULADOR_BASE = process.env.SIMULADOR_API_URL ?? 'http://localhost:3010';

/** @readonly escenarios disponibles en el panel. */
export const ESCENARIOS_DEMO = Object.freeze([
  'feliz',
  'ausente',
  'demorado',
  'tercer-fallo',
  'rafaga',
]);

/**
 * Dispara un escenario del simulador.
 * @param {string} nombre Nombre del escenario (feliz, ausente, demorado, tercer-fallo, rafaga).
 * @returns {Promise<Record<string, unknown>>} Respuesta del simulador.
 * @throws {Error} Si el simulador no responde o devuelve error.
 */
export async function dispararEscenario(nombre) {
  const respuesta = await fetch(`${SIMULADOR_BASE}/escenarios/${encodeURIComponent(nombre)}`, {
    method: 'POST',
  });
  const datos = await respuesta.json();
  if (!respuesta.ok) {
    throw new Error(/** @type {{error?: string}} */ (datos).error ?? `HTTP ${respuesta.status}`);
  }
  return /** @type {Record<string, unknown>} */ (datos);
}

/**
 * Inyecta un evento malformado en `envios.estados` (termina en la DLQ).
 * @returns {Promise<Record<string, unknown>>} Respuesta del simulador.
 * @throws {Error} Si el simulador no responde.
 */
export async function inyectarMalformado() {
  const respuesta = await fetch(`${SIMULADOR_BASE}/eventos/malformado`, { method: 'POST' });
  const datos = await respuesta.json();
  if (!respuesta.ok) {
    throw new Error(/** @type {{error?: string}} */ (datos).error ?? `HTTP ${respuesta.status}`);
  }
  return /** @type {Record<string, unknown>} */ (datos);
}
