# safeR5 API contract v1

All routes `/api/v1`. JSON. Same-origin browser UI at `http://127.0.0.1:8765`. Error `{detail: string | validation-array}`. Dates ISO UTC. UI never reads paths. All stored IDs opaque hex; managed directory only.

## Requests

- `GET /health` → `{status:"ok",version:string}`
- `GET /overview` → `{datasets:Dataset[],experiments:ExperimentSummary[],jobs:Job[],stats:{datasets:number,experiments:number,events:number}}`
- `GET /datasets` → Dataset[]
- `POST /lab/generate` body `{profile:"demo",seed:42,n_events:2400,include_attacks:true,users:8,hosts:4,start:"2026-01-01T00:00:00Z",duration_hours:12}` → 202 Job. Defaults may be omitted. Users 2..256, hosts 4..256, duration 1..24 hours per split; split starts are 2 days apart.
- `GET /datasets/{id}` → Dataset (manifest added)
- `POST /experiments` body RunConfig → 202 Job. Null dataset_id generates a demo. RunConfig `{dataset_id:string|null,name:string,seed:number,sources:("auth"|"audit"|"dns")[],loss:LossConfig,budget_fraction:number,max_false_positive_rate:number}`. Defaults name="Demo deneyi", seed=42, all sources, loss none, budget=.7, FPR=1.
- LossConfig `{kind:"none"|"random"|"source"|"interval",rate:0..1,source:"auth"|"audit"|"dns"|null,start:string|null,end:string|null}`. Source outage without dates removes whole source; interval requires both ISO dates.
- `GET /jobs` → Job[]; `GET /jobs/{id}` → Job; `POST /jobs/{id}/cancel` → Job
- `GET /experiments` → ExperimentSummary[]
- `GET /experiments/{id}` → Experiment
- `GET /experiments/{id}/evidence?event_id=...` → `{event:Event,raw:string,reference:{file_id:string,line:number,sha256:string}}` (retained events only)
- `GET /experiments/{id}/events?offset=0&limit=50&source=auth&q=...` → `{items:Event[],total:number}` (observed/retained test events only, optional source/query)
- `GET /experiments/{id}/report?format=json|csv|markdown|html` → downloadable file
- `GET /models` → summaries of locally trained models
- `GET /settings` → `{version,data_directory,limits,dependencies,ait:{status,record_url,note}}`
- `POST /datasets/import` JSON `{name:string,content:string}` normalized JSONL upload (bounded), returns Dataset. No paths.

## Objects

Dataset `{id,name,created_at,event_count,source_counts:{auth:number,audit:number,dns:number},input_hash,profile,seed}`.

Job `{id,kind,status:"queued"|"running"|"succeeded"|"failed"|"cancelled"|"interrupted",stage:string,progress:0..100,created_at,updated_at,result_id:string|null,error:string|null,config:object}`.

ExperimentSummary `{id,name,dataset_id,created_at,event_count,retained_count,loss_kind,status:"succeeded"}`.

Experiment extends summary `{config:RunConfig,baseline:AnalysisResult,perturbed:AnalysisResult,optimization:Optimization,provenance:object,performance:object,loss_manifest:object}`.

AnalysisResult `{event_count,source_counts,alerts:Alert[],incidents:Incident[],metrics:Metrics,graph:{nodes:Node[],edges:Edge[]},source_health:{auth:string,audit:string,dns:string}}`.

AnalysisResult also includes `method_metrics:{rules:Metrics,iforest:Metrics}`; `metrics` is the union. The generated contract `frontend/src/generated-contract.ts` is authoritative for complete wire types; `scripts/generate_contract.py --check` rejects drift and API responses validate against Pydantic `wire.py`.

Alert `{id,method:"rules"|"iforest",rule_id,message,severity:"medium"|"high",evidence_ids:string[],host_id,user_id,event_time,score:number|null}`. Score is uncalibrated anomaly score.

Incident `{id,alert_ids:string[],evidence_ids:string[],host_id,user_id,start,end,summary}`.

Metrics `{attack_step_recall:number|null,false_positive_rate:number|null,evidence_coverage:number|null,detection_delay_seconds:number|null,steps_detected:number,steps_total:number,false_positives:number,normal_events:number,alerts_total:number,status:"measured"|"no_ground_truth"|"empty"}`. Rates 0..1. Delay seconds. Hidden true steps remain in denominator.

Metrics additionally has `false_positive_windows`, `normal_windows`, `evidence_flag_rate`. `false_positive_rate` is flagged normal source/host/user/300-second windows / observed known-normal windows. Original attack windows remain excluded even if attack rows are hidden. `false_positives` / `normal_events` are separately the bounded flagged normal evidence events / observed labeled normal events; their ratio is `evidence_flag_rate`. A zero denominator is null, never a perfect false-alarm claim.

Node `{id,label,kind:"event"|"host"|"user"|"session"}`; Edge `{source,target,relation,evidence_ids:string[],uncertainty:string}`.

Optimization `{budget_bytes:number,budget_fraction:number,cost_unit:string,validation_dataset_hash:string,recommended_sources:string[],candidates:Candidate[],comparisons:Comparison[],independent_test:Metrics,actual_test_cost_bytes:number,estimated_cost_bytes:number,policy:string}`. Candidate `{sources:string[],cost_bytes:number,recall:number|null,false_positive_rate:number|null,feasible:boolean}`. Comparison `{method,sources:string[],validation_recall:number|null,test_recall:number|null,cost_bytes:number,within_budget:boolean}`. All 8 subsets searched on validation. Random comparisons repeat seeds.

Event `{event_id,event_time,observed_time,source_type,host_id,user_id,session_id,event_type,action,result,process_id,parent_process_id,process_start_time,src_ip,dst_ip,dns_query,bytes_out,privileged,raw_ref:{file_id,line,sha256},parser_version,schema_version}`. Missing fields null. Ground truth is never in Event.
