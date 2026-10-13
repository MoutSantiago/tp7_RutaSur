# Decisiones de diseño — RutaSur

Registro de decisiones técnicas del proyecto. Cada entrada sigue el formato
**Decisión / Motivo / Alternativa descartada**. Las decisiones de alto nivel de la
especificación están en `docs/spec.md`; aquí se registran las que surjan durante la
implementación.

---

## Formato

```
### <fecha> — <título breve>

- **Decisión:** qué se decidió.
- **Motivo:** por qué.
- **Alternativa descartada:** qué se evaluó y por qué no.
```

---

## Registro

<!-- Agregar decisiones aquí siguiendo el formato. -->

### 2026-10-13 — Cuarto indicador: día del EN_REPARTO, solo primer intento

- **Decisión:** el tiempo medio en hub se imputa al documento diario del día/zona/
  franja del evento `EN_REPARTO`, solo del primer intento, y se guarda como
  `porHub.<hub>.tiempoHubSumaMs` + `tiempoHubCantidad`.
- **Motivo:** el primer paso por el hub es el comparable entre envíos (los
  reintentos empiezan desde "día hábil siguiente"); la suma y la cantidad permiten
  recomputar el promedio incrementalmente al leer sin recalcular nada.
- **Alternativa descartada:** imputar al día del INGRESADO_HUB: dividía casos
  límite (ingreso 23:50, salida 00:10) entre dos documentos; guardar el promedio
  directo: no es agregable incrementalmente.

### 2026-10-13 — Replay como grupo nuevo sobre el log retenido

- **Decisión:** el cuarto indicador se habilita con `scripts/replay-tiempos-hub.js`,
  que crea el grupo `analitica-tiempos-hub` leyendo `envios.estados` desde el
  inicio, reporta progreso/lag y termina al agotar el histórico.
- **Motivo:** demuestra que los topics compactados/con retención de 30 días sostienen
  reprocesar vistas sin reiniciar los consumidores productivos; como cada evento se
  marca en `eventos_procesados` de ese grupo, relanzar el script no duplica sumas.
- **Alternativa descartada:** job batch leyendo con `fetch` manual y apagando el
  consumo: desaprovecha la propiedad clave de Kafka (offsets por grupo) que evalúa
  el casos de uso 4.

### 2026-10-13 — Escenarios del simulador responden sin bloquear

- **Decisión:** `POST /escenarios/:nombre` genera de inmediato los ciclos y responde;
  la publicación de sus eventos corre en segundo plano (la ráfaga publica sin esperas).
- **Motivo:** el panel de demo no puede quedar colgado esperando ciclos que duran
  de segundos a minutos reales según el factor de aceleración.
- **Alternativa descartada:** responder al completar el ciclo: transformaba la llamada
  en una espera larga y escondía el comportamiento asíncrono que la demo quiere mostrar.

### 2026-10-13 — API HTTP de control del simulador solo para la demo

- **Decisión:** el simulador expone una API HTTP mínima (`POST /escenarios/:nombre`,
  `POST /eventos/malformado`, `GET /salud`) para que el panel de demo dispare
  escenarios a pedido.
- **Motivo:** la especificación exige escenarios "disparados a pedido" durante la
  presentación y un canal para inyectar el evento malformado; un endpoint HTTP es lo
  más simple para un panel en Next.js. No viola la regla de la arquitectura porque no
  es comunicación entre servicios de negocio: es un plano de control.
- **Alternativa descartada:** topic Kafka `comandos.demo` para disparar escenarios:
  más "puro" pero exige al panel publicar en Kafka (que la spec prohíbe: "el frontend
  no depende de Kafka").

### 2026-10-13 — Barrido del monitor mapeado al reloj simulado

- **Decisión:** el barrido corre cada `60000 / SIM_FACTOR_ACELERACION` ms reales
  (1 minuto simulado), pero el "ahora" usado para evaluar es el máximo
  `ocurridoEn` visto en los eventos, no el reloj de la máquina.
- **Motivo:** la especificación exige que el tiempo de negocio venga de los
  eventos (factor de aceleración); el intervalo real del temporizador solo es el
  disparador de la evaluación. Si el flujo de eventos se detiene, el tiempo
  simulado se congela y las alertas no avanzan solas.
- **Alternativa descartada:** derivar el ahora simulado de `Date.now() * factor`:
  funcionaría con el flujo continuo, pero rompe la regla de "nunca el reloj de la
  máquina" y haría imposible barridos deterministas en tests.

### 2026-10-13 — Operaciones del monitor serializadas

- **Decisión:** `registrarPromesa`, `registrarEstado` y `barrer` pasan por una
  cadena de promesas (exclusión mutua) dentro del motor.
- **Motivo:** el barrido y el handler de eventos son asíncronos sobre el mismo
  estado en memoria; sin serialización, dos evaluaciones concurrentes del mismo
  envío podían emitir la misma alerta dos veces (detectado en la prueba end-to-end).
- **Alternativa descartada:** lock por envío con Map de promesas: más granular,
  pero innecesario para un único consumidor y más difícil de explicar.

### 2026-10-13 — Analítica consume también `envios.promesas`

- **Decisión:** el servicio de analítica se suscribe además a `envios.promesas` y
  guarda el vencimiento de cada envío en una colección interna `promesas_envios`,
  para evaluar el cumplimiento de SLA cuando llega el `ENTREGADO`.
- **Motivo:** el indicador "cumplimiento de SLA" exige conocer `venceEn`, que no
  viaja en los eventos de `envios.estados`; el catálogo de la spec lista a analítica
  solo sobre estados, lo que haría imposible ese indicador.
- **Alternativa descartada:** leer el vencimiento desde la colección `envios` del
  proyector: acoplaría los servicios por la base cuando la regla de oro es compartir
  solo por Kafka.

### 2026-10-13 — ZONA_INACCESIBLE se retiene, no se reprograma

- **Decisión:** una entrega fallida por `ZONA_INACCESIBLE` pasa a `RETENIDO`, igual que
  `DIRECCION_INCORRECTA`, salvo que sea el tercer intento (devolución).
- **Motivo:** la especificación solo detalla la regla de `AUSENTE` para reintentos;
  una zona inaccesible no se resuelve con un nuevo intento automático al día siguiente.
- **Alternativa descartada:** reprogramarla como `AUSENTE`: contradice el espíritu de
  la regla (solo el "ausente" vuelve al circuito, según el diagrama del CU1).

### 2026-10-13 — Las reprogramaciones no mueven `ultimaSecuencia`

- **Decisión:** en la colección `envios`, la regla de orden por `secuencia` la gobierna
  solo `envios.estados`; las reprogramaciones se registran por `eventId` en el historial
  y actualizan `intentos`/estado derivado.
- **Motivo:** los productores son procesos distintos y no comparten el contador de
  secuencia del envío; usar una secuencia ajena corrompería la detección de desorden.
- **Alternativa descartada:** secuencia global por envío coordinada entre servicios:
  requeriría estado compartido fuera de Kafka, contra la arquitectura del TP.
