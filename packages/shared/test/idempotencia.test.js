import test from 'node:test';
import assert from 'node:assert/strict';
import {
  crearMarcadorIdempotencia,
  asegurarIndicesIdempotencia,
  COLECCION_EVENTOS_PROCESADOS,
  TTL_EVENTOS_PROCESADOS_SEG,
} from '../src/mongo/idempotencia.js';

/**
 * Crea una base de datos mock que emula el índice único (consumidor, eventId)
 * de MongoDB lanzando el error 11000 cuando se inserta un duplicado.
 * @returns {{db: import('mongodb').Db, insertados: Array<Record<string, unknown>>, indices: Array<{claves: Record<string, number>, opciones: Record<string, unknown>}>}}
 *   Mock de la base y registros de las operaciones recibidas.
 */
function crearDbMock() {
  /** @type {Array<Record<string, unknown>>} */
  const insertados = [];
  /** @type {Array<{claves: Record<string, number>, opciones: Record<string, unknown>}>} */
  const indices = [];
  const coleccion = /** @type {unknown} */ ({
    /**
     * Registra la creación de un índice.
     * @param {Record<string, number>} claves Claves del índice.
     * @param {Record<string, unknown>} opciones Opciones del índice.
     * @returns {Promise<string>} Nombre del índice creado.
     */
    createIndex: async (claves, opciones) => {
      indices.push({ claves, opciones });
      return 'ok';
    },
    /**
     * Inserta un documento emulando el índice único (consumidor, eventId).
     * @param {Record<string, unknown>} doc Documento a insertar.
     * @returns {Promise<{insertedId: unknown}>} Resultado de la inserción.
     * @throws {Error} Error con code 11000 si ya existe un registro con esa clave.
     */
    insertOne: async (doc) => {
      const existe = insertados.some(
        (d) => d.consumidor === doc.consumidor && d.eventId === doc.eventId,
      );
      if (existe) {
        const error = /** @type {Error & {code?: number}} */ (new Error('E11000 duplicate key'));
        error.code = 11000;
        throw error;
      }
      insertados.push(doc);
      return { insertedId: doc.eventId };
    },
  });
  const db = /** @type {import('mongodb').Db} */ (/** @type {unknown} */ ({
    collection: () => coleccion,
  }));
  return { db, insertados, indices };
}

test('idempotencia: el primer procesamiento de un eventId devuelve verdadero', async () => {
  const { db, insertados } = crearDbMock();
  const marcar = crearMarcadorIdempotencia({ db, consumidor: 'proyector' });

  const esNuevo = await marcar.marcarSiNuevo('evt-1');

  assert.equal(esNuevo, true);
  assert.equal(insertados.length, 1);
  assert.equal(insertados[0].consumidor, 'proyector');
  assert.equal(insertados[0].eventId, 'evt-1');
  assert.ok(insertados[0].procesadoEn instanceof Date);
});

test('idempotencia: repetir el mismo eventId devuelve falso y no duplica el registro', async () => {
  const { db, insertados } = crearDbMock();
  const marcar = crearMarcadorIdempotencia({ db, consumidor: 'proyector' });

  await marcar.marcarSiNuevo('evt-1');
  const esNuevo = await marcar.marcarSiNuevo('evt-1');

  assert.equal(esNuevo, false);
  assert.equal(insertados.length, 1);
});

test('idempotencia: el mismo eventId con distinto consumidor se procesa dos veces', async () => {
  const { db } = crearDbMock();
  const marcarA = crearMarcadorIdempotencia({ db, consumidor: 'proyector' });
  const marcarB = crearMarcadorIdempotencia({ db, consumidor: 'analitica' });

  assert.equal(await marcarA.marcarSiNuevo('evt-1'), true);
  assert.equal(await marcarB.marcarSiNuevo('evt-1'), true);
});

test('idempotencia: errores que no son de duplicado se propagan', async () => {
  const coleccion = /** @type {unknown} */ ({
    insertOne: async () => {
      throw new Error('conexión perdida');
    },
  });
  const db = /** @type {import('mongodb').Db} */ (/** @type {unknown} */ ({
    collection: () => coleccion,
  }));
  const marcar = crearMarcadorIdempotencia({ db, consumidor: 'proyector' });

  await assert.rejects(marcar.marcarSiNuevo('evt-1'), /conexión perdida/);
});

test('idempotencia: los índices son único por consumidor+eventId y TTL de 7 días', async () => {
  const { db, indices } = crearDbMock();

  await asegurarIndicesIdempotencia(db);

  assert.equal(indices.length, 2);
  const unico = indices.find((i) => i.claves.consumidor === 1 && i.claves.eventId === 1);
  assert.ok(unico);
  assert.equal(unico.opciones.unique, true);
  const ttl = indices.find((i) => i.claves.procesadoEn === 1);
  assert.ok(ttl);
  assert.equal(ttl.opciones.expireAfterSeconds, TTL_EVENTOS_PROCESADOS_SEG);
  assert.equal(COLECCION_EVENTOS_PROCESADOS, 'eventos_procesados');
});
