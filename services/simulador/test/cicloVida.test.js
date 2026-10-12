import test from 'node:test';
import assert from 'node:assert/strict';
import { crearPrng } from '../src/prng.js';
import { generarCicloDeVida, MAX_INTENTOS } from '../src/cicloVida.js';
import { cargarConfigSimulador } from '../src/config.js';

/** Configuración pura de prueba basada en los defaults. */
const config = cargarConfigSimulador({ env: {} });
const INICIO = Date.parse('2026-10-12T09:00:00Z');

/**
 * Genera el ciclo de vida del envío número `n` con la semilla dada.
 * @param {number} semilla Semilla del PRNG.
 * @param {number} n Número correlativo del envío.
 * @returns {import('../src/cicloVida.js').CicloDeVida} Ciclo generado.
 */
function cicloDe(semilla, n) {
  return generarCicloDeVida({
    prng: crearPrng(semilla),
    config,
    shipmentId: `ENV-${String(n).padStart(6, '0')}`,
    inicioMs: INICIO,
  });
}

test('determinismo: la misma semilla produce exactamente la misma secuencia de eventos', () => {
  const a = cicloDe(42, 1);
  const b = cicloDe(42, 1);
  assert.deepEqual(
    a.eventos.map((e) => ({ ...e, eventId: undefined })),
    b.eventos.map((e) => ({ ...e, eventId: undefined })),
  );
  assert.equal(a.promesa.venceEn, b.promesa.venceEn);

  const c = cicloDe(7, 1);
  assert.notDeepEqual(
    a.eventos.map((e) => ({ ...e, eventId: undefined })),
    c.eventos.map((e) => ({ ...e, eventId: undefined })),
  );
});

test('ciclo de vida: la secuencia por envío es estrictamente creciente y los tiempos no retroceden', () => {
  for (let semilla = 1; semilla <= 200; semilla++) {
    const ciclo = cicloDe(semilla, 1);
    const todos = [ciclo.promesa, ...ciclo.eventos];
    for (let i = 1; i < todos.length; i++) {
      assert.ok(
        todos[i].secuencia > todos[i - 1].secuencia,
        `semilla ${semilla}: secuencia ${todos[i - 1].secuencia} -> ${todos[i].secuencia}`,
      );
    }
    for (let i = 1; i < ciclo.eventos.length; i++) {
      assert.ok(
        Date.parse(ciclo.eventos[i].ocurridoEn) >= Date.parse(ciclo.eventos[i - 1].ocurridoEn),
        `semilla ${semilla}: el tiempo simulado retrocedió`,
      );
    }
  }
});

test('ciclo de vida: el flujo comienza en CREADO y termina en ENTREGADO o ENTREGA_FALLIDA', () => {
  for (let semilla = 1; semilla <= 100; semilla++) {
    const ciclo = cicloDe(semilla, 1);
    assert.equal(ciclo.eventos[0].tipo, 'CREADO');
    assert.ok(['ENTREGADO', 'ENTREGA_FALLIDA'].includes(ciclo.estadoFinal));
    assert.equal(ciclo.eventos[ciclo.eventos.length - 1].tipo, ciclo.estadoFinal);
    assert.ok(ciclo.intentos >= 1 && ciclo.intentos <= MAX_INTENTOS);
  }
});

test('ciclo de vida: solo AUSENTE reintenta y el intento incrementa; los demás motivos terminan', () => {
  for (let semilla = 1; semilla <= 500; semilla++) {
    const ciclo = cicloDe(semilla, 1);
    const fallidos = ciclo.eventos.filter((e) => e.tipo === 'ENTREGA_FALLIDA');
    for (let i = 0; i < fallidos.length - 1; i++) {
      assert.equal(
        fallidos[i].motivo,
        'AUSENTE',
        'solo un fallo por AUSENTE puede ser seguido de otro intento',
      );
      assert.equal(fallidos[i + 1].intento, (fallidos[i].intento ?? 0) + 1);
    }
    assert.ok(ciclo.intentos <= MAX_INTENTOS);
  }
});

test('distribuciones: tasas de fallo por zona cercanas a las configuradas (muestra grande)', () => {
  const prng = crearPrng(2026);
  const N = 15000;
  const totales = Object.fromEntries(config.zonas.map((z) => [z.zonaId, 0]));
  const fallosPrimerIntento = Object.fromEntries(config.zonas.map((z) => [z.zonaId, 0]));

  for (let i = 0; i < N; i++) {
    const ciclo = generarCicloDeVida({
      prng,
      config,
      shipmentId: `ENV-${i}`,
      inicioMs: INICIO,
    });
    totales[ciclo.zonaId] += 1;
    const falloPrimero = ciclo.eventos.some(
      (e) => e.tipo === 'ENTREGA_FALLIDA' && e.intento === 1,
    );
    if (falloPrimero) fallosPrimerIntento[ciclo.zonaId] += 1;
  }

  for (const zona of config.zonas) {
    const tasaObservada = fallosPrimerIntento[zona.zonaId] / totales[zona.zonaId];
    const tasaEsperada = zona.tasaFallo;
    assert.ok(
      Math.abs(tasaObservada - tasaEsperada) < 0.02,
      `${zona.zonaId}: observada ${tasaObservada.toFixed(3)} vs esperada ${tasaEsperada}`,
    );
  }
});

test('distribuciones: motivos de fallo cercanos a 60/20/15/5 (muestra grande)', () => {
  const prng = crearPrng(999);
  /** @type {Record<string, number>} */
  const conteo = { AUSENTE: 0, DIRECCION_INCORRECTA: 0, RECHAZADO: 0, ZONA_INACCESIBLE: 0 };
  /** @type {Record<string, number>} */
  const esperado = { AUSENTE: 0.6, DIRECCION_INCORRECTA: 0.2, RECHAZADO: 0.15, ZONA_INACCESIBLE: 0.05 };
  const N = 20000;
  let totalFallos = 0;
  for (let i = 0; i < N; i++) {
    const ciclo = generarCicloDeVida({ prng, config, shipmentId: `ENV-${i}`, inicioMs: INICIO });
    for (const evento of ciclo.eventos) {
      if (evento.tipo === 'ENTREGA_FALLIDA' && evento.motivo) {
        conteo[evento.motivo] += 1;
        totalFallos += 1;
      }
    }
  }
  for (const motivo of Object.keys(esperado)) {
    const observada = conteo[motivo] / totalFallos;
    assert.ok(
      Math.abs(observada - esperado[motivo]) < 0.02,
      `${motivo}: observada ${observada.toFixed(3)} vs esperada ${esperado[motivo]}`,
    );
  }
});
