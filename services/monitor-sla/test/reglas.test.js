import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluarEnvio,
  actualizarConEvento,
  HORA_MS,
  UMBRALES_HORAS,
} from '../src/reglas.js';
import { crearEventoEstado } from '@rutasur/shared';

const BASE = Date.parse('2026-10-14T10:00:00Z');

/**
 * Crea el estado interno de prueba de un envío.
 * @param {Partial<import('../src/reglas.js').EnvioMonitoreado>} overrides Sobrescrituras.
 * @returns {import('../src/reglas.js').EnvioMonitoreado} Envío monitoreado.
 */
function envioEn(overrides = {}) {
  return {
    shipmentId: 'ENV-000001',
    ultimoEstado: 'CREADO',
    venceEnMs: BASE + 24 * HORA_MS,
    ultimaSecuencia: 1,
    ultimoFalloEnMs: null,
    entregado: false,
    reglasAlertadas: [],
    hubId: 'HUB-1',
    zonaId: 'ZONA-SUR',
    repartidorId: 'REP-1',
    ...overrides,
  };
}

test('SIN_INGRESO: falta menos de 10 h y no ingresó al hub', () => {
  const ahora = BASE + (24 - 10) * HORA_MS + 1; // faltan 9:59:59
  const alertas = evaluarEnvio(envioEn(), ahora);
  assert.deepEqual(alertas, [{ regla: 'SIN_INGRESO', prioridad: 'MEDIA' }]);
});

test('SIN_INGRESO (borde): a exactamente 10 h del vencimiento NO alerta', () => {
  const ahora = BASE + (24 - UMBRALES_HORAS.SIN_INGRESO) * HORA_MS; // faltan exactamente 10 h
  const alertas = evaluarEnvio(envioEn(), ahora);
  assert.deepEqual(alertas, []);
});

test('SIN_INGRESO: si ya ingresó al hub no alerta', () => {
  const ahora = BASE + (24 - 9) * HORA_MS;
  const alertas = evaluarEnvio(envioEn({ ultimoEstado: 'INGRESADO_HUB' }), ahora);
  assert.deepEqual(alertas, []);
});

test('SIN_SALIDA: falta menos de 4 h y no está en reparto', () => {
  const ahora = BASE + (24 - 4) * HORA_MS + 1; // faltan 3:59:59
  const alertas = evaluarEnvio(envioEn({ ultimoEstado: 'INGRESADO_HUB' }), ahora);
  assert.deepEqual(alertas, [{ regla: 'SIN_SALIDA', prioridad: 'ALTA' }]);
});

test('SIN_SALIDA (borde): a exactamente 4 h no alerta; en reparto tampoco', () => {
  const justo4h = BASE + (24 - UMBRALES_HORAS.SIN_SALIDA) * HORA_MS;
  assert.deepEqual(
    evaluarEnvio(envioEn({ ultimoEstado: 'CLASIFICADO' }), justo4h),
    [],
    '4 h exactas no es "menos de 4 h"',
  );
  const dentroDelUmbral = justo4h + 1;
  assert.deepEqual(
    evaluarEnvio(envioEn({ ultimoEstado: 'EN_REPARTO' }), dentroDelUmbral),
    [],
    'en reparto no alerta',
  );
});

test('FALLO_DIA_LIMITE: ENTREGA_FALLIDA el mismo día del vencimiento', () => {
  const venceEnMs = BASE + 24 * HORA_MS; // 2026-10-15T10:00:00Z
  const falloEnMs = Date.parse('2026-10-15T09:00:00Z'); // mismo día UTC
  const envio = envioEn({
    ultimoEstado: 'ENTREGA_FALLIDA',
    ultimoFalloEnMs: falloEnMs,
    venceEnMs,
  });
  const alertas = evaluarEnvio(envio, falloEnMs);
  assert.deepEqual(alertas, [{ regla: 'FALLO_DIA_LIMITE', prioridad: 'ALTA' }]);
});

