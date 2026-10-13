import test from 'node:test';
import assert from 'node:assert/strict';
import { crearPrng } from '../src/prng.js';
import { cargarConfigSimulador } from '../src/config.js';
import {
  generarEscenario,
  definicionEscenario,
  crearMensajeMalformado,
  ESCENARIOS,
  CANTIDAD_RAFAGA,
} from '../src/escenarios.js';
import { MAX_INTENTOS } from '../src/cicloVida.js';

const config = cargarConfigSimulador({ env: {} });
const INICIO = Date.parse('2026-10-14T08:00:00Z'); // miércoles

/**
 * Helper: genera el único ciclo de un escenario unitario.
 * @param {string} nombre Nombre del escenario.
 * @param {number} [semilla] Semilla del PRNG.
 * @returns {import('../src/cicloVida.js').CicloDeVida} Ciclo generado.
 */
function cicloEscenario(nombre, semilla = 42) {
  const { ciclos } = generarEscenario({
    nombre,
    prng: crearPrng(semilla),
    config,
    inicioMs: INICIO,
    numeroBase: 9000,
    crearShipmentId: (n) => `ENV-${String(n).padStart(6, '0')}`,
  });
  assert.equal(ciclos.length, 1);
  return ciclos[0];
}

test('escenarios disponibles: los cinco de la especificación', () => {
  assert.deepEqual(ESCENARIOS, ['feliz', 'ausente', 'demorado', 'tercer-fallo', 'rafaga']);
  assert.throws(() => definicionEscenario('no-existe'), /desconocido/);
});

test('feliz: un intento, termina ENTREGADO, sin entregas fallidas y dentro del SLA', () => {
  const ciclo = cicloEscenario('feliz');
  assert.equal(ciclo.estadoFinal, 'ENTREGADO');
  assert.equal(ciclo.intentos, 1);
  assert.deepEqual(
    ciclo.eventos.map((e) => e.tipo),
    ['CREADO', 'INGRESADO_HUB', 'CLASIFICADO', 'EN_REPARTO', 'ENTREGADO'],
  );
  const venceEn = Date.parse(ciclo.promesa.venceEn);
  const entregadoEn = Date.parse(ciclo.eventos[ciclo.eventos.length - 1].ocurridoEn);
  assert.ok(entregadoEn <= venceEn, 'entrega dentro del SLA');
  assert.ok(!ciclo.eventos.some((e) => e.tipo === 'ENTREGA_FALLIDA'));
});

test('ausente: falla una vez por AUSENTE y entrega en el segundo intento', () => {
  const ciclo = cicloEscenario('ausente');
  assert.equal(ciclo.estadoFinal, 'ENTREGADO');
  assert.equal(ciclo.intentos, 2);
  const fallo = ciclo.eventos.find((e) => e.tipo === 'ENTREGA_FALLIDA');
  assert.ok(fallo);
  assert.equal(fallo.motivo, 'AUSENTE');
  assert.equal(fallo.intento, 1);
  const entregado = ciclo.eventos[ciclo.eventos.length - 1];
  assert.equal(entregado.tipo, 'ENTREGADO');
  assert.equal(entregado.intento, 2);
  // el nuevo intento ocurre alrededor del día siguiente (20-28 h simuladas después)
  const gap = Date.parse(entregado.ocurridoEn) - Date.parse(fallo.ocurridoEn);
  assert.ok(gap >= 20 * 3600e3, `gap ${gap / 3600e3} h`);
});

test('demorado: queda detenido en el hub y la promesa vence pronto (dispara alertas)', () => {
  const ciclo = cicloEscenario('demorado');
  assert.equal(ciclo.estadoFinal, 'ENTREGADO');
  // Promesa ajustada (5 h) + demora en hub (6-12 h) => el envío no llega al reparto a tiempo.
  const venceEn = Date.parse(ciclo.promesa.venceEn);
  assert.equal(venceEn - INICIO, 5 * 3600e3);
  const ingreso = ciclo.eventos.find((e) => e.tipo === 'INGRESADO_HUB');
  const clasificado = ciclo.eventos.find((e) => e.tipo === 'CLASIFICADO');
  assert.ok(ingreso && clasificado);
  const gap = Date.parse(clasificado.ocurridoEn) - Date.parse(ingreso.ocurridoEn);
  assert.ok(gap >= 6 * 3600e3, `demora en hub de ${gap / 3600e3} h simuladas`);
  // al momento de clasificar ya se pasó el vencimiento o falta muy poco
  assert.ok(Date.parse(clasificado.ocurridoEn) >= venceEn - 4 * 3600e3);
});

test('tercer-fallo: agota los 3 intentos con AUSENTE y no vuelve a circuito', () => {
  const ciclo = cicloEscenario('tercer-fallo');
  assert.equal(ciclo.estadoFinal, 'ENTREGA_FALLIDA');
  assert.equal(ciclo.intentos, MAX_INTENTOS);
  const fallos = ciclo.eventos.filter((e) => e.tipo === 'ENTREGA_FALLIDA');
  assert.equal(fallos.length, 3);
  assert.deepEqual(
    fallos.map((f) => f.motivo),
    ['AUSENTE', 'AUSENTE', 'AUSENTE'],
  );
  assert.deepEqual(
    fallos.map((f) => f.intento),
    [1, 2, 3],
  );
});

test('rafaga: genera 500 ciclos correctos', () => {
  const { ciclos, cantidadUsados } = generarEscenario({
    nombre: 'rafaga',
    prng: crearPrng(1),
    config,
    inicioMs: INICIO,
    numeroBase: 5000,
    crearShipmentId: (n) => `ENV-${String(n).padStart(6, '0')}`,
  });
  assert.equal(ciclos.length, CANTIDAD_RAFAGA);
  assert.equal(cantidadUsados, CANTIDAD_RAFAGA);
  const unicos = new Set(ciclos.map((c) => c.shipmentId));
  assert.equal(unicos.size, CANTIDAD_RAFAGA);
  for (const ciclo of ciclos) {
    assert.ok(['ENTREGADO', 'ENTREGA_FALLIDA'].includes(ciclo.estadoFinal));
  }
});

test('escenarios: el mismo escenario con la misma semilla es idéntico (determinismo)', () => {
  const a = cicloEscenario('tercer-fallo', 99);
  const b = cicloEscenario('tercer-fallo', 99);
  assert.deepEqual(
    a.eventos.map((e) => ({ ...e, eventId: undefined })),
    b.eventos.map((e) => ({ ...e, eventId: undefined })),
  );
});

test('malformado: el mensaje inyectable no es JSON válido y lleva la clave pedida', () => {
  const mensaje = crearMensajeMalformado({ shipmentId: 'ENV-DEMO-9' });
  assert.equal(mensaje.clave, 'ENV-DEMO-9');
  assert.throws(() => JSON.parse(mensaje.valor));
  assert.match(mensaje.valor, /ENV-DEMO-9/);
});
