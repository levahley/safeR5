export type * from './generated-contract'
import type { Event, LossConfig } from './generated-contract'
export type Source = Event['source_type']
export type Loss = LossConfig
