# Usar la simulación

La cuenta inicial contiene 100 USDT virtuales. Los pares BTCUSDT, ETHUSDT y SOLUSDT se valoran en USDT. El mercado público y las órdenes manuales funcionan sin claves de broker ni LLM.

1. Abre el portable de la compilación más reciente, o ejecuta `npm start`.
2. Espera a **Mercado disponible**. `REST · 3 s` indica consultas periódicas reales, no un stream. El fallback funciona aunque el WebSocket no conecte. La edad del bid/ask determina si se permite ejecutar.
3. Selecciona activo y tipo de orden. Los botones de tamaño redondean al lote del instrumento. Comprueba el mínimo nocional, stop, objetivo y costes estimados antes de confirmar.
4. Revisa Posiciones, Órdenes y Rendimiento. **Reducir / cerrar** prepara una venta para revisar; **Cancelar** libera la reserva de una orden pendiente.
5. **Pausar entradas** bloquea compras y detiene Auto-Paper; las ventas y las protecciones siguen permitidas con precio fresco. **Detener todo** también cancela órdenes pendientes. **Reanudar entradas** conserva la sesión y exige una nueva activación de los agentes.
6. **Verificar cuenta** contrasta efectivo, reservas, coste de activos, comisiones y P&L con el ledger. Exporta JSON para conservar estado/configuración y CSV para revisar equity y fills.

## Auto-Paper y coste de API

Configura endpoint, modelo disponible en tu proveedor y su API key. Las tarifas introducidas son estimaciones configurables: compruébalas con tu proveedor. Iniciar agentes abre la revisión de parámetros y ejecuta el preflight. El flujo se detiene si faltan clave, presupuesto, mercado o requisitos contables.

Para la primera prueba: endpoint `https://api.openai.com/v1`, modelo `gpt-5.6-luna`, un solo símbolo `BTCUSDT` y primero **Analizar mercado**. Esta acción consulta al LLM pero no envía una orden automáticamente. Revisa la respuesta y después activa **Iniciar agentes** si deseas Auto-Paper. Guarda la clave únicamente en Configuración, no en archivos del proyecto ni en conversaciones.

Compatibilidad y precios base de Luna contrastados con [OpenAI Docs](https://developers.openai.com/api/docs/models/gpt-5.6-luna): Chat Completions y razonamiento `low`; entrada 0.20 USD y salida 1.20 USD por millón de tokens. La tarifa configurada es por 1000 tokens (0.0002 / 0.0012). El [límite `max_completion_tokens`](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) incluye salida visible y razonamiento; una respuesta truncada se rechaza. El acceso efectivo depende de la cuenta del proveedor.

Una pausa invalida respuestas pendientes: un resultado tardío no puede abrir una posición. El análisis usa indicadores calculados localmente y 60 velas de contexto; la salida tiene un máximo de 1600 tokens. Se conservan límites de llamadas diarios, coste estimado y pausa por errores. El presupuesto monetario es un control estimado al iniciar cada llamada; no es un límite de facturación impuesto al proveedor.

El coste API se acumula por sesión y se muestra en USD. No se resta de USDT como si ambas monedas fueran idénticas. Los controles de ejecución son independientes del LLM.

## Evaluar resultados

El P&L incluye comisiones y precios de fill con slippage. Compara retorno, drawdown, expectativa neta y profit factor contra cash y BTC. Los fills parciales de una venta se agrupan por orden para contar resultados. Sharpe/Sortino requieren al menos 30 observaciones diarias completas; sin muestra se muestra N/D.

Fija capital, instrumentos, estrategia y costes antes del experimento; conserva también corridas perdedoras. Una interfaz, un backtest o un porcentaje de confianza del modelo no demuestran rentabilidad.

## Límites de esta versión

- Requiere equipo, app y conexión activos. En suspensión o desconexión no existe protección continua; la siguiente cotización ejecutable puede cruzar el stop y producir una pérdida mayor.
- REST consulta aproximadamente cada 3 segundos cuando no hay stream sano, sujeto a latencia y disponibilidad. Puede perder movimientos intraperiodo; nunca reconstruye un fill usando una vela anterior a la posición.
- El simulador no replica prioridad en cola ni todo el impacto de mercado. Los fills y su liquidez son un modelo, no una garantía de ejecución real.
- La migración V5 conserva un respaldo y añade correcciones al ledger antiguo. No elimina fills históricos. Un archivo de cuenta ilegible bloquea el arranque en lugar de reiniciar silenciosamente el saldo.
- Auto-Paper fue probado con respuestas LLM controladas; una llamada facturable al proveedor requiere una clave configurada y queda por verificar en tu cuenta.
- Las órdenes con dinero real continúan bloqueadas.

## Verificación y compilación

`npm test` ejecuta regresiones, incluyendo integración del motor. `scripts/electron-smoke.cjs` es una prueba de Electron con perfil temporal: consulta mercado público, compra/vende virtualmente, comprueba el ledger y captura la interfaz. No usa la cuenta habitual.

`npm run release:portable` crea una carpeta nueva bajo `release/` con fecha y `build-info.json` (SHA-256 de los fuentes). Conserva los portables anteriores. No ejecutes simultáneamente versiones distintas sobre una misma cuenta.
