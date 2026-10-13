#!/usr/bin/env node
/**
 * Replay del cuarto indicador (CU4): tiempo medio por hub.
 *
 * Lanza un grupo de consumidores NUEVO (`analitica-tiempos-hub`) que lee
 * `envios.estados` desde el inicio y va acumulando suma y cantidad por hub en
 * `metricas_diarias`, sin reiniciar ni tocar a los demás servicios. Muestra el
 * progreso (procesados y lag) cada pocos segundos y termina sola al alcanzar
 * el final del topic.
 *
 * Uso: node scripts/replay-tiempos-hub.js
 */

import { randomUUID } from 'node:crypto';
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
} from '../packages/shared/src/index.js';
import {
  crearRastreadorTiempos,
  incrementosTiempoHub,
} from '../services/analitica/src/tiemposHub.js';

/** Milisegundos de silencio que indican que el replay alcanzó el final del topic. */
const SILENCIO_FIN_MS = 5000;

/** Intervalo del informe de progreso (ms). */
const REPORTE_CADA_MS = 2000;

/**
 * Punto de entrada del replay del cuarto indicador.
 * @returns {Promise<void>} Resuelve al terminar el reprocesamiento.
 */
async function main() {
  const config = cargarConfiguracion({ servicio: 'replay-tiempos-hub' });
  const logger = crearLogger({ servicio: 'replay-tiempos-hub', nivel: config.logNivel });
  // Cliente efímero para distinguir la conexión Kafka de este script.
  const clientId = `replay-tiempos-${randomUUID().slice(0, 8)}`;

  const conexion = await conectarMongo({ uri: config.mongoUri, dbName: config.mongoDb, logger });
  await asegurarIndicesIdempotencia(conexion.db);
  const metricas = conexion.db.collection('metricas_diarias');
  const marcar = crearMarcadorIdempotencia({ db: conexion.db, consumidor: GRUPOS.ANALITICA_TIEMPOS_HUB });
  const rastreador = crearRastreadorTiempos();
  const productorDlq = await crearProductor({ brokers: config.kafkaBrokers, clientId, logger });

  let procesados = 0;
  let pares = 0;
  let ultimoMensaje = Date.now();

  const procesador = crearProcesadorMensaje({
    consumidor: GRUPOS.ANALITICA_TIEMPOS_HUB,
    logger,
    marcarSiNuevo: marcar.marcarSiNuevo,
    enviarADlq: (m) =>
      productorDlq.publicarCrudo({ topico: TOPICS.DLQ_ESTADOS, clave: m.clave, valor: m.valor }),
    handler: async (evento) => {
      ultimoMensaje = Date.now();
      procesados += 1;
      const paso = rastreador.registrar(
        /** @type {import('../packages/shared/src/eventos/tipos.js').EventoEstado} */ (evento),
      );
      if (!paso) return;
      pares += 1;
      await metricas.updateOne(
        { fecha: paso.fecha, zonaId: paso.zonaId, franja: paso.franja },
        {
          $inc: incrementosTiempoHub(paso),
          $setOnInsert: { fecha: paso.fecha, zonaId: paso.zonaId, franja: paso.franja, creadoEn: new Date() },
          $set: { actualizadoEn: new Date() },
        },
        { upsert: true },
      );
    },
  });

  const consumidor = await crearConsumidor({
    brokers: config.kafkaBrokers,
    clientId,
    grupo: GRUPOS.ANALITICA_TIEMPOS_HUB,
    topicos: [TOPICS.ESTADOS],
    procesador,
    logger,
    desdeElInicio: true,
  });
  await consumidor.iniciar();

  // Informe de progreso: lee offsets del grupo y totales del topic.
  const { Kafka } = await import('kafkajs');
  const admin = new Kafka({ clientId: `${clientId}-admin`, brokers: config.kafkaBrokers }).admin();
  await admin.connect();
  const reportero = setInterval(async () => {
    try {
      const [altos, offsets] = await Promise.all([
        admin.fetchTopicOffsets(TOPICS.ESTADOS),
        admin.fetchOffsets({ groupId: GRUPOS.ANALITICA_TIEMPOS_HUB, topics: [TOPICS.ESTADOS] }),
      ]);
      const finaltTopic = altos.reduce((a, p) => a + Number(p.high), 0);
      const comprometido =
        offsets[0]?.partitions?.reduce((a, p) => a + Math.max(0, Number(p.offset)), 0) ?? 0;
      logger.info('Progreso del replay', { procesados, pares, lag: Math.max(0, finaltTopic - comprometido) });
    } catch {
      logger.info('Progreso del replay', { procesados, pares });
    }
  }, REPORTE_CADA_MS);

  // Termina cuando no llegan mensajes nuevos por un rato (histórico agotado).
  while (Date.now() - ultimoMensaje < SILENCIO_FIN_MS) {
    await new Promise((resolver) => setTimeout(resolver, 500));
  }

  clearInterval(reportero);
  await consumidor.detener();
  await admin.disconnect();
  await productorDlq.cerrar();
  await conexion.cerrar();
  logger.info('Replay completo', { procesados, pares });
  process.exit(0);
}

await main();
