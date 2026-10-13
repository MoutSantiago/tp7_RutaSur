import test from 'node:test';
import assert from 'node:assert/strict';
import { crearEventoEstado } from '@rutasur/shared';
import { decidirAviso, CANAL_POR_DEFECTO } from '../src/avisos.js';

const DIMS = { shipmentId: 'ENV-000001', hubId: 'HUB-1', zonaId: 'ZONA-SUR', repartidorId: 'REP-1' };

/**
 * Crea un evento de estado para la prueba.
 * @param {string} tipo Tipo de estado.
 * @param {object} [extra] Campos extra del evento.
 * @returns {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} Evento creado.
 */
function eventoEstado(tipo, extra = {}) {
  return crearEventoEstado({ ...DIMS, secuencia: 1, tipo, ...extra });
}

test('avisos: ante ENTREGA_FALLIDA genera un aviso con motivo e intento', () => {
  const evento = eventoEstado('ENTREGA_FALLIDA', { motivo: 'AUSENTE', intento: 2 });
  const aviso = decidirAviso(evento);

  assert.ok(aviso);
  assert.equal(aviso.canal, CANAL_POR_DEFECTO);
  assert.match(aviso.asunto, /intento 2/);
  assert.match(aviso.cuerpo, /no encontramos a nadie/i);
  assert.match(aviso.cuerpo, /ENV-000001/);
});

test('avisos: cada motivo tiene su texto', () => {
  const textos = {
    DIRECCION_INCORRECTA: /dirección de entrega parece incorrecta/i,
    RECHAZADO: /rechazado/i,
    ZONA_INACCESIBLE: /zona de entrega/i,
  };
  for (const [motivo, esperado] of Object.entries(textos)) {
    const aviso = decidirAviso(eventoEstado('ENTREGA_FALLIDA', { motivo, intento: 1 }));
    assert.ok(aviso);
    assert.match(aviso.cuerpo, esperado, `motivo ${motivo}`);
  }
});

test('avisos: estados que no son fallo no generan aviso', () => {
  for (const tipo of ['CREADO', 'INGRESADO_HUB', 'CLASIFICADO', 'EN_REPARTO', 'ENTREGADO']) {
    assert.equal(decidirAviso(eventoEstado(tipo)), null, `tipo ${tipo}`);
  }
});
