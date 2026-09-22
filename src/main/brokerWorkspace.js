const path=require('path');
const {createHash}=require('crypto');
const {LiveBroker}=require('./liveBroker');
const {LiveStore}=require('./liveStore');
const {LiveTradingService}=require('./liveTrading');
const {SerializedMutationQueue}=require('./mutationQueue');
const {baseUrl}=require('./binanceClient');

function registerBrokerWorkspace({ipcMain,directory,io,readJson,writeJson,protect,unprotect,fetchImpl,onUpdate}){
  const secretsFile=path.join(directory,'secrets.json'),selectionFile=path.join(directory,'broker-selection.json');
  const changes=new SerializedMutationQueue();let service=null,activeId=null,switching=false,connectionError=null;
  const secrets=()=>readJson(secretsFile,{});
  const metadata=()=>Object.values(secrets().brokerAccounts||{}).map(a=>({id:a.id,label:a.label,environment:a.environment}));
  function snapshot(){return {...(service?service.snapshot():{status:connectionError?'error':'not-configured',error:connectionError,environment:'testnet',orders:[],openOrders:[],recovery:[],armed:false,account:null}),accounts:metadata(),activeId,legacyCredentialsAvailable:Boolean(secrets().binanceApiKey)};}
  function publish(){onUpdate(snapshot());}
  function load(id){
    const entry=secrets().brokerAccounts?.[id];if(!entry)throw new Error('Cuenta no configurada.');
    service?.shutdown();activeId=id;
    service=new LiveTradingService({scope:id,label:entry.label,environment:entry.environment,client:new LiveBroker({apiKey:unprotect(entry.apiKey),secret:unprotect(entry.secret),environment:entry.environment,allowMainnet:entry.environment==='mainnet',fetchImpl}),store:new LiveStore(directory,id,io),onUpdate:()=>publish()});
    connectionError=null;writeJson(selectionFile,{activeId:id});publish();
  }
  try{const saved=readJson(selectionFile,{});if(saved.activeId)load(saved.activeId);}catch(error){connectionError=error.message;service=null;}
  async function change(task){
    return changes.enqueue('account-change',async()=>{
      switching=true;
      try{
        if(service){const previous=service;previous.disarm('Cambio de cuenta solicitado');await previous.queue.enqueue('switch-check',()=>{if(!previous.canSwitch())throw new Error('Resuelve las órdenes abiertas o inciertas antes de cambiar de cuenta o credenciales.');});}
        return await task();
      }finally{switching=false;}
    });
  }
  function current(payload,scopeRequired=true){
    if(switching)throw new Error('Cambio de cuenta en curso.');if(!service)throw new Error(connectionError||'Guarda las credenciales del broker primero.');
    if(scopeRequired&&payload?.scope!==activeId)throw new Error('La cuenta cambió; vuelve a revisar la operación.');return service;
  }
  const handlers={
    'broker:snapshot':()=>snapshot(),
    'broker:saveCredentials':value=>change(async()=>{
      baseUrl(value?.environment);
      const apiKey=String(value?.apiKey||'').trim(),secret=String(value?.secret||'').trim();
      if(!apiKey||!secret||apiKey.length>1024||secret.length>4096)throw new Error('API key y secret del broker obligatorios.');
      const id=value.environment+'-'+createHash('sha256').update(apiKey).digest('hex').slice(0,20),saved=secrets();
      saved.brokerAccounts={...(saved.brokerAccounts||{}),[id]:{id,environment:value.environment,label:String(value.label||`Binance ${value.environment}`).trim().slice(0,60),apiKey:protect(apiKey),secret:protect(secret)}};
      writeJson(secretsFile,saved);load(id);return snapshot();
    }),
    'broker:select':value=>change(async()=>{load(String(value?.id||''));return snapshot();}),
    'broker:reconcile':async()=>{await current(null,false).reconcile();return snapshot();},
    'broker:testConnection':async()=>{await current(null,false).reconcile();return snapshot();},
    'broker:preflight':async()=>current(null,false).preflight(),
    'broker:arm':async value=>{await current(value).arm(value);return snapshot();},
    'broker:disarm':value=>{current(value).disarm();return snapshot();},
    'broker:preview':value=>current(value).preview(value),
    'broker:submit':value=>current(value).submit(value),
    'broker:cancel':async value=>{await current(value).cancel(value);return snapshot();},
    'broker:kill':value=>current(value).kill(),
    'broker:report':()=>{const s=current(null,false);return {exportedAt:new Date().toISOString(),scope:s.scope,environment:s.environment,state:structuredClone(s.state)};}
  };
  for(const [channel,handle]of Object.entries(handlers))ipcMain.handle(channel,(_event,value)=>handle(value));
  // Old renderer channels cannot bypass the new preview/confirmation flow.
  for(const channel of ['broker:armSandbox','broker:placeSandboxOrder','broker:getSandboxOrder','broker:cancelSandboxOrder','broker:killSandbox'])ipcMain.handle(channel,()=>{throw new Error('Usa el nuevo workspace de Cuenta y la revisión de orden.');});
  return {snapshot,reconcile:async()=>{if(service&&!switching)await service.reconcile();},shutdown:()=>service?.shutdown()};
}
module.exports={registerBrokerWorkspace};
