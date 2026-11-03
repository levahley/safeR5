export async function api<T>(path:string, body?:unknown, signal?:AbortSignal):Promise<T> {
  let response:Response
  try {
    response = await fetch(`/api/v1${path}`, {method:body === undefined ? 'GET':'POST',headers:body === undefined ? undefined:{'Content-Type':'application/json'},body:body === undefined ? undefined:JSON.stringify(body),signal})
  } catch (error) {
    if(error instanceof DOMException && error.name==='AbortError') throw error
    throw new Error('Yerel sunucuya ulaşılamadı. safeR5 sunucusunun çalıştığını kontrol edin.',{cause:error})
  }
  if(!response.ok) {
    const data = await response.json().catch(()=>null)
    const detail = data?.detail
    const message = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((x:{msg?:string})=>x.msg ?? 'Geçersiz alan').join('; ') : `Sunucu isteği tamamlayamadı (${response.status}).`
    throw new Error(message)
  }
  return response.json() as Promise<T>
}
export function message(error:unknown) { return error instanceof Error ? error.message : 'İşlem tamamlanamadı. Yeniden deneyin.' }
