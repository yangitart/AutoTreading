# LLM Trader — tareas del producto

Esta es la lista operativa del proyecto. El alcance completo está en PLATFORM_PLAN.md. AGENTS.md exige actualizarla cuando una tarea queda implementada y verificada. La prioridad actual es hacer fiable la simulación; las tareas de ampliación de mercado, noticias y live quedan en espera.

Estados: [x] terminado y comprobado · [~] prototipo parcial · [ ] pendiente.

## Simulación utilizable — revisión 2026-09-20

- [x] Fallback REST independiente del WebSocket, cotizaciones bid/ask frescas por símbolo y vigilancia desde main.
- [x] Compras bloqueadas durante pausa; ventas reductoras permitidas; reanudación visible; kill switch libera reservas.
- [x] Invalida decisiones automáticas pendientes al detener, pausar o reiniciar sesión.
- [x] Ledger de ventas a coste base con P&L explícito, reconciliación de activos y migración V5 con respaldo y corrección auditable.
- [x] Validación previa de órdenes pendientes, reserva de ventas, control de exposición incluyendo compras pendientes y source IPC no privilegiado.
- [x] Pruebas integradas de costes, cierre parcial, reinicio, idempotencia, reservas, pausa, stop al precio disponible, liquidez y respuesta tardía.
- [x] Prueba Electron con mercado público real y perfil aislado: compra/venta virtual, venta durante pausa y reconciliación íntegra.
- [x] Terminal con equity, saldo libre/reservado, drawdown, curva, P&L diario, coste API, reglas de lote, sizing, cancelación y reducción.
- [x] Métricas diarias con continuidad entre días, profit factor neto y ratios N/D sin muestra suficiente.
- [x] Salida LLM limitada en tokens, coste acumulado por sesión y divisa API explícita.
- [ ] Validar una corrida Auto-Paper con el proveedor/modelo y API key del operador; no se hicieron llamadas facturables en esta revisión.
- [ ] Evaluación prospectiva prolongada con estrategia congelada, benchmark y tolerancia de riesgo definidos por experimento.

Los checks históricos inferiores describen iteraciones anteriores; no certifican rentabilidad ni operación 24/7. Guía actual: `SIMULATION_GUIDE.md`.

## 0. Base y producto

- [x] App de escritorio Electron con main, preload y renderer aislados.
- [x] Workspace Simulación visible como entorno principal.
- [~] Workspace Real visible en solo lectura; ejecución live bloqueada.
- [x] Workspace Investigación con backtest baseline.
- [x] API key del LLM cifrada con el almacenamiento seguro de Electron.
- [x] .gitignore para dependencias, datos, secretos y releases.
- [x] Script generar-release.bat para crear un portable actualizado.
- [x] Migraciones versionadas para estado y configuración, con historial de versión y rechazo de respaldos futuros.
- [x] Cola única de mutaciones paper para serializar ticks, órdenes, reset, pausa, cancelación y Auto-Paper.
- [x] Copia de seguridad automática antes de reset/restauración y restauración con validación de esquema/ledger.
- [x] Exportación de un experimento completo reproducible con snapshots de mercado usados.

## 1. Simulación — prioridad actual

### Cuenta y contabilidad

- [x] Capital inicial configurable, con 100 USD como valor de prueba.
- [x] Cash, posiciones, equity y P&L no realizado básico.
- [x] P&L realizado en cierres paper.
- [x] Reinicio explícito de la cuenta paper.
- [x] Libro de doble entrada balanceado para capital y fills de cash, activo y fees.
- [x] Soportar cierres parciales con coste medio correcto.
- [x] Separar P&L bruto, comisiones, slippage, P&L neto y coste de API del LLM.
- [x] Mantener sesiones paper históricas; reset archiva el resumen y no borra evidencia.
- [x] Validar moneda de liquidación y diferenciar USD, USDT y USDC en configuración/estado.

### Ejecución paper realista

