# Alcance de producto: investigación, simulación y ejecución

## Objetivo

Construir una aplicación de escritorio Electron que permita investigar, comparar y operar estrategias asistidas por LLMs. La meta futura es obtener rentabilidad neta con riesgo medido. La aplicación debe demostrar con datos cuándo una estrategia aporta valor y cuándo pierde; una explicación convincente del modelo no demuestra una ventaja de mercado.

## Espacios de trabajo

**Simulación / Paper:** son nombres del mismo entorno. Capital configurable, inicialmente 100 unidades de moneda de cuenta. Datos reales, operaciones virtuales, límites, costes y diario de decisiones. Mostrar explícitamente la moneda: USDT no es USD; la conversión deberá ser explícita cuando exista. No necesita credenciales de trading para consultar mercado público.

**Real:** visible como próximo, sin ejecución implementada. Más adelante permite elegir proveedor y cuenta, verificar permisos y activar una sesión. Historial, credenciales, saldos y órdenes totalmente separados del paper. Nunca cambiar de entorno con órdenes pendientes sin resolver su estado. Cambiar de pestaña no autoriza operaciones reales.

**Investigación:** backtesting y comparaciones de estrategias; no necesita ser un tercer modo de ejecución.

## Primera versión útil

1. Terminal con velas OHLCV, volumen, intervalos, watchlist, precio y antigüedad del dato. Mercado visible sin llamar al LLM. Estados cargando, desconectado y obsoleto. No rellenar huecos con precios inventados.
2. Cuenta paper y libro contable con cash libre/reservado, posiciones, coste base, equity, P&L realizado/no realizado, comisiones, cierres parciales y exportación. Nueva sesión conserva la anterior; reset no debe borrar evidencia.
3. Ejecución paper con bid/ask, comisión del proveedor, slippage y latencia configurables; restricciones reales de tick, lote y mínimo nocional. Órdenes market, limit, cancelación y estados explícitos. Un precio sugerido por el modelo nunca es un fill.
4. Stops y take-profit realmente ejecutados por el motor, incluidos gaps. Si una vela toca stop y objetivo sin resolución suficiente, registrar ambigüedad y usar una política conservadora. El stop no garantiza el precio de salida.
5. Análisis reproducible: velas cerradas para señales, indicadores calculados por código, contexto de varias temporalidades, tendencia, volatilidad, volumen, liquidez y exposición actual. Noticias/fundamentales solo con fuente y fecha; no imprescindibles para una primera estrategia técnica.
6. LLM con salida tipada y validación semántica; BUY/SELL/HOLD, horizonte, invalidación y evidencia. Confianza declarada no equivale a probabilidad de éxito. Cada respuesta conserva modelo, versión de prompt, datos de entrada, duración, tokens, coste y resultado de validación.
7. Riesgo independiente del modelo: saldo, exposición por activo y total, riesgo agregado de stops, pérdidas diarias, drawdown y límites de actividad. Una pausa impide nuevas entradas pero permite reducir posiciones. No aumentar tamaño para recuperar pérdidas automáticamente.
8. Automatizador con iniciar/pausar/detener, presupuesto de API, próximo análisis, estado y registro de errores. Una sola iteración activa, sin órdenes duplicadas tras reintentos. Pausa invalida decisiones pendientes. La vigilancia de posiciones no depende de consultar al LLM.
9. Persistencia transaccional y recuperación: motor fuera del renderer, escrituras serializadas, migraciones y copia de seguridad. Una actualización de precio no debe sobrescribir una orden o reset concurrentes.

## Cómo evaluar si puede ganar dinero

Comparar en idéntico periodo, universo, capital y costes: conservar cash, buy-and-hold, estrategia de reglas simples y estrategia asistida por LLM. Mantener la versión de estrategia fija durante cada experimento.

Mostrar retorno neto, drawdown máximo, exposición, número de operaciones cerradas, ganancia/pérdida media, expectancy, profit factor, rotación y costes. Sharpe/Sortino requieren suficientes observaciones; mostrar N/D cuando no se pueden estimar. No presentar 0% como un win rate observado si no hay cierres.

