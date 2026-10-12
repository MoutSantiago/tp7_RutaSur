/**
 * Cliente consumidor de Kafka para RutaSur con commit MANUAL de offsets.
 *
 * El procesamiento de cada mensaje está separado de Kafka (`crearProcesadorMensaje`)
 * para poder testear la lógica (validación, idempotencia, DLQ) sin broker.
 *
 * Flujo por mensaje: parsear JSON → validar esquema → verificar idempotencia →
 * ejecutar handler → confirmar el offset. Los mensajes inválidos van a la DLQ
 * con el motivo y se confirman igual, para no bloquear el consumo.
 */

import { validarEvento } from '../eventos/esquemas.js';

/** @readonly resultados posibles del procesamiento de un mensaje. */
export const RESULTADOS_PROCESAMIENTO = Object.freeze({
  PROCESADO: 'PROCESADO',
  DUPLICADO: 'DUPLICADO',
  DLQ: 'DLQ',
});

/**
 * Contexto de un mensaje de Kafka procesado.
 * @typedef {object} ContextoMensaje
 * @property {string} topico Topic de origen.
 * @property {number} particion Partición del mensaje.
 * @property {string} offset Offset del mensaje.
 */

/**
 * Función que registra un evento como procesado para idempotencia.
 * @callback MarcarSiNuevo
 * @param {string} eventId Identificador del evento.
 * @returns {Promise<boolean>} Verdadero si el evento es nuevo, falso si ya estaba procesado.
 */

/**
 * Función que envía un mensaje inválido a la DLQ.
 * @callback EnviarADlq
 * @param {object} mensaje Datos del mensaje rechazado.
 * @param {string} mensaje.clave Clave de partición (shipmentId o 'desconocido').
 * @param {import('../eventos/tipos.js').MensajeDlq} mensaje.valor Payload de la DLQ.
 * @returns {Promise<void>} Resuelve cuando el mensaje fue publicado en la DLQ.
 */

/**
 * Handler de negocio de un servicio consumidor.
 * @callback HandlerEvento
 * @param {import('../eventos/tipos.js').EventoBase} evento Evento validado.
 * @param {ContextoMensaje} contexto Contexto del mensaje (topic, partición, offset).
 * @returns {Promise<void>} Resuelve cuando el efecto del evento fue aplicado.
 */

/**
 * Procesador de mensajes: lógica pura de validación, idempotencia y DLQ.
 * @typedef {object} ProcesadorMensaje
 * @property {(mensaje: ContextoMensaje & {valorCrudo: string | Buffer | null}) => Promise<string>} procesar
 *   Procesa un mensaje y devuelve el resultado (PROCESADO, DUPLICADO o DLQ).
 */

/**
 * Crea un procesador de mensajes desacoplado de Kafka (testeable con mocks).
 * @param {object} opciones Opciones del procesador.
 * @param {string} opciones.consumidor Nombre del grupo de consumidores.
 * @param {HandlerEvento} opciones.handler Handler de negocio a invocar con eventos válidos.
 * @param {EnviarADlq} opciones.enviarADlq Función para publicar en la DLQ.
 * @param {MarcarSiNuevo} [opciones.marcarSiNuevo] Verificación de idempotencia (opcional).
 * @param {import('../logger.js').Logger} opciones.logger Logger estructurado.
 * @param {(topico: string, evento: unknown) => {valido: boolean, errores: string[]}} [opciones.validar]
 *   Validador de esquema (por defecto, `validarEvento`).
 * @returns {ProcesadorMensaje} Procesador listo para usar.
 */