- [x] Compra y venta manuales dentro de paper.
- [x] Cotización actual consultada antes de ejecutar una orden manual.
- [x] Comisión configurable.
- [x] Slippage configurable.
- [x] Bid/ask real en vez de precio único para cotización y fills disponibles.
- [x] Latencia configurable entre decisión, envío y fill.
- [x] Estados de orden: created, accepted, partial, filled, cancelled, expired, rejected y failed.
- [x] Fills parciales configurables con límite de liquidez nocional por actualización.
- [x] Órdenes market, limit, stop-market y stop-limit con disparador, ejecución y estados persistidos.
- [x] Restricciones de tick size, lot size y mínimo nocional por símbolo mediante exchangeInfo.
- [x] Política conservadora configurable cuando una vela/gap toca stop y take-profit a la vez.
- [x] Rechazar órdenes con dato obsoleto o mercado desconectado.
- [x] Idempotencia con clientOrderId en UI y Auto-Paper; cada corrida automática genera identificadores deterministas.

### Riesgo y protección

- [x] Límite básico de tamaño por orden.
- [x] Límite básico de drawdown.
- [x] Tamaño automático básico basado en riesgo y stop sugerido.
- [x] Riesgo monetario máximo por operación calculado desde el stop efectivo.
- [x] Exposición máxima por activo y exposición total.
- [x] Riesgo agregado de posiciones basado en stops efectivos.
- [x] Pérdida diaria máxima y pausa automática de nuevas entradas.
- [x] Kill switch de una acción para cancelar y pausar todo.
- [x] Stops y take-profit persistidos y ejecutados por el simulador en cada tick.
- [x] Protección de nuevas entradas durante pérdida de conexión mediante stale gate y alertas; stops persistidos esperan una cotización fresca y registran la indisponibilidad.
- [x] Alertas persistentes y visibles para rechazo, drawdown, pausa, kill switch y fallo del automatizador.

### Tiempo real y terminal

- [x] Ticker en tiempo real con reconexión protegida.
- [x] Velas japonesas y volumen en la vista principal.
- [x] Selector de activo e intervalo.
- [x] Watchlist inicial de BTC, ETH y SOL.
- [x] Mark-to-market básico de posiciones.
- [x] Actualización de la última vela sin recargar el historial completo.
- [x] Indicador de edad del precio y estados live, stale y offline básicos.
- [x] Gráfico de equity con datos persistidos y rangos de 24h, 7d, 30d y todo el historial.
- [x] Gráfico de P&L diario y acumulado.
- [x] Tabla de órdenes y eventos de fill registrados.
- [x] Controles y confirmaciones claras para comprar, vender, cancelar y pausar.

### Métricas y evaluación

- [x] Benchmark BTC con cuentas virtuales buy-and-hold y cash sin operar.
- [x] Retorno y P&L bruto/neto; se muestra además el rendimiento después del coste LLM.
- [x] Drawdown máximo, duración del drawdown y recuperación.
- [x] Win rate observado; mostrar N/D sin operaciones cerradas.
- [x] Ganancia media, pérdida media y expectancy.
- [x] Profit factor, turnover y exposición media/máxima.
- [x] Volatilidad, Sharpe y Sortino cuando haya suficientes datos.
- [x] Curva de capital y operaciones exportables en JSON y CSV con contexto del experimento.
- [x] Informe por estrategia, modelo, prompt y periodo, combinando backtests guardados y análisis LLM paper.
- [x] Pruebas de datos inválidos, caché offline, órdenes rechazadas, stops y gaps completos.

## 2. Estrategia y LLM — después de estabilizar simulación

- [x] Analista LLM con salida BUY, SELL o HOLD.
- [x] Validación de JSON y Structured Output para OpenAI.
- [x] Auto-Paper opcional con cooldown y confianza mínima.
- [x] Auto-Paper ejecutable bajo demanda, con sizing redondeado al lote del instrumento y flujo completo LLM→riesgo→paper.
- [x] TradeIntent validada semánticamente y versionada (`intentVersion` 1.0).
- [x] Mover cálculo de indicadores al código y enviar al LLM un snapshot verificable.
- [x] Registrar modelo, versión de prompt, datos, timestamp, tokens y coste configurable por proveedor.
- [x] Separar intención del LLM de tamaño y autorización de riesgo.
- [x] Agente técnico.
- [x] Agente crítico que busque contradicciones e invalidación de la tesis.
- [x] Agente de revisión de cartera y concentración.
- [x] Contraste multi-temporal con timeframe superior guardado en cada análisis.
- [x] Agente de liquidez basado en order book, spread e imbalance.
- [x] Presupuesto máximo de llamadas al LLM por día y coste diario configurable.
- [x] Pausa automática de Auto-Paper si el proveedor falla o devuelve decisiones inválidas repetidas.
- [x] Evaluar un solo agente contra varios agentes con el mismo dataset y coste mediante cierres futuros observados, sin presentarlo como backtest.
- [x] Tests de prompts y regresión para que el modelo no cambie el contrato de orden.

