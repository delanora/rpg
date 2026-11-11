import { z } from 'zod';
import { HttpError } from '../../lib/http-error.js';

const legendaryStateSchema=z.object({used:z.number().int().nonnegative().default(0),surprised:z.boolean().default(false),firstTurnEnded:z.boolean().default(false)});
export type LegendaryState=z.infer<typeof legendaryStateSchema>;
export function legendaryStateOf(value:unknown):LegendaryState {return legendaryStateSchema.parse(value??{});}
const legendaryWindowSchema=z.object({id:z.string(),turnSequence:z.number().int().nonnegative(),outgoingId:z.string(),candidateIds:z.array(z.string()),decidedIds:z.array(z.string()),extraCombatantId:z.string().optional()});
export type LegendaryWindow=z.infer<typeof legendaryWindowSchema>;
export function legendaryWindowOf(value:unknown):LegendaryWindow|null {return value==null?null:legendaryWindowSchema.parse(value);}
export function assertLegendaryTurnOpen(value:unknown):void {
 if(legendaryWindowOf(value))throw new HttpError('Aguarde a decisão do Mestre no fim do turno.',409,'LEGENDARY_WINDOW_PENDING');
}
export interface LegendaryWindowDto extends LegendaryWindow {}
export interface LegendaryPoolDto extends LegendaryState {max:number;}
