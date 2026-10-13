'use client';

import { useState } from 'react';
import { ESCENARIOS_DEMO } from '../../lib/simulador.js';

/** @readonly etiquetas visibles de las acciones del panel. */
const ETIQUETAS = Object.freeze(
  /** @type {Record<string, string>} */ ({
    feliz: 'Envío feliz',
    ausente: 'Ausente (falla y se reprograma)',
    demorado: 'Demorado (alerta de SLA)',
    'tercer-fallo': 'Tercer fallo (devolución)',
    rafaga: 'Ráfaga de 500 envíos',
    malformado: 'Evento malformado (a la DLQ)',
  }),
);

/**
 * Botones del panel de demo. Cada botón hace POST al route handler local
 * (`/api/demo/:accion`), que reenvía a la API del simulador.
 * @returns {import('react').ReactElement} Panel de demo.
 */
export default function PanelDemo() {
  const [resultado, setResultado] = useState(/** @type {Record<string, unknown> | null} */ (null));
  const [cargando, setCargando] = useState(false);

  /**
   * Dispara una acción del simulador vía el route handler.
   * @param {string} accion Nombre de la acción.
   * @returns {Promise<void>}
   */
  async function disparar(accion) {
    setCargando(true);
    try {
      const respuesta = await fetch(`/api/demo/${accion}`, { method: 'POST' });
      setResultado(await respuesta.json());
    } catch (error) {
      setResultado({ ok: false, error: String(error) });
    } finally {
      setCargando(false);
    }
  }

  return (
    <section className="panel">
      <h2>Panel de demo</h2>
      <p>Disparadores de escenarios del simulador (los resultados se ven en la torre de control).</p>
      <div className="contadores">
        {[...ESCENARIOS_DEMO, 'malformado'].map((accion) => (
          <button
            key={accion}
            onClick={() => void disparar(accion)}
            disabled={cargando}
            className="boton-demo"
          >
            {ETIQUETAS[accion] ?? accion}
          </button>
        ))}
      </div>
      {resultado && (
        <p>
          <code>{JSON.stringify(resultado)}</code>
        </p>
      )}
    </section>
  );
}
