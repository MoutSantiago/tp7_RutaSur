/**
 * Punto de entrada del servicio de reprogramación (CU2).
 *
 * Consume `envios.estados` en el grupo `reprogramacion`; ante cada
 * ENTREGA_FALLIDA aplica las reglas puras de `reglas.js` y publica la
 * decisión en `envios.reprogramaciones`. Idempotente vía eventos_procesados.
 */

import {
  TOPICS,
  GRUPOS,
  cargarConfiguracion,
  crearLogger,
  crearConsumidor,
  crearProcesadorMensaje,
  crearProductor,
  crearEventoReprogramacion,
  conectarMongo,
  crearMarcadorIdempotencia,
  asegurarIndicesIdempotencia,
  registrarApagadoOrdenado,
} from '@rutasur/shared';
import { decidirReprogramacion } from './reglas.js';

/**
 * Arranca el servicio de reprogramación.
 * @returns {Promise<void>} Resuelve cuando el servicio quedó iniciado.
 */
async function main() {
  const config = cargarConfiguracion({ servicio: 'reprogramacion' });
  const logger = crearLogger({ servicio: GRUPOS.REPROGRAMACION, nivel: config.logNivel });

  const conexion = await conectarMongo({ uri: config.mongoUri, dbName: config.mongoDb, logger });
  await asegurarIndicesIdempotencia(conexion.db);
  const marcarIdempotencia = crearMarcadorIdempotencia({
    db: conexion.db,
    consumidor: GRUPOS.REPROGRAMACION,
  });

  const productor = await crearProductor({
    brokers: config.kafkaBrokers,
    clientId: 'reprogramacion',
    logger,
  });

  const procesador = crearProcesadorMensaje({
    consumidor: GRUPOS.REPROGRAMACION,
    logger,
    marcarSiNuevo: marcarIdempotencia.marcarSiNuevo,
    enviarADlq: ({ clave, valor }) =>
      productor.publicarCrudo({ topico: TOPICS.DLQ_ESTADOS, clave, valor }),
    handler: async (evento) => {
      const estado = /** @type {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} */ (evento);
      if (estado.tipo !== 'ENTREGA_FALLIDA') return;
      const decision = decidirReprogramacion({
        motivo: /** @type {string} */ (estado.motivo),
        intento: estado.intento ?? 1,
        ocurridoEn: estado.ocurridoEn,
      });
      const reprogramacion = crearEventoReprogramacion({
        shipmentId: estado.shipmentId,
        secuencia: estado.secuencia,
        ocurridoEn: estado.ocurridoEn,
        hubId: estado.hubId,
        zonaId: estado.zonaId,
        repartidorId: estado.repartidorId,
        motivo: /** @type {string} */ (estado.motivo),
        ...decision,
      });
      await productor.publicar({ topico: TOPICS.REPROGRAMACIONES, evento: reprogramacion });
      logger.info(' Decisión de reprogramación publicada', {
        shipmentId: estado.shipmentId,
        resultado: decision.resultado,
        intento: decision.intento,
        motivo: estado.motivo,
      });
    },
  });

  const consumidor = await crearConsumidor({
    brokers: config.kafkaBrokers,
    clientId: 'reprogramacion',
    grupo: GRUPOS.REPROGRAMACION,
    topicos: [TOPICS.ESTADOS],
    procesador,
    logger,
  });
  await consumidor.iniciar();

  registrarApagadoOrdenado({
    logger,
    pasos: [
      { nombre: 'consumidor-kafka', ejecutar: () => consumidor.detener() },
      { nombre: 'productor-kafka', ejecutar: () => productor.cerrar() },
      { nombre: 'mongodb', ejecutar: () => conexion.cerrar() },
    ],
  });

  logger.info('Servicio de reprogramación en marcha', { grupo: GRUPOS.REPROGRAMACION });
}

await main();
