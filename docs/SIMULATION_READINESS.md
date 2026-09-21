# Preparación para la primera prueba con API key

Estado: preparada para una prueba paper supervisada. No existe una promesa de beneficio ni habilitación de trading real.

## Evidencia

- Regresiones automáticas del motor y módulos auxiliares: contabilidad, cierres parciales, comisiones/slippage, reservas, cancelación, pausa/kill, datos obsoletos, stop al precio disponible, migración, reinicio e integridad.
- Prueba LLM completa con transporte simulado: preflight → petición Chat Completions → validación JSON/semántica → consenso → riesgo → orden paper → fill → ledger. Incluye BUY, HOLD, error 401, respuesta inválida y presupuesto agotado.
- Electron probado con perfil temporal y datos públicos reales: compra virtual y venta con entradas pausadas; posiciones cerradas y ledger íntegro. Se revisan Terminal, Agentes, Investigación y Configuración; no hay errores del renderer ni desbordamiento horizontal global a 1440 y 1100 px.
- Capturas y resultado de la última ejecución en `artifacts/terminal.png`, `artifacts/terminal-compact.png` y `artifacts/smoke-result.json`.
- Portable generado desde los fuentes actuales, con hashes en `build-info.json`; las compilaciones anteriores permanecen disponibles.

## Lo que requiere tu clave

Confirmar autenticación, saldo/cuota, acceso al modelo y una respuesta real del proveedor. Las pruebas anteriores no gastan tokens de una cuenta real y no pueden certificar esos requisitos. Introduce la clave en Configuración y ejecuta primero un análisis manual. BUY/SELL son intenciones sujetas a riesgo; HOLD es un resultado válido.

## Límites conocidos

La vigilancia requiere app/equipo/conexión activos. El fallback REST puede perder movimientos entre consultas. La liquidez es simulada y no reproduce prioridad de cola. La rentabilidad necesita evaluación prospectiva, comparación con benchmarks y costes verificados. Sandbox/live y la ampliación de mercados siguen fuera de esta entrega de simulación.

Consulta `SIMULATION_GUIDE.md` para los controles y el procedimiento de prueba.
