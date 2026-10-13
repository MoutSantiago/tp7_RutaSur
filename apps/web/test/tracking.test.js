import test from 'node:test';
import assert from 'node:assert/strict';
import { sanearTracking, CAMPOS_PUBLICOS_TRACKING } from '../lib/tracking.js';

const ENVIO_INTERNO = {
  shipmentId: 'ENV-000001',
  estado: 'EN_REPARTO',
  zonaId: 'ZONA-SUR',
  hubId: 'HUB-1',
  repartidorId: 'REP-ZONA-SUR-7',
  intentos: 2,
  promesa: { venceEn: '2026-10-14T18:00:00.000Z', franja: 'PM' },
  historial: [
    { tipo: 'CREADO', secuencia: 1, ocurridoEn: '2026-10-13T08:00:00.000Z' },
    { tipo: 'ENTREGA_FALLIDA', motivo: 'AUSENTE', secuencia: 5, ocurridoEn: '2026-10-13T18:00:00.000Z' },
  ],
  ultimaSecuencia: 6,
  ultimaActualizacion: '2026-10-14T10:00:00.000Z',
};

test('tracking: solo expone shipmentId, estado, texto público y fecha estimada', () => {
  const publico = sanearTracking(ENVIO_INTERNO);
  assert.ok(publico);
  assert.deepEqual(Object.keys(publico).sort(), [...CAMPOS_PUBLICOS_TRACKING].sort());
  assert.equal(publico.shipmentId, 'ENV-000001');
  assert.equal(publico.estado, 'EN_REPARTO');
  assert.equal(publico.estadoTexto, 'En reparto');
  assert.equal(publico.fechaEstimada, '2026-10-14T18:00:00.000Z');
  assert.equal(publico.franjaEstimada, 'PM');
});

test('tracking: no filtra ningún dato interno', () => {
  const publico = /** @type {Record<string, unknown>} */ (
    /** @type {unknown} */ (sanearTracking(ENVIO_INTERNO))
  );
  const internos = [
    'zonaId',
    'hubId',
    'repartidorId',
    'intentos',
    'historial',
    'motivo',
    'ultimaSecuencia',
    'alertas',
    'eventId',
  ];
  for (const clave of internos) {
    assert.equal(publico[clave], undefined, `se filtró el campo interno "${clave}"`);
  }
  const serializado = JSON.stringify(publico);
  assert.ok(!serializado.includes('REP-'), 'sin repartidor');
  assert.ok(!serializado.includes('AUSENTE'), 'sin motivos de fallo');
  assert.ok(!serializado.includes('HUB-'), 'sin hub');
});

test('tracking: traduce los estados derivados al lenguaje del destinatario', () => {
  const casos = [
    ['CREADO', 'Recibimos tu pedido'],
    ['INGRESADO_HUB', 'En el centro de distribución'],
    ['ENTREGADO', 'Entregado'],
    ['ENTREGA_FALLIDA', 'No pudimos entregarlo; te avisaremos'],
    ['RETENIDO', 'En revisión; te avisaremos'],
    ['DEVOLUCION', 'En gestión con el comercio'],
  ];
  for (const [estado, texto] of casos) {
    const publico = sanearTracking({ ...ENVIO_INTERNO, estado });
    assert.equal(publico?.estadoTexto, texto);
  }
});

test('tracking: envío inexistente devuelve null; sin promesa no inventa fecha', () => {
  assert.equal(sanearTracking(null), null);
  const sinPromesa = sanearTracking({ ...ENVIO_INTERNO, promesa: null });
  assert.equal(sinPromesa?.fechaEstimada, null);
  assert.equal(sinPromesa?.franjaEstimada, null);
});
