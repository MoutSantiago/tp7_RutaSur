/**
 * Conexión a MongoDB para los servicios de RutaSur.
 * MongoDB guarda vistas derivadas de los eventos; la fuente de verdad es Kafka.
 *
 * @example
 * const conexion = await conectarMongo({ uri: config.mongoUri, dbName: config.mongoDb });
 * await conexion.cerrar();
 */

/**
 * Conexión establecida con MongoDB.
 * @typedef {object} ConexionMongo
 * @property {import('mongodb').MongoClient} client Cliente de MongoDB.
 * @property {import('mongodb').Db} db Base de datos del servicio.
 * @property {() => Promise<void>} cerrar Cierra la conexión.
 */

/**
 * Conecta a MongoDB y verifica la conexión con un ping.
 * @param {object} opciones Opciones de conexión.
 * @param {string} opciones.uri URI de MongoDB (con replicaSet para change streams).
 * @param {string} opciones.dbName Nombre de la base de datos.
 * @param {import('../logger.js').Logger} [opciones.logger] Logger estructurado.
 * @returns {Promise<ConexionMongo>} Conexión establecida.
 * @throws {import('mongodb').MongoServerError} Si no se puede conectar o autenticar.
 */
export async function conectarMongo({ uri, dbName, logger }) {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(uri, { appName: 'rutasur' });
  await client.connect();
  const db = client.db(dbName);
  await db.command({ ping: 1 });
  logger?.info('Conexión MongoDB establecida', { dbName });
  return {
    client,
    db,
    async cerrar() {
      await client.close();
      logger?.info('Conexión MongoDB cerrada', { dbName });
    },
  };
}
