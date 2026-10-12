/**
 * Máquina de estados del envío (lógica pura del simulador).
 *
 * Dado un PRNG y la configuración, genera el ciclo de vida completo de un
 * envío: la promesa de entrega y la lista ordenada de eventos de estado.
 * No publica nada: la publicación en Kafka es responsabilidad de la capa de I/O.
 *
 * Flujo: CREADO -> INGRESADO_HUB -> CLASIFICADO -> EN_REPARTO ->
 * ENTREGADO | ENTREGA_FALLIDA. Un fallo por AUSENTE reintenta (máximo 3
 * intentos) con nueva secuencia; otro motivo o el tercer fallo termina el ciclo.
 */

import { crearEventoEstado, crearEventoPromesa } from '@rutasur/shared';

/** Una hora simulada en milisegundos. */
const HORA_SIMULADA_MS = 60 * 60 * 1000;

/** Cantidad máxima de intentos de entrega antes de sacar el envío del circuito. */
export const MAX_INTENTOS = 3;

/**
 * Configuraciónoperativa de una zona de entrega.
 * @typedef {object} Zona
 * @property {string} zonaId Identificador de la zona.
 * @property {number} tasaFallo Probabilidad de fallo por intento de entrega [0, 1].
 */

/**
 * Configuración pura del simulador para generar ciclos de vida.
 * @typedef {object} ConfigSimulacion
 * @property {string[]} hubs Identificadores de los centros de distribución.
 * @property {Zona[]} zonas Zonas con su tasa de fallo.
 * @property {number} repartidoresPorZona Cantidad de repartidores por zona.
 * @property {Array<{valor: string, peso: number}>} motivosFalla Distribución de motivos.
 * @property {number} probabilidadDemoraHub Probabilidad de que un envío se demore en el hub.
 */

/**
 * Resultado del ciclo de vida generado para un envío.
 * @typedef {object} CicloDeVida
 * @property {string} shipmentId Identificador del envío.
 * @property {string} zonaId Zona asignada.
 * @property {string} hubId Hub asignado.
 * @property {import('@rutasur/shared/src/eventos/tipos.js').EventoPromesa} promesa Promesa de entrega.
 * @property {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado[]} eventos
 *   Eventos de estado en orden cronológico simulado, con secuencia creciente.
 * @property {number} intentos Cantidad de intentos de entrega realizados.
 * @property {string} estadoFinal Último estado del envío.
 */

/** @readonly franjas horarias posibles de la promesa. */
const FRANJAS = Object.freeze(['AM', 'PM']);

/**
 * Cantidad de repartidores declarados para un identificador de zona.
 * Constante auxiliar para documentar el modelo; ver ConfigSimulacion.
 * @type {number}
 */
const DEMORA_MIN_HUB_HORAS = 6;

/**
 * Elige las dimensiones del envío (hub, zona, repartidor).
 * @param {import('./prng.js').Prng} prng Generador aleatorio.
 * @param {ConfigSimulacion} config Configuración de la simulación.
 * @returns {{hubId: string, zona: Zona, repartidorId: string}} Dimensiones elegidas.
 */
function elegirDimensiones(prng, config) {
  const hubId = config.hubs[prng.entero(0, config.hubs.length - 1)];
  const zona = config.zonas[prng.entero(0, config.zonas.length - 1)];
  const repartidorId = `REP-${zona.zonaId}-${prng.entero(1, config.repartidoresPorZona)}`;
  return { hubId, zona, repartidorId };
}

/**
 * Ejecuta un intento de entrega completo desde CLASIFICADO hasta su resultado.
 * @param {import('./prng.js').Prng} prng Generador aleatorio.
 * @param {ConfigSimulacion} config Configuración de la simulación.
 * @param {Zona} zona Zona del envío (define la tasa de fallo).
 * @param {number} intento Número de intento (1..MAX_INTENTOS).
 * @param {number} desdeMs Momento simulado desde el que se clasifica.
 * @returns {{eventosIntento: Array<{enMs: number, tipo: string, motivo?: string, intento: number}>, resultado: string, siguienteMomento: number}}
 *   Pasos del intento, estado resultante y momento simulado en que terminó.
 */
function ejecutarIntento(prng, config, zona, intento, desdeMs) {
  const eventosIntento = [];
  let momento = desdeMs;

  momento += prng.entero(1, 3) * HORA_SIMULADA_MS;
  eventosIntento.push({ enMs: momento, tipo: 'EN_REPARTO', intento });

  momento += prng.entero(30, 240) * 60 * 1000;
  const fallo = prng.chance(zona.tasaFallo);
  if (!fallo) {
    eventosIntento.push({ enMs: momento, tipo: 'ENTREGADO', intento });
    return { eventosIntento, resultado: 'ENTREGADO', siguienteMomento: momento };
  }
  const motivo = prng.elegirPonderado(config.motivosFalla);
  eventosIntento.push({ enMs: momento, tipo: 'ENTREGA_FALLIDA', motivo, intento });
  return { eventosIntento, resultado: 'ENTREGA_FALLIDA', siguienteMomento: momento };
}

