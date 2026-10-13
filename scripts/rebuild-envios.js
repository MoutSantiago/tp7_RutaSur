#!/usr/bin/env node
/**
 * Reconstruye la colección `envios` desde el inicio del topic `envios.estados`.
 *
 * Borra la colección y la repuebla con un grupo de consumidores nuevo que lee
 * desde el offset inicial, demostrando que la vista es derivada y
 * reconstruible. Termina solo cuando alcanza el final del topic.
 *
 * Uso: node scripts/rebuild-envios.js
 * Variables de entorno: KAFKA_BROKERS, MONGO_URI, MONGO_DB (mismas que el resto).
 */

import { randomUUID } from 'node:crypto';
import {
  TOPICS,
  cargarConfiguracion,
  crearLogger,
  crearConsumidor,
  crearProcesadorMensaje,
  crearProductor,
  conectarMongo,
  crearMarcadorIdempotencia,
} from '../packages/shared/src/index.js';
import {
  crearRepositorioEnvios,
  asegurarIndicesEnvios,
  COLECCION_ENVIOS,
} from '../services/proyector/src/almacenamiento.js';

/** Milisegundos de silencio del topic tras los cuales se da por alcanzado el final. */
const SILENCIO_FIN_MS = 3000;

/**
 * Punto de entrada del script de reconstrucción.
 * @returns {Promise<void>} Resuelve cuando la reconstrucción finalizó.
 */
async function main() {
  const config = cargarConfiguracion({ servicio: 'rebuild-envios' });
  const logger = crearLogger({ servicio: 'rebuild-envios', nivel: config.logNivel });
  const grupo = `proyector-rebuild-${randomUUID()}`;

  const conexion = await conectarMongo({ uri: config.mongoUri, dbName: config.mongoDb, logger });
  const coleccion = conexion.db.collection(COLECCION_ENVIOS);
  const borrados = await coleccion.deleteMany({});
  logger.info('Colección envios vaciada', { borrados: borrados.deletedCount });
  await asegurarIndicesEnvios(conexion.db);

  const repositorio = crearRepositorioEnvios(conexion.db);
  // Grupo nuevo: sin offsets previos y sin marca de idempotencia compartida,
  // así se reprocesa todo el histórico.
  const marcarIdempotencia = crearMarcadorIdempotencia({ db: conexion.db, consumidor: grupo });
  const productorDlq = await crearProductor({
    brokers: config.kafkaBrokers,
    clientId: 'rebuild-envios',
    logger,
  });

  let ultimoMensaje = Date.now();
  let procesados = 0;

  const procesador = crearProcesadorMensaje({
    consumidor: grupo,
    logger,
    marcarSiNuevo: marcarIdempotencia.marcarSiNuevo,
    enviarADlq: ({ clave, valor }) =>
      productorDlq.publicarCrudo({ topico: TOPICS.DLQ_ESTADOS, clave, valor }),
    handler: async (evento) => {
      ultimoMensaje = Date.now();
      procesados += 1;
      await repositorio.aplicarEstado(
        /** @type {import('../packages/shared/src/eventos/tipos.js').EventoEstado} */ (evento),
      );
    },
  });

  const consumidor = await crearConsumidor({
    brokers: config.kafkaBrokers,
    clientId: 'rebuild-envios',
    grupo,
    topicos: [TOPICS.ESTADOS],
    procesador,
    logger,
    desdeElInicio: true,
  });
  await consumidor.iniciar();
  logger.info('Reprocesando histórico...', { grupo });

  // Espera hasta que no lleguen mensajes nuevos por SILENCIO_FIN_MS.
  while (Date.now() - ultimoMensaje < SILENCIO_FIN_MS) {
    await new Promise((resolver) => setTimeout(resolver, 250));
  }

  await consumidor.detener();
  await productorDlq.cerrar();
  const total = await coleccion.estimatedDocumentCount();
  logger.info('Reconstrucción finalizada', { procesados, documentos: total, grupo });
  await conexion.cerrar();
  process.exit(0);
}

await main();
