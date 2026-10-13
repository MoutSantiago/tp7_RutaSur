import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decidirReprogramacion,
  siguienteDiaHabil,
  franjaDe,
  franjaOpuesta,
} from '../src/reglas.js';

test('regla AUSENTE: nuevo intento al día hábil siguiente en la franja opuesta (tarde -> AM)', () => {
  // Fallo un miércoles a las 18:30 (PM) -> jueves 9:00 AM (franja opuesta).
  const decision = decidirReprogramacion({
    motivo: 'AUSENTE',
    intento: 1,
    ocurridoEn: '2026-10-14T18:30:00Z',
  });
  assert.equal(decision.resultado, 'REPROGRAMADO');
  assert.equal(decision.intento, 2);
  assert.equal(decision.franja, 'AM');
  assert.equal(decision.nuevoIntentoEn, '2026-10-15T09:00:00.000Z');
});

test('regla AUSENTE: franja opuesta desde la mañana (AM -> PM)', () => {
  const decision = decidirReprogramacion({
    motivo: 'AUSENTE',
    intento: 1,
    ocurridoEn: '2026-10-14T08:00:00Z',
  });
  assert.equal(decision.franja, 'PM');
  assert.equal(decision.nuevoIntentoEn, '2026-10-15T15:00:00.000Z');
});

test('regla AUSENTE: fallo en viernes se reprograma al lunes (día hábil)', () => {
  // 2026-10-16 es viernes; 17 y 18 son sábado y domingo; el 19 es lunes.
  const decision = decidirReprogramacion({
    motivo: 'AUSENTE',
    intento: 2,
    ocurridoEn: '2026-10-16T20:00:00Z',
  });
  assert.equal(decision.nuevoIntentoEn, '2026-10-19T09:00:00.000Z');

  // Un sábado también salta al lunes.
  assert.equal(
    siguienteDiaHabil(new Date('2026-10-17T10:00:00Z')).toISOString(),
    '2026-10-19T00:00:00.000Z',
  );
});

test('regla AUSENTE: en el tercer intento fallido se devuelve al comercio', () => {
  const decision = decidirReprogramacion({
    motivo: 'AUSENTE',
    intento: 3,
    ocurridoEn: '2026-10-14T18:30:00Z',
  });
  assert.equal(decision.resultado, 'DEVOLUCION');
  assert.equal(decision.nuevoIntentoEn, undefined);
});

test('regla DIRECCION_INCORRECTA: queda retenido y no se reprograma solo', () => {
  const decision = decidirReprogramacion({
    motivo: 'DIRECCION_INCORRECTA',
    intento: 1,
    ocurridoEn: '2026-10-14T10:00:00Z',
  });
  assert.equal(decision.resultado, 'RETENIDO');
  assert.equal(decision.nuevoIntentoEn, undefined);
  assert.equal(decision.franja, undefined);
});

test('regla RECHAZADO: devolución al comercio desde el primer fallo', () => {
  const decision = decidirReprogramacion({
    motivo: 'RECHAZADO',
    intento: 1,
    ocurridoEn: '2026-10-14T10:00:00Z',
  });
  assert.equal(decision.resultado, 'DEVOLUCION');
});

test('regla del tercer fallo: cualquier motivo va a devolución', () => {
  for (const motivo of ['AUSENTE', 'DIRECCION_INCORRECTA', 'RECHAZADO', 'ZONA_INACCESIBLE']) {
    const decision = decidirReprogramacion({
      motivo,
      intento: 3,
      ocurridoEn: '2026-10-14T10:00:00Z',
    });
    assert.equal(decision.resultado, 'DEVOLUCION', `${motivo} en tercer intento`);
  }
});

test('regla ZONA_INACCESIBLE: se retiene para revisión operativa', () => {
  const decision = decidirReprogramacion({
    motivo: 'ZONA_INACCESIBLE',
    intento: 1,
    ocurridoEn: '2026-10-14T10:00:00Z',
  });
  assert.equal(decision.resultado, 'RETENIDO');
});

test('franja: utilidades franjaDe y franjaOpuesta', () => {
  assert.equal(franjaDe(new Date('2026-10-14T12:59:00Z')), 'AM');
  assert.equal(franjaDe(new Date('2026-10-14T13:00:00Z')), 'PM');
  assert.equal(franjaOpuesta('AM'), 'PM');
  assert.equal(franjaOpuesta('PM'), 'AM');
});

test('reglas: motivo desconocido o datos faltantes lanzan error', () => {
  assert.throws(
    () => decidirReprogramacion({ motivo: 'EXTRANO', intento: 1, ocurridoEn: new Date() }),
    /desconocido/,
  );
  assert.throws(
    () =>
      decidirReprogramacion(
        /** @type {{motivo: string, intento: number, ocurridoEn: Date}} */ ({
          motivo: '',
          intento: 1,
          ocurridoEn: new Date(),
        }),
      ),
    /requieren/,
  );
});
