import test from 'node:test';
import assert from 'node:assert/strict';
import { crearEventoEstado, crearProcesadorMensaje, crearLogger, TOPICS } from '@rutasur/shared';
import { crearRastreadorTiempos, incrementosTiempoHub } from '../src/tiemposHub.js';

const DIMS = { shipmentId: 'ENV-000001', hubId: 'HUB-2', zonaId: 'ZONA-SUR', repartidorId: 'REP-1' };
const HORA = 3600000;

/** @readonly logger silenciado. */
const logger = crearLogger({ servicio: 'test', nivel: 'error' });
logger.error = () => {};
logger.warn = () => {};

/**
 * Evento de estado de prueba.
 * @param {string} tipo Estado.
 * @param {number} secuencia Secuencia.
 * @param {number} ms Momento simulado (epoch ms).
 * @param {object} [extra] Campos extra.
 * @returns {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} Evento creado.
 */
function estado(tipo, secuencia, ms, extra = {}) {
  return crearEventoEstado({
    ...DIMS,
    tipo,
    secuencia,
    ocurridoEn: new Date(ms).toISOString(),
    ...extra,
  });
}

const BASE = Date.parse('2026-10-13T10:00:00Z');

test('tiempos hub: un par ingreso→salida devuelve la duración con día, zona y franja', () => {
  const r = crearRastreadorTiempos();
  const ingreso = r.registrar(estado('INGRESADO_HUB', 3, BASE));
  assert.equal(ingreso, null);
  const paso = r.registrar(estado('EN_REPARTO', 5, BASE + 2.5 * HORA, { intento: 1 }));
  assert.ok(paso);
  assert.equal(paso.deltaMs, 2.5 * HORA);
  assert.equal(paso.fecha, '2026-10-13');
  assert.equal(paso.franja, 'AM'); // salida a las 12:30 UTC, antes del corte de 13:00
  assert.equal(paso.hubId, 'HUB-2');
});

test('tiempos hub: estados ajenos y reparto sin ingreso previo no generan nada', () => {
  const r = crearRastreadorTiempos();
  assert.equal(r.registrar(estado('CREADO', 2, BASE)), null);
  assert.equal(r.registrar(estado('EN_REPARTO', 5, BASE + HORA, { intento: 1 })), null);
});

test('tiempos hub: reparto de segundo intento no cuenta', () => {
  const r = crearRastreadorTiempos();
  r.registrar(estado('INGRESADO_HUB', 3, BASE));
  r.registrar(estado('EN_REPARTO', 5, BASE + 2 * HORA, { intento: 1 }));
  assert.equal(r.registrar(estado('EN_REPARTO', 9, BASE + 26 * HORA, { intento: 2 })), null);
});

test('tiempos hub: un evento fuera de orden no genera par (secuencia <= ingreso)', () => {
  const r = crearRastreadorTiempos();
  r.registrar(estado('INGRESADO_HUB', 4, BASE));
  assert.equal(r.registrar(estado('EN_REPARTO', 3, BASE + HORA, { intento: 1 })), null);
});

test('tiempos hub: el par cerrado no se vuelve a contar', () => {
  const r = crearRastreadorTiempos();
  r.registrar(estado('INGRESADO_HUB', 3, BASE));
  const primero = r.registrar(estado('EN_REPARTO', 5, BASE + 2 * HORA, { intento: 1 }));
  assert.ok(primero);
  assert.equal(r.registrar(estado('EN_REPARTO', 5, BASE + 2 * HORA, { intento: 1 })), null);
});

test('tiempos hub: los incrementos son suma y cantidad por hub (nunca el promedio)', () => {
  const r = crearRastreadorTiempos();
  r.registrar(estado('INGRESADO_HUB', 3, BASE));
  const paso = r.registrar(estado('EN_REPARTO', 5, BASE + 3 * HORA, { intento: 1 }));
  assert.ok(paso);
  assert.deepEqual(incrementosTiempoHub(paso), {
    'porHub.HUB-2.tiempoHubSumaMs': 3 * HORA,
    'porHub.HUB-2.tiempoHubCantidad': 1,
  });
});

test('replay idempotente: reprocesar los mismos eventos no duplica sumas', async () => {
  // Emula el replay: procesador con marcador por eventId + acumulador en memoria.
  const acumulado = new Map();
  const vistos = new Set();
  const rastreador = crearRastreadorTiempos();
  const procesador = crearProcesadorMensaje({
    consumidor: 'analitica-tiempos-hub',
    logger,
    marcarSiNuevo: async (id) => !vistos.has(id) && (vistos.add(id), true),
    enviarADlq: async () => {},
    handler: async (evento) => {
      const paso = rastreador.registrar(
        /** @type {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} */ (evento),
      );
      if (!paso) return;
      for (const [ruta, delta] of Object.entries(incrementosTiempoHub(paso))) {
        acumulado.set(ruta, (acumulado.get(ruta) ?? 0) + delta);
      }
    },
  });

  const eventos = [
    estado('CREADO', 1, BASE),
    estado('INGRESADO_HUB', 3, BASE),
    estado('CLASIFICADO', 4, BASE + HORA),
    estado('EN_REPARTO', 5, BASE + 4 * HORA, { intento: 1 }),
    estado('ENTREGADO', 6, BASE + 8 * HORA, { intento: 1 }),
  ];
  // Primera pasada + replay completo (simula un segundo recorrido desde el inicio).
  for (const pasada of [0, 1]) {
    let offset = pasada * 100;
    for (const e of eventos) {
      offset += 1;
      await procesador.procesar({
        topico: TOPICS.ESTADOS,
        particion: 0,
        offset: String(offset),
        valorCrudo: JSON.stringify(e),
      });
    }
  }

  assert.equal(acumulado.get('porHub.HUB-2.tiempoHubCantidad'), 1);
  assert.equal(acumulado.get('porHub.HUB-2.tiempoHubSumaMs'), 4 * HORA);
});
