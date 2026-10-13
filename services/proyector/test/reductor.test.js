import test from 'node:test';
import assert from 'node:assert/strict';
import { crearEventoEstado } from '@rutasur/shared';
import { aplicarEventoAEstado, RESULTADOS_REDUCCION } from '../src/reductor.js';

const DIMS = { hubId: 'HUB-1', zonaId: 'ZONA-SUR', repartidorId: 'REP-ZONA-SUR-7' };

/**
 * Crea un evento de estado para la prueba.
 * @param {object} opciones Opciones del evento.
 * @param {number} opciones.secuencia Secuencia del evento.
 * @param {string} opciones.tipo Tipo de estado.
 * @param {string} [opciones.motivo] Motivo de falla, si aplica.
 * @param {number} [opciones.intento] Número de intento, si aplica.
 * @returns {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} Evento creado.
 */
function evento({ secuencia, tipo, motivo, intento }) {
  return crearEventoEstado({
    shipmentId: 'ENV-000001',
    secuencia,
    tipo,
    motivo,
    intento,
    ocurridoEn: new Date(Date.parse('2026-10-12T10:00:00Z') + secuencia * 3600000).toISOString(),
    ...DIMS,
  });
}

/**
 * Aplica un evento exigiendo que sea aceptado y devolviendo el documento.
 * @param {import('../src/reductor.js').DocumentoEnvio | null} doc Documento actual.
 * @param {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} ev Evento a aplicar.
 * @returns {import('../src/reductor.js').DocumentoEnvio} Documento resultante.
 */
function aplicado(doc, ev) {
  const { resultado, documento } = aplicarEventoAEstado(doc, ev);
  assert.equal(resultado, RESULTADOS_REDUCCION.APLICADO);
  assert.ok(documento, 'el documento aplicado no debería ser null');
  return documento;
}

test('orden: el primer evento crea el documento con historial inicial', () => {
  const documento = aplicado(null, evento({ secuencia: 1, tipo: 'CREADO' }));
  assert.equal(documento.estado, 'CREADO');
  assert.equal(documento.ultimaSecuencia, 1);
  assert.equal(documento.historial.length, 1);
  assert.equal(documento.intentos, 0);
  assert.equal(documento.zonaId, 'ZONA-SUR');
});

test('orden: un evento con secuencia igual o menor se descarta y no cambia el estado', () => {
  const creado = aplicado(null, evento({ secuencia: 1, tipo: 'CREADO' }));
  const enReparto = aplicado(creado, evento({ secuencia: 5, tipo: 'EN_REPARTO', intento: 1 }));

  const igual = aplicarEventoAEstado(enReparto, evento({ secuencia: 5, tipo: 'CREADO' }));
  assert.equal(igual.resultado, RESULTADOS_REDUCCION.DESCARTADO_POR_ORDEN);
  assert.equal(igual.documento, null);

  const viejo = aplicarEventoAEstado(enReparto, evento({ secuencia: 2, tipo: 'CREADO' }));
  assert.equal(viejo.resultado, RESULTADOS_REDUCCION.DESCARTADO_POR_ORDEN);

  // el documento original no se mutó
  assert.equal(enReparto.estado, 'EN_REPARTO');
  assert.equal(enReparto.ultimaSecuencia, 5);
});

test('historial: los eventos se acumulan en orden y con motivo/intento', () => {
  let doc = aplicado(null, evento({ secuencia: 1, tipo: 'CREADO' }));
  doc = aplicado(doc, evento({ secuencia: 2, tipo: 'INGRESADO_HUB' }));
  doc = aplicado(doc, evento({ secuencia: 3, tipo: 'ENTREGA_FALLIDA', motivo: 'AUSENTE', intento: 1 }));
  doc = aplicado(doc, evento({ secuencia: 4, tipo: 'ENTREGADO', intento: 2 }));

  assert.equal(doc.historial.length, 4);
  assert.deepEqual(
    doc.historial.map((h) => h.tipo),
    ['CREADO', 'INGRESADO_HUB', 'ENTREGA_FALLIDA', 'ENTREGADO'],
  );
  assert.equal(doc.historial[2].motivo, 'AUSENTE');
  assert.equal(doc.historial[2].intento, 1);
  assert.equal(doc.intentos, 2);
  assert.equal(doc.estado, 'ENTREGADO');
});

test('orden: eventos fuera de orden no hacen retroceder el estado ni agregan historial', () => {
  let doc = aplicado(null, evento({ secuencia: 1, tipo: 'CREADO' }));
  // Llega primero el secuencia 3 y después el 2 (fuera de orden).
  doc = aplicado(doc, evento({ secuencia: 3, tipo: 'CLASIFICADO', intento: 1 }));
  const fueraDeOrden = aplicarEventoAEstado(doc, evento({ secuencia: 2, tipo: 'INGRESADO_HUB' }));

  assert.equal(fueraDeOrden.resultado, RESULTADOS_REDUCCION.DESCARTADO_POR_ORDEN);
  assert.equal(doc.estado, 'CLASIFICADO');
  assert.equal(doc.historial.length, 2);
});

test('reducción: un documento de otro envío provoca error', () => {
  const doc = aplicado(null, evento({ secuencia: 1, tipo: 'CREADO' }));
  const otro = evento({ secuencia: 2, tipo: 'ENTREGADO' });
  otro.shipmentId = 'ENV-999999';
  assert.throws(() => aplicarEventoAEstado(doc, otro), /no corresponde/);
});
