/**
 * Punto de entrada del servicio de notificaciones (CU2).
 *
 * Consume `envios.estados` en el grupo `notificaciones`; ante cada
 * ENTREGA_FALLIDA registra un aviso al destinatario publicando en
 * `notificaciones.enviadas`. Exactamente una notificación por fallo gracias a
 * la idempotencia sobre eventos_procesados.
 */

import {
  TOPICS,
  GRUPOS,
  cargarConfiguracion,
  crearLogger,
  crearConsumidor,
  crearProcesadorMensaje,
  crearProductor,
  crearEventoNotificacion,
  conectarMongo,
  crearMarcadorIdempotencia,
  asegurarIndicesIdempotencia,
  registrarApagadoOrdenado,
} from '@rutasur/shared';
import { decidirAviso } from './avisos.js';

/**
 * Arranca el servicio de notificaciones.
 * @returns {Promise<void>} Resuelve cuando el servicio quedó iniciado.
 */
async function main() {
  const config = cargarConfiguracion({ servicio: 'notificaciones' });
  const logger = crearLogger({ servicio: GRUPOS.NOTIFICACIONES, nivel: config.logNivel });

  const conexion = await conectarMongo({ uri: config.mongoUri, dbName: config.mongoDb, logger });
  await asegurarIndicesIdempotencia(conexion.db);
  const marcarIdempotencia = crearMarcadorIdempotencia({
    db: conexion.db,
    consumidor: GRUPOS.NOTIFICACIONES,
  });

  const productor = await crearProductor({
    brokers: config.kafkaBrokers,
    clientId: 'notificaciones',
    logger,
  });

  const procesador = crearProcesadorMensaje({
    consumidor: GRUPOS.NOTIFICACIONES,
    logger,
    marcarSiNuevo: marcarIdempotencia.marcarSiNuevo,
    enviarADlq: ({ clave, valor }) =>
      productor.publicarCrudo({ topico: TOPICS.DLQ_ESTADOS, clave, valor }),
    handler: async (evento) => {
      const estado = /** @type {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} */ (evento);
      const aviso = decidirAviso(estado);
      if (!aviso) return;
      const notificacion = crearEventoNotificacion({
        shipmentId: estado.shipmentId,
        secuencia: estado.secuencia,
        ocurridoEn: new Date().toISOString(),
        hubId: estado.hubId,
        zonaId: estado.zonaId,
        repartidorId: estado.repartidorId,
        eventoOrigenId: estado.eventId,
        ...aviso,
      });
      await productor.publicar({ topico: TOPICS.NOTIFICACIONES, evento: notificacion });
      logger.info('Notificación publicada', {
        shipmentId: estado.shipmentId,
        motivo: estado.motivo,
        intento: estado.intento,
        eventoOrigenId: estado.eventId,
      });
    },
  });

  const consumidor = await crearConsumidor({
    brokers: config.kafkaBrokers,
    clientId: 'notificaciones',
    grupo: GRUPOS.NOTIFICACIONES,
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

  logger.info('Servicio de notificaciones en marcha', { grupo: GRUPOS.NOTIFICACIONES });
}

await main();