## 3. Datos de mercado y noticias — EN ESPERA

- [~] Fallback entre endpoints públicos; falta proveedor configurable con credenciales separadas del LLM.
- [x] Almacenamiento local de velas por símbolo/timeframe y fallback stale con recuperación incremental por rango y deduplicación.
- [x] Normalización de zona horaria y símbolo, precisión de ejecución mediante tick/lot size y cierre de vela.
- [x] Validación de huecos, duplicados, timestamps futuros, `closeTime`, velas abiertas, OHLC inválido y freshness del resultado.
- [x] Fallback entre endpoints públicos sin mezclar precios incompatibles.
- [~] Agente de noticias RSS con fuente, hora, activo, relevancia y sentimiento ponderado por recencia; clasificación fundamental avanzada aún pendiente.
- [x] Eliminar duplicados por enlace.
- [x] Contexto de noticias separado de la señal técnica.
- [ ] Agente fundamental para acciones cuando se añada soporte de equities.
- [x] Order book REST y stream incremental con profundidad, spread, imbalance, secuencia/resync y límite de liquidez para fills paper.
- [ ] Calendario de eventos y filtros por sesión/mercado.

## 4. Backtesting e investigación — EN ESPERA

- [x] Motor histórico sin look-ahead bias con tres estrategias simples seleccionables.
- [x] Decisiones solo con velas cerradas y fill en la apertura de la siguiente vela.
- [x] Fees, slippage, spread, latencia y fills configurables en el backtest.
- [x] Separación temporal train, validation y test.
- [x] Walk-forward con folds futuros, comparación por tramo y etiquetado descriptivo por régimen de mercado.
- [~] Seed/fingerprint determinista y stress Monte Carlo bootstrap por dataset/costes/estrategia; faltan prompts/modelos variables.
- [x] Comparación contra cash, buy-and-hold y estrategia de reglas simples por cada experimento.
- [x] Informe de supuestos y limitaciones junto a cada resultado.
- [x] No seleccionar automáticamente una estrategia por el mejor backtest aislado; el informe conserva folds y benchmarks.

## 5. Cuenta real — EN ESPERA

- [x] Adaptador Binance para lectura y órdenes sandbox detrás de un contrato común PaperBroker/LiveBroker.
- [~] Binance testnet/demo con preflight, reglas de instrumento, idempotencia y kill switch; falta reconciliación end-to-end contra un entorno real.
- [~] Contrato de broker y ledger live separado con eventos de órdenes y balances normalizados; falta persistencia transaccional completa.
- [x] Credenciales de broker separadas del LLM y cifradas localmente.
- [~] Vista de cuenta real en modo lectura y prueba de conexión; falta reconciliación completa.
- [~] Verificación de cuenta y entorno antes de enviar sandbox; falta la puerta live completa.
- [x] Preflight live/sandbox con credenciales, entorno, permisos, discrepancias, recuperación, auditoría y stream.
- [~] Reconciliación periódica REST de balances y órdenes abiertas, con User Data Stream, normalización monotónica y recuperación de estados finales; falta una prueba real end-to-end contra cancelación tardía.
- [~] Manejo de fills parciales y recuperación de órdenes tras desconexión; falta prueba end-to-end de cancelaciones tardías.
- [~] Kill switch probado con órdenes sandbox pendientes; falta probar recuperación conjunta de órdenes y posiciones reales.
- [x] Registro inmutable de comandos y respuestas del broker mediante hash encadenado verificable.
- [ ] Activación live mediante acción explícita y revisión de criterios.
- [ ] Operación persistente 24/7 fuera de Electron si el producto lo necesita.

## Verificación de esta iteración

