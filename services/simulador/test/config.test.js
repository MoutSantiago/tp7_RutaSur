import test from 'node:test';
import assert from 'node:assert/strict';
import { cargarConfigSimulador } from '../src/config.js';
import { FACTOR_ACELERACION_POR_DEFECTO } from '../src/reloj.js';

test('config del simulador: valores por defecto según la especificación', () => {
  const config = cargarConfigSimulador({ env: {} });
  assert.equal(config.enviosPorMinuto, 20);
  assert.equal(config.factorAceleracion, FACTOR_ACELERACION_POR_DEFECTO);
  assert.equal(config.semilla, 42);
  assert.equal(config.zonas.length, 3);
  assert.deepEqual(
    config.zonas.map((z) => z.tasaFallo),
    [0.05, 0.15, 0.3],
  );
  assert.deepEqual(config.hubs, ['HUB-1', 'HUB-2', 'HUB-3']);
  assert.equal(config.probabilidadDemoraHub, 0.1);
  assert.equal(config.probabilidades.duplicado, 0.02);
  assert.equal(config.probabilidades.fueraDeOrden, 0.02);
  assert.equal(config.probabilidades.malformado, 0.01);
});

test('config del simulador: la tasa de fallo por zona es configurable por entorno', () => {
  const config = cargarConfigSimulador({ env: { SIM_FALLO_SUR: '0.5' } });
  const sur = config.zonas.find((z) => z.zonaId === 'ZONA-SUR');
  assert.equal(sur?.tasaFallo, 0.5);
});

test('config del simulador: rechaza valores fuera de rango', () => {
  assert.throws(
    () => cargarConfigSimulador({ env: { SIM_DUPLICADO: '1.5' } }),
    /SIM_DUPLICADO/,
  );
});
