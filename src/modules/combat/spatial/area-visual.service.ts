import { z } from 'zod';
import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import { getBroadcaster } from '../../../realtime/hub.js';
import { ServerEvents, type CombatAreaVisualPayload } from '../../../realtime/events.js';
import { creatureAbilitiesOf } from '../../shared/creature-abilities.js';
import { effectiveSceneConfigOf, spatialPositionSchema } from './spatial.types.js';

export const areaVisualSchema = z.object({
  previewId: z.string().min(1).max(100),
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  placement: z.object({
    combatantId: z.string().min(1),
    abilityId: z.string().min(1),
    origin: spatialPositionSchema,
    angle: z.number().finite().min(-Math.PI * 2).max(Math.PI * 2),
  }).strict().nullable(),
}).strict();

// Lápides breves impedem que uma atualização atrasada reabra uma prévia cancelada.
const received = new Map<string, { sequence: number; closed: boolean; at: number }>();

/** Apresentação efêmera: não decide atingidos, não escreve no banco nem gasta recursos. */
export async function shareAreaVisual(combatId: string, input: z.infer<typeof areaVisualSchema>, author: {sub: string; role: string}) {
  if (author.role !== 'MASTER') throw new HttpError('Somente o Mestre compartilha áreas do bestiário.', 403, 'FORBIDDEN');
  const combat = await prisma.combat.findUnique({where:{id:combatId},include:{scene:true,combatants:{include:{creature:true}}}});
  if (!combat || combat.status !== 'ACTIVE') throw new HttpError('A prévia exige um combate em andamento.',409,'AREA_VISUAL_UNAVAILABLE');
  const scene = effectiveSceneConfigOf(combat);
  if(scene.mode !== 'grid-2d') throw new HttpError('A prévia exige um grid.',409,'AREA_VISUAL_UNAVAILABLE');
  let area: CombatAreaVisualPayload['area'] = null;
  let privateOnly = false;
  if(input.placement) {
    const {combatantId,abilityId,origin,angle}=input.placement;
    const unit=combat.combatants.find(c=>c.id===combatantId);
    const ability=unit?.creature && creatureAbilitiesOf(unit.creature.abilities).find(a=>a.id===abilityId);
    if(!unit || !ability?.area || ability.execution !== 'area-save-damage') throw new HttpError('Habilidade em área não encontrada.',400,'CREATURE_AREA_REQUIRED');
    if(origin.xFeet>scene.widthFeet || origin.yFeet>scene.heightFeet) throw new HttpError('Posicione a área dentro do grid.',400,'AREA_VISUAL_OUTSIDE');
    privateOnly=unit.spatialVisibility==='master-only';
    // Apenas dados necessários ao desenho; nunca a definição inteira ou os candidatos.
    area={combatantId,origin,angle,shape:ability.area.shape,damageType:ability.area.damage[0]?.type};
  }
  const now=Date.now();
  for(const [key,value] of received) if(now-value.at>300_000) received.delete(key);
  const key=`${combatId}:${author.sub}:${input.previewId}`;
  const previous=received.get(key);
  if(previous && (previous.closed || previous.sequence>=input.sequence)) return {shared:false};
  if(received.size>=256 && !previous) received.delete(received.keys().next().value!);
  received.set(key,{sequence:input.sequence,closed:!area,at:now});
  const payload:CombatAreaVisualPayload={previewId:input.previewId,sequence:input.sequence,combatId,authorId:author.sub,
    expiresAt:now+6000,area};
  getBroadcaster().toMasters(ServerEvents.COMBAT_AREA_VISUAL,payload);
  // Ocultar o autor também limpa uma prévia pública anterior da mesma sessão.
  getBroadcaster().toPlayers(ServerEvents.COMBAT_AREA_VISUAL,privateOnly?{...payload,area:null}:payload);
  return {shared:true};
}