test('FALLO_DIA_LIMITE: un fallo el día anterior al vencimiento no alerta', () => {
  const venceEnMs = BASE + 48 * HORA_MS;
  const envio = envioEn({
    ultimoEstado: 'ENTREGA_FALLIDA',
    ultimoFalloEnMs: BASE + 20 * HORA_MS,
    venceEnMs,
  });
  assert.deepEqual(evaluarEnvio(envio, BASE + 21 * HORA_MS), []);
});

test('VENCIDO: pasó el vencimiento sin ENTREGADO es crítica', () => {
  const venceEnMs = BASE + 24 * HORA_MS;
  const envio = envioEn({ ultimoEstado: 'EN_REPARTO', venceEnMs });
  assert.deepEqual(evaluarEnvio(envio, venceEnMs + 1), [
    { regla: 'VENCIDO', prioridad: 'CRITICA' },
  ]);
});

test('VENCIDO (borde): en el instante exacto del vencimiento aún no está vencido', () => {
  const venceEnMs = BASE + 24 * HORA_MS;
  const envio = envioEn({ ultimoEstado: 'EN_REPARTO', venceEnMs });
  assert.deepEqual(evaluarEnvio(envio, venceEnMs), []);
});

test('la misma regla no alerta dos veces sobre el mismo envío', () => {
  const ahora = BASE + (24 - 9) * HORA_MS;
  const envio = envioEn();
  const primera = evaluarEnvio(envio, ahora);
  assert.deepEqual(
    primera.map((a) => a.regla),
    ['SIN_INGRESO'],
  );
  envio.reglasAlertadas.push(...primera.map((a) => a.regla));

  // SIN_INGRESO nunca vuelve a aparecer, ni dentro del umbral ni ya vencido.
  for (const momento of [ahora + 1000, ahora + 5 * HORA_MS, ahora + 12 * HORA_MS]) {
    const alertas = evaluarEnvio(envio, momento);
    assert.ok(
      !alertas.some((a) => a.regla === 'SIN_INGRESO'),
      `SIN_INGRESO se repitió en ${momento}`,
    );
    envio.reglasAlertadas.push(...alertas.map((a) => a.regla));
  }
  // Vencido también alerta una única vez.
  const vencido = evaluarEnvio(envio, /** @type {number} */ (envio.venceEnMs) + HORA_MS);
  assert.ok(vencido.every((a) => a.regla !== 'SIN_INGRESO'));
});

test('un envío entregado nunca alerta (ni vencido)', () => {
  const venceEnMs = BASE + 24 * HORA_MS;
  const envio = envioEn({ entregado: true, ultimoEstado: 'ENTREGADO', venceEnMs });
  assert.deepEqual(evaluarEnvio(envio, venceEnMs + 48 * HORA_MS), []);
});

test('sin vencimiento conocido el envío queda inerte', () => {
  assert.deepEqual(evaluarEnvio(envioEn({ venceEnMs: null }), BASE + 100 * HORA_MS), []);
});

test('actualizarConEvento: registra estado, secuencia y fallos sin mutar el original', () => {
  const original = envioEn();
  const evento = crearEventoEstado({
    shipmentId: 'ENV-000001',
    secuencia: 5,
    tipo: 'ENTREGA_FALLIDA',
    motivo: 'AUSENTE',
    intento: 1,
    ocurridoEn: '2026-10-15T09:00:00Z',
    hubId: 'HUB-1',
    zonaId: 'ZONA-SUR',
    repartidorId: 'REP-1',
  });
  const actualizado = actualizarConEvento(original, evento);
  assert.equal(actualizado.ultimoEstado, 'ENTREGA_FALLIDA');
  assert.equal(actualizado.ultimaSecuencia, 5);
  assert.equal(actualizado.ultimoFalloEnMs, Date.parse('2026-10-15T09:00:00Z'));
  assert.equal(actualizado.entregado, false);
  assert.equal(original.ultimoEstado, 'CREADO', 'el original no se mutó');
});
