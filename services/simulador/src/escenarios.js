/**
 * Escenarios a pedido del simulador (lógica pura).
 *
 * Cada escenario genera uno o más ciclos de vida con resultados deterministas
 * mediante los forzados de `generarCicloDeVida`. El despacho (publicación con
 * tiempos simulados) es responsabilidad de la capa de I/O.
 */

import { generarCicloDeVida } from './cicloVida.js';

/** @readonly nombres de los escenarios disponibles. */
export const ESCENARIOS = Object.freeze([
  'feliz',
  'ausente',
  'demorado',
  'tercer-fallo',
  'rafaga',
]);

/** @readonly cantidad de envíos de la ráfaga. */
export const CANTIDAD_RAFAGA = 500;

/**
 * Definición de un escenario: cómo forzar cada ciclo generado.
 * @typedef {object} DefinicionEscenario
 * @property {number} cantidad Cantidad de envíos del escenario.
 * @property {import('./cicloVida.js').ForzadoCiclo} forzar Forzado aplicado a cada envío.
 * @property {string} descripcion Qué demuestra el escenario.
 */

/** @readonly forzados por escenario. */
const DEFINICIONES = Object.freeze(
  /** @type {Record<string, DefinicionEscenario>} */ ({
    feliz: {
      cantidad: 1,
      forzar: { fallos: ['ENTREGADO'] },
      descripcion: 'Un envío recorre todos los estados sin incidentes.',
    },
    ausente: {
      cantidad: 1,
      forzar: { fallos: ['AUSENTE', 'ENTREGADO'] },
      descripcion: 'Un envío falla por ausencia y se reprograma; el segundo intento entrega.',
    },
    demorado: {
      cantidad: 1,
      forzar: { demoraHub: true, slaHoras: 5, fallos: ['ENTREGADO'] },
      descripcion:
        'Un envío queda detenido en el hub con una promesa ajustada (5 h): dispara SIN_INGRESO/SIN_SALIDA antes del vencimiento.',
    },
    'tercer-fallo': {
      cantidad: 1,
      forzar: { fallos: ['AUSENTE', 'AUSENTE', 'AUSENTE'] },
      descripcion: 'Un envío agota sus tres intentos y pasa a devolución al comercio.',
    },
    rafaga: {
      cantidad: CANTIDAD_RAFAGA,
      forzar: {},
      descripcion: '500 envíos en pocos segundos, para ver acumulación y recuperación del lag.',
    },
  }),
);

/**
 * Devuelve la definición de un escenario.
 * @param {string} nombre Nombre del escenario.
 * @returns {DefinicionEscenario} Definición del escenario.
 * @throws {Error} Si el escenario no existe.
 */
export function definicionEscenario(nombre) {
  const definicion = DEFINICIONES[nombre];
  if (!definicion) {
    throw new Error(`Escenario desconocido: "${nombre}". Disponibles: ${ESCENARIOS.join(', ')}`);
  }
  return definicion;
}

/**
 * Genera los ciclos de vida de un escenario.
 * @param {object} opciones Opciones.
 * @param {string} opciones.nombre Nombre del escenario.
 * @param {import('./prng.js').Prng} opciones.prng Generador aleatorio del servicio.
 * @param {import('./cicloVida.js').ConfigSimulacion} opciones.config Configuración de la simulación.
 * @param {number} opciones.inicioMs Momento simulado de disparo del escenario.
 * @param {number} opciones.numeroBase Siguiente número correlativo de envío del simulador.
 * @param {(numero: number) => string} opciones.crearShipmentId Función de identificador.
 * @returns {{ciclos: Array<import('./cicloVida.js').CicloDeVida>, cantidadUsados: number, descripcion: string}}
 *   Ciclos a publicar y cuántos números de envío consumió.
 */
export function generarEscenario({ nombre, prng, config, inicioMs, numeroBase, crearShipmentId }) {
  const definicion = definicionEscenario(nombre);
  const ciclos = [];
  for (let i = 0; i < definicion.cantidad; i++) {
    ciclos.push(
      generarCicloDeVida({
        prng,
        config,
        shipmentId: crearShipmentId(numeroBase + i),
        inicioMs,
        forzar: definicion.forzar,
      }),
    );
  }
  return { ciclos, cantidadUsados: definicion.cantidad, descripcion: definicion.descripcion };
}

/**
 * Construye un mensaje malformado para inyectar en `envios.estados` durante la
 * demo (JSON roto que no supera la validación de esquema en los consumidores).
 * @param {object} [opciones] Opciones.
 * @param {string} [opciones.shipmentId] Identificador a incluir en la clave y el payload.
 * @returns {{clave: string, valor: string}} Mensaje listo para publicar en crudo.
 * @example
 * const m = crearMensajeMalformado({ shipmentId: 'ENV-DEMO-1' });
 * // m.valor es una cadena JSON inválida que terminará en la DLQ.
 */
export function crearMensajeMalformado({ shipmentId = 'ENV-DEMO-MALFORMADO' } = {}) {
  return {
    clave: shipmentId,
    valor: `{"eventId":"malformado-demo","shipmentId":"${shipmentId}","tipo":"CREADO","secuencia":"esto-no-es-un-numero"`,
  };
}
