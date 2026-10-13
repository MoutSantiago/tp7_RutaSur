import test from 'node:test';
import assert from 'node:assert/strict';
import { crearEventoEstado } from '@rutasur/shared';
import {
  fechaDelDia,
  franjaDeMomento,
  claveParaEvento,
  calcularIncrementos,
} from '../src/metricas.js';

const DIMS = { shipmentId: 'ENV-000001', hubId: 'HUB-2', zonaId: 'ZONA-SUR', repartidorId: 'REP-1' };

/**
 * Crea un evento de estado de prueba.
 * @param {object} opciones Opciones del evento.
 * @returns {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} Evento creado.
 */
function evento(opciones) {
  return crearEventoEstado(
    /** @type {import('@rutasur/shared/src/eventos/fabrica.js').DatosBase & { tipo: string, motivo?: string, intento?: number }} */ ({
      ...DIMS,
      ...opciones,
    }),
  );
}

test('fechas y franjas: fechaDelDia y franjaDeMomento usan UTC y el corte de las 13:00', () => {
  assert.equal(fechaDelDia('2026-10-12T23:59:59Z'), '2026-10-12');
  assert.equal(fechaDelDia('2026-10-13T00:00:00Z'), '2026-10-13');
  assert.equal(franjaDeMomento('2026-10-12T12:59:59Z'), 'AM');
  assert.equal(franjaDeMomento('2026-10-12T13:00:00Z'), 'PM');
  assert.throws(() => fechaDelDia('no-una-fecha'), /inválida/);
});

test('claveParaEvento: agrupa por día, zona y franja del ocurridoEn', () => {
  const clave = claveParaEvento(
    evento({ secuencia: 1, tipo: 'CREADO', ocurridoEn: '2026-10-12T14:30:00Z' }),
  );
  assert.deepEqual(clave, { fecha: '2026-10-12', zonaId: 'ZONA-SUR', franja: 'PM' });
});

test('incrementos: estados intermedios no aportan', () => {
  for (const tipo of ['CREADO', 'INGRESADO_HUB', 'CLASIFICADO', 'EN_REPARTO']) {
    const incs = calcularIncrementos(evento({ secuencia: 1, tipo }), null);
    assert.deepEqual(incs, {}, `tipo ${tipo}`);
  }
});

test('incrementos: ENTREGADO en el primer intento suma a la tasa y al SLA cumplido', () => {
  const incs = calcularIncrementos(
    evento({ secuencia: 5, tipo: 'ENTREGADO', intento: 1, ocurridoEn: '2026-10-12T20:00:00Z' }),
    '2026-10-13T00:00:00Z',
  );
  assert.equal(incs['intentosPrimeros.total'], 1);
  assert.equal(incs['intentosPrimeros.exitosos'], 1);
  assert.equal(incs['sla.cumplidos'], 1);
  assert.equal(incs['porHub.HUB-2.sla.cumplidos'], 1);
  assert.equal(Object.keys(incs).length, 4);
});

test('incrementos: ENTREGADO a tiempo vencido cuenta como SLA incumplido', () => {
  const incs = calcularIncrementos(
    evento({ secuencia: 5, tipo: 'ENTREGADO', intento: 2, ocurridoEn: '2026-10-15T20:00:00Z' }),
    '2026-10-13T00:00:00Z',
  );
  assert.equal(incs['sla.incumplidos'], 1);
  assert.equal(incs['porHub.HUB-2.sla.incumplidos'], 1);
  assert.equal(incs['intentosPrimeros.total'], undefined, 'segundo intento no cuenta para la tasa');
});

test('incrementos: ENTREGA_FALLIDA en primer intento suma a la tasa y al motivo', () => {
  const incs = calcularIncrementos(
    evento({
      secuencia: 5,
      tipo: 'ENTREGA_FALLIDA',
      motivo: 'AUSENTE',
      intento: 1,
      ocurridoEn: '2026-10-12T20:00:00Z',
    }),
    '2026-10-13T00:00:00Z',
  );
  assert.equal(incs['intentosPrimeros.total'], 1);
  assert.equal(incs['intentosPrimeros.exitosos'], undefined);
  assert.equal(incs['motivos.AUSENTE'], 1);
  assert.equal(incs['sla.cumplidos'], undefined, 'los fallos no son entregas para el SLA');
});

test('incrementos: sin vencimiento conocido no se evalúa SLA', () => {
  const incs = calcularIncrementos(
    evento({ secuencia: 5, tipo: 'ENTREGADO', intento: 1, ocurridoEn: '2026-10-12T20:00:00Z' }),
    null,
  );
  assert.equal(incs['sla.cumplidos'], undefined);
  assert.equal(incs['intentosPrimeros.exitosos'], 1);
});
