import test from 'node:test';
import assert from 'node:assert/strict';
import { TOPICS } from '../src/constantes.js';
import { validarEvento } from '../src/eventos/esquemas.js';
import {
  crearEventoEstado,
  crearEventoPromesa,
  crearEventoReprogramacion,
  crearEventoAlertaSla,
  crearEventoNotificacion,
} from '../src/eventos/fabrica.js';

/** Dimensiones base reutilizables para construir eventos de prueba. */
const DIMENSIONES = { hubId: 'HUB-1', zonaId: 'ZONA-1', repartidorId: 'REP-1' };
const BASE = { shipmentId: 'ENV-0001', secuencia: 1, ...DIMENSIONES };

test('validación: un evento de estado bien formado es válido', () => {
  const evento = crearEventoEstado({ ...BASE, tipo: 'CREADO' });
  const { valido, errores } = validarEvento(TOPICS.ESTADOS, evento);
  assert.equal(valido, true);
  assert.deepEqual(errores, []);
});

test('validación: falta de campos comunes genera errores descriptivos', () => {
  const { valido, errores } = validarEvento(TOPICS.ESTADOS, { tipo: 'CREADO' });
  assert.equal(valido, false);
  assert.ok(errores.some((e) => e.includes('eventId')));
  assert.ok(errores.some((e) => e.includes('shipmentId')));
  assert.ok(errores.some((e) => e.includes('secuencia')));
});

test('validación: un estado fuera del enum es rechazado', () => {
  const evento = crearEventoEstado({ ...BASE, tipo: 'CREADO' });
  evento.tipo = 'TELETRANSPORTADO';
  const { valido } = validarEvento(TOPICS.ESTADOS, evento);
  assert.equal(valido, false);
});

test('validación: un motivo fuera del enum es rechazado', () => {
  const evento = crearEventoEstado({
    ...BASE,
    tipo: 'ENTREGA_FALLIDA',
    motivo: 'AUSENTE',
    intento: 1,
  });
  evento.motivo = 'LLUVIA';
  const { valido } = validarEvento(TOPICS.ESTADOS, evento);
  assert.equal(valido, false);
});

test('validación: secuencia cero o negativa es rechazada', () => {
  const evento = crearEventoEstado({ ...BASE, tipo: 'CREADO' });
  evento.secuencia = 0;
  assert.equal(validarEvento(TOPICS.ESTADOS, evento).valido, false);
});

test('validación: propiedades extra son rechazadas', () => {
  const evento = crearEventoEstado({ ...BASE, tipo: 'CREADO' });
  const conExtra = { ...evento, sorpresa: true };
  const { valido, errores } = validarEvento(TOPICS.ESTADOS, conExtra);
  assert.equal(valido, false);
  assert.ok(errores.some((e) => e.includes('additional')));
});

test('validación: promesa requiere venceEn y franja', () => {
  const { valido } = validarEvento(TOPICS.PROMESAS, {
    ...crearEventoPromesa({ ...BASE, venceEn: '2026-10-20T12:00:00Z', franja: 'AM' }),
  });
  assert.equal(valido, true);

  const { valido: invalido } = validarEvento(TOPICS.PROMESAS, {
    ...BASE,
    tipo: 'PROMESA_DEFINIDA',
    eventId: 'evt-1',
    ocurridoEn: new Date().toISOString(),
    version: 1,
  });
  assert.equal(invalido, false);
});

test('validación: fecha no parseable es rechazada en ocurridoEn', () => {
  const evento = crearEventoEstado({ ...BASE, tipo: 'CREADO' });
  evento.ocurridoEn = 'ayer a la tarde';
  assert.equal(validarEvento(TOPICS.ESTADOS, evento).valido, false);
});

test('validación: reprogramación, alerta y notificación válidas', () => {
  const repro = crearEventoReprogramacion({
    ...BASE,
    resultado: 'REPROGRAMADO',
    motivo: 'AUSENTE',
    intento: 2,
    nuevoIntentoEn: '2026-10-21T13:00:00Z',
    franja: 'PM',
  });
  assert.equal(validarEvento(TOPICS.REPROGRAMACIONES, repro).valido, true);

  const alerta = crearEventoAlertaSla({
    ...BASE,
    regla: 'SIN_SALIDA',
    prioridad: 'ALTA',
    estadoAlerta: 'ABIERTA',
    venceEn: '2026-10-20T18:00:00Z',
  });
  assert.equal(validarEvento(TOPICS.ALERTAS_SLA, alerta).valido, true);

  const notif = crearEventoNotificacion({
    ...BASE,
    canal: 'EMAIL',
    asunto: 'No pudimos entregar tu pedido',
    cuerpo: 'Reprogramá la entrega desde el link.',
    eventoOrigenId: 'evt-origen',
  });
  assert.equal(validarEvento(TOPICS.NOTIFICACIONES, notif).valido, true);
});

test('validación: topic sin esquema registrado lanza error', () => {
  assert.throws(() => validarEvento('topic.inexistente', {}), /esquema/);
});

test('validación: la factoría rechaza construir un evento inválido', () => {
  assert.throws(
    () => crearEventoEstado({ ...BASE, tipo: 'INVENTADO' }),
    /Evento inválido/,
  );
});
