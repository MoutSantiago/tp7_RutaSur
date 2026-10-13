import PanelDemo from '../components/PanelDemo.jsx';

export const dynamic = 'force-dynamic';

/**
 * Panel de demo: botones que disparan los escenarios del simulador a través
 * del route handler del servidor (el navegador no llama al simulador).
 * @returns {import('react').ReactElement} Página del panel de demo.
 */
export default function PaginaDemo() {
  return <PanelDemo />;
}