- [x] Sintaxis validada en main, preload, broker, agentes y renderer.
- [x] Regresión automatizada de paper, indicadores, backtest, agentes, Binance y contrato de broker.
- [x] Estadísticas separan P&L bruto/neto y muestran el coste estimado del LLM.
- [x] Snapshot de mercado y estado de calidad incluidos en cada análisis y exportación.
- [x] Backtest con estrategias seleccionables y tramos train/validation/test comparados contra benchmarks.
- [x] Auditoría broker y ledger live con cadena hash y detección de manipulación.
- [x] Persistencia paper con respaldo antes de cambios destructivos y restore validado.
- [x] Métricas visibles de drawdown, recuperación, P&L diario y exposición de cartera.
- [x] Extracción formal de los adaptadores `PaperBroker` y `LiveBroker` con mainnet protegido.
- [x] Kill switch sandbox expuesto en la cuenta y protegido contra ejecución en mainnet.
- [x] Prueba integrada de stop-market: disparo por precio y fill paper protegido.
- [x] Restauración de cuenta paper validada y respaldo automático antes de reset o restore.
- [x] Alertas paper y órdenes automáticas idempotentes integradas y verificadas.
- [x] Prueba de límite de riesgo agregado con posiciones protegidas.
- [x] Órdenes pendientes con cinco fallos de fill pasan a `failed` y generan alerta auditable.
- [x] Prueba de análisis con contexto de timeframe superior y trazabilidad del agente.
- [x] Caché de mercado marcado stale y bloqueo de entradas cuando no hay cotización fresca.
- [x] Prueba integrada de Auto-Paper con cotización, reglas de instrumento, sizing y orden paper.
- [x] Moneda de liquidación persistida y visible en la cuenta paper.
- [x] Se bloquean fills cuando la moneda de la cuenta no coincide con la moneda cotizada del instrumento.
- [x] Order book se actualiza periódicamente mientras el terminal permanece abierto.
- [x] Parser LLM tolera contenido segmentado, markdown y refusals con fallo auditable.
- [x] Recuperación de órdenes por `providerOrderId` o `clientOrderId` con reporte de estados no resueltos.
- [x] Preflight visible en Cuenta real con razón concreta para cada requisito pendiente.
- [x] Sandbox exige preflight, valida reglas del instrumento, evita duplicados y ejecuta kill switch.
- [x] Sandbox requiere armado temporal explícito y se desarma automáticamente con kill switch.
- [x] Risk Governor bloquea entradas paper con feed offline y permite únicamente salidas de riesgo.
- [x] Cuenta real muestra balances libres/bloqueados y órdenes normalizadas en solo lectura.
- [x] User Data Stream actualiza balances libres/bloqueados inmediatamente y deja evento auditable.
- [x] Rendimiento permite cambiar el rango temporal y recalcula métricas/gráficos.
- [x] Cuenta paper actualiza benchmark buy-and-hold y cash en cada tick.
- [x] Verificación manual de integridad reconcilia cash, comisiones, IDs, estados, posiciones y ledger.
- [x] Folds walk-forward guardados y visibles en Investigación sin selección automática por el mejor resultado.
- [x] Historial persistente de experimentos para comparar corridas sin perder contexto.
- [x] Backtests guardan fingerprint/seed determinista para repetir la misma corrida.
- [x] Investigación muestra percentiles Monte Carlo, probabilidad positiva y probabilidad de superar buy-and-hold.
- [x] Comparación en una misma corrida de SMA, EMA y RSI con idéntico dataset, capital y costes.
- [x] Order book y agente de liquidez visibles en terminal y trazables en análisis.
- [x] Política de ejecución ambigua y persistencia de configuración cero probadas.
- [x] Flujo integrado LLM multiagente con veto crítico, cartera, consenso y presupuesto diario.
- [x] Evaluación comparable de agente técnico único frente a consenso multiagente visible en Investigación.
- [x] Regresiones del contrato TradeIntent: normalización, niveles incoherentes y veto conservador del consenso.
- [x] Informe de Investigación agrupado por estrategia, modelo, prompt, activo e intervalo con costes y periodo.
- [x] Contrato LLM centralizado y versionado: Structured Output cerrado, parser tolerante y noticias tratadas como evidencia no confiable.
- [x] Calidad de velas: timestamps UTC, `closeTime`, frescura, vela abierta identificada y exclusión de cierres incompletos en señales y backtests.
- [x] Recuperación incremental de velas: `startTime` desde la caché, merge ordenado, deduplicación y reporte de velas recuperadas.
- [x] Precisión de instrumentos: `tickSize`/`stepSize` se aplican a fills, protecciones y órdenes pendientes antes de persistir el resultado.
- [x] Folds walk-forward etiquetados por régimen y resumen de rendimiento frente a buy-and-hold por régimen.
- [x] Order book normalizado y validado por orden, spread positivo, liquidez, UTC y frescura; el agente excluye snapshots stale.
- [x] Monte Carlo muestra escenarios deterministas de costes base, 1.5x y 2x conservando seed y benchmark.
- [x] Feeds RSS configurables desde Configuración: solo HTTPS, deduplicados y con estado fresh/degraded/offline por proveedor.
- [x] El agente de noticias ignora titulares futuros o stale, pondera la evidencia reciente y conserva trazabilidad de antigüedad por titular.
- [x] Stream incremental de profundidad con snapshot REST inicial, buffer, secuencia `U/u`, detección de gaps y resync automático; los fills conservan su límite de liquidez nocional configurable.
- [x] Fills paper limitados por el nocional disponible del lado del order book y consumo de niveles entre órdenes dentro del mismo snapshot.
- [x] Auto-Paper con single-flight, heartbeat, duración de corrida y estado persistente `running`/`idle`/`paused`.
- [x] Detención explícita de Auto-Paper: desactiva automatización, conserva la cuenta y deja estado `stopped` auditable.
- [x] Diario persistente por corrida Auto-Paper con decisiones, saltos, órdenes enviadas y errores por símbolo.
- [x] Recuperación al arranque de corridas Auto-Paper con heartbeat perdido: estado `interrupted`, alerta crítica y revisión manual obligatoria.
- [x] Heartbeat periódico durante llamadas LLM largas para diferenciar lentitud de una corrida abandonada.
- [x] Risk Governor reinicia la pérdida diaria al cambiar la fecha UTC y no arrastra el bloqueo de ayer.
- [x] Auto-Paper inicia siempre pausado al abrir la aplicación y solo se activa mediante un preflight explícito.
- [x] Preflight de Auto-Paper valida modo, LLM, presupuesto, cuenta, integridad, riesgo, feed, velas cerradas, instrumentos y moneda antes de arrancar.
- [x] Progreso visible y persistente por fase: market-data, LLM, validación, agentes, consenso y ejecución.
- [x] Vista dedicada de Agentes con roster, estado en vivo, detalle de actividad, consenso e historial de corridas Auto-Paper.
- [x] Acceso directo a Agentes dentro de la Terminal mediante pestaña del libro operativo y vista completa opcional.
- [x] Navegación horizontal tipo tabs para Simulación/Real y para Terminal/Agentes dentro del mismo shell.
- [x] Auto-Paper permanece pausado al arrancar y ofrece Iniciar agentes en Terminal/Agentes para activar preflight y ejecución.
- [x] Iniciar agentes abre un modal de configuración y confirmación antes del preflight (símbolos, timeframe, intervalo, confianza y riesgo).
- [x] El control principal muestra Iniciar en reposo, abre el modal y solo muestra Pausar mientras Auto-Paper está activo.
- [x] GPT-5.6 Luna es el modelo predeterminado; Configuración y el modal de inicio ofrecen selector de modelos, costes y opción personalizada.
- [x] El diario persistente de Auto-Paper conserva también las fases de agentes, no solo decisiones y órdenes.
- [x] Reserva de cash para órdenes BUY pendientes, liberación proporcional en fills/cancelaciones y validación contra órdenes abiertas.
- [x] QA Electron de Terminal, Investigación y Cuenta real en solo lectura.
- [x] Portable regenerado con `generar-release.bat`.

## Orden de ejecución actual

1. Completar contabilidad y estados de órdenes paper.
2. Implementar stops, take-profit, pausa, kill switch y datos obsoletos.
3. Añadir métricas y benchmarks.
4. Añadir tests de fallos y exportación reproducible.
5. Después reanudar datos avanzados, noticias y backtesting.
6. El modo real queda al final.

## Iteración de protección OHLC/gaps

- [x] El motor paper evalúa stops y take-profit con el mínimo y máximo de la vela, no únicamente con el cierre.
- [x] Un gap que atraviesa una protección se llena al precio de apertura disponible y queda marcado en la orden y el trade.
- [x] Si el feed está offline no se inventa un fill: las posiciones protegidas permanecen armadas, las entradas se bloquean y se registra una alerta persistente.
- [x] Pruebas deterministas para stops por rango, gaps, ambigüedad intrabar y órdenes stop pendientes.
- [x] Migraciones versionadas idempotentes para configuración y estado paper, con rechazo de respaldos de versiones futuras.
- [x] Mutaciones paper serializadas con recuperación de la cola después de errores.
