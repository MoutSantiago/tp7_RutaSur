/**
 * Punto de entrada del simulador de RutaSur.
 *
 * Genera envíos a un ritmo configurable, construye su ciclo de vida con la
 * lógica pura de `cicloVida.js`, aplica defectos de publicación con
 * `defectos.js` y publica en Kafka (envios.promesas y envios.estados).
 * Las marcas temporales son simuladas (ocurridoEn), aceleradas respecto al
 * tiempo real según el factor configurado.
 */

import {
  TOPICS,
  crearLogger,
  crearProductor,
  registrarApagadoOrdenado,
} from '@rutasur/shared';
import { cargarConfigSimulador } from './config.js';
import { crearPrng } from './prng.js';
import { crearRelojSimulado, dormirSimulados } from './reloj.js';
import { generarCicloDeVida } from './cicloVida.js';
import { planificarPublicaciones } from './defectos.js';

/** Prefijo de los identificadores de envío generados. */
const PREFIJO_ENVIO = 'ENV';

/**
 * Genera un identificador de envío legible y correlativo.
 * @param {number} numero Número correlativo del envío (1 en adelante).
 * @returns {string} Identificador del envío, p. ej. ENV-000001.
 */
function crearShipmentId(numero) {
  return `${PREFIJO_ENVIO}-${String(numero).padStart(6, '0')}`;
}

/**
 * Ejecuta el ciclo de vida de un envío: publica la promesa y, en tiempos
 * simulados, cada publicación planificada del listado de estados.
 * @param {object} opciones Opciones de ejecución.
 * @param {import('./prng.js').Prng} opciones.prng Generador aleatorio.
 * @param {import('./cicloVida.js').ConfigSimulacion} opciones.config Configuración pura.
 * @param {import('./defectos.js').ProbabilidadesDefecto} opciones.probabilidades Defectos de publicación.
 * @param {import('./reloj.js').RelojSimulado} opciones.reloj Reloj simulado del servicio.
 * @param {import('@rutasur/shared').ProductorEventos} opciones.productor Productor Kafka.
 * @param {import('@rutasur/shared').Logger} opciones.logger Logger estructurado.
 * @param {string} opciones.shipmentId Identificador del envío.
 * @param {number} opciones.inicioMs Momento simulado de creación del envío.
 * @param {() => boolean} opciones.debeDetenerse Función que indica si el servicio está apagándose.
 * @returns {Promise<void>} Resuelve cuando se publicaron todos los eventos del envío.
 */
export async function ejecutarEnvio({
  prng,
  config,
  probabilidades,
  reloj,
  productor,
  logger,
  shipmentId,
  inicioMs,
  debeDetenerse,
}) {
  const ciclo = generarCicloDeVida({ prng, config, shipmentId, inicioMs });
  const logEnvio = logger.hijo({ shipmentId });

  await productor.publicar({ topico: TOPICS.PROMESAS, evento: ciclo.promesa });
  logEnvio.info('Promesa publicada', { venceEn: ciclo.promesa.venceEn, franja: ciclo.promesa.franja });

  const plan = planificarPublicaciones({ prng, probabilidades, eventos: ciclo.eventos });
  for (const publicacion of plan) {
    if (debeDetenerse()) return;
    const enMs =
      typeof publicacion.valor === 'object' && publicacion.valor !== null
        ? Date.parse(
            /** @type {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} */ (
              publicacion.valor
            ).ocurridoEn,
          )
        : inicioMs;
    const esperaMs = enMs - reloj.ahoraSimulado();
    if (esperaMs > 0) await dormirSimulados(reloj, esperaMs);
    if (debeDetenerse()) return;
    await productor.publicarCrudo({
      topico: TOPICS.ESTADOS,
      clave: publicacion.clave,
      valor: publicacion.valor,
    });
  }
  logEnvio.info('Ciclo de envío completado', {
    estadoFinal: ciclo.estadoFinal,
    intentos: ciclo.intentos,
  });
}

/**
 * Función principal del servicio: levanta la configuración, conecta el
 * productor y dispara el flujo continuo de envíos hasta detenerse.
 * @returns {Promise<void>} Resuelve cuando el servicio termina de apagarse.
 */
async function main() {
  const config = cargarConfigSimulador();
  const logger = crearLogger({
    servicio: 'simulador',
    nivel: config.servicio.logNivel,
  });
  logger.info('Simulador iniciando', {
    enviosPorMinuto: config.enviosPorMinuto,
    factorAceleracion: config.factorAceleracion,
    semilla: config.semilla,
  });

  const productor = await crearProductor({
    brokers: config.servicio.kafkaBrokers,
    clientId: 'simulador',
    logger,
  });

  const prng = crearPrng(config.semilla);
  const reloj = crearRelojSimulado({ factor: config.factorAceleracion });
  let numeroEnvio = 0;
  let deteniendo = false;
  const debeDetenerse = () => deteniendo;

  const intervaloMsReal = 60000 / config.enviosPorMinuto;
  const temporizador = setInterval(() => {
    numeroEnvio += 1;
    if (config.enviosTotal > 0 && numeroEnvio > config.enviosTotal) {
      clearInterval(temporizador);
      return;
    }
    const shipmentId = crearShipmentId(numeroEnvio);
    const inicioMs = reloj.ahoraSimulado();
    ejecutarEnvio({
      prng,
      config,
      probabilidades: config.probabilidades,
      reloj,
      productor,
      logger,
      shipmentId,
      inicioMs,
      debeDetenerse,
    }).catch((error) => logger.error('Falló el envío simulado', { shipmentId, error }));
  }, intervaloMsReal);

  registrarApagadoOrdenado({
    logger,
    pasos: [
      {
        nombre: 'temporizador',
        ejecutar: () => {
          deteniendo = true;
          clearInterval(temporizador);
        },
      },
      { nombre: 'productor-kafka', ejecutar: () => productor.cerrar() },
    ],
  });

  logger.info('Simulador en marcha', { intervaloMsReal });
}

await main();
