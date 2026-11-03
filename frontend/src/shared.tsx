import type { ReactNode } from 'react'
import { AlertCircle, CircleHelp, FlaskConical, LoaderCircle } from 'lucide-react'
import type { Source } from './types'
import { percent, sourceNames } from './domain'
export function Loading({children='Veriler yükleniyor…'}:{children?:ReactNode}) { return <div className="loading" role="status"><LoaderCircle size={19} className="spin"/>{children}</div> }
export function ErrorBox({error,retry}:{error:string;retry?:()=>void}) {return <div className="error-banner" role="alert"><AlertCircle size={18}/><p>{error}</p>{retry&&<button className="button small quiet" onClick={retry}>Yeniden dene</button>}</div>}
export function Notice({children,warning=false}:{children:ReactNode;warning?:boolean}) {return <div className={`notice${warning?' warning':''}`}><CircleHelp size={17}/><div>{children}</div></div>}
export function Empty({title,children,action}:{title:string;children:ReactNode;action?:ReactNode}) {return <div className="empty"><FlaskConical size={27}/><h2>{title}</h2><p>{children}</p>{action}</div>}
export function PageHead({title,children,action}:{title:string;children:ReactNode;action?:ReactNode}) {return <header className="page-head"><div><h1>{title}</h1><p>{children}</p></div>{action}</header>}
export function SourceList({values}:{values:Source[]}) {return <>{values.length ? values.map(x=>sourceNames[x]??x).join(', '):'Kaynak yok'}</>}
export function Rate({value}:{value:number|null}) {return <span className="comparison-value"><span>{percent(value)}</span>{value!=null&&<span className="mini-bar" aria-hidden="true"><span style={{width:`${Math.max(0,Math.min(value,1))*100}%`}}/></span>}</span>}
