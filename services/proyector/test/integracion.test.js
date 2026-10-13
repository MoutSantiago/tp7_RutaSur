import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Test de integración del proyector contra Kafka y MongoDB reales.
 * Requiere el entorno levantado (`npm run up`) y se ejecuta solo con:
 *
 *   RUTASUR_INTEGRACION=1 npm test -w services/proyector
 */
import { randomUUID } from 'node:crypto';
import {
  TOPICS,
  crearLogger,
  crearProductor,
  crearConsumidor,
  crearProcesadorMensaje,
  crearEventoEstado,
  conectarMongo,
  crearMarcadorIdempotencia,
  cargarConfiguracion,
} from '@rutasur/shared';
import { crearRepositorioEnvios, asegurarIndicesEnvios } from '../src/almacenamiento.js';

const INTEGRACION = process.env.RUTASUR_INTEGRACION === '1';

test(
  'integración: un envío recorre estados por Kafka y queda proyectado en MongoDB descartando duplicados y desorden',
  { skip: !INTEGRACION ? 'Requiere RUTASUR_INTEGRACION=1 y el entorno Docker levantado' : false, timeout: 60000 },
  async () => {
    const config = cargarConfiguracion({ servicio: 'proyector-test' });
    const logger = crearLogger({ servicio: 'proyector-test', nivel: 'error' });
    const grupo = `proyector-test-${randomUUID()}`;

    const conexion = await conectarMongo({ uri: config.mongoUri, dbName: config.mongoDb, logger });
    await asegurarIndicesEnvios(conexion.db);
    const repositorio = crearRepositorioEnvios(conexion.db);
    const marcar = crearMarcadorIdempotencia({ db: conexion.db, consumidor: grupo });
    const coleccion = conexion.db.collection('envios');

    const productor = await crearProductor({
      brokers: config.kafkaBrokers,
      clientId: 'proyector-test',
      logger,
    });

    const shipmentId = `ENV-${randomUUID().slice(0, 8).toUpperCase()}`;
    const dims = { shipmentId, hubId: 'HUB-1', zonaId: 'ZONA-SUR', repartidorId: 'REP-1' };
    const base = Date.parse('2026-10-12T10:00:00Z');
    /**
     * Construye un evento de estado de prueba.
     * @param {number} secuencia Secuencia del evento.
     * @param {string} tipo Estado.
     * @param {Record<string, unknown>} [extra] Campos extra.
     * @returns {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} Evento creado.
     */
    const evento = (secuencia, tipo, extra = {}) =>
      crearEventoEstado({
        ...dims,
        secuencia,
        tipo,
        ocurridoEn: new Date(base + secuencia * 3600000).toISOString(),
        ...extra,
      });

    /** @type {Promise<unknown>[]} */
    const aplicaciones = [];
    const procesador = crearProcesadorMensaje({
      consumidor: grupo,
      logger,
      marcarSiNuevo: marcar.marcarSiNuevo,
      enviarADlq: async () => {},
      handler: async (e) => {
        const aplicacion = repositorio.aplicarEstado(
          /** @type {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} */ (e),
        );
        aplicaciones.push(aplicacion);
        await aplicacion;
      },
    });
    // Publicar primero y consumir desde el inicio con grupo nuevo: evita la carrera
    // de resolución del offset "latest" y hace el test determinista.
    // Orden publicado: CREADO(1), CLASIFICADO(3), INGRESADO_HUB(2) fuera de orden y
    // un duplicado del CLASIFICADO(3).
    await productor.publicar({ topico: TOPICS.ESTADOS, evento: evento(1, 'CREADO') });
    await productor.publicar({ topico: TOPICS.ESTADOS, evento: evento(3, 'CLASIFICADO', { intento: 1 }) });
    await productor.publicar({ topico: TOPICS.ESTADOS, evento: evento(2, 'INGRESADO_HUB') });
    await productor.publicar({ topico: TOPICS.ESTADOS, evento: evento(3, 'CLASIFICADO', { intento: 1 }) });

    const consumidor = await crearConsumidor({
      brokers: config.kafkaBrokers,
      clientId: 'proyector-test',
      grupo,
      topicos: [TOPICS.ESTADOS],
      procesador,
      logger,
      desdeElInicio: true,
    });
    await consumidor.iniciar();

    // Esperar al procesamiento (máximo 15 s).
    /** @type {import('../src/reductor.js').DocumentoEnvio | null} */
    let doc = null;
    const limite = Date.now() + 15000;
    while (Date.now() < limite) {
      await new Promise((resolver) => setTimeout(resolver, 500));
      doc = /** @type {import('../src/reductor.js').DocumentoEnvio | null} */ (
        await coleccion.findOne({ shipmentId })
      );
      if (doc && doc.historial.length === 2) break;
    }

    await consumidor.detener();
    await productor.cerrar();
    await coleccion.deleteOne({ shipmentId });
    await conexion.cerrar();

    assert.ok(doc, 'el documento del envío debería existir');
    assert.equal(doc.estado, 'CLASIFICADO');
    assert.equal(doc.ultimaSecuencia, 3);
    assert.equal(doc.historial.length, 2);
    assert.deepEqual(
      doc.historial.map((h) => h.tipo),
      ['CREADO', 'CLASIFICADO'],
    );
  },
);
