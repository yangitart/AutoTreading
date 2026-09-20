# LLM Trader — instrucciones del proyecto

## Objetivo

Aplicación de escritorio Electron para analizar mercados con LLMs y probar estrategias en paper trading con precios de mercado en tiempo real.

El alcance y las prioridades están en docs/PRODUCT_SCOPE.md. Priorizar contabilidad, ejecución realista, costes y evaluación frente a ampliar estrategias. Distinguir explícitamente módulos implementados y arquitectura futura. Simulación y paper son el mismo workspace.

El alcance completo de la plataforma está en docs/PLATFORM_PLAN.md. Usarlo para no olvidar módulos de una plataforma de trading: mercado, instrumentos, gráficos, OMS, ledger, riesgo, estrategias, métricas, agentes, automatización, seguridad y operación.

La lista operativa está en docs/TODO.md. Marcar una tarea con [x] solo después de implementar y verificar sus criterios; mantener la lista ordenada por prioridad. La prioridad actual es la simulación. Las secciones EN ESPERA no se deben iniciar mientras queden tareas críticas de simulación pendientes, salvo instrucción explícita del usuario.

El alcance y las prioridades están en `docs/PRODUCT_SCOPE.md`. Priorizar contabilidad, ejecución realista, costes y evaluación frente a ampliar estrategias. Distinguir explícitamente módulos implementados y arquitectura futura. Simulación y paper son el mismo workspace.

## Alcance actual

- El modo permitido por defecto es `paper`.
- El capital inicial debe ser configurable; `$100` es el valor de prueba por defecto.
- El paper broker debe actualizar el valor de las posiciones con el mercado, registrar comisiones y slippage, y conservar un historial auditable.
- El modo live no debe enviar órdenes reales hasta que exista un adaptador de broker separado, permisos explícitos, límites pre-trade, reconciliación y kill switch.

## Arquitectura

- `src/main/`: proceso principal, IPC, secretos, datos de mercado y broker.
- `src/renderer/`: interfaz visual; no usar Node.js ni secretos directamente.
- `docs/`: decisiones de arquitectura y criterios de evaluación.
- El LLM devuelve una intención estructurada. El motor de riesgo valida tamaño, saldo, exposición y drawdown antes de que un broker ejecute.
- Nunca mezclar la API key del LLM con credenciales de exchanges o brokers.

## Producto y UX

- La pantalla inicial es un dashboard de trading, no una pantalla de configuración.
- Debe mostrar de un vistazo: equity, P&L, drawdown, curva de equity, rendimiento diario, exposición, posiciones, órdenes y último análisis.
- La estética debe ser de terminal financiero moderno: jerarquía visual clara, densidad útil, gráficos legibles, estados de mercado visibles y sin emojis como iconos principales.
- El tiempo real debe verse en precio, equity y P&L; no depender solo de un botón de refrescar.
- Toda ejecución paper automática debe tener un modo claramente etiquetado y poder pausarse.

## Seguridad

- Mantener `contextIsolation: true` y `nodeIntegration: false`.
- Exponer por preload solo operaciones IPC concretas y validadas.
- No imprimir ni devolver API keys al renderer.
- Rechazar símbolos, cantidades, precios y órdenes inválidas antes de persistirlas.

## Verificación

- Ejecutar `node --check` sobre los archivos JavaScript modificados.
- Ejecutar `npm start` para comprobar el arranque de Electron.
- No presentar un instalador viejo como resultado de una compilación nueva.
