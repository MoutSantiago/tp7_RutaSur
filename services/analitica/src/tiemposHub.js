/**
 * Cuarto indicador (CU4): tiempo medio entre INGRESADO_HUB y EN_REPARTO por hub.
 *
 * Lógica pura: un rastreador por envío recuerda el momento del ingreso al hub
 * y, cuando llega el EN_REPARTO del PRIMER intento, emite la duración. La
 * agregación es incremental (suma + cantidad en `porHub.<hub>.tiempoHub*` de
 * metricas_diarias); el promedio se calcula al leer, nunca se guarda.
 *
 * Un grupo de consumidores NUEVO que lea `envios.estados` desde el inicio
 * reconstruye el indicador con datos históricos, sin tocar lo demás.
 */

/** Solo contamos el paso por el hub del primer intento (determinista y comparable). */
const INTENTO_CONTADO = 1;

/**
 * Resultado de registrar un EN_REPARTO con ingreso conocido.
 * @typedef {object} PasoPorHub
 * @property {number} deltaMs Milisegundos entre INGRESADO_HUB y EN_REPARTO (tiempo simulado).
 * @property {string} fecha Día del EN_REPARTO (YYYY-MM-DD, UTC).
 * @property {string} zonaId Zona del envío.
 * @property {string} franja Franja del EN_REPARTO (AM/PM).
 * @property {string} hubId Hub que procesó el envío.
 */

/**
 * Rastreador de pares ingreso→salida por envío.
 * @typedef {object} RastreadorTiempos
 * @property {(evento: import('@rutasur/shared/src/eventos/tipos.js').EventoEstado) => PasoPorHub | null} registrar
 *   Registra un evento de estado; devuelve la duración si cierra un par, o null.
 */

/**
 * Crea el rastreador de tiempos de hub.
 * @returns {RastreadorTiempos} Rastreador vacío.
 * @example
 * const r = crearRastreadorTiempos();
 * r.registrar(eventoIngresadoHub);            // null
 * r.registrar(eventoEnReparto);               // { deltaMs, fecha, zonaId, franja, hubId }
 */
export function crearRastreadorTiempos() {
  /** @type {Map<string, {ingresoMs: number, secuencia: number}>} */
  const ingresos = new Map();
  /** @type {Map<string, number>} envíos que ya cerraron el par (no se repiten). */
  const cerrados = new Map();

  return {
    registrar(evento) {
      const id = evento.shipmentId;
      if (cerrados.has(id)) return null;
      if (evento.tipo === 'INGRESADO_HUB') {
        // Un nuevo intento vuelve al hub si reaparece INGRESADO_HUB con más secuencia.
        ingresos.set(id, { ingresoMs: Date.parse(evento.ocurridoEn), secuencia: evento.secuencia });
        return null;
      }
      if (evento.tipo === 'EN_REPARTO' && (evento.intento ?? 1) === INTENTO_CONTADO) {
        const ingreso = ingresos.get(id);
        if (!ingreso || evento.secuencia <= ingreso.secuencia) return null;
        cerrados.set(id, evento.secuencia);
        const salidaMs = Date.parse(evento.ocurridoEn);
        return {
          deltaMs: Math.max(0, salidaMs - ingreso.ingresoMs),
          fecha: new Date(evento.ocurridoEn).toISOString().slice(0, 10),
          zonaId: evento.zonaId,
          franja: new Date(evento.ocurridoEn).getUTCHours() < 13 ? 'AM' : 'PM',
          hubId: evento.hubId,
        };
      }
      return null;
    },
  };
}

/**
 * Convierte un paso por hub en los incrementos para `metricas_diarias`
 * (suma y cantidad; el promedio sale al leer).
 * @param {PasoPorHub} paso Paso cerrado.
 * @returns {Record<string, number>} Incrementos para $inc.
 */
export function incrementosTiempoHub(paso) {
  return {
    [`porHub.${paso.hubId}.tiempoHubSumaMs`]: paso.deltaMs,
    [`porHub.${paso.hubId}.tiempoHubCantidad`]: 1,
  };
}
