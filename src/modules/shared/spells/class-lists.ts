import { SPELL_CLASS_KEYS, type SpellClassKey, type SpellSchool } from './types.js';

/**
 * Listas de magias das 8 classes conjuradoras "base" do PHB 2014 (cap. 11).
 *
 * É a FONTE ÚNICA do vínculo magia ↔ classe: cada linha traz os ids (estáveis)
 * das magias daquela lista. O campo `classes` de cada `Spell` é derivado daqui
 * ao montar `SPELLS` (ver `index.ts`), então não há dado duplicado por magia.
 *
 * Cavaleiro Arcano e Trapaceiro Arcano não aparecem: eles usam a lista do Mago
 * com a restrição de escola da subclasse (ver `THIRD_CASTER_*` abaixo).
 */
const RAW_CLASS_LISTS: Record<SpellClassKey, string> = {
  bard: 'blade-ward,dancing-lights,friends,light,mage-hand,mending,message,minor-illusion,prestidigitation,true-strike,vicious-mockery,animal-friendship,bane,charm-person,comprehend-languages,cure-wounds,detect-magic,disguise-self,dissonant-whispers,faerie-fire,feather-fall,healing-word,heroism,identify,illusory-script,longstrider,silent-image,sleep,speak-with-animals,tashas-hideous-laughter,thunderwave,unseen-servant,animal-messenger,blindness-deafness,calm-emotions,cloud-of-daggers,crown-of-madness,detect-thoughts,enhance-ability,enthrall,heat-metal,hold-person,invisibility,knock,lesser-restoration,locate-animals-or-plants,locate-object,magic-mouth,phantasmal-force,see-invisibility,shatter,silence,suggestion,zone-of-truth,bestow-curse,clairvoyance,dispel-magic,fear,feign-death,glyph-of-warding,hypnotic-pattern,leomunds-tiny-hut,major-image,nondetection,plant-growth,sending,speak-with-dead,speak-with-plants,stinking-cloud,tongues,compulsion,confusion,dimension-door,freedom-of-movement,greater-invisibility,hallucinatory-terrain,locate-creature,polymorph,animate-objects,awaken,dominate-person,dream,geas,greater-restoration,hold-monster,legend-lore,mass-cure-wounds,mislead,modify-memory,planar-binding,raise-dead,scrying,seeming,teleportation-circle,eyebite,find-the-path,guards-and-wards,mass-suggestion,ottos-irresistible-dance,programmed-illusion,true-seeing,etherealness,forcecage,mirage-arcane,mordenkainens-magnificent-mansion,mordenkainens-sword,project-image,regenerate,resurrection,symbol,teleport,dominate-monster,feeblemind,glibness,mind-blank,power-word-stun,foresight,power-word-heal,power-word-kill,true-polymorph',
  cleric: 'guidance,light,mending,resistance,sacred-flame,spare-the-dying,thaumaturgy,bane,bless,burning-hands,charm-person,command,create-or-destroy-water,cure-wounds,detect-evil-and-good,detect-magic,detect-poison-and-disease,disguise-self,divine-favor,faerie-fire,fog-cloud,guiding-bolt,healing-word,identify,inflict-wounds,protection-from-evil-and-good,purify-food-and-drink,sanctuary,shield-of-faith,speak-with-animals,thunderwave,aid,augury,barkskin,blindness-deafness,calm-emotions,continual-flame,enhance-ability,find-traps,flaming-sphere,gentle-repose,gust-of-wind,hold-person,lesser-restoration,locate-object,magic-weapon,mirror-image,pass-without-trace,prayer-of-healing,protection-from-poison,scorching-ray,shatter,silence,spike-growth,spiritual-weapon,suggestion,warding-bond,zone-of-truth,animate-dead,beacon-of-hope,bestow-curse,blink,call-lightning,clairvoyance,create-food-and-water,daylight,dispel-magic,feign-death,glyph-of-warding,magic-circle,mass-healing-word,meld-into-stone,nondetection,plant-growth,protection-from-energy,remove-curse,revivify,sending,sleet-storm,speak-with-dead,spirit-guardians,tongues,water-walk,wind-wall,arcane-eye,banishment,confusion,control-water,death-ward,dimension-door,divination,dominate-beast,freedom-of-movement,guardian-of-faith,ice-storm,locate-creature,polymorph,stone-shape,stoneskin,wall-of-fire,commune,contagion,dispel-evil-and-good,dominate-person,flame-strike,geas,greater-restoration,hallow,hold-monster,insect-plague,legend-lore,mass-cure-wounds,modify-memory,planar-binding,raise-dead,scrying,tree-stride,blade-barrier,create-undead,find-the-path,forbiddance,harm,heal,heroes-feast,planar-ally,true-seeing,word-of-recall,conjure-celestial,divine-word,etherealness,fire-storm,plane-shift,regenerate,resurrection,symbol,antimagic-field,control-weather,earthquake,holy-aura,astral-projection,gate,mass-heal,true-resurrection',
  druid: 'druidcraft,guidance,mending,poison-spray,produce-flame,resistance,shillelagh,thorn-whip,animal-friendship,charm-person,create-or-destroy-water,cure-wounds,detect-magic,detect-poison-and-disease,entangle,faerie-fire,fog-cloud,goodberry,healing-word,jump,longstrider,purify-food-and-drink,speak-with-animals,thunderwave,animal-messenger,barkskin,beast-sense,blur,darkness,darkvision,enhance-ability,find-traps,flame-blade,flaming-sphere,gust-of-wind,heat-metal,hold-person,invisibility,lesser-restoration,locate-animals-or-plants,locate-object,melfs-acid-arrow,mirror-image,misty-step,moonbeam,pass-without-trace,protection-from-poison,silence,spider-climb,spike-growth,web,call-lightning,conjure-animals,create-food-and-water,daylight,dispel-magic,feign-death,gaseous-form,haste,lightning-bolt,meld-into-stone,plant-growth,protection-from-energy,sleet-storm,slow,speak-with-plants,stinking-cloud,water-breathing,water-walk,wind-wall,blight,confusion,conjure-minor-elementals,conjure-woodland-beings,control-water,divination,dominate-beast,freedom-of-movement,giant-insect,grasping-vine,greater-invisibility,hallucinatory-terrain,ice-storm,locate-creature,polymorph,stone-shape,stoneskin,wall-of-fire,antilife-shell,awaken,cloudkill,commune-with-nature,cone-of-cold,conjure-elemental,contagion,dream,geas,greater-restoration,insect-plague,mass-cure-wounds,passwall,planar-binding,reincarnate,scrying,tree-stride,wall-of-stone,conjure-fey,find-the-path,heal,heroes-feast,move-earth,sunbeam,transport-via-plants,wall-of-thorns,wind-walk,fire-storm,mirage-arcane,regenerate,reverse-gravity,animal-shapes,antipathy-sympathy,control-weather,earthquake,feeblemind,sunburst,tsunami,foresight,shapechange,storm-of-vengeance,true-resurrection',
  paladin: 'compelled-duel,searing-smite,thunderous-smite,wrathful-smite,aura-of-vitality,blinding-smite,crusaders-mantle,elemental-weapon,aura-of-life,aura-of-purity,staggering-smite,banishing-smite,circle-of-power,destructive-wave',
  ranger: 'alarm,animal-friendship,cure-wounds,detect-magic,detect-poison-and-disease,ensnaring-strike,fog-cloud,goodberry,hail-of-thorns,hunters-mark,jump,longstrider,speak-with-animals,animal-messenger,barkskin,beast-sense,cordon-of-arrows,darkvision,find-traps,lesser-restoration,locate-animals-or-plants,locate-object,pass-without-trace,protection-from-poison,silence,spike-growth,conjure-animals,conjure-barrage,daylight,elemental-weapon,lightning-arrow,nondetection,plant-growth,protection-from-energy,speak-with-plants,water-breathing,water-walk,wind-wall,conjure-woodland-beings,freedom-of-movement,grasping-vine,locate-creature,stoneskin,commune-with-nature,conjure-volley,swift-quiver,tree-stride',
  sorcerer: 'acid-splash,blade-ward,chill-touch,dancing-lights,fire-bolt,friends,light,mage-hand,mending,message,minor-illusion,poison-spray,prestidigitation,ray-of-frost,shocking-grasp,true-strike,burning-hands,charm-person,chromatic-orb,color-spray,comprehend-languages,detect-magic,disguise-self,expeditious-retreat,false-life,feather-fall,fog-cloud,jump,mage-armor,magic-missile,ray-of-sickness,shield,silent-image,sleep,thunderwave,witch-bolt,alter-self,blindness-deafness,blur,cloud-of-daggers,crown-of-madness,darkness,darkvision,detect-thoughts,enhance-ability,enlarge-reduce,gust-of-wind,hold-person,invisibility,knock,levitate,mirror-image,misty-step,phantasmal-force,scorching-ray,see-invisibility,shatter,spider-climb,suggestion,web,blink,clairvoyance,counterspell,daylight,dispel-magic,fear,fireball,fly,gaseous-form,haste,hypnotic-pattern,lightning-bolt,major-image,protection-from-energy,sleet-storm,slow,stinking-cloud,tongues,water-breathing,water-walk,banishment,blight,confusion,dimension-door,dominate-beast,greater-invisibility,ice-storm,polymorph,stoneskin,wall-of-fire,animate-objects,cloudkill,cone-of-cold,creation,dominate-person,hold-monster,insect-plague,seeming,telekinesis,teleportation-circle,wall-of-stone,arcane-gate,chain-lightning,circle-of-death,disintegrate,eyebite,globe-of-invulnerability,mass-suggestion,move-earth,sunbeam,true-seeing,delayed-blast-fireball,etherealness,finger-of-death,fire-storm,plane-shift,prismatic-spray,reverse-gravity,teleport,dominate-monster,earthquake,incendiary-cloud,power-word-stun,sunburst,tsunami,gate,meteor-swarm,power-word-kill,time-stop,wish',
  warlock: 'blade-ward,chill-touch,eldritch-blast,friends,mage-hand,minor-illusion,poison-spray,prestidigitation,true-strike,armor-of-agathys,arms-of-hadar,burning-hands,charm-person,command,comprehend-languages,expeditious-retreat,faerie-fire,hellish-rebuke,hex,illusory-script,protection-from-evil-and-good,sleep,tashas-hideous-laughter,unseen-servant,witch-bolt,blindness-deafness,calm-emotions,cloud-of-daggers,crown-of-madness,darkness,detect-thoughts,enthrall,hold-person,invisibility,mirror-image,misty-step,ray-of-enfeeblement,scorching-ray,shatter,spider-climb,suggestion,blink,clairvoyance,counterspell,dispel-magic,fear,fly,gaseous-form,hunger-of-hadar,hypnotic-pattern,magic-circle,major-image,plant-growth,remove-curse,sending,stinking-cloud,tongues,vampiric-touch,banishment,blight,dimension-door,dominate-beast,evards-black-tentacles,fire-shield,greater-invisibility,hallucinatory-terrain,wall-of-fire,contact-other-plane,dominate-person,dream,flame-strike,hallow,hold-monster,scrying,seeming,telekinesis,arcane-gate,circle-of-death,conjure-fey,create-undead,eyebite,flesh-to-stone,mass-suggestion,true-seeing,etherealness,finger-of-death,forcecage,plane-shift,demiplane,dominate-monster,feeblemind,glibness,power-word-stun,astral-projection,foresight,imprisonment,power-word-kill,true-polymorph',
  wizard: 'acid-splash,blade-ward,chill-touch,dancing-lights,fire-bolt,friends,light,mage-hand,mending,message,minor-illusion,poison-spray,prestidigitation,ray-of-frost,shocking-grasp,true-strike,alarm,burning-hands,charm-person,chromatic-orb,color-spray,comprehend-languages,detect-magic,disguise-self,expeditious-retreat,false-life,feather-fall,find-familiar,fog-cloud,grease,identify,illusory-script,jump,longstrider,mage-armor,magic-missile,protection-from-evil-and-good,ray-of-sickness,shield,silent-image,sleep,tashas-hideous-laughter,tensers-floating-disk,thunderwave,unseen-servant,witch-bolt,alter-self,arcane-lock,blindness-deafness,blur,cloud-of-daggers,continual-flame,crown-of-madness,darkness,darkvision,detect-thoughts,enlarge-reduce,flaming-sphere,gentle-repose,gust-of-wind,hold-person,invisibility,knock,levitate,locate-object,magic-mouth,magic-weapon,melfs-acid-arrow,mirror-image,misty-step,nystuls-magic-aura,phantasmal-force,ray-of-enfeeblement,rope-trick,scorching-ray,see-invisibility,shatter,spider-climb,suggestion,web,animate-dead,bestow-curse,blink,clairvoyance,counterspell,dispel-magic,fear,feign-death,fireball,fly,gaseous-form,glyph-of-warding,haste,hypnotic-pattern,leomunds-tiny-hut,lightning-bolt,magic-circle,major-image,nondetection,phantom-steed,protection-from-energy,remove-curse,sending,sleet-storm,slow,stinking-cloud,tongues,vampiric-touch,water-breathing,arcane-eye,banishment,blight,confusion,conjure-minor-elementals,control-water,dimension-door,evards-black-tentacles,fabricate,fire-shield,greater-invisibility,hallucinatory-terrain,ice-storm,leomunds-secret-chest,locate-creature,mordenkainens-faithful-hound,mordenkainens-private-sanctum,otilukes-resilient-sphere,phantasmal-killer,polymorph,stone-shape,stoneskin,wall-of-fire,animate-objects,bigbys-hand,cloudkill,cone-of-cold,conjure-elemental,contact-other-plane,creation,dominate-person,dream,geas,hold-monster,legend-lore,mislead,modify-memory,passwall,planar-binding,rarys-telepathic-bond,scrying,seeming,telekinesis,teleportation-circle,wall-of-force,wall-of-stone,arcane-gate,chain-lightning,circle-of-death,contingency,create-undead,disintegrate,drawmijs-instant-summons,eyebite,flesh-to-stone,globe-of-invulnerability,guards-and-wards,magic-jar,mass-suggestion,move-earth,otilukes-freezing-sphere,ottos-irresistible-dance,programmed-illusion,sunbeam,true-seeing,wall-of-ice,delayed-blast-fireball,etherealness,finger-of-death,forcecage,mirage-arcane,mordenkainens-magnificent-mansion,mordenkainens-sword,plane-shift,prismatic-spray,project-image,reverse-gravity,sequester,simulacrum,symbol,teleport,antimagic-field,antipathy-sympathy,clone,control-weather,demiplane,dominate-monster,feeblemind,incendiary-cloud,maze,mind-blank,power-word-stun,sunburst,telepathy,tsunami,astral-projection,foresight,gate,imprisonment,meteor-swarm,power-word-kill,prismatic-wall,shapechange,time-stop,true-polymorph,weird,wish',
};

