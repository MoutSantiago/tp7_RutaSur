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
