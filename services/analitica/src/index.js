/**
 * Punto de entrada del servicio de analítica (CU4).
 *
 * Consume `envios.estados` y `envios.promesas` en el grupo `analitica` y
 * actualiza `metricas_diarias` únicamente con incrementos atómicos. Las
 * promesas se guardan en una colección interna para poder evaluar el
 * cumplimiento de SLA cuando llega el ENTREGADO. La idempotencia la garantiza
 * `eventos_procesados`: un evento reprocesado no incrementa dos veces.
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
  crearMarcadorIdempotencia,
  asegurarIndicesIdempotencia,
  registrarApagadoOrdenado,
} from '@rutasur/shared';
import { asegurarIndicesAnalitica, crearRepositorioMetricas } from './almacenamiento.js';
import { claveParaEvento, calcularIncrementos } from './metricas.js';

/**
 * Arranca el servicio de analítica.
 * @returns {Promise<void>} Resuelve cuando el servicio quedó iniciado.
 */
async function main() {
  const config = cargarConfiguracion({ servicio: 'analitica' });
  const logger = crearLogger({ servicio: GRUPOS.ANALITICA, nivel: config.logNivel });

  const conexion = await conectarMongo({ uri: config.mongoUri, dbName: config.mongoDb, logger });
  await asegurarIndicesIdempotencia(conexion.db);
  await asegurarIndicesAnalitica(conexion.db);
  const repo = crearRepositorioMetricas(conexion.db);
  const marcarIdempotencia = crearMarcadorIdempotencia({
    db: conexion.db,
    consumidor: GRUPOS.ANALITICA,
  });

  const productorDlq = await crearProductor({
    brokers: config.kafkaBrokers,
    clientId: 'analitica',
    logger,
  });

  const procesador = crearProcesadorMensaje({
    consumidor: GRUPOS.ANALITICA,
    logger,
    marcarSiNuevo: marcarIdempotencia.marcarSiNuevo,
    enviarADlq: ({ clave, valor }) =>
      productorDlq.publicarCrudo({ topico: TOPICS.DLQ_ESTADOS, clave, valor }),
    handler: async (evento, contexto) => {
      if (contexto.topico === TOPICS.PROMESAS) {
        await repo.guardarPromesa(
          /** @type {import('@rutasur/shared/src/eventos/tipos.js').EventoPromesa} */ (evento),
        );
        return;
      }
      const estado = /** @type {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} */ (evento);
      const venceEn = await repo.buscarVencimiento(estado.shipmentId);
      const incrementos = calcularIncrementos(estado, venceEn);
      const clave = claveParaEvento(estado);
      await repo.aplicarIncrementos(clave, incrementos);
      if (Object.keys(incrementos).length > 0) {
        logger.info('Métrica incrementada', {
          shipmentId: estado.shipmentId,
          tipo: estado.tipo,
          ...clave,
        });
      }
    },
  });

  const consumidor = await crearConsumidor({
    brokers: config.kafkaBrokers,
    clientId: 'analitica',
    grupo: GRUPOS.ANALITICA,
    topicos: [TOPICS.ESTADOS, TOPICS.PROMESAS],
    procesador,
    logger,
  });
  await consumidor.iniciar();

  registrarApagadoOrdenado({
    logger,
    pasos: [
      { nombre: 'consumidor-kafka', ejecutar: () => consumidor.detener() },
      { nombre: 'productor-dlq', ejecutar: () => productorDlq.cerrar() },
      { nombre: 'mongodb', ejecutar: () => conexion.cerrar() },
    ],
  });

  logger.info('Servicio de analítica en marcha', { grupo: GRUPOS.ANALITICA });
}

await main();
