const worker=new Worker(new URL('./engine.worker.ts',import.meta.url),{type:'module'});
let id=0;
const pending=new Map<number,{resolve:(v:unknown)=>void;reject:(e:Error)=>void;progress?:(s:string)=>void}>();
worker.onmessage=({data})=>{const p=pending.get(data.request);if(!p)return;if(data.progress){p.progress?.(data.progress);return;}pending.delete(data.request);if(data.error)p.reject(new Error(data.error));else p.resolve(data.result);};
worker.onerror=()=>{for(const p of pending.values())p.reject(new Error('The processing worker stopped. Reload and try again on a desktop browser.'));pending.clear();};
export function engine<T>(action:string,body:Record<string,unknown>={},progress?:(s:string)=>void):Promise<T>{return new Promise((resolve,reject)=>{const request=++id;pending.set(request,{resolve:resolve as (v:unknown)=>void,reject,progress});worker.postMessage({request,action,...body});});}
