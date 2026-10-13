import test from 'node:test';
import assert from 'node:assert/strict';
import { resumirMetricas } from '../lib/metricas.js';

/**
 * Construye un documento crudo de metricas_diarias para pruebas.
 * @param {object} opciones Opciones.
 * @param {string} opciones.fecha Día YYYY-MM-DD.
 * @param {string} opciones.zonaId Zona.
 * @param {string} [opciones.franja] Franja (default AM).
 * @param {[number, number]} [opciones.intentosPrimero] [total, exitosos].
 * @param {Record<string, number>} [opciones.motivos] Motivos -> cantidad.
 * @param {Record<string, {cumplidos: number, incumplidos: number}>} [opciones.hubs] SLA por hub.
 * @returns {Record<string, any>} Documento de métricas.
 */
function docMetricas({ fecha, zonaId, franja = 'AM', intentosPrimero, motivos, hubs }) {
  const doc = /** @type {Record<string, any>} */ ({ fecha, zonaId, franja });
  if (intentosPrimero) {
    doc.intentosPrimeros = { total: intentosPrimero[0], exitosos: intentosPrimero[1] };
  }
  if (motivos) doc.motivos = motivos;
  if (hubs) {
    doc.porHub = Object.fromEntries(
      Object.entries(hubs).map(([h, s]) => [h, { sla: s }]),
    );
  }
  return doc;
}

const DOCS = [
  docMetricas({ fecha: '2026-10-13', zonaId: 'ZONA-SUR', franja: 'AM', intentosPrimero: [10, 8] }),
  docMetricas({ fecha: '2026-10-13', zonaId: 'ZONA-SUR', franja: 'PM', intentosPrimero: [10, 4] }),
  docMetricas({ fecha: '2026-10-13', zonaId: 'ZONA-NORTE', franja: 'AM', intentosPrimero: [20, 19] }),
  docMetricas({ fecha: '2026-10-13', zonaId: 'ZONA-SUR', motivos: { AUSENTE: 8, RECHAZADO: 2 } }),
  docMetricas({
    fecha: '2026-10-13',
    zonaId: 'ZONA-SUR',
    hubs: { 'HUB-1': { cumplidos: 9, incumplidos: 1 }, 'HUB-2': { cumplidos: 2, incumplidos: 8 } },
  }),
  docMetricas({
    fecha: '2026-10-14',
    zonaId: 'ZONA-CENTRO',
    intentosPrimero: [15, 15],
    hubs: { 'HUB-1': { cumplidos: 15, incumplidos: 0 } },
  }),
];

test('analítica: tasa de primer intento por día, zona y franja', () => {
  const { tasaPrimerIntento } = resumirMetricas(DOCS, {});
  const surAm = tasaPrimerIntento.find((f) => f.franja === 'AM' && f.zonaId === 'ZONA-SUR');
  assert.ok(surAm);
  assert.equal(surAm.tasa, 80);
  const surPm = tasaPrimerIntento.find((f) => f.franja === 'PM' && f.zonaId === 'ZONA-SUR');
  assert.ok(surPm);
  assert.equal(surPm.tasa, 40);
  const norte = tasaPrimerIntento.find((f) => f.zonaId === 'ZONA-NORTE');
  assert.ok(norte);
  assert.equal(norte.tasa, 95);
});

test('analítica: el filtro por zona restringe los tres indicadores', () => {
  const soloSur = resumirMetricas(DOCS, { zonaId: 'ZONA-SUR' });
  assert.ok(soloSur.tasaPrimerIntento.every((f) => f.zonaId === 'ZONA-SUR'));
  assert.ok(soloSur.motivos.every((m) => m.zonaId === 'ZONA-SUR'));
  assert.deepEqual(soloSur.motivos.map((m) => [m.motivo, m.cantidad]), [
    ['AUSENTE', 8],
    ['RECHAZADO', 2],
  ]);
});

test('analítica: el filtro por día restringe los indicadores', () => {
  const dia14 = resumirMetricas(DOCS, { fecha: '2026-10-14' });
  assert.equal(dia14.tasaPrimerIntento.length, 1);
  assert.equal(dia14.tasaPrimerIntento[0].zonaId, 'ZONA-CENTRO');
  assert.equal(dia14.slaHub.length, 1);
  assert.equal(dia14.slaHub[0].cumplimiento, 100);
});

test('analítica: cumplimiento de SLA por hub y día, filtrado por hub', () => {
  const todo = resumirMetricas(DOCS, {});
  const hub1 = todo.slaHub.find((s) => s.hubId === 'HUB-1' && s.fecha === '2026-10-13');
  assert.ok(hub1);
  assert.equal(hub1.cumplidos, 9);
  assert.equal(hub1.incumplidos, 1);

  const soloHub2 = resumirMetricas(DOCS, { hubId: 'HUB-2' });
  assert.equal(soloHub2.slaHub.length, 1);
  assert.equal(soloHub2.slaHub[0].hubId, 'HUB-2');
  assert.equal(soloHub2.slaHub[0].cumplimiento, 20);
});

test('analítica: motivos agregan cantidades entre documentos de la misma zona', () => {
  const dobles = [...DOCS, docMetricas({ fecha: '2026-10-14', zonaId: 'ZONA-SUR', franja: 'PM', motivos: { AUSENTE: 4 } })];
  const { motivos } = resumirMetricas(dobles, { zonaId: 'ZONA-SUR' });
  assert.deepEqual(motivos[0], { zonaId: 'ZONA-SUR', motivo: 'AUSENTE', cantidad: 12 });
});

test('analítica: sin datos devuelve listas vacías sin fallar', () => {
  const vacio = resumirMetricas([], {});
  assert.deepEqual(vacio, { tasaPrimerIntento: [], motivos: [], slaHub: [] });
});