/** Lista de cada classe, já como array. */
export const CLASS_SPELL_LISTS: Record<SpellClassKey, readonly string[]> = Object.fromEntries(
  SPELL_CLASS_KEYS.map((key) => [key, RAW_CLASS_LISTS[key].split(',')]),
) as unknown as Record<SpellClassKey, readonly string[]>;

/** Mapa inverso: id da magia → classes que a conhecem. */
export const SPELL_CLASSES_BY_ID: ReadonlyMap<string, readonly SpellClassKey[]> = (() => {
  const map = new Map<string, SpellClassKey[]>();
  for (const key of SPELL_CLASS_KEYS) {
    for (const id of CLASS_SPELL_LISTS[key]) {
      const current = map.get(id);
      if (current) current.push(key);
      else map.set(id, [key]);
    }
  }
  return map;
})();

/** Classes que conhecem uma magia (vazio quando não está em nenhuma lista base). */
export function spellClassesFor(id: string): SpellClassKey[] {
  return [...(SPELL_CLASSES_BY_ID.get(id) ?? [])];
}

// ---------------------------------------------------------------------------
// Cavaleiro Arcano e Trapaceiro Arcano (terço-conjuradores de Inteligência)
// ---------------------------------------------------------------------------

/**
 * Escolas permitidas por subclasse terço-conjuradora. Fora das escolas listadas,
 * a magia só pode ser aprendida nos níveis "livres" (ver `THIRD_CASTER_FREE_LEVELS`).
 */
export const THIRD_CASTER_SCHOOLS: Record<string, readonly SpellSchool[]> = {
  'eldritch-knight': ['abjuration', 'evocation'],
  'arcane-trickster': ['enchantment', 'illusion'],
};

/**
 * Níveis em que o terço-conjurador pode aprender magia de QUALQUER escola
 * (PHB: as magias aprendidas nos níveis 8, 14 e 20 da subclasse).
 */
export const THIRD_CASTER_FREE_LEVELS: Record<string, readonly number[]> = {
  'eldritch-knight': [8, 14, 20],
  'arcane-trickster': [8, 14, 20],
};

/** A magia é válida para a subclasse terço-conjuradora neste nível dela? */
export function thirdCasterAllowsSpell(
  subclassId: string,
  school: SpellSchool,
  subclassLevel: number,
): boolean {
  const schools = THIRD_CASTER_SCHOOLS[subclassId];
  if (!schools) return true;
  if ((THIRD_CASTER_FREE_LEVELS[subclassId] ?? []).includes(subclassLevel)) return true;
  return schools.includes(school);
}