export function crearProcesadorMensaje({
  consumidor,
  handler,
  enviarADlq,
  marcarSiNuevo,
  logger,
  validar = validarEvento,
}) {
  return {
    async procesar({ topico, particion, offset, valorCrudo }) {
      const logBase = { consumidor, topico, particion, offset };

      let evento;
      try {
        evento = JSON.parse(valorCrudo?.toString() ?? 'null');
      } catch (error) {
        const detalle = error instanceof Error ? error.message : String(error);
        return rechazar({ motivo: `JSON inválido: ${detalle}`, valorCrudo, topico, particion, offset });
      }

      const { valido, errores } = validar(topico, evento);
      if (!valido) {
        return rechazar({ motivo: errores.join(' | '), evento, valorCrudo: null, topico, particion, offset });
      }

      const logEvento = logger.hijo({ eventId: evento.eventId, ...logBase });

      if (marcarSiNuevo) {
        const esNuevo = await marcarSiNuevo(evento.eventId);
        if (!esNuevo) {
          logEvento.info('Evento duplicado descartado', { shipmentId: evento.shipmentId });
          return RESULTADOS_PROCESAMIENTO.DUPLICADO;
        }
      }

      await handler(evento, { topico, particion, offset });
      logEvento.debug('Evento procesado', { shipmentId: evento.shipmentId, tipo: evento.tipo });
      return RESULTADOS_PROCESAMIENTO.PROCESADO;
    },
  };

  /**
   * Envía un mensaje inválido a la DLQ con el motivo del rechazo.
   * @param {object} datos Datos del rechazo.
   * @param {string} datos.motivo Motivo legible del rechazo.
   * @param {unknown} [datos.evento] Evento parseado, si pudo parsearse.
   * @param {string | Buffer | null} datos.valorCrudo Payload original.
   * @param {string} datos.topico Topic de origen del mensaje.
   * @param {number} datos.particion Partición del mensaje.
   * @param {string} datos.offset Offset del mensaje.
   * @returns {Promise<string>} Siempre RESULTADOS_PROCESAMIENTO.DLQ.
   */
  async function rechazar({ motivo, evento, valorCrudo, topico, particion, offset }) {
    const clave =
      evento && typeof evento === 'object' && 'shipmentId' in evento
        ? String(evento.shipmentId)
        : 'desconocido';
    await enviarADlq({
      clave,
      valor: {
        motivoError: motivo,
        eventoOriginal: evento ?? valorCrudo?.toString() ?? null,
        consumidor,
        topicOrigen: topico,
        particion,
        offset,
        enviadoEn: new Date().toISOString(),
      },
    });
    logger.warn('Mensaje enviado a la DLQ', { motivo, clave });
    return RESULTADOS_PROCESAMIENTO.DLQ;
  }
}

/**
 * Consumidor de un servicio RutaSur.
 * @typedef {object} ConsumidorEventos
 * @property {() => Promise<void>} iniciar Conecta, suscribe y comienza a consumir.
 * @property {() => Promise<void>} detener Detiene y desconecta el consumidor.
 */

/**
 * Crea un consumidor de Kafka con commit manual de offsets después del handler.
 * @param {object} opciones Opciones del consumidor.
 * @param {string[]} opciones.brokers Lista de brokers (host:puerto).
 * @param {string} opciones.clientId Identificador del cliente Kafka.
 * @param {string} opciones.grupo Grupo de consumidores del servicio.
 * @param {string[]} opciones.topicos Topics a suscribir.
 * @param {ProcesadorMensaje} opciones.procesador Procesador de mensajes (ver crearProcesadorMensaje).
 * @param {import('../logger.js').Logger} opciones.logger Logger estructurado.
 * @param {boolean} [opciones.desdeElInicio] Si es verdadero, lee desde el offset inicial.
 * @returns {Promise<ConsumidorEventos>} Consumidor listo para iniciar.
 * @throws {Error} Si no se puede conectar a Kafka.
 */
export async function crearConsumidor({
  brokers,
  clientId,
  grupo,
  topicos,
  procesador,
  logger,
  desdeElInicio = false,
}) {
  const { Kafka } = await import('kafkajs');
  const kafka = new Kafka({ clientId, brokers });
  const consumidorKafka = kafka.consumer({
    groupId: grupo,
    allowAutoTopicCreation: false,
  });

  let iniciado = false;
  let deteniendose = false;

  return {
    async iniciar() {
      await consumidorKafka.connect();
      for (const topico of topicos) {
        await consumidorKafka.subscribe({ topic: topico, fromBeginning: desdeElInicio });
      }
      await consumidorKafka.run({
        autoCommit: false,
        eachMessage: async ({ topic, partition, message }) => {
          if (deteniendose) return;
          try {
            await procesador.procesar({
              topico: topic,
              particion: partition,
              offset: message.offset,
              valorCrudo: message.value,
            });
            await consumidorKafka.commitOffsets([
              { topic, partition, offset: (Number(message.offset) + 1).toString() },
            ]);
          } catch (error) {
            // El handler falló: NO se confirma el offset para reintentar el mensaje.
            logger.error('Error procesando mensaje; se reintentará', {
              topico: topic,
              particion: partition,
              offset: message.offset,
              error,
            });
            throw error;
          }
        },
      });
      iniciado = true;
      logger.info('Consumidor Kafka iniciado', { grupo, topicos, desdeElInicio });
    },

    async detener() {
      if (!iniciado) return;
      deteniendose = true;
      await consumidorKafka.stop();
      await consumidorKafka.disconnect();
      logger.info('Consumidor Kafka detenido', { grupo });
    },
  };
}
