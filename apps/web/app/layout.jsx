import './globals.css';

export const metadata = {
  title: 'RutaSur — Torre de control',
  description: 'Seguimiento de envíos en tiempo real de RutaSur',
};

/**
 * Layout raíz de la interfaz de RutaSur.
 * @param {object} props Props del layout.
 * @param {import('react').ReactNode} props.children Contenido de la página.
 * @returns {import('react').ReactElement} Documento HTML de la app.
 */
export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        <header className="cabecera">
          <h1>
            RutaSur <small>torre de control</small>
          </h1>
          <nav>
            <a href="/">Torre de control</a> · <a href="/tracking/ENV-000001">Tracking</a> ·{' '}
            <a href="/analitica">Analítica</a> · <a href="/demo">Demo</a>
          </nav>
        </header>
        <main className="contenido">{children}</main>
      </body>
    </html>
  );
}