/**
 * Genera el ciclo de vida completo de un envío.
 * @param {object} opciones Opciones de generación.
 * @param {import('./prng.js').Prng} opciones.prng Generador aleatorio (determina toda la corrida).
 * @param {ConfigSimulacion} opciones.config Configuración de la simulación.
 * @param {string} opciones.shipmentId Identificador del envío.
 * @param {number} opciones.inicioMs Momento simulado de creación del envío (epoch ms).
 * @returns {CicloDeVida} Promesa de entrega y eventos de estado del envío.
 * @throws {Error} Si la configuración no tiene hubs o zonas.
 * @example
 * const ciclo = generarCicloDeVida({ prng: crearPrng(42), config, shipmentId: 'ENV-0001', inicioMs: Date.now() });
 * console.log(ciclo.eventos.map(e => e.tipo)); // ['CREADO', 'INGRESADO_HUB', ...]
 */
export function generarCicloDeVida({ prng, config, shipmentId, inicioMs }) {
  if (config.hubs.length === 0 || config.zonas.length === 0) {
    throw new Error('La configuración debe incluir al menos un hub y una zona');
  }

  const { hubId, zona, repartidorId } = elegirDimensiones(prng, config);
  const dimensiones = { hubId, zonaId: zona.zonaId, repartidorId };

  let secuencia = 0;
  /**
   * Crea la promesa de entrega del envío.
   * @param {number} venceEn Momento simulado de vencimiento (epoch ms).
   * @returns {import('@rutasur/shared/src/eventos/tipos.js').EventoPromesa} Promesa creada.
   */
  const crearPromesa = (venceEn) =>
    crearEventoPromesa({
      shipmentId,
      secuencia: ++secuencia,
      ocurridoEn: new Date(inicioMs).toISOString(),
      venceEn: new Date(venceEn).toISOString(),
      franja: prng.elegirPonderado(FRANJAS.map((f) => ({ valor: f, peso: 1 }))),
      ...dimensiones,
    });

  /**
   * Crea un evento de estado sellando el momento y la secuencia.
   * @param {object} paso Paso del ciclo.
   * @param {number} paso.enMs Momento simulado del paso (epoch ms).
   * @param {string} paso.tipo Estado del envío.
   * @param {string} [paso.motivo] Motivo de la falla, si aplica.
   * @param {number} [paso.intento] Número de intento, si aplica.
   * @returns {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} Evento creado.
   */
  const crearEstado = (paso) =>
    crearEventoEstado({
      shipmentId,
      secuencia: ++secuencia,
      ocurridoEn: new Date(paso.enMs).toISOString(),
      tipo: paso.tipo,
      motivo: paso.motivo,
      intento: paso.intento,
      ...dimensiones,
    });

  const venceEn = inicioMs + prng.entero(24, 48) * HORA_SIMULADA_MS;
  const promesa = crearPromesa(venceEn);

  const pasos = /** @type {Array<{enMs: number, tipo: string, motivo?: string, intento?: number}>} */ ([
    { enMs: inicioMs, tipo: 'CREADO' },
  ]);

  let momento = inicioMs + prng.entero(1, 4) * HORA_SIMULADA_MS;
  pasos.push({ enMs: momento, tipo: 'INGRESADO_HUB' });

  if (prng.chance(config.probabilidadDemoraHub)) {
    momento += prng.entero(DEMORA_MIN_HUB_HORAS, 12) * HORA_SIMULADA_MS;
  }
  momento += prng.entero(30, 60) * 60 * 1000;

  let intento = 0;
  let resultado = 'ENTREGA_FALLIDA';
  while (intento < MAX_INTENTOS) {
    intento += 1;
    pasos.push({ enMs: momento, tipo: 'CLASIFICADO', intento });
    const {
      eventosIntento,
      resultado: resultadoIntento,
      siguienteMomento,
    } = ejecutarIntento(prng, config, zona, intento, momento);
    for (const paso of eventosIntento) pasos.push(paso);
    momento = siguienteMomento;
    resultado = resultadoIntento;

    if (resultado === 'ENTREGADO') break;
    const ultimoPaso = pasos[pasos.length - 1];
    if (ultimoPaso.motivo !== 'AUSENTE' || intento >= MAX_INTENTOS) break;
    momento += prng.entero(20, 28) * HORA_SIMULADA_MS; // nuevo intento al día hábil siguiente
  }

  return {
    shipmentId,
    zonaId: zona.zonaId,
    hubId,
    promesa,
    eventos: pasos.map(crearEstado),
    intentos: intento,
    estadoFinal: resultado,
  };
}
