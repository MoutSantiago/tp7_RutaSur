/**
 * Cliente productor de Kafka para RutaSur. La clave de partición es siempre
 * `shipmentId`, lo que garantiza el orden de los eventos de un mismo envío.
 *
 * @example
 * const productor = await crearProductor({ brokers: ['localhost:9092'], clientId: 'simulador', logger });
 * await productor.publicar({ topico: TOPICS.ESTADOS, evento });
 * await productor.cerrar();
 */

/**
 * Productor de eventos de RutaSur.
 * @typedef {object} ProductorEventos
 * @property {(opciones: {topico: string, evento: import('../eventos/tipos.js').EventoBase}) => Promise<void>} publicar
 *   Publica un evento usando el shipmentId del evento como clave.
 * @property {(opciones: {topico: string, clave: string, valor: unknown}) => Promise<void>} publicarCrudo
 *   Publica un valor arbitrario (usado para la DLQ).
 * @property {() => Promise<void>} cerrar Desconecta el productor.
 */

/**
 * Crea y conecta un productor de Kafka.
 * @param {object} opciones Opciones del productor.
 * @param {string[]} opciones.brokers Lista de brokers (host:puerto).
 * @param {string} opciones.clientId Identificador del cliente Kafka.
 * @param {import('../logger.js').Logger} opciones.logger Logger estructurado.
 * @param {import('kafkajs').Kafka} [opciones.kafka] Instancia de Kafka reutilizable (inyección para tests o múltiples roles).
 * @returns {Promise<ProductorEventos>} Productor conectado.
 * @throws {Error} Si no se puede conectar a Kafka.
 */
export async function crearProductor({ brokers, clientId, logger, kafka }) {
  const kafkaBase =
    kafka ??
    new (await import('kafkajs')).Kafka({ clientId, brokers });
  const productorKafka = kafkaBase.producer({ allowAutoTopicCreation: false });

  await productorKafka.connect();
  logger.info('Productor Kafka conectado', { clientId, brokers });

  /**
   * Publica un valor arbitrario serializado a JSON con la clave indicada.
   * @param {object} opciones Opciones de publicación.
   * @param {string} opciones.topico Topic destino.
   * @param {string} opciones.clave Clave de partición.
   * @param {unknown} opciones.valor Valor a serializar como JSON.
   * @returns {Promise<void>} Resuelve cuando Kafka confirmó el envío.
   */
  async function publicarCrudo({ topico, clave, valor }) {
    await productorKafka.send({
      topic: topico,
      messages: [{ key: clave, value: JSON.stringify(valor) }],
    });
    logger.debug('Evento publicado', { topico, clave });
  }

  return {
    async publicar({ topico, evento }) {
      if (!evento.shipmentId) {
        throw new Error(`El evento debe tener shipmentId para usarlo como clave (${topico})`);
      }
      await publicarCrudo({ topico, clave: evento.shipmentId, valor: evento });
    },
    publicarCrudo,

    async cerrar() {
      await productorKafka.disconnect();
      logger.info('Productor Kafka desconectado', { clientId });
    },
  };
}
