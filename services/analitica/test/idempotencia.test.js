import test from 'node:test';
import assert from 'node:assert/strict';
import { crearEventoEstado, crearProcesadorMensaje, crearLogger, TOPICS } from '@rutasur/shared';
import { claveParaEvento, calcularIncrementos } from '../src/metricas.js';

/** @readonly logger silenciado. */
const logger = crearLogger({ servicio: 'test', nivel: 'error' });
logger.error = () => {};
logger.warn = () => {};

/**
 * Acumulador en memoria que emula las escrituras de metricas_diarias.
 * @returns {{mapa: Map<string, Record<string, number>>, aplicar: (clave: object, incs: Record<string, number>) => Promise<void>}}
 *   Mapa acumulado y función aplicadora.
 */
function crearAcumulador() {
  const mapa = new Map();
  return {
    mapa,
    aplicar: async (clave, incs) => {
      const claveStr = JSON.stringify(clave);
      const doc = mapa.get(claveStr) ?? {};
      for (const [ruta, delta] of Object.entries(incs)) {
        doc[ruta] = (doc[ruta] ?? 0) + delta;
      }
      mapa.set(claveStr, doc);
    },
  };
}

/**
 * Emula eventos_procesados: recuerda los eventId ya marcados.
 * @returns {{marcarSiNuevo: (eventId: string) => Promise<boolean>}} Marcador.
 */
function crearMarcador() {
  const vistos = new Set();
  return { marcarSiNuevo: async (eventId) => !vistos.has(eventId) && (vistos.add(eventId), true) };
}

test('idempotencia: reprocesar el mismo evento no incrementa dos veces', async () => {
  const acumulador = crearAcumulador();
  const marcador = crearMarcador();
  const procesador = crearProcesadorMensaje({
    consumidor: 'analitica',
    logger,
    marcarSiNuevo: marcador.marcarSiNuevo,
    enviarADlq: async () => {},
    handler: async (evento) => {
      const estado = /** @type {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} */ (evento);
      await acumulador.aplicar(claveParaEvento(estado), calcularIncrementos(estado, '2026-10-13T00:00:00Z'));
    },
  });

  const fallo = crearEventoEstado({
    shipmentId: 'ENV-000001',
    secuencia: 5,
    tipo: 'ENTREGA_FALLIDA',
    motivo: 'AUSENTE',
    intento: 1,
    ocurridoEn: '2026-10-12T20:00:00Z',
    hubId: 'HUB-2',
    zonaId: 'ZONA-SUR',
    repartidorId: 'REP-1',
  });
  const mensaje = JSON.stringify(fallo);
  const ctx = { topico: TOPICS.ESTADOS, particion: 0 };

  await procesador.procesar({ ...ctx, offset: '10', valorCrudo: mensaje });
  // Reproceso: mismo evento, otro offset (Por ejemplo tras reiniciar el consumidor).
  const segundo = await procesador.procesar({ ...ctx, offset: '10', valorCrudo: mensaje });

  const doc = acumulador.mapa.values().next().value;
  assert.ok(doc);
  assert.equal(doc['intentosPrimeros.total'], 1);
  assert.equal(doc['motivos.AUSENTE'], 1);
  assert.equal(segundo, 'DUPLICADO');
});

test('idempotencia: eventos distintos del mismo envío sí incrementan por separado', async () => {
  const acumulador = crearAcumulador();
  const marcador = crearMarcador();
  const procesador = crearProcesadorMensaje({
    consumidor: 'analitica',
    logger,
    marcarSiNuevo: marcador.marcarSiNuevo,
    enviarADlq: async () => {},
    handler: async (evento) => {
      const estado = /** @type {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} */ (evento);
      await acumulador.aplicar(claveParaEvento(estado), calcularIncrementos(estado, '2026-10-13T00:00:00Z'));
    },
  });

  for (let i = 0; i < 3; i++) {
    const fallo = crearEventoEstado({
      shipmentId: 'ENV-000001',
      secuencia: 10 + i,
      tipo: 'ENTREGA_FALLIDA',
      motivo: 'AUSENTE',
      intento: 1,
      ocurridoEn: '2026-10-12T20:00:00Z',
      hubId: 'HUB-2',
      zonaId: 'ZONA-SUR',
      repartidorId: 'REP-1',
    });
    await procesador.procesar({
      topico: TOPICS.ESTADOS,
      particion: 0,
      offset: String(20 + i),
      valorCrudo: JSON.stringify(fallo),
    });
  }

  const doc = acumulador.mapa.values().next().value;
  assert.ok(doc);
  assert.equal(doc['intentosPrimeros.total'], 3);
  assert.equal(doc['motivos.AUSENTE'], 3);
});