Separar P&L de trading neto de costes de ejecución de resultado económico después de API, datos y alojamiento. Con una cuenta de 100, un coste operativo de 1 equivale al 1% del capital: los análisis deben tener presupuesto explícito. Este ejemplo no es una tarifa de proveedor.

Backtests sin acceso a datos futuros, con entrenamiento/ajuste y evaluación separados temporalmente, walk-forward y costes adversos. Con LLMs, documentar posible contaminación por conocimiento histórico aprendido; el paper prospectivo aporta una comprobación adicional. Registrar intentos fallidos para evitar elegir solo resultados afortunados.

No fijar un número arbitrario de días o un win rate como prueba suficiente. Definir previamente muestra, métricas, benchmark y tolerancia de riesgo por experimento; repetir en regímenes distintos sin ajustar a posteriori el criterio de éxito.

## Camino al modo real

Primero implementar un único adaptador para un proveedor elegido, con el mismo contrato de broker utilizado en paper: cuenta, posiciones, enviar/cancelar, estado y eventos de ejecución. Respetar capacidades, horarios, divisas y reglas específicas del mercado. No prometer soporte universal de acciones, cripto y derivados con una sola API.

Validar integración en sandbox/testnet, respuestas ambiguas, fills parciales, cancelaciones tardías, desconexiones y reinicio. Identificadores idempotentes y reconciliación con el broker antes de reintentar. Credenciales por cuenta, cifradas, sin retiros cuando el proveedor permita restringirlos. Validación IPC, bloqueo de navegación externa y protección contra contenido no confiable recibido por el LLM.

Antes de operar capital real: criterios experimentales cumplidos, contabilidad contrastada, límites y parada comprobados, cuenta/mercado seleccionados y habilitación explícita. La disponibilidad y requisitos del broker dependen del proveedor y jurisdicción; verificar al elegir integración.

La V1 local solo trabaja con la aplicación y equipo activos. Suspensión, apagado y desconexión se muestran como interrupciones; no simular que hubo protección continua. La operación futura 24/7 requerirá un servicio persistente, monitoreo y alertas independientes de Electron.

## Prioridades y estado honesto

**Implementado y revisado (2026-09-20):** simulación con ledger V5 reconciliado, cierres parciales, reservas, órdenes market/limit/stop, cotización bid/ask con fallback REST, protección al precio disponible, pausa/reanudación, kill switch, métricas y terminal. El flujo LLM conserva preflight y presupuesto; la integración facturable depende de la clave/modelo del operador. Ver `SIMULATION_GUIDE.md` y `TODO.md`.

**Prioridad 0:** mantener las regresiones contables y operativas; completar la validación prospectiva con el proveedor del operador. La pérdida puede superar el riesgo estimado por gaps, suspensión o desconexión.

**Prioridad 1:** evaluación prolongada de resultados netos, recuperación y disponibilidad. Las métricas, benchmark de sesión y backtests están implementados; no constituyen evidencia de rentabilidad por sí mismos.

**Prioridad 2:** adaptador sandbox, reconciliación y recuperación. Después, habilitación real.

**Fuera de la primera versión:** apalancamiento, futuros/opciones, HFT, autoaprendizaje que modifica estrategias en vivo y múltiples agentes sin una mejora demostrada frente a un modelo sencillo.

Existen adaptadores `PaperBroker` y `LiveBroker`. El motor paper todavía delega gran parte de su implementación en `main.js`; los módulos auxiliares y el flujo integrado tienen regresiones. Live permanece bloqueado fuera de sandbox/testnet.

## Pruebas de aceptación

- Mercado funciona sin API key del LLM; fallo de feed se ve y bloquea órdenes con datos obsoletos.
- Una compra y venta con precio constante pierde exactamente sus costes; cierre parcial conserva coste base y cash correctos.
- No pueden existir cash negativo, ventas superiores a posición o dos fills del mismo intento.
- Stops, pausa, fallo de API, pérdida de red y reinicio tienen pruebas deterministas.
- El informe explica cada variación de equity y exporta evidencia reproducible.
- Ninguna acción del workspace de simulación puede llegar a un broker real.
