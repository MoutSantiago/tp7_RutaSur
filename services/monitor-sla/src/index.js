/**
 * Punto de entrada del monitor de SLA (CU3).
 *
 * Consume `envios.promesas` y `envios.estados` en el grupo `monitor-sla`,
 * mantiene el estado interno por envío (memoria + respaldo MongoDB), usa el
 * reloj simulado que viaja en los eventos, evalúa las reglas al recibir cada
 * evento y por barrido periódico (cada minuto SIMULADO), y publica alertas en
 * `alertas.sla` (abrir y cerrar, sin repetir reglas por envío).
 */

import {
  TOPICS,
  GRUPOS,
  cargarConfiguracion,
  crearLogger,
  crearConsumidor,
  crearProcesadorMensaje,
  crearProductor,
  conectarMongo,
  registrarApagadoOrdenado,
} from '@rutasur/shared';
import { crearRelojEventos, intervaloBarridoRealMs } from './reloj.js';
import { crearAlmacenMonitor, asegurarIndicesMonitor } from './estado.js';
import { crearMotorSla } from './motor.js';

/**
 * Lee el factor de aceleración del entorno.
 * @param {NodeJS.ProcessEnv} env Variables de entorno.
 * @returns {number} Factor de aceleración (SIM_FACTOR_ACELERACION, default 120).
 */
export function leerFactorAceleracion(env = process.env) {
  const valor = Number(env.SIM_FACTOR_ACELERACION ?? 120);
  if (!Number.isFinite(valor) || valor <= 0) {
    throw new Error('SIM_FACTOR_ACELERACION debe ser un número positivo');
  }
  return valor;
}

/**
 * Arranca el monitor de SLA.
 * @returns {Promise<void>} Resuelve cuando el servicio quedó iniciado.
 */
async function main() {
  const config = cargarConfiguracion({ servicio: 'monitor-sla' });
  const logger = crearLogger({ servicio: GRUPOS.MONITOR_SLA, nivel: config.logNivel });
  const factor = leerFactorAceleracion();

  const conexion = await conectarMongo({ uri: config.mongoUri, dbName: config.mongoDb, logger });
  await asegurarIndicesMonitor(conexion.db);
  const almacen = crearAlmacenMonitor(conexion.db);
  const restaurados = await almacen.restaurar();
  logger.info('Estado del monitor restaurado desde MongoDB', { enviosAbiertos: restaurados });

  const reloj = crearRelojEventos({ factorAceleracion: factor });
  const productor = await crearProductor({
    brokers: config.kafkaBrokers,
    clientId: 'monitor-sla',
    logger,
  });

  const motor = crearMotorSla({
    almacen,
    reloj,
    publicador: productor,
    topicoAlertas: TOPICS.ALERTAS_SLA,
    logger,
  });

  // Nota de idempotencia: el monitor decide por su propio estado persistido
  // (reglasAlertadas), no por eventos_procesados, para no omitir la evaluación
  // de un duplicado que avanza el reloj.
  const procesador = crearProcesadorMensaje({
    consumidor: GRUPOS.MONITOR_SLA,
    logger,
    enviarADlq: ({ clave, valor }) =>
      productor.publicarCrudo({ topico: TOPICS.DLQ_ESTADOS, clave, valor }),
    handler: async (evento, contexto) => {
      if (contexto.topico === TOPICS.PROMESAS) {
        await motor.registrarPromesa(
          /** @type {import('@rutasur/shared/src/eventos/tipos.js').EventoPromesa} */ (evento),
        );
      } else {
        await motor.registrarEstado(
          /** @type {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} */ (evento),
        );
      }
    },
  });

  const consumidor = await crearConsumidor({
    brokers: config.kafkaBrokers,
    clientId: 'monitor-sla',
    grupo: GRUPOS.MONITOR_SLA,
    topicos: [TOPICS.PROMESAS, TOPICS.ESTADOS],
    procesador,
    logger,
  });
  await consumidor.iniciar();

  // Barrido: cada minuto SIMULADO = 60000/factor ms reales.
  const intervaloRealMs = intervaloBarridoRealMs(factor);
  const temporizador = setInterval(() => {
    motor.barrer().catch((error) => logger.error('Falló el barrido de alertas', { error }));
  }, intervaloRealMs);

  registrarApagadoOrdenado({
    logger,
    pasos: [
      { nombre: 'temporizador-barrido', ejecutar: () => clearInterval(temporizador) },
      { nombre: 'consumidor-kafka', ejecutar: () => consumidor.detener() },
      { nombre: 'productor-kafka', ejecutar: () => productor.cerrar() },
      { nombre: 'mongodb', ejecutar: () => conexion.cerrar() },
    ],
  });

  logger.info('Monitor de SLA en marcha', {
    grupo: GRUPOS.MONITOR_SLA,
    barridoCadaMsReales: intervaloRealMs,
    factorAceleracion: factor,
  });
}

await main();
