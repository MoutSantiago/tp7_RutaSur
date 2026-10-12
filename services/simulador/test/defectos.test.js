import test from 'node:test';
import assert from 'node:assert/strict';
import { crearPrng } from '../src/prng.js';
import { planificarPublicaciones } from '../src/defectos.js';
import { crearEventoEstado } from '@rutasur/shared';

const DIMENSIONES = { hubId: 'HUB-1', zonaId: 'ZONA-1', repartidorId: 'REP-1' };

/**
 * Crea N eventos de estado consecutivos del mismo envío.
 * @param {number} n Cantidad de eventos.
 * @returns {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado[]} Eventos generados.
 */
function crearEventos(n) {
  const tipos = ['CREADO', 'INGRESADO_HUB', 'CLASIFICADO', 'EN_REPARTO', 'ENTREGADO'];
  return Array.from({ length: n }, (_, i) =>
    crearEventoEstado({
      shipmentId: 'ENV-0001',
      secuencia: i + 1,
      tipo: tipos[i],
      ...DIMENSIONES,
    }),
  );
}

test('defectos: con probabilidades en cero el plan es idéntico a la entrada', () => {
  const prng = crearPrng(1);
  const eventos = crearEventos(5);
  const plan = planificarPublicaciones({
    prng,
    probabilidades: { duplicado: 0, fueraDeOrden: 0, malformado: 0 },
    eventos,
  });
  assert.deepEqual(
    plan.map((p) => p.valor),
    eventos,
  );
});

test('defectos: con duplicado=1 cada mensaje se publica dos veces', () => {
  const plan = planificarPublicaciones({
    prng: crearPrng(1),
    probabilidades: { duplicado: 1, fueraDeOrden: 0, malformado: 0 },
    eventos: crearEventos(3),
  });
  assert.equal(plan.length, 6);
  for (let i = 0; i < plan.length; i += 2) {
    assert.deepEqual(plan[i].valor, plan[i + 1].valor);
    assert.equal(plan[i + 1].paraQue, 'duplicado');
  }
});

test('defectos: fuera de orden invierte dos eventos consecutivos con probabilidad 1', () => {
  const eventos = crearEventos(5);
  const plan = planificarPublicaciones({
    prng: crearPrng(1),
    probabilidades: { duplicado: 0, fueraDeOrden: 1, malformado: 0 },
    eventos,
  });
  const secuencias = plan.map(
    (p) => /** @type {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} */ (p.valor)
      .secuencia,
  );
  assert.equal(secuencias.length, 5);
  assert.notDeepEqual(secuencias, [1, 2, 3, 4, 5]);
  assert.deepEqual([...secuencias].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  // exactamente un par adyacente invertido
  let inversiones = 0;
  for (let i = 0; i < secuencias.length - 1; i++) {
    if (secuencias[i] === secuencias[i + 1] + 1) inversiones += 1;
  }
  assert.equal(inversiones, 1);
});

test('defectos: con malformado=1 todos los mensajes son cadenas inválidas', () => {
  const plan = planificarPublicaciones({
    prng: crearPrng(1),
    probabilidades: { duplicado: 0, fueraDeOrden: 0, malformado: 1 },
    eventos: crearEventos(3),
  });
  assert.equal(plan.length, 3);
  for (const p of plan) {
    assert.equal(typeof p.valor, 'string');
    assert.equal(p.paraQue, 'malformado');
    assert.throws(() => JSON.parse(/** @type {string} */ (p.valor)));
  }
});

test('defectos: misma semilla produce el mismo plan (determinismo)', () => {
  const eventos = crearEventos(5);
  const opciones = { probabilidades: { duplicado: 0.5, fueraDeOrden: 0.5, malformado: 0.2 } };
  const a = planificarPublicaciones({ prng: crearPrng(77), ...opciones, eventos });
  const b = planificarPublicaciones({ prng: crearPrng(77), ...opciones, eventos });
  assert.deepEqual(a, b);
});
