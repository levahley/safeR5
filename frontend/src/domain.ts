import type { RunConfig, Source } from './types'
export const sources:Source[] = ['auth','audit','dns']
export const sourceNames:Record<Source,string> = {auth:'Kimlik doğrulama',audit:'Sistem denetimi',dns:'DNS'}
export const defaultConfig:RunConfig = {dataset_id:null,name:'Demo deneyi',seed:42,sources,loss:{kind:'none',rate:0,source:null,start:null,end:null},budget_fraction:.7,max_false_positive_rate:1}
export const num = (value:number) => new Intl.NumberFormat('tr-TR',{maximumFractionDigits:1}).format(value)
export const percent = (value:number|null|undefined) => value == null || !Number.isFinite(value) ? 'Ölçülmedi' : `%${new Intl.NumberFormat('tr-TR',{minimumFractionDigits:1,maximumFractionDigits:1}).format(value*100)}`
export const date = (value:string|null) => !value||!Number.isFinite(+new Date(value)) ? 'Bilinmiyor' : new Intl.DateTimeFormat('tr-TR',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'UTC'}).format(new Date(value))+' UTC'
export const seconds = (value:number|null) => value == null ? 'Ölçülmedi' : `${num(value)} sn`
export const bytes = (value:number) => value < 1024 ? `${num(value)} B` : value < 1024**2 ? `${num(value/1024)} KiB` : `${num(value/1024**2)} MiB`
export const lossNames:Record<string,string> = {none:'Kayıp yok',random:'Rastgele kayıp',source:'Kaynak kesintisi',interval:'Zaman aralığı kaybı'}
export const healthNames:Record<string,string> = {observed:'Veri mevcut',healthy:'Veri mevcut',present:'Veri mevcut',available:'Veri mevcut',missing:'Veri yok',empty:'Veri yok',absent:'Veri yok',degraded:'Kısmi veri'}
