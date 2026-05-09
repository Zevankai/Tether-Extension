import OBR from "@owlbear-rodeo/sdk";
import { useState, useCallback, useRef, useEffect } from "react";

/* ── fonts ── */
if (!document.querySelector('link[data-tether-fonts="true"]')) {
  const _fl = document.createElement("link");
  _fl.rel = "stylesheet";
  _fl.href = "https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@400;700&family=Cinzel:wght@400;600&family=IM+Fell+English:ital@0;1&display=swap";
  _fl.dataset.tetherFonts = "true";
  document.head.appendChild(_fl);
}

/* ══════════════════════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════════════════════ */
const statMod = v => Math.ceil(Math.max(1,v)/5);
const modStr  = v => { const m=statMod(v); return m>=0?`+${m}`:`${m}`; };
const TMIN=-10,TMAX=10,BMIN=-6,BMAX=6;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const tetherLabel=v=>v===0?{text:"0 — Neutral",color:"var(--neutral)"}
  :v>0?{text:`${v}G — Grace`,color:"var(--grace)"}
  :{text:`${Math.abs(v)}D — Dread`,color:"var(--dread)"};
const baselineLabel=v=>v===0?"Neutral":v>0?`${v}G`:`${Math.abs(v)}D`;
let _uid=0; const uid=()=>`u${++_uid}`;
const ROOM_STATE_KEY = "io.github.zevankai.tether-extension/state";
const LOCAL_STATE_KEY = "tether-extension/local-state";
const DEFAULT_EXTENSION_STATE = {
  players: [],
  gmCritNumber: null,
  activeTimers: [],
  gmDreadPool: 0,
  dreadVisible: true,
  playerChars: {},
};

const hasObrSdk = () => typeof OBR?.onReady === "function";
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const normalizeExtensionState = raw => {
  if (!isObject(raw)) return DEFAULT_EXTENSION_STATE;

  const players = Array.isArray(raw.players)
    ? raw.players.filter(player => isObject(player) && typeof player.id === "string" && typeof player.name === "string")
    : DEFAULT_EXTENSION_STATE.players;
  const playerChars = isObject(raw.playerChars)
    ? Object.fromEntries(
        Object.entries(raw.playerChars).map(([playerId, chars]) => [playerId, Array.isArray(chars) ? chars : []])
      )
    : DEFAULT_EXTENSION_STATE.playerChars;

  return {
    players,
    gmCritNumber: Number.isInteger(raw.gmCritNumber) && raw.gmCritNumber >= 1 && raw.gmCritNumber <= 12 ? raw.gmCritNumber : null,
    activeTimers: Array.isArray(raw.activeTimers) ? raw.activeTimers : DEFAULT_EXTENSION_STATE.activeTimers,
    gmDreadPool: typeof raw.gmDreadPool === "number" ? clamp(Math.round(raw.gmDreadPool), 0, 12) : DEFAULT_EXTENSION_STATE.gmDreadPool,
    dreadVisible: typeof raw.dreadVisible === "boolean" ? raw.dreadVisible : DEFAULT_EXTENSION_STATE.dreadVisible,
    playerChars,
  };
};

// Competency points granted per level-up
const COMP_POINTS_PER_LEVEL = l => [3,6,9,12].includes(l) ? 3 : 1;
const LEVELUP_STAT_LEVELS = [5,8,10,12];
const COMP_STAT_LEVELS = Array.from({length:12},(_,i)=>i+1); // every level

/* ══════════════════════════════════════════════════════════════════════════════
   GAME DATA
══════════════════════════════════════════════════════════════════════════════ */
const CRADLES = ["Human","Elf","Dwarf","Kin","Scum","Gnome","Goblin","Goliath","Dravik","Myrin"];

// Cradle Qualities: each cradle has qualities at levels 1,3,5,7,9,12 with options A and B
const CRADLE_QUALITIES = {
  Human:{
    1:[
      {id:"human_1a",label:"Lead by Example",desc:"When you spend Stress to gain Advantage on a roll, one ally within Close range also gains Advantage on their next roll before the end of the round."},
      {id:"human_1b",label:"Powder Burn",desc:"You begin play with a crude firearm (flintlock pistol: 1d6 Ballistic, Swift, 30/120 ft, 4 Fracture max). You deal +1d4 damage with all firearms."},
    ],
    3:[
      {id:"human_3a",label:"Grit and Bear It",desc:"Gain a pool of Grit Points equal to 1d4 (rolled at each Long Rest). Bonus action: spend 1 Grit Point to remove 1 Stress. Unspent Grit Points reset on Long Rest."},
      {id:"human_3b",label:"Parry Expert",desc:"When you use the Parry action and roll a 1 or 4 on the fracture die, your weapon takes no fractures from the parry."},
    ],
    5:[
      {id:"human_5a",label:"Legend in the Making",desc:"Create one additional positive Chronicle. Write its backstory, select its Competency, gain +2 to that Competency. You may spend Stress for Advantage on rolls tied to it."},
      {id:"human_5b",label:"Joint Assault",desc:"If an ally already attacked the same target this round (before your attack), you deal +1d6 damage on your attack against that target."},
    ],
    7:[
      {id:"human_7a",label:"Support System",desc:"As an action, remove 1 Stress from all allies within Close range (not yourself). Usable once per Long Rest."},
      {id:"human_7b",label:"Master of Metal",desc:"When you use a Gear Kit to repair equipment, you may also restore 1d4 Armor to the item's owner (cannot exceed max Armor)."},
    ],
    9:[
      {id:"human_9a",label:"Indomitable",desc:"The first time you reach 0 HP each Long Rest, immediately stabilize at 1 HP instead of entering a Death State. You still gain a Critical Injury. Gain 1d4 Grit Points when this triggers."},
      {id:"human_9b",label:"Expert Saboteur",desc:"Your firearms and explosives ignore enemy Armor values of 2 or lower (treat as 0 for your damage calculation only)."},
    ],
    12:[
      {id:"human_12a",label:"Paragon",desc:"Lead by Example (if taken) works even without being Human. If not taken, instead choose one ally at session start — they gain +1 to all rolls within Close range of you."},
      {id:"human_12b",label:"Expert of Your Craft",desc:"Choose one Competency you possess. It becomes an Expertise: all rolls using this Competency are made with Advantage."},
    ],
  },
  Elf:{
    1:[
      {id:"elf_1a",label:"Resonant Echo",desc:"When you cast a spell costing 2+ Mana, you may reduce its damage by 1 to reduce the Mana cost by 1. Cannot reduce below 1 Mana."},
      {id:"elf_1b",label:"Fleet of Foot",desc:"Your base movement speed increases by +5 ft."},
    ],
    3:[
      {id:"elf_3a",label:"Elegant Deflection",desc:"While wearing no armor or light attire, gain +1 to your d20 roll when defending against melee attacks."},
      {id:"elf_3b",label:"Piercing Gaze",desc:"You can see through non-magical darkness and magical fog up to Close range. Does not grant vision through solid objects."},
    ],
    5:[
      {id:"elf_5a",label:"Arcane Sharpshooter",desc:"When attacking with a Bow or Wand, you may use Soul instead of Mind for the to-hit roll."},
      {id:"elf_5b",label:"Highborn Discourse",desc:"Advantage on Influence rolls when interacting with authority figures (nobles, officers, magistrates) or magical beings."},
    ],
    7:[
      {id:"elf_7a",label:"Flowing Formless",desc:"Once per Short or Long Rest, reroll a failed Arcana check. You must take the second result even if worse."},
      {id:"elf_7b",label:"Wind-Walker",desc:"Ignore movement penalties from difficult terrain. You can move across liquid surfaces provided you end your movement on solid ground."},
    ],
    9:[
      {id:"elf_9a",label:"Spell-Weaver",desc:"When you cast a single-target spell, spend 2 additional Stress to target one additional enemy within range. Roll to hit the second target separately."},
      {id:"elf_9b",label:"Astral Aim",desc:"Your ranged attacks (projectile and magical) ignore penalties from dim light and partial cover."},
    ],
    12:[
      {id:"elf_12a",label:"Avatar of Resonance",desc:"Your maximum Mana increases by +3."},
      {id:"elf_12b",label:"Timeless Grace",desc:"Gain a permanent +1 to your Soul Pillar. Applies to all Soul-based rolls and recalculates derived values."},
    ],
  },
  Scum:{
    1:[
      {id:"scum_1a",label:"Six-Fingered Grip",desc:"Advantage on rolls to disarm an opponent or climb vertical surfaces."},
      {id:"scum_1b",label:"Mean Streets",desc:"Unarmed strikes deal 1d4 + Body (instead of standard 1d4). Your claws deal Blade damage instead of Bludgeon."},
    ],
    3:[
      {id:"scum_3a",label:"Vile Instincts",desc:"(Requires Path of Dread) When your Tether Roll lands on Dread (1–6), gain +1 to your next to-hit roll. Expires before your next turn."},
      {id:"scum_3b",label:"Hopeful Convert",desc:"(Requires Path of Grace) When your Tether Roll lands on Grace (7–12), gain +1 to your next non-combat d20 roll. Expires before your next turn."},
    ],
    5:[
      {id:"scum_5a",label:"Cheap Shot",desc:"When you attack a flanked, prone, blinded, grappled, or unaware target, deal +1d6 damage."},
      {id:"scum_5b",label:"Dirty Fighter",desc:"Bonus action: throw dirt at a target within Close range. Target rolls Mind vs. your Body or is Blinded until end of their next turn. Once per encounter."},
    ],
    7:[
      {id:"scum_7a",label:"Slip the Noose",desc:"Spend 1 Stress to automatically succeed on any roll to escape a Grapple, mundane restraint, or non-permanent magical restraint."},
      {id:"scum_7b",label:"Acid Blooded",desc:"Immune to Poisoned. Reduce max HP by 2. Creatures that deal melee damage with natural weapons take 1d4 acid. Once per Long Rest: craft a Blood Bomb (20ft, 2d4 acid, 5ft radius)."},
    ],
    9:[
      {id:"scum_9a",label:"Chaos Dealer",desc:"When your Tether Roll matches the encounter's crit number, you move 3 steps on the Tether instead of 2."},
      {id:"scum_9b",label:"Hidden Blade",desc:"Conceal up to two Swift weapons so effectively they cannot be found by mundane searches. Only magical detection can reveal them."},
    ],
    12:[
      {id:"scum_12a",label:"Scum of the Earth",desc:"Once per Long Rest, force the GM to reroll any die and take the second result. Declare before outcome resolves. Costs 2 Stress."},
      {id:"scum_12b",label:"Unstoppable",desc:"When reduced to 0 HP, continue acting for 1 full round before choosing a Death State. Cannot be healed above 0 HP during this round. Still gain 3 Trauma."},
    ],
  },
  Dwarf:{
    1:[
      {id:"dwarf_1a",label:"Thick Skinned",desc:"Your maximum HP increases by +3."},
      {id:"dwarf_1b",label:"Grudge Bearer",desc:"Choose one enemy type. You gain +1 to all to-hit rolls against creatures of that type permanently."},
    ],
    3:[
      {id:"dwarf_3a",label:"Deep Sense",desc:"Detect shifts in air pressure within 30ft — sense presence and direction of moving creatures through walls or darkness. Requires a Mind roll (DC set by GM)."},
      {id:"dwarf_3b",label:"Steady Footing",desc:"Cannot be knocked prone or forcibly moved by non-magical effects. Magical effects grant you Advantage on the resistance roll."},
    ],
    5:[
      {id:"dwarf_5a",label:"Forge-Hardened",desc:"Your maximum Armor increases by +1."},
      {id:"dwarf_5b",label:"Earth-Mover",desc:"Advantage on Strength rolls to break, move, or shape stone and heavy metals (walls, bars, tunnels)."},
    ],
    7:[
      {id:"dwarf_7a",label:"Dalga's Blessing",desc:"Once per Long Rest, bonus action: restore 1d4 HP to yourself (cannot exceed max HP)."},
      {id:"dwarf_7b",label:"Heavy Momentum",desc:"If you move at least 10ft in a straight line before a melee attack, deal +1d4 damage on that attack."},
    ],
    9:[
      {id:"dwarf_9a",label:"Master Smith",desc:"You can repair gear of any quality, including Masterwork. Your Crafting Competency increases by +2 for all repair-related rolls."},
      {id:"dwarf_9b",label:"Unshakable Wall",desc:"While wearing Heavy Armor, gain Resistance (half damage) to physical melee from Standard-tier or lower enemies."},
    ],
    12:[
      {id:"dwarf_12a",label:"Living Fortress",desc:"Your maximum Armor increases by +2."},
      {id:"dwarf_12b",label:"Mountain's Heart",desc:"Gain a permanent +2 to all Resilience Competency rolls."},
    ],
  },
  Goliath:{
    1:[
      {id:"goliath_1a",label:"Colossal Reach",desc:"Your melee attacks have an additional 5ft of range. Stacks with Reach weapons (15ft total with a pike or spear)."},
      {id:"goliath_1b",label:"Burden Lifter",desc:"Maximum Load +15. You can carry a Medium or smaller creature on your back without penalty (movement halved)."},
    ],
    3:[
      {id:"goliath_3a",label:"Intimidating Bulk",desc:"Use Body instead of Soul for Influence rolls when attempting to Intimidate. Does not apply to other Influence uses."},
      {id:"goliath_3b",label:"Trailblazer",desc:"When you move through difficult terrain, you clear a path. Allies following your exact path treat it as normal terrain until end of round."},
    ],
    5:[
      {id:"goliath_5a",label:"Titan's Grip",desc:"Wield Two-Handed (Heavy) weapons in one hand, freeing the other for a shield or Swift weapon. Cannot dual-wield two Heavy weapons this way."},
      {id:"goliath_5b",label:"Siege Engine",desc:"Deal double damage to inanimate objects and structures. Does not apply to creatures or worn/held equipment."},
    ],
    7:[
      {id:"goliath_7a",label:"Shockwave",desc:"Action: slam the ground. All enemies within Close range roll Body vs. your Strength or are knocked Prone. Once per Short Rest."},
      {id:"goliath_7b",label:"Thick Hide",desc:"Your maximum Armor increases by +1."},
    ],
    9:[
      {id:"goliath_9a",label:"Unstoppable Force",desc:"When you successfully Shove a creature, push them up to 15ft instead of 5ft. If they collide with a wall or creature, both take 1d4 Bludgeon damage."},
      {id:"goliath_9b",label:"Shake It Off",desc:"Once per Long Rest, downgrade one Major or Serious injury by one tier when you suffer it. Traumatic and Critical injuries cannot be downgraded."},
    ],
    12:[
      {id:"goliath_12a",label:"World-Shaker",desc:"Your Strength and Resilience Competencies each increase by +3."},
      {id:"goliath_12b",label:"Guardian Giant",desc:"Reaction: when an adjacent ally takes damage, you take 100% of that damage instead (apply your own Armor). Once per round."},
    ],
  },
  Goblin:{
    1:[
      {id:"goblin_1a",label:"Scavenger's Eye",desc:"When looting, find +1d4 additional coins. Coin type determined by GM based on loot source."},
      {id:"goblin_1b",label:"Nimble Escape",desc:"You do not provoke attacks of opportunity when moving out of an enemy's melee reach."},
    ],
    3:[
      {id:"goblin_3a",label:"Twitchy",desc:"You gain +3 to Initiative rolls."},
      {id:"goblin_3b",label:"Junk Armor",desc:"Once per Long Rest during a rest, craft temporary armor from scrap. Absorbs all damage from one hit, then shatters. Cannot be repaired or worn over existing armor."},
    ],
    5:[
      {id:"goblin_5a",label:"Token Hoarder",desc:"Your maximum Trick Tokens increases from 3 to 5."},
      {id:"goblin_5b",label:"Vexing Poke",desc:"When you spend a Trick Token to force an enemy reroll, that enemy also takes -2 on the rerolled result."},
    ],
    7:[
      {id:"goblin_7a",label:"Cornered Rat",desc:"While your Stress is equal to or greater than half your maximum Stress (rounded up), you gain Advantage on all attack rolls."},
      {id:"goblin_7b",label:"Tunnel Rat",desc:"Squeeze through gaps as small as 6 inches without rolling. Advantage on rolls to escape traps, pits, and cages."},
    ],
    9:[
      {id:"goblin_9a",label:"Master of Mischief",desc:"Spend 2 Trick Tokens to redirect an enemy's attack. Roll Mind vs. their Soul. On success, their next attack hits an ally of theirs instead."},
      {id:"goblin_9b",label:"Explosive Surprise",desc:"When any gear breaks (max Fractures), it detonates dealing 2d4 to all within Close range. You take half damage from your own explosions."},
    ],
    12:[
      {id:"goblin_12a",label:"Goblin King",desc:"Non-hostile Goblins treat you as ally. Advantage on Influence with Goblins. Once per Long Rest: command up to 1d4 Goblin NPCs for one encounter."},
      {id:"goblin_12b",label:"Lucky Devil",desc:"Once per Long Rest, after a Tether Roll, declare it a Critical. Moves 2 steps in the crit direction and triggers racial Crit Ability. Costs 1 Stress."},
    ],
  },
  Gnome:{
    1:[
      {id:"gnome_1a",label:"Clockwork Assistant",desc:"Begin play with a mechanical companion (HP: 1d6, deals 1d4 on your turn using your action). If destroyed, rebuild during Long Rest with DC 14 Crafting + 1 Gear Kit. Failed rebuild adds another Long Rest."},
      {id:"gnome_1b",label:"Illusionist's Spark",desc:"Cast a minor illusion (sound or static image ≤1 cubic foot) at will for 1 Mana. Lasts 1 minute or until dismissed. Cannot deal damage, create light, or interact physically."},
    ],
    3:[
      {id:"gnome_3a",label:"Eye for Detail",desc:"Advantage on rolls to detect hidden compartments, mechanical traps, and illusions. Passive — GM may call for this even without declaring a search."},
      {id:"gnome_3b",label:"Efficient Tinker",desc:"When you use a Gear Kit to repair equipment, restore 2 additional Fractures per repair action (3 total instead of 1)."},
    ],
    5:[
      {id:"gnome_5a",label:"Disruptive Tech",desc:"Action: automatically disable one non-magical mechanical trap within Close range without rolling. Magical traps still require a roll but with +2 bonus."},
      {id:"gnome_5b",label:"Slippery Mind",desc:"Advantage on all rolls to resist being Charmed or Afraid."},
    ],
    7:[
      {id:"gnome_7a",label:"Gravity Boots",desc:"Walk on walls or ceilings for up to 1 minute. Hands must be free (no two-handed weapons). Once per Long Rest."},
      {id:"gnome_7b",label:"Master Chemist",desc:"When you administer Bandages or Potions (to yourself or an ally), the item heals +2 additional HP beyond its normal value."},
    ],
    9:[
      {id:"gnome_9a",label:"Prototype Weapon",desc:"During a Long Rest, modify one non-magical weapon to deal +1d4 elemental damage (Fire, Frost, or Shock). Lasts until next Long Rest. Requires 1 Gear Kit."},
      {id:"gnome_9b",label:"Vanish",desc:"Reaction to taking damage: become invisible until start of your next turn. Attacking or casting ends invisibility. Once per Long Rest."},
    ],
    12:[
      {id:"gnome_12a",label:"Grand Architect",desc:"Gain +2 to all Mind-based Competency rolls (Scholarship, Wilderness, Crafting, Medicine, Awareness)."},
      {id:"gnome_12b",label:"Soul of the Machine",desc:"Communicate with mechanical constructs and animated objects. Advantage on rolls to understand, disable, or modify mechanical devices."},
    ],
  },
  Kin:{
    1:[
      {id:"kin_1a",label:"Shared Burden",desc:"When an ally within Close range gains Stress, you may take that Stress instead. For 2+ Stress, you take half (rounded up) and they take the rest. Once per round."},
      {id:"kin_1b",label:"Mimicry",desc:"After witnessing an ally succeed on a Competency roll you don't possess, gain +1 to that Competency for 1 hour. Only one Mimicry bonus active at a time."},
    ],
    3:[
      {id:"kin_3a",label:"Versatile Heritage",desc:"Choose one Level 1 or Level 3 Cradle Quality from the Human list that you meet requirements for. You gain that quality in addition to your Kinfolk qualities."},
      {id:"kin_3b",label:"Spirit Sense",desc:"Passively sense the general emotional state (hostile, afraid, deceptive, calm, distressed) of any living creature within Close range. GM may withhold info for high-Willpower creatures."},
    ],
    5:[
      {id:"kin_5a",label:"Unity of Purpose",desc:"When you and at least one ally both attack the same target in the same round, gain +2 to your to-hit roll (flat bonus, not Advantage)."},
      {id:"kin_5b",label:"Resilient Soul",desc:"Restore +1 additional Stress during any rest that restores Stress (Short Rest: +2 total. Long Rest: +4 total)."},
    ],
    7:[
      {id:"kin_7a",label:"Adaptive Resistance",desc:"The first time you take elemental damage in an encounter, gain Resistance (half damage) to that element for the rest of the encounter. Only one active at a time."},
      {id:"kin_7b",label:"Soul Link",desc:"Telepathically communicate with willing allies within 100ft. Two-way, words and simple concepts only. Drops if you take damage; re-establish as a bonus action."},
    ],
    9:[
      {id:"kin_9a",label:"Echo of Greatness",desc:"At the start of each session, choose one Stage 1 class ability from a class you don't possess. Use it for the session at normal costs. GM has final approval."},
      {id:"kin_9b",label:"Purifying Breath",desc:"Action: remove one negative Status Effect from yourself or an ally within Close range. Once per Short Rest."},
    ],
    12:[
      {id:"kin_12a",label:"One with Luris",desc:"Gain +1 to one Pillar of your choice (Body, Mind, or Soul). Permanent, applies to all rolls and derived values."},
      {id:"kin_12b",label:"Ever-Changing",desc:"At the start of each Long Rest, swap one Competency for a different Competency within the same Pillar. The swapped Competency retains its bonus level."},
    ],
  },
  Dravik:{
    1:[
      {id:"dravik_1a",label:"Evolved Scales",desc:"Your maximum Armor increases by +1."},
      {id:"dravik_1b",label:"Elemental Breath",desc:"Choose Fire, Frost, or Acid at creation. Action: exhale a 10ft cone dealing 1d6 damage. Costs 2 Stress. Targets roll Body vs. your Body for half damage."},
    ],
    3:[
      {id:"dravik_3a",label:"Dragon's Hunger",desc:"Consume raw meat as a rest action to restore 1d4 HP (replaces normal meal action). Any fresh meat works — no rations required."},
      {id:"dravik_3b",label:"Ancient Lore",desc:"Gain +1 to your Soul Pillar. Applies to all Soul-based rolls and recalculates derived values."},
    ],
    5:[
      {id:"dravik_5a",label:"Terrifying Roar",desc:"Action: all enemies within Close range roll Soul vs. your Body or are Afraid for 1 round (Disadvantage on attacks, cannot move toward you). Once per Short Rest."},
      {id:"dravik_5b",label:"Powerful Leap",desc:"Jump distance tripled. No damage from falls of 30ft or less."},
    ],
    7:[
      {id:"dravik_7a",label:"Potent Breath",desc:"Elemental Breath increases to 2d6 damage and 20ft cone. If not taken at Level 1, you may choose it now at these improved values."},
      {id:"dravik_7b",label:"Burning Blood",desc:"When hit by melee from within 5ft, attacker takes 2 flat elemental damage (choose element when taking this quality). Automatic, no action required."},
    ],
    9:[
      {id:"dravik_9a",label:"Hoard Sense",desc:"Passively detect gold (10+ coins), gemstones, and magical items within 60ft, even through walls or buried. Sense direction and approximate distance."},
      {id:"dravik_9b",label:"Spell-Eater",desc:"When you successfully resist a spell, regain 1 Mana. If at maximum Mana, lose 1 Stress instead."},
    ],
    12:[
      {id:"dravik_12a",label:"Wyrm-Lord",desc:"Elemental Breath increases to 3d6 damage, 30ft cone, costs only 1 Stress. If not previously taken, choose it now at these values."},
      {id:"dravik_12b",label:"Eternal Scales",desc:"Gain Resistance (half damage) to all non-magical physical damage (Blade, Bludgeon, non-magical Ballistic). Magical weapons and spells deal full damage."},
    ],
  },
  Myrin:{
    1:[
      {id:"myrin_1a",label:"Amphibious",desc:"Breathe underwater indefinitely. Swim speed is double walking speed. No penalties for fighting underwater."},
      {id:"myrin_1b",label:"Ethereal Sight",desc:"You can see spirits, ghosts, and Veil-border creatures invisible to others. Always active, extends to Close range."},
    ],
    3:[
      {id:"myrin_3a",label:"Slippery Skin",desc:"Advantage on all rolls to escape grapples, restraints, and the effects of being Stuck or Entangled."},
      {id:"myrin_3b",label:"Tide-Caller",desc:"Create or extinguish small amounts of water or mist at will (no roll, no cost). Fill a container, create a puddle, extinguish a small fire, or produce a 10ft mist cloud."},
    ],
    5:[
      {id:"myrin_5a",label:"Flowing Combat",desc:"When you miss a melee attack, gain +2 to your next to-hit roll against the same target. Stacks once (max +2). Resets on hit or target switch."},
      {id:"myrin_5b",label:"Water Shaping",desc:"Within 10ft of a body of water (large bucket's worth+), shape and hurl it as an action: 1d6 Bludgeon to one target within Close range (Soul to-hit)."},
    ],
    7:[
      {id:"myrin_7a",label:"Misty Form",desc:"Once per Long Rest, bonus action: become semi-transparent for 1 minute. All attacks against you have Disadvantage. Ends early if you deal damage or cast offensive spells."},
      {id:"myrin_7b",label:"Aqueous Healing",desc:"While standing in water (ankle-deep+), restore 1 HP at the start of each of your turns. Automatic, no action required."},
    ],
    9:[
      {id:"myrin_9a",label:"Crushing Depths",desc:"While grappling a creature, it takes 1d6 Bludgeon at the start of your turns. Increases to 1d8 if the grapple occurs underwater."},
      {id:"myrin_9b",label:"Veil Walker",desc:"Once per Long Rest, action: step into the Veil for 1 round. Become incorporeal — immune to physical attacks, move through objects, cannot interact with physical world."},
    ],
    12:[
      {id:"myrin_12a",label:"Ocean's Fury",desc:"Once per Long Rest, within 30ft of significant water: summon a wave as an action. All enemies within 30ft roll Body vs. your Soul or take 3d6 Bludgeon and are knocked Prone."},
      {id:"myrin_12b",label:"Serene Mind",desc:"Resistance to external Stress. When enemy ability, trap, or environment causes Stress, gain half (rounded up, min 1). Voluntary Stress costs are unaffected."},
    ],
  },
};

const QUALITY_UNLOCK_LEVELS=[1,3,5,7,9,12];
const getCradleQualities=(cradle)=>CRADLE_QUALITIES[cradle]??{};
const getAvailableQualities=(cradle,level)=>{
  const all=getCradleQualities(cradle);
  return QUALITY_UNLOCK_LEVELS.filter(l=>l<=level).flatMap(l=>all[l]??[]);
};

/* ── Cradle lore, stats, and features ── */
const CRADLE_DATA={
  Human:{
    identity:"Intelligent and capable leaders who carry explosive potential through sheer persistence.",
    lore:"Long ago, humanity was created by the goddess Elysium to be the \"perfected\" version of life on Luris. The most abundant of all Cradles, Humans have spread far and wide. Versatile, resilient, and ambitious — they lack any innate connection to Resonance, but make up for it with grit and sheer force of will. Humans were early adopters of gunpowder, finding ways to close military gaps through explosives and firearms.",
    features:[
      {name:"Work Ethic",desc:"Humans can take one additional rest action during Short Rests."},
      {name:"Strength in Numbers",desc:"Within Close range of at least one ally, gain +1 to attack rolls. +2 if the ally is also Human."},
      {name:"Flex Point",desc:"During character creation, assign +1 to any single stat (HP, Stress, Mana, or Armor)."},
    ],
    stats:{hp:18,stress:7,mana:4,armor:0},
    flexPoint:true,
    crit:"Lose 1 Stress · Gain 1 Mana",
  },
  Elf:{
    identity:"The elegant, intelligent, and often arrogant primary Resonance users of Luris.",
    lore:"Among Elyndra's firstborn, Elves were shaped alongside the Myrin in the earliest days of Luris — set free to rule the land while the Myrin ruled the seas. Standing taller than Humans, Elves are born with an innate connection to Resonance that no other Cradle possesses naturally. Their society revolves around the mastery of magic, diplomacy, and influence — the only civilization that rivals humanity's sprawl across Luris. They are physically fragile, built for finesse rather than fortitude.",
    features:[
      {name:"Innate Resonance",desc:"Cast one spell of level 4 or under per Long Rest at no Mana cost. Increases to level 8 or under at level 10."},
      {name:"Arcane Recovery",desc:"The first time per Tether Reset that your Tether reaches 8G or higher, regain 2 Mana. Cannot trigger again until Tether resets."},
      {name:"Fragile Frame",desc:"Disadvantage on Body rolls to resist physical effects (grapples, shoves, knockdowns, forced movement)."},
    ],
    stats:{hp:15,stress:5,mana:10,armor:0},
    crit:"Gain 2 Mana · Lose 1 Stress",
  },
  Dwarf:{
    identity:"Devoted masters of endurance and craftsmanship.",
    lore:"The Dwarves were born of the mountains by the god Dalga. When Aelvoryn's conspiracy threatened all mortal life, Dalga left the Veil permanently and created Dalga's Eye — a private sanctuary within the Veil accessible only to his children. The Goliaths left the mountains; the Dwarves stayed and built their civilization among Dalga's bones. Short, stocky, and impossibly sturdy, Dwarves are born with a natural resistance to physical punishment. Their culture revolves around endurance, craftsmanship, and devotion to the Mountain.",
    features:[
      {name:"Stoneborn",desc:"Natural immunity to non-magical poison and diseases."},
      {name:"Dalga's Presence",desc:"Once per Long Rest, commune with the Mountain: restore 1 Armor and remove 1 Stress. Underground: restore 2 Armor and remove 2 Stress."},
      {name:"Short Stride",desc:"Reduced base movement speed (25 ft vs standard 30 ft). Cannot be increased by abilities or equipment."},
    ],
    stats:{hp:16,stress:8,mana:4,armor:2},
    crit:"Gain 1 Armor point (max 5) · Lose 1 Stress",
  },
  Kin:{
    identity:"Adaptive survivors who draw strength from community, wit, and an unshakable refusal to stay down.",
    lore:"The goddess Elysium created the Kinfolk alongside Humans as the culmination of her experiments with mortal life on Luris. Where Humans were designed for ambition and expansion, Kinfolk were designed for connection and endurance. Small and wiry, standing a head or two shorter than Humans — easy to underestimate, which suits them fine. Natural collaborators, quick learners, and fiercely protective of those they consider family. There is a quiet stubbornness to the Kinfolk that outsiders rarely see until it's too late. They bend. They adapt. But they do not break.",
    features:[
      {name:"Shared Spirit",desc:"When you and at least one ally are within Close range, both gain +1 to rolls made to resist negative Status Effects (Charmed, Afraid, Poisoned, Stunned, Blinded, Weakened, Bleeding). You must be conscious."},
      {name:"Quick Study",desc:"Once per Short Rest, after failing a Competency roll, immediately reroll it with +1. Must take the second result."},
      {name:"Small Frame",desc:"Difficulty wielding Heavy weapons — movement reduced to 15 ft/turn while wielding one. Cannot dual-wield Heavy weapons."},
    ],
    stats:{hp:17,stress:7,mana:5,armor:1},
    crit:"Lose 1 Stress · Gain +2 to a future d20 roll of your choice (or an ally's roll) before end of next turn",
  },
  Scum:{
    identity:"Enduring survivalists who thrive in high risk/high reward situations.",
    lore:"The goddess Elysium created the Scum alongside the Gnomes as her earliest experiments with mortal life on Luris. Though she would later dismiss them as \"failures\", the Scum endured. They bear a striking resemblance to Humans, but the differences reveal themselves quickly: six clawed fingers on each hand, ears inlaid flush against their skulls, and solid black eyes that afford exceptional vision in the dark. They are drawn to chaos the way others are drawn to warmth, thriving where most would falter. Cunning, scrappy, and fiercely loyal to their own — the most dangerous hand-to-hand combatants on Luris. Their name was given to them by those who feared what they could not control. The Scum wear it, nonetheless.",
    features:[
      {name:"Darkvision",desc:"Exceptional vision in low-light and dark. In bright light without darkened sun-goggles: Disadvantage on rolls targeting anything beyond 15 ft and gain 1 Stress at encounter start. Goggles negate both."},
      {name:"Path-Side Benefits",desc:"Immune to charm and fear effects when the Tether Bar is at least 4 within your chosen Path direction."},
    ],
    stats:{hp:17,stress:10,mana:2,armor:1},
    crit:"Lose 1 Stress · Move Tether one extra space",
  },
  Gnome:{
    identity:"Patient inventors and quiet problem-solvers with an instinctive connection to Resonance and an insatiable need to understand how everything works.",
    lore:"Like the Scum, Gnomes were among the earliest experiments of the goddess Elysium — shaped when she was still learning what mortal life could be. She would later call them failures. The Gnomes, characteristically, didn't care. Small even by small-folk standards, Gnomes are compact, sharp-eyed, and endlessly curious. Their hands never stop moving — tinkering, sketching, adjusting, disassembling. Born with a faint, instinctive connection to Resonance that manifests as an intuitive understanding of how things work. Where Dwarves build to endure, Gnomes build to discover.",
    features:[
      {name:"Innate Resonance (Minor)",desc:"Sense magical energy within Close range (enchanted objects, active spells, Resonance pools). Less precise than Elves."},
      {name:"Inventor's Eye",desc:"Advantage on all Crafting rolls made to repair, modify, or understand mechanical devices and equipment. Includes identifying traps, locks, and constructs."},
      {name:"Small Frame",desc:"Difficulty wielding Heavy weapons — movement reduced to 15 ft/turn while wielding one. Cannot dual-wield Heavy weapons."},
    ],
    stats:{hp:14,stress:7,mana:7,armor:0},
    crit:"Lose 1 Stress · Gain +2 to a future d20 roll of your choice (or an ally's roll) before end of next turn",
  },
  Goblin:{
    identity:"Impulse driven agents of chaos with dexterity and creativity to rival any other lifeform.",
    lore:"Goblins are a creation of Zylnor, shaped alongside the Dravik during his restless experiments with mortal life. Where the Dravik emerged patient and steady, the Goblins came out fast, loud, and completely unpredictable. Small, wiry, and impossibly quick, Goblins operate on pure instinct. They don't bother with plans — what they lack in foresight they make up for with an almost supernatural ability to read chaotic situations and take advantage. They love traps, toys, and gadgets. Though often mistaken for stupidity, the chaos of the Goblins is exactly what has allowed them to survive in literally every corner of Luris.",
    features:[
      {name:"Small and Slippery",desc:"Move through spaces occupied by larger creatures without penalty. Advantage on rolls to escape grapples and restraints."},
      {name:"Trick Token",desc:"Spend Trick Tokens as reactions to force a reroll of any non-Tether roll at any point."},
      {name:"Reckless Instinct",desc:"Tether rolls are split differently — 1–8 = Dread movement, 9–12 = Grace movement."},
    ],
    stats:{hp:14,stress:7,mana:3,armor:0},
    crit:"Gain 1 Trick Token · Lose 1 Stress",
  },
  Goliath:{
    identity:"The impatient and impulsive powerhouses who trade stamina for short-term dominance.",
    lore:"The Goliaths were shaped deep in the mountains by the god Dalga, who loved them enough to die for them. The Dwarves stayed in the mountains; the Goliaths left, for they were restless, fiercely independent, and hungry to test themselves against the wider world. Standing between seven and eight feet tall, Goliaths are impossible to ignore. Born strong and growing stronger, driven by an almost compulsive need to test their own limits. But their power comes at a cost — Goliaths burn through energy faster than any other Cradle.",
    features:[
      {name:"Imposing Stature",desc:"Advantage on Influence rolls to intimidate. Cannot be frightened by non-magical sources."},
      {name:"Surge",desc:"Once per encounter, automatically pass a Body roll. Costs 1 Stress."},
      {name:"Quick to Tire",desc:"Gain 1 additional Stress during any encounter lasting longer than 4 rounds, and each consecutive round after. Taking a rest action resets this."},
    ],
    stats:{hp:20,stress:8,mana:1,armor:1},
    crit:"Gain 2 temp HP (max 10) · Lose 1 Stress",
  },
  Dravik:{
    identity:"Physically resilient tanks with a signature weapon.",
    lore:"The Dravik are the creation of the god Zylnor, shaped alongside the Goblins during his restless experiments with mortal life. Reptilian and proud, the Dravik stand at roughly human height, their bodies covered in hardened scales that serve as natural armor. Long, powerful tails grant them extraordinary balance — a trait that makes them devastatingly effective with their signature weapon, the Sling Blade. Cold-blooded, they thrive in temperate and tropical regions, basking in the sun between battles. Patient, steady, and built to endure.",
    features:[
      {name:"Scaled Hide",desc:"Dravik begin with +2 max Armor naturally. This does not require wearing armor and cannot be removed."},
      {name:"Thermal Charge",desc:"After spending a Short Rest in direct sunlight, gain +2 to Body rolls until your next Long Rest."},
      {name:"Cold Blooded",desc:"In cold environments without warm cover, gain 1 Stress at the start of each encounter."},
    ],
    stats:{hp:16,stress:8,mana:5,armor:3},
    crit:"Gain 2 temporary HP (max 10) · Lose 1 Stress",
  },
  Myrin:{
    identity:"Stress management specialists capable of almost anything they put their minds to.",
    lore:"Among the oldest of all Cradles, the Myrin were shaped by the goddess Elyndra alongside the Elves. While the Elves were made to rule the land, the Myrin were made to rule the seas, and they have done so ever since. Unmistakably aquatic — long webbed fingers, large black pupils granting sharp vision in the darkest depths, and gills lining the sides of their necks. In water, a Myrin has raw, splendid power, capable of reaching speeds of over 40 miles per hour.",
    features:[
      {name:"Amphibious",desc:"Breathe both air and water. Clear vision in aquatic environments. Move, fight, and communicate freely underwater with no penalty."},
      {name:"Aquatic Rejuvenation",desc:"When taking a Long Rest while submerged in water, lose all Stress in addition to other rest options."},
      {name:"Land Fatigue",desc:"While on dry land, gain 1 Stress at the start of each combat encounter."},
    ],
    stats:{hp:18,stress:8,mana:4,armor:0},
    crit:"Lose 3 Stress",
  },
};


const CLASS_DATA = [
  {name:"Soldier",   subclasses:[{name:"Tactician",  specs:["Duelist","Warlord"]},     {name:"Warrior",      specs:["Vanguard","Juggernaut"]}]},
  {name:"Witch",     subclasses:[{name:"Druid",       specs:["Shapeshifter","Warden"]}, {name:"Lancer",       specs:["Spellblade","Mage"]}]},
  {name:"Brute",     subclasses:[{name:"Berserker",   specs:["Ravager","Bloodborne"]},  {name:"Grappler",     specs:["Brawler","Crusher"]}]},
  {name:"Ranger",    subclasses:[{name:"Wildling",    specs:["Primalist","Beastmaster"]},{name:"Stalker",      specs:["Marksman","Trapper"]}]},
  {name:"Sentinel",  subclasses:[{name:"Angel",       specs:["Guardian","Lightbringer"]},{name:"Avenger",      specs:["Crusader","Paladin"]}]},
  {name:"Luminary",  subclasses:[{name:"Bard",        specs:["Skald","Troubadour"]},    {name:"Magician",     specs:["Charlatan","Mesmer"]}]},
  {name:"Rogue",     subclasses:[{name:"Assassin",    specs:["Shadowblade","Viper"]},   {name:"Espion",       specs:["Agent","Saboteur"]}]},
  {name:"Reacher",   subclasses:[{name:"Empath",      specs:["Medic","Shepherd"]},      {name:"Engineer",     specs:["Architect","Warframe"]}]},
  {name:"Inquisitor",subclasses:[{name:"Zealot",      specs:["Heretic","Godslayer"]},   {name:"Purifier",     specs:["Witch Hunter","Nullifier"]}]},
  {name:"Vessel",    subclasses:[{name:"Chaos Walker",specs:["Voidcaller","Fleshweaver"]},{name:"The Repented",specs:["Martyr","Formless Shield"]}]},
];
const getSubs=cls=>CLASS_DATA.find(c=>c.name===cls)?.subclasses??[];


// ─── Spell Progression per Class ───────────────────────────────────────────
// className matches CLASS_DATA names. "Witch" = Resonant in the PDF.
const SPELL_PROGRESSION={
  Resonant:{levelsGained:[1,2,3,4,5,6,7,8,9,10,11,12],total:12,maxSpellLevel:12,
    pathWeighting:{chosen:8,other:4},swapRule:"any_levelup"},
  Sentinel:{levelsGained:[1,2,3,4,5,6,7,8,12],total:9,maxSpellLevel:12,
    pathWeighting:{Grace:9,Dread:3},swapRule:"milestones"},
  Vessel:{levelsGained:[1,2,3,4,5,6,7,8,12],total:9,maxSpellLevel:12,
    pathWeighting:{Dread:9,Grace:3},swapRule:"milestones"},
  Luminary:{levelsGained:[1,2,3,4,5,6,7,8,12],total:9,maxSpellLevel:10,
    pathWeighting:{chosen:9,other:3},swapRule:"milestones"},
  Inquisitor:{levelsGained:[1,2,3,4,5,6,7,8,12],total:9,maxSpellLevel:10,
    pathWeighting:{chosen:9,other:3,defaultPath:"Dread"},swapRule:"milestones"},
  Reacher:{levelsGained:[1,2,4,6,8,10,12],total:7,maxSpellLevel:8,
    pathWeighting:{Grace:6,Dread:1},swapRule:"milestones"},
  Rogue:{levelsGained:[1,3,5,8,10,12],total:6,maxSpellLevel:8,
    pathWeighting:"free",swapRule:"milestones"},
  Ranger:{levelsGained:[1,3,6,9,12],total:5,maxSpellLevel:7,
    pathWeighting:"free",swapRule:"milestones"},
  Soldier:{levelsGained:[1,3,8,10,12],total:5,maxSpellLevel:6,
    pathWeighting:"free",swapRule:"milestones"},
  Brute:{levelsGained:[1,5,10,12],total:4,maxSpellLevel:8,
    pathWeighting:{Grace:2},swapRule:"milestones"},
  // Witch = Resonant class in the tracker (mapped name)
  Witch:{levelsGained:[1,2,3,4,5,6,7,8,9,10,11,12],total:12,maxSpellLevel:12,
    pathWeighting:{chosen:8,other:4},swapRule:"any_levelup"},
};

// ─── Cradle starting spell bonuses ─────────────────────────────────────────
const CRADLE_SPELL_BONUS={
  Elf:2, Gnome:1, Myrin:1,
};

// ─── Subclass spell bonuses ─────────────────────────────────────────────────
// null = no bonus. Object = {path:"Dread"|"Grace"|"any", maxLevel:N, tags:[...] optional}
const SUBCLASS_SPELL_BONUS={
  // Resonant/Witch
  Druid:   {path:"any",   maxLevel:4, tags:null},
  Lancer:  {path:"any",   maxLevel:4, tags:null},
  // Sentinel
  Angel:   {path:"Grace", maxLevel:8, tags:null},
  Avenger: {path:"Dread", maxLevel:6, tags:null},
  // Vessel
  "Chaos Walker":{path:"any",   maxLevel:8, tags:null},
  "The Repented":{path:"Grace", maxLevel:6, tags:null},
  // Luminary
  Bard:     {path:"Grace", maxLevel:6, tags:["Buff","Utility"]},
  Magician: {path:"any",   maxLevel:6, tags:null},
  // Inquisitor
  Zealot:   {path:"Dread", maxLevel:6, tags:null},
  Purifier: {path:"Grace", maxLevel:6, tags:["Damage","Control"]},
  // Reacher
  Empath:   {path:"Grace", maxLevel:6, tags:["Heal"]},
  Engineer: null,
  // Rogue
  Assassin: {path:"Dread", maxLevel:6, tags:["Damage","Debuff"]},
  Espion:   null,
  // Ranger
  Wildling: {path:"Grace", maxLevel:4, tags:null},
  Stalker:  {path:"Dread", maxLevel:4, tags:["Utility"]},
  // Soldier
  Tactician:{path:"any",   maxLevel:4, tags:["Buff","Control"]},
  Warrior:  null,
  // Brute
  Berserker:{path:"Dread", maxLevel:4, tags:["Damage"]},
  Grappler: null,
};

// ─── Specialization spell bonuses ───────────────────────────────────────────
const SPEC_SPELL_BONUS={
  // Witch/Resonant Druid
  Witch:       {path:"Dread", maxLevel:6, tags:null},
  Warden:      null,
  // Witch/Resonant Lancer
  Spellblade:  {path:"Dread", maxLevel:8, tags:null},
  Mage:        {path:"Grace", maxLevel:8, tags:null},
  // Sentinel Angel
  Guardian:    {path:"Grace", maxLevel:6, tags:["Buff","Heal"]},
  Lightbringer:{path:"Grace", maxLevel:10,tags:["Damage"]},
  // Sentinel Avenger
  Crusader:    {path:"any",   maxLevel:6, tags:["Damage"]},
  Paladin:     {path:"Grace", maxLevel:8, tags:["Buff","Control"]},
  // Vessel Chaos Walker
  Voidcaller:  {path:"Dread", maxLevel:10,tags:["Control","Damage"]},
  Fleshweaver: {path:"Dread", maxLevel:8, tags:["Debuff","Damage"]},
  // Vessel The Repented
  Martyr:          {path:"Grace", maxLevel:8, tags:["Heal"]},
  "Formless Shield":{path:"Grace",maxLevel:6, tags:["Buff"]},
  // Luminary Bard
  Skald:       {path:"any",   maxLevel:4, tags:["Damage"]},
  Troubadour:  {path:"Grace", maxLevel:6, tags:["Control","Utility"]},
  // Luminary Magician
  Charlatan:   {path:"Dread", maxLevel:6, tags:["Utility","Control"]},
  Mesmer:      {path:"Dread", maxLevel:8, tags:["Control"]},
  // Inquisitor Zealot
  Heretic:     {path:"any",   maxLevel:8, tags:null},
  Godslayer:   {path:"Dread", maxLevel:10,tags:["Damage"]},
  // Inquisitor Purifier
  "Witch Hunter":{path:"Dread",maxLevel:6,tags:["Debuff","Control"]},
  Nullifier:   {path:"any",   maxLevel:8, tags:["Control"]},
  // Reacher Empath
  Medic:       {path:"Grace", maxLevel:4, tags:["Heal"]},
  Shepherd:    {path:"Grace", maxLevel:6, tags:["Buff","Control"]},
  // Reacher Engineer
  Architect:   {path:"Grace", maxLevel:6, tags:["Utility"]},
  Warframe:    {path:"Dread", maxLevel:6, tags:["Damage","Debuff"]},
  // Rogue Assassin
  Shadowblade: {path:"Dread", maxLevel:8, tags:["Utility","Damage"]},
  Viper:       {path:"Dread", maxLevel:6, tags:["Debuff"]},
  // Rogue Espion
  Agent:       {path:"any",   maxLevel:8, tags:["Utility"]},
  Saboteur:    {path:"Dread", maxLevel:6, tags:["Control","Utility"]},
  // Ranger Wildling
  Primalist:   {path:"any",   maxLevel:6, tags:["Damage"]},
  Beastmaster: {path:"Grace", maxLevel:6, tags:["Utility","Buff"]},
  // Ranger Stalker
  Marksman:    {path:"Dread", maxLevel:6, tags:["Debuff"]},
  Trapper:     {path:"any",   maxLevel:4, tags:["Control","Utility"]},
  // Soldier Tactician
  Duelist:     {path:"Dread", maxLevel:4, tags:["Debuff"]},
  Warlord:     {path:"Grace", maxLevel:4, tags:["Buff"]},
  // Soldier Warrior
  Vanguard:    {path:"Grace", maxLevel:4, tags:["Buff"]},
  Juggernaut:  {path:"Dread", maxLevel:6, tags:["Damage"]},
  // Brute Berserker
  Ravager:     {path:"Dread", maxLevel:6, tags:["Damage"]},
  Bloodborne:  {path:"Dread", maxLevel:4, tags:["Debuff","Damage"]},
  // Brute Grappler
  Brawler:     {path:"Dread", maxLevel:4, tags:["Debuff"]},
  Crusher:     {path:"Dread", maxLevel:6, tags:["Damage","Control"]},
};

// ─── Helper: compute total starting spells ────────────────────────────────
const getStartingSpellCount=(cls,cradle)=>{
  const base=1;
  const cradleBonus=CRADLE_SPELL_BONUS[cradle]||0;
  // Resonant/Witch gets +1 extra at level 1
  const classBonus=(cls==="Witch"||cls==="Resonant")?1:0;
  return base+cradleBonus+classBonus;
};

// ─── Helper: filter spells by rule ───────────────────────────────────────
const filterSpellsByRule=(rule, chosenPath, alreadyKnown=[])=>{
  if(!rule)return [];
  return ALL_SPELLS.filter(s=>{
    if(alreadyKnown.includes(s.id))return false;
    if(rule.maxLevel&&s.level>rule.maxLevel)return false;
    if(rule.path==="Dread"&&s.path!=="Dread")return false;
    if(rule.path==="Grace"&&s.path!=="Grace")return false;
    if(rule.path==="chosen"&&s.path!==chosenPath)return false;
    if(rule.path==="other"&&s.path===chosenPath)return false;
    if(rule.tags&&rule.tags.length>0&&!s.tags.some(t=>rule.tags.includes(t)))return false;
    return true;
  });
};

// ─── Helper: get class spell slots gained at a specific level ──────────────
const getSpellsGainedAtLevel=(cls,level)=>{
  const prog=SPELL_PROGRESSION[cls];
  return prog?.levelsGained.includes(level)?1:0;
};


const getSpecs=(cls,sub)=>getSubs(cls).find(s=>s.name===sub)?.specs??[];

const COMMUNITIES=[
  {name:"Peasantry",      gold:0,  goldUnit:"gold",  statBonus:{body:2},noNegChron:true,
   bag:{name:"Burlap Sack",      type:"backpack",  units:20},clothes:"Peasant's Attire",
   note:"No money. No negative Chronicle required."},
  {name:"Nobility",       gold:20, goldUnit:"gold",  statBonus:{mind:1},
   bag:{name:"Velvet Purse",     type:"auxiliary", units:5}, clothes:"Noble Garments"},
  {name:"Tribal",         gold:5,  goldUnit:"gold",  statBonus:{body:2},
   bag:{name:"Crafted Leather Pack",type:"backpack",units:25},clothes:"Tribal Attire"},
  {name:"Merchant's Guild",gold:15,goldUnit:"gold",  statBonus:{mind:1},
   bag:{name:"Journeyman's Pack",type:"backpack",  units:25},clothes:"Merchant's Robes"},
  {name:"Religious",      gold:5,  goldUnit:"silver",statBonus:{soul:2},
   bag:{name:"Apostle's Satchel",type:"auxiliary", units:5}, clothes:"Apostle's Robes"},
  {name:"Academic",       gold:5,  goldUnit:"gold",  statBonus:{mind:2},
   bag:{name:"Scholar's Satchel",type:"auxiliary", units:10},clothes:"Scholar's Robes"},
  {name:"Military",       gold:5,  goldUnit:"gold",  statBonus:{body:2},extraNegChron:true,
   bag:{name:"Military Pack",    type:"backpack",  units:30},clothes:"Military Uniform",
   weaponUpgrade:true,startsWithArmor:"Leather Armor",
   note:"Must create a 2nd negative Chronicle. Starts with Standard weapon & Leather Armor."},
];

const CRUDE_WEAPONS=[
  {name:"Crude Dagger",damage:"1d4",  fractures:4,  hands:1,    weight:1, notes:"Thrown (Body, range 20 ft). Miss = 1d4 fractures."},
  {name:"Crude Sword", damage:"1d6",  fractures:6,  hands:1,    weight:2, notes:"Parry (contested Mind). Win = 1d4 fractures + 1d6 dmg."},
  {name:"Crude Bow",   damage:"1d4+ammo",fractures:4,hands:2,   weight:2, notes:"Range: Mind, 60 ft. Melee: Body 1d4. Parry (Mind)."},
  {name:"Crude Club",  damage:"1d4",  fractures:8,  hands:"1-2",weight:3, notes:"Parry (Mind). Win = +1 fracture."},
  {name:"Crude Spear", damage:"1d6",  fractures:6,  hands:2,    weight:2, notes:"Thrown (Body, 30 ft). Miss = +1 fracture max."},
  {name:"Crude Sling", damage:"1d4+ammo",fractures:"—",hands:1, weight:1, notes:"Range 45 ft. Cannot be destroyed except through roleplay."},
  {name:"Crude Wand",  damage:"Spell",fractures:"—",hands:1,    weight:1, notes:"Magic focus. Range/dmg by spell. Max 40 ft. Indestructible."},
  {name:"Crude Staff", damage:"Spell",fractures:8,  hands:2,    weight:3, notes:"Magic focus. Parry (Mind). Max 60 ft."},
];

const STARTING_GEAR_FIXED=[
  {name:"Torch",          qty:1, weight:4, notes:"1d4 melee (destroyed on use). Bright: melee. Dim: close."},
  {name:"Medkit",         qty:1, weight:2, notes:"Req. to heal injuries. DC 17 Medicine = +1d4 IP."},
  {name:"Gear Repair Kit",qty:2, weight:1, notes:"Repairs 1d4 fractures. DC 17 Crafting = +1d4."},
  {name:"Rope (20 ft)",   qty:1, weight:3, notes:"Standard rope."},
  {name:"Simple Bandage", qty:2, weight:1, notes:"Bonus action: 1d4 HP. Action/OOC: 4 HP."},
];

const COMPETENCIES={
  Body:[
    {key:"warfare",    name:"Warfare",    desc:"Combat tactics, weapon mastery, and martial training."},
    {key:"subterfuge", name:"Subterfuge", desc:"Stealth, lockpicking, sleight of hand, and infiltration."},
    {key:"resilience", name:"Resilience", desc:"Resisting poison, disease, exhaustion, and hardship."},
    {key:"athleticism",name:"Athleticism",desc:"Climbing, swimming, jumping, balance, tumbling, agility."},
    {key:"strength",   name:"Strength",   desc:"Lifting, breaking, pushing, and raw physical power."},
  ],
  Mind:[
    {key:"scholarship",name:"Scholarship",desc:"History, languages, research, and academic knowledge."},
    {key:"survival",   name:"Survival",   desc:"Tracking, foraging, navigation, wilderness expertise."},
    {key:"intrigue",   name:"Intrigue",   desc:"Reading people, detecting lies, piecing together info."},
    {key:"medicine",   name:"Medicine",   desc:"Treating injuries, diagnosing illness, field surgery."},
    {key:"awareness",  name:"Awareness",  desc:"Perception, noticing details, spotting danger."},
  ],
  Soul:[
    {key:"magic",      name:"Magic",      desc:"Formless Magic theory, identifying spells, magical phenomena."},
    {key:"influence",  name:"Influence",  desc:"Persuasion, deception, intimidation, and leadership."},
    {key:"performance",name:"Performance",desc:"Music, acting, storytelling, and entertainment arts."},
    {key:"conviction", name:"Conviction", desc:"Willpower, resisting mental effects, standing firm."},
    {key:"devotion",   name:"Devotion",   desc:"Religious knowledge, divine connection, empathy."},
  ],
};
const ALL_COMP=Object.values(COMPETENCIES).flat();
const initComps=()=>Object.fromEntries(ALL_COMP.map(c=>[c.key,0]));
const initCompMeta=()=>Object.fromEntries(ALL_COMP.map(c=>[c.key,"normal"])); // "proficient"|"deficient"|"normal"

const CONVICTIONS={
  Body:[
    {name:"Unyielding",  comp:"warfare",    perk:"Bastion — Guard action grants +1 temporary Armor."},
    {name:"Reckoner",    comp:"warfare",    perk:"Blood Debt — Next attack vs injurer deals +1d4/injury tier."},
    {name:"Relentless",  comp:"resilience", perk:"Second Wind — First 0 HP per session: stabilize at 1 HP."},
    {name:"Undaunted",   comp:"resilience", perk:"Hardened Frame — Adv resisting Stunned, Bleeding, Weakened."},
    {name:"Impulsive",   comp:"subterfuge", perk:"Hair Trigger — Adv Initiative. First turn movement +10 ft."},
    {name:"Cunning",     comp:"subterfuge", perk:"Gambler's Hand — Access to Trick Token mechanic."},
    {name:"Brutish",     comp:"athleticism",perk:"Heavy Hitter — Shove/Grapple deals 1d4 dmg per comp rank."},
    {name:"Olympian",    comp:"athleticism",perk:"Leaper — Double jump. Reduce fall dmg by 1d4/rank."},
    {name:"Stoic",       comp:"strength",   perk:"Pack Mule — Max Load +10. Short rest +1 extra Stress."},
    {name:"Brawny",      comp:"strength",   perk:"Crushing Force — Adv on push, tackle, break, lift rolls."},
  ],
  Mind:[
    {name:"Curious",     comp:"scholarship",perk:"Seeker — Once/session, Flashback for a GM hint."},
    {name:"Historian",   comp:"scholarship",perk:"Ancestral Voice — Auto-read ancient languages."},
    {name:"Nomadic",     comp:"survival",   perk:"Wayfinder — Adv navigation. Ignore natural difficult terrain."},
    {name:"Feral",       comp:"survival",   perk:"Apex Senses — Communicate with beasts. Adv tracking."},
    {name:"Tinkerer",    comp:"crafting",   perk:"Hands-on — Gear Repair Kits repair double fractures."},
    {name:"Scrapper",    comp:"crafting",   perk:"Field Fix — Can repair Broken gear once/quality level."},
    {name:"Clinical",    comp:"medicine",   perk:"Anatomist — Major/Serious injury treatment heals double IP."},
    {name:"Compassionate",comp:"medicine",  perk:"Soul Bond — Once/session, take 1 Stress to negate ally Stress."},
    {name:"Cynical",     comp:"awareness",  perk:"Hardened Mind — +1 vs Charms, Illusions, mental effects."},
    {name:"Vigilant",    comp:"awareness",  perk:"Always Ready — GM needs 3 Dread to surprise you."},
  ],
  Soul:[
    {name:"Sage",        comp:"magic",      perk:"Arcane Sight — ID magic items or active spell schools by sight."},
    {name:"Occultist",   comp:"magic",      perk:"Forbidden Rites — Resist Magic dmg, but always +1 Stress from it."},
    {name:"Ambitious",   comp:"influence",  perk:"Golden Tongue — Start +10 Gold. Adv bartering."},
    {name:"Commanding",  comp:"influence",  perk:"Lead the Charge — Once/day, ally uses your Influence bonus."},
    {name:"Captivating", comp:"performance",perk:"Enthrall — DC 15: target can't attack allies next turn."},
    {name:"Wit",         comp:"performance",perk:"Sharp Tongue — DC 15: target Disadv on next roll."},
    {name:"Martyr",      comp:"conviction", perk:"Living Shield — Intercept ally blow; you take half dmg."},
    {name:"Intuitive",   comp:"conviction", perk:"Sixth Sense — Sense hidden/invisible within 15 ft."},
    {name:"Devout",      comp:"devotion",   perk:"Constant Prayers — Max Mana +2. Spend 1 Mana to stabilize ally."},
    {name:"Ascetic",     comp:"devotion",   perk:"Purified — Roll to resist poisons, diseases, starvation."},
  ],
};
const ALL_CONVICTIONS=[...CONVICTIONS.Body,...CONVICTIONS.Mind,...CONVICTIONS.Soul];

/* ══════════════════════════════════════════════════════════════════════════════
   CSS
══════════════════════════════════════════════════════════════════════════════ */
const CSS=`
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0d0a08;--panel:#161109;--border:#4a3520;
  --gold:#c8952a;--gold-dim:#7a5a18;
  --grace:#6ab3c8;--grace-dim:#2a5f70;
  --dread:#c85a3a;--dread-dim:#6b2014;
  --neutral:#8a7d6a;--text:#e8d9b8;--text-dim:#7a6a50;
  --ink:#1a1209;--green:#5a9a5a;--section:#120e08;
  --purple:#a878d8;--purple-dim:#5a2a8a;
}
body{background:var(--bg);color:var(--text);font-family:'IM Fell English',serif;min-height:100vh;overflow-x:hidden}
body::before{content:'';position:fixed;inset:0;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");pointer-events:none;z-index:999;opacity:.35}
.app{max-width:920px;margin:0 auto;padding:18px 12px 60px}
.hdr{text-align:center;padding:18px 0 12px;border-bottom:1px solid var(--border);margin-bottom:16px}
.hdr::after{content:'⚔ ✦ ⚔';display:block;color:var(--gold-dim);font-size:10px;margin-top:5px;letter-spacing:6px}
.title{font-family:'Cinzel Decorative',serif;font-size:22px;color:var(--gold);letter-spacing:3px;text-shadow:0 0 18px rgba(200,149,42,.3)}
.subtitle{font-size:11px;color:var(--text-dim);letter-spacing:2px;margin-top:2px;font-style:italic}
.ptabs-wrap{display:flex;align-items:stretch;margin-bottom:14px;border:1px solid var(--border);border-radius:2px;overflow:hidden}
.ptab{flex:1;padding:8px 4px;background:var(--panel);border:none;border-right:1px solid var(--border);color:var(--text-dim);font-family:'Cinzel',serif;font-size:9px;letter-spacing:.8px;cursor:pointer;transition:all .2s;display:flex;align-items:center;justify-content:center;gap:4px;min-width:0}
.ptab.on{background:var(--section);color:var(--gold)}
.ptab:hover:not(.on){color:var(--text);background:#1a1410}
.ptab-x{width:14px;height:14px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--dread-dim);font-size:11px;cursor:pointer;flex-shrink:0}
.ptab-x:hover{color:var(--dread)}
.add-player-btn{padding:8px 14px;background:var(--section);border:none;border-left:1px solid var(--border);color:var(--gold-dim);font-family:'Cinzel',serif;font-size:9px;letter-spacing:1px;cursor:pointer;white-space:nowrap;transition:all .2s;flex-shrink:0}
.add-player-btn:hover{color:var(--gold)}
.stabs{display:flex;border:1px solid var(--border);border-radius:2px;overflow:hidden;margin-bottom:11px}
.stab{flex:1;padding:6px 2px;background:var(--ink);border:none;border-right:1px solid var(--border);color:var(--text-dim);font-family:'Cinzel',serif;font-size:8px;letter-spacing:.5px;cursor:pointer;transition:all .2s}
.stab:last-child{border-right:none}
.stab.on{background:var(--section);color:var(--gold-dim)}
.sstabs{display:flex;gap:5px;margin-bottom:9px}
.sstab{padding:4px 10px;border:1px solid var(--border);background:var(--ink);color:var(--text-dim);font-family:'Cinzel',serif;font-size:8px;letter-spacing:.8px;cursor:pointer;border-radius:1px;transition:all .15s}
.sstab.on{border-color:var(--gold-dim);color:var(--gold)}
.char-bar{display:flex;align-items:center;gap:6px;margin-bottom:12px;flex-wrap:wrap}
.char-chip{padding:5px 10px;border:1px solid var(--border);background:var(--section);color:var(--text-dim);font-family:'Cinzel',serif;font-size:9px;letter-spacing:1px;cursor:pointer;border-radius:2px;transition:all .15s;display:flex;align-items:center;gap:5px}
.char-chip.on{border-color:var(--gold-dim);color:var(--gold);background:var(--panel)}
.char-chip.archived{opacity:.5;border-style:dashed}
.char-chip-del{background:transparent;border:none;color:var(--dread-dim);cursor:pointer;font-size:11px;line-height:1}
.char-chip-del:hover{color:var(--dread)}
.add-char-btn{padding:5px 10px;border:1px dashed var(--gold-dim);background:transparent;color:var(--gold-dim);font-family:'Cinzel',serif;font-size:9px;letter-spacing:1px;cursor:pointer;border-radius:2px;transition:all .15s}
.add-char-btn:hover{border-color:var(--gold);color:var(--gold)}
.panel{background:var(--panel);border:1px solid var(--border);border-radius:2px;padding:14px;margin-bottom:11px;position:relative}
.panel::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,var(--gold-dim),transparent)}
.slabel{font-family:'Cinzel',serif;font-size:8px;letter-spacing:3px;color:var(--gold-dim);margin-bottom:9px;text-transform:uppercase}
.tb-labels{display:flex;justify-content:space-between;font-family:'Cinzel',serif;font-size:8px;letter-spacing:2px;margin-bottom:4px}
.tether-outer{height:18px;background:var(--ink);border:1px solid var(--border);border-radius:2px;position:relative;overflow:hidden;cursor:pointer}
.tether-fill{position:absolute;top:0;bottom:0;transition:all .3s cubic-bezier(.4,0,.2,1)}
.tcenter{position:absolute;left:50%;top:0;bottom:0;width:2px;background:var(--neutral);opacity:.4;transform:translateX(-50%)}
.tcursor{position:absolute;top:-2px;bottom:-2px;width:3px;background:var(--text);border-radius:2px;transition:left .3s cubic-bezier(.4,0,.2,1);box-shadow:0 0 5px rgba(232,217,184,.5)}
.bmarker{position:absolute;top:-3px;width:2px;height:24px;background:var(--gold);opacity:.45;transition:left .3s}
.bmarker::after{content:'B';position:absolute;top:-11px;left:-3px;font-family:'Cinzel',serif;font-size:7px;color:var(--gold);opacity:.7}
.tpos{text-align:center;margin-top:6px;font-family:'Cinzel',serif;font-size:11px;letter-spacing:2px}
.tctrl{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:8px}
.tbtn{width:30px;height:30px;border:1px solid var(--border);background:var(--section);color:var(--text);font-size:15px;cursor:pointer;border-radius:2px;transition:all .15s;display:flex;align-items:center;justify-content:center}
.tbtn:hover{border-color:var(--gold);color:var(--gold)}
.tbtn.d:hover{border-color:var(--dread);color:var(--dread)}
.tbtn.g:hover{border-color:var(--grace);color:var(--grace)}
.bctrl{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:7px;font-size:9px;color:var(--text-dim)}
.bctrl button{padding:1px 6px;border:1px solid var(--border);background:var(--section);color:var(--text-dim);font-size:8px;cursor:pointer;border-radius:1px}
.bctrl button:hover{color:var(--gold);border-color:var(--gold-dim)}
.rgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(105px,1fr));gap:8px}
.rcard{background:var(--section);border:1px solid var(--border);border-radius:2px;padding:9px;text-align:center}
.rname{font-family:'Cinzel',serif;font-size:7px;letter-spacing:2.5px;color:var(--text-dim);margin-bottom:6px;text-transform:uppercase}
.rrow{display:flex;align-items:center;justify-content:center;gap:4px}
.rval{font-family:'Cinzel Decorative',serif;font-size:18px;color:var(--text);min-width:22px;text-align:center}
.rsep{color:var(--text-dim);font-size:12px}.rmax{font-size:12px;color:var(--text-dim)}
.rbtn{width:19px;height:19px;border:1px solid var(--border);background:var(--ink);color:var(--text-dim);font-size:12px;cursor:pointer;border-radius:1px;display:flex;align-items:center;justify-content:center;transition:all .15s;line-height:1}
.rbtn:hover{color:var(--gold);border-color:var(--gold-dim)}
.rbtn:disabled{opacity:.3;cursor:not-allowed}
.rbtnrow{display:flex;gap:3px;justify-content:center;margin-top:4px}
.rsub{font-size:8px;color:var(--text-dim);margin-top:2px;font-style:italic}
.hpmini{height:3px;background:var(--ink);border-radius:2px;margin-top:4px;overflow:hidden}
.hpfill{height:100%;background:linear-gradient(90deg,var(--dread),var(--gold));transition:width .3s;border-radius:2px}
/* Pip resource tracks */
.res-track-wrap{margin-bottom:14px}
.res-track-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;gap:8px}
.res-track-label{font-family:'Cinzel',serif;font-size:8px;letter-spacing:2.5px;color:var(--text-dim);text-transform:uppercase;white-space:nowrap}
.res-track-vals-wrap{display:flex;align-items:center;gap:6px;cursor:pointer}
.res-track-vals-wrap:hover .res-edit-hint{opacity:1}
.res-edit-hint{font-size:8px;color:var(--gold-dim);opacity:0;transition:opacity .2s;white-space:nowrap}
.res-track-nums{display:flex;align-items:baseline;gap:2px}
.res-num-input{background:transparent;border:none;border-bottom:1px solid var(--gold-dim);color:var(--text);font-family:'Cinzel Decorative',serif;font-size:15px;width:36px;text-align:center;outline:none;-moz-appearance:textfield}
.res-num-input::-webkit-outer-spin-button,.res-num-input::-webkit-inner-spin-button{-webkit-appearance:none}
.res-num-display{font-family:'Cinzel Decorative',serif;font-size:15px}
.res-pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.res-section{background:var(--section);border:1px solid var(--border);border-radius:2px;padding:12px 14px;margin-bottom:10px}
.sgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}
.scard{background:var(--section);border:1px solid var(--border);border-radius:2px;padding:9px;text-align:center}
.sname{font-family:'Cinzel',serif;font-size:7px;letter-spacing:2px;color:var(--gold-dim);margin-bottom:4px}
.sinput{width:44px;background:transparent;border:none;border-bottom:1px solid var(--border);color:var(--text);font-family:'Cinzel Decorative',serif;font-size:20px;text-align:center;outline:none;transition:border-color .2s;-moz-appearance:textfield}
.sinput::-webkit-outer-spin-button,.sinput::-webkit-inner-spin-button{-webkit-appearance:none}
.sinput:focus{border-color:var(--gold)}
.smod{font-size:9px;color:var(--text-dim);margin-top:2px;font-style:italic}
.injgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.inj{background:var(--section);border:1px solid var(--border);border-radius:2px;padding:6px 4px;text-align:center;cursor:pointer;transition:all .2s;user-select:none}
.inj.on{border-color:var(--dread);background:rgba(200,90,58,.09)}
.inj:hover{border-color:var(--gold-dim)}
.injname{font-family:'Cinzel',serif;font-size:7px;letter-spacing:1.5px;color:var(--text-dim);margin-bottom:2px}
.inj.on .injname{color:var(--dread)}
.injhp{font-size:9px;color:var(--text-dim)}
.itrow{display:flex;gap:9px}
.itcard{flex:1;background:var(--section);border:1px solid var(--border);border-radius:2px;padding:8px;text-align:center}
.itname{font-family:'Cinzel',serif;font-size:7px;letter-spacing:2px;color:var(--text-dim);margin-bottom:4px}
.itval{font-family:'Cinzel Decorative',serif;font-size:21px}
.itcard.ins .itval{color:var(--grace)}.itcard.trm .itval{color:var(--dread)}
.narea{width:100%;min-height:75px;background:var(--section);border:1px solid var(--border);border-radius:2px;color:var(--text);font-family:'IM Fell English',serif;font-size:12px;padding:8px;resize:vertical;outline:none;transition:border-color .2s;line-height:1.6}
.narea:focus{border-color:var(--gold-dim)}
.narea::placeholder{color:var(--text-dim);font-style:italic}
.id-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}
.id-field{display:flex;flex-direction:column;gap:3px}
.id-label{font-family:'Cinzel',serif;font-size:7px;letter-spacing:2px;color:var(--gold-dim);text-transform:uppercase}
.id-input{background:transparent;border:none;border-bottom:1px solid var(--border);color:var(--text);font-family:'IM Fell English',serif;font-size:13px;outline:none;padding-bottom:2px;transition:border-color .2s;width:100%}
.id-input:focus{border-color:var(--gold-dim)}
.id-input::placeholder{color:var(--text-dim);font-style:italic}
.id-select{width:100%;background:var(--ink);border:none;border-bottom:1px solid var(--border);color:var(--text);font-family:'IM Fell English',serif;font-size:13px;outline:none;padding-bottom:2px;cursor:pointer;appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%237a6a50'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 2px center;padding-right:16px;transition:border-color .2s}
.id-select:focus{border-color:var(--gold-dim)}
.id-select option{background:var(--panel);color:var(--text)}
.id-select:disabled{opacity:.35;cursor:not-allowed}
.identity-strip{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}
.level-badge{background:var(--section);border:1px solid var(--gold-dim);border-radius:2px;padding:3px 10px;font-family:'Cinzel Decorative',serif;font-size:11px;color:var(--gold);white-space:nowrap}
.path-badge{padding:3px 8px;border-radius:2px;font-family:'Cinzel',serif;font-size:8px;letter-spacing:1.5px;border:1px solid}
.path-grace{border-color:var(--grace-dim);color:var(--grace);background:rgba(106,179,200,.07)}
.path-dread{border-color:var(--dread-dim);color:var(--dread);background:rgba(200,90,58,.07)}
.id-tag{font-family:'Cinzel',serif;font-size:9px;color:var(--text-dim);letter-spacing:1px}
.id-tag span{color:var(--text)}
.level-row{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.level-num{font-family:'Cinzel Decorative',serif;font-size:28px;color:var(--gold);min-width:36px;text-align:center}
.level-ctrl{display:flex;flex-direction:column;gap:4px}
.level-btn{padding:3px 10px;border:1px solid var(--border);background:var(--section);color:var(--text-dim);font-family:'Cinzel',serif;font-size:9px;cursor:pointer;border-radius:1px;transition:all .15s}
.level-btn:hover{border-color:var(--gold-dim);color:var(--gold)}
.level-btn:disabled{opacity:.3;cursor:not-allowed}
.levelup-notice{padding:8px 10px;border:1px solid var(--gold);border-radius:2px;background:rgba(200,149,42,.08);font-size:10px;color:var(--gold);font-style:italic;flex:1}
/* competency read-only display */
.comp-section{margin-bottom:14px}
.comp-section-hdr{font-family:'Cinzel',serif;font-size:8px;letter-spacing:3px;margin-bottom:7px;padding-bottom:4px;border-bottom:1px solid var(--border)}
.comp-row{display:flex;align-items:center;gap:8px;padding:5px 7px;background:var(--section);border:1px solid var(--border);border-radius:2px;margin-bottom:4px;position:relative;cursor:default}
.comp-row.editable{cursor:pointer}
.comp-row.editable:hover{border-color:var(--gold-dim)}
.comp-row.has-rank{border-color:rgba(200,149,42,.3)}
.comp-name{flex:1;font-family:'Cinzel',serif;font-size:10px;letter-spacing:1px;color:var(--text)}
.comp-rank{font-family:'Cinzel Decorative',serif;font-size:13px;color:var(--gold);min-width:18px;text-align:center}
.comp-rbtn{width:17px;height:17px;border:1px solid var(--border);background:var(--ink);color:var(--text-dim);font-size:11px;cursor:pointer;border-radius:1px;display:flex;align-items:center;justify-content:center;transition:all .15s;line-height:1;flex-shrink:0}
.comp-rbtn:hover{color:var(--gold);border-color:var(--gold-dim)}
.comp-bonus{font-family:'Cinzel',serif;font-size:8px;color:var(--text-dim);min-width:28px;text-align:right}
.comp-marker{font-size:12px;min-width:14px;text-align:center}
.comp-desc-box{position:fixed;z-index:600;max-width:260px;background:var(--panel);border:1px solid var(--gold-dim);border-radius:2px;padding:10px 12px;box-shadow:0 4px 20px rgba(0,0,0,.6);pointer-events:none}
.comp-desc-name{font-family:'Cinzel',serif;font-size:10px;color:var(--gold);margin-bottom:4px;letter-spacing:1.5px}
.comp-desc-text{font-size:11px;color:var(--text-dim);line-height:1.5;font-style:italic}
/* modals */
.moverlay{position:fixed;inset:0;background:rgba(0,0,0,.84);display:flex;align-items:center;justify-content:center;z-index:500;backdrop-filter:blur(2px)}
.modal{background:var(--panel);border:1px solid var(--border);border-radius:2px;padding:22px;max-width:480px;width:94%;position:relative;max-height:92vh;overflow-y:auto}
.modal.wide{max-width:600px}
.modal::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,var(--gold),transparent)}
.mtitle{font-family:'Cinzel Decorative',serif;font-size:14px;color:var(--gold);text-align:center;margin-bottom:6px;letter-spacing:2px}
.mstep{font-family:'Cinzel',serif;font-size:8px;letter-spacing:2px;color:var(--text-dim);text-align:center;margin-bottom:14px}
.mbody{font-size:12px;color:var(--text-dim);line-height:1.6;margin-bottom:14px;font-style:italic}
.mprimary{width:100%;padding:10px;border:1px solid var(--gold-dim);background:rgba(200,149,42,.07);color:var(--gold);font-family:'Cinzel',serif;font-size:9px;letter-spacing:3px;cursor:pointer;border-radius:2px;transition:all .2s;text-transform:uppercase;margin-bottom:5px}
.mprimary:hover{background:rgba(200,149,42,.16)}
.mprimary:disabled{opacity:.4;cursor:not-allowed}
.msec{width:100%;padding:8px;border:1px solid var(--border);background:transparent;color:var(--text-dim);font-family:'Cinzel',serif;font-size:8px;letter-spacing:2px;cursor:pointer;border-radius:2px;transition:all .2s;margin-bottom:4px}
.msec:hover{color:var(--text);border-color:var(--text-dim)}
.mdanger{width:100%;padding:8px;border:1px solid var(--dread-dim);background:rgba(200,90,58,.08);color:var(--dread);font-family:'Cinzel',serif;font-size:8px;letter-spacing:2px;cursor:pointer;border-radius:2px;margin-bottom:4px}
.mdanger:hover{background:rgba(200,90,58,.18)}
.dice-row{display:flex;gap:10px;justify-content:center;margin:12px 0;flex-wrap:wrap}
.die-card{background:var(--section);border:1px solid var(--border);border-radius:2px;padding:10px 14px;text-align:center;min-width:52px}
.die-lbl{font-family:'Cinzel',serif;font-size:7px;letter-spacing:2px;color:var(--text-dim);margin-bottom:3px}
.die-val{font-family:'Cinzel Decorative',serif;font-size:28px;line-height:1;color:var(--text)}
.die-val.grc{color:var(--grace)}.die-val.drc{color:var(--dread)}
.opt-grid{display:grid;gap:7px;margin-bottom:14px}
.opt-grid.cols2{grid-template-columns:1fr 1fr}
.opt-grid.cols3{grid-template-columns:repeat(3,1fr)}
.opt-btn{padding:8px 6px;border:1px solid var(--border);background:var(--section);color:var(--text-dim);font-family:'Cinzel',serif;font-size:9px;letter-spacing:1px;cursor:pointer;border-radius:2px;transition:all .2s;text-align:center}
.opt-btn:hover{border-color:var(--gold-dim);color:var(--text)}
.opt-btn.sel{border-color:var(--gold);color:var(--gold);background:rgba(200,149,42,.08)}
.opt-btn.sel-grace{border-color:var(--grace);color:var(--grace);background:rgba(106,179,200,.08)}
.opt-btn.sel-dread{border-color:var(--dread);color:var(--dread);background:rgba(200,90,58,.08)}
.opt-btn .opt-sub{font-family:'IM Fell English',serif;font-size:9px;color:var(--text-dim);font-style:italic;margin-top:2px;letter-spacing:0;display:block}
.alloc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}
.alloc-card{background:var(--section);border:1px solid var(--border);border-radius:2px;padding:10px;text-align:center}
.alloc-name{font-family:'Cinzel',serif;font-size:8px;letter-spacing:2px;color:var(--gold-dim);margin-bottom:5px}
.alloc-val{font-family:'Cinzel Decorative',serif;font-size:22px;color:var(--text)}
.remaining-badge{text-align:center;font-family:'Cinzel',serif;font-size:11px;color:var(--gold);margin-bottom:10px;letter-spacing:1px}
.chronicle-item{background:var(--section);border:1px solid var(--border);border-radius:2px;padding:10px;margin-bottom:8px}
.chronicle-type{font-family:'Cinzel',serif;font-size:8px;letter-spacing:2px;margin-bottom:6px}
.chronicle-pos{color:var(--grace)}.chronicle-neg{color:var(--dread)}
.chronicle-textarea{width:100%;background:transparent;border:none;border-bottom:1px solid var(--border);color:var(--text);font-family:'IM Fell English',serif;font-size:12px;resize:none;outline:none;padding-bottom:4px;margin-bottom:8px;line-height:1.5;min-height:50px}
.chronicle-textarea::placeholder{color:var(--text-dim);font-style:italic}
.chronicle-textarea:focus{border-color:var(--gold-dim)}
.conv-card{padding:7px 9px;border:1px solid var(--border);background:var(--section);border-radius:2px;cursor:pointer;transition:all .15s;margin-bottom:5px}
.conv-card:hover{border-color:var(--gold-dim)}
.conv-card.sel{border-color:var(--gold);background:rgba(200,149,42,.07)}
.conv-name{font-family:'Cinzel',serif;font-size:9px;letter-spacing:1.5px;color:var(--text);margin-bottom:2px}
.conv-comp{font-size:9px;color:var(--gold-dim);font-style:italic;margin-bottom:3px}
.conv-perk{font-size:9px;color:var(--text-dim);line-height:1.4}
.weapon-card{padding:9px;border:1px solid var(--border);background:var(--section);border-radius:2px;cursor:pointer;transition:all .15s;margin-bottom:6px}
.weapon-card:hover{border-color:var(--gold-dim)}
.weapon-card.sel{border-color:var(--gold);background:rgba(200,149,42,.07)}
.weapon-name{font-family:'Cinzel',serif;font-size:10px;letter-spacing:1px;color:var(--text);margin-bottom:3px;display:flex;justify-content:space-between}
.weapon-stats{font-size:9px;color:var(--gold-dim);margin-bottom:3px}
.weapon-notes{font-size:9px;color:var(--text-dim);font-style:italic;line-height:1.4}
.gear-review-table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px}
.gear-review-table th{font-family:'Cinzel',serif;font-size:7px;letter-spacing:2px;color:var(--gold-dim);padding:4px 6px;border-bottom:1px solid var(--border);text-align:left}
.gear-review-table td{padding:4px 6px;border-bottom:1px solid rgba(74,53,32,.2);color:var(--text-dim);vertical-align:top}
.gear-review-table td:first-child{color:var(--text)}
/* death state */
.death-state-row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.ds-btn{flex:1;padding:8px 5px;border:1px solid var(--border);background:var(--section);color:var(--text-dim);font-family:'Cinzel',serif;font-size:8px;letter-spacing:1px;cursor:pointer;border-radius:2px;transition:all .2s;text-transform:uppercase;min-width:60px}
.ds-btn:hover{border-color:var(--gold-dim)}
.ds-btn.alive{border-color:var(--green);background:rgba(90,154,90,.07);color:var(--green)}
.ds-btn.die{border-color:var(--dread);background:rgba(200,64,64,.1);color:var(--dread)}
.ds-btn.saves{border-color:var(--gold);background:rgba(200,149,42,.09);color:var(--gold)}
.ds-btn.bargain{border-color:var(--purple);background:rgba(168,120,216,.09);color:var(--purple)}
.saves-pips{display:flex;gap:6px;justify-content:center;margin:12px 0}
.pip{width:34px;height:34px;border:2px solid var(--border);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer;transition:all .2s;background:var(--section)}
.pip.revival{border-color:var(--grace);background:rgba(106,179,200,.1)}
.pip.death{border-color:var(--dread);background:rgba(200,90,58,.1)}
.pip.empty{border-color:var(--border)}
/* GM */
.bigval{font-family:'Cinzel Decorative',serif;font-size:48px;line-height:1;text-align:center}
.biglabel{font-family:'Cinzel',serif;font-size:7px;letter-spacing:3px;color:var(--text-dim);text-align:center;margin-top:2px;margin-bottom:9px}
.ctrbtns{display:flex;gap:6px;justify-content:center}
.ctrbtn{padding:6px 15px;border:1px solid var(--border);background:var(--section);color:var(--text);font-family:'Cinzel',serif;font-size:16px;cursor:pointer;border-radius:2px;transition:all .15s}
.ctrbtn:hover{border-color:var(--gold);color:var(--gold)}
.critgrid{display:flex;gap:4px;margin-top:11px;flex-wrap:wrap;justify-content:center}
.cnbtn{width:28px;height:28px;border:1px solid var(--border);background:var(--section);color:var(--text-dim);font-family:'Cinzel',serif;font-size:9px;cursor:pointer;border-radius:1px;transition:all .15s}
/* inventory */
.invtable{width:100%;border-collapse:collapse}
.invtable th{font-family:'Cinzel',serif;font-size:7px;letter-spacing:2px;color:var(--gold-dim);padding:4px 5px;border-bottom:1px solid var(--border);text-align:left;text-transform:uppercase}
.invtable td{padding:4px 5px;border-bottom:1px solid rgba(74,53,32,.25);font-size:11px;vertical-align:middle}
.iinput{background:transparent;border:none;color:var(--text);font-family:'IM Fell English',serif;font-size:11px;width:100%;outline:none}
.iinput:focus{border-bottom:1px solid var(--gold-dim)}
.inum{background:transparent;border:none;color:var(--text);font-family:'Cinzel',serif;font-size:10px;width:38px;text-align:center;outline:none;-moz-appearance:textfield}
.inum::-webkit-outer-spin-button,.inum::-webkit-inner-spin-button{-webkit-appearance:none}
.inum:focus{border-bottom:1px solid var(--gold-dim)}
.idelbtn{background:transparent;border:none;color:var(--dread-dim);cursor:pointer;font-size:12px;padding:0 3px;transition:color .15s}
.idelbtn:hover{color:var(--dread)}
.iaddbtn{padding:6px 12px;border:1px solid var(--border);background:var(--section);color:var(--text-dim);font-family:'Cinzel',serif;font-size:8px;letter-spacing:2px;cursor:pointer;border-radius:2px;margin-top:8px;transition:all .15s}
.iaddbtn:hover{border-color:var(--gold-dim);color:var(--gold)}
.mvbtn{padding:2px 6px;border:1px solid var(--border);background:var(--section);color:var(--text-dim);font-size:8px;font-family:'Cinzel',serif;cursor:pointer;border-radius:1px;white-space:nowrap;transition:all .15s}
.mvbtn:hover{border-color:var(--gold-dim);color:var(--gold)}
.enccard{background:var(--section);border:1px solid var(--border);border-radius:2px;padding:6px;text-align:center}
.enccardlabel{font-family:'Cinzel',serif;font-size:6px;letter-spacing:2px;color:var(--text-dim);margin-bottom:2px}
.enccardval{font-family:'Cinzel Decorative',serif;font-size:14px;color:var(--text)}
.gitem{background:var(--section);border:1px solid var(--border);border-radius:2px;padding:8px;margin-bottom:7px}
.gitemrow{display:flex;align-items:flex-start;gap:7px}
.gname{flex:1;background:transparent;border:none;border-bottom:1px solid var(--border);color:var(--text);font-family:'Cinzel',serif;font-size:11px;outline:none;padding-bottom:2px}
.gname:focus{border-color:var(--gold-dim)}
.gdesc{width:100%;background:transparent;border:none;color:var(--text-dim);font-family:'IM Fell English',serif;font-size:10px;outline:none;margin-top:4px;resize:none;min-height:32px;font-style:italic}
.gdesc::placeholder{color:var(--border);font-style:italic}
.condrow{display:flex;align-items:center;gap:7px;padding:5px 0;border-bottom:1px solid rgba(74,53,32,.25)}
.condrm{background:transparent;border:none;color:var(--dread-dim);cursor:pointer;font-size:12px;transition:color .15s}
.condrm:hover{color:var(--dread)}
.condinput{background:transparent;border:none;border-bottom:1px solid var(--border);color:var(--text);font-family:'IM Fell English',serif;font-size:12px;width:190px;outline:none}
.bwinput{width:55px;background:transparent;border:none;border-bottom:1px solid var(--border);color:var(--text);font-family:'Cinzel',serif;font-size:12px;text-align:center;outline:none;-moz-appearance:textfield}
.bwinput::-webkit-outer-spin-button,.bwinput::-webkit-inner-spin-button{-webkit-appearance:none}
.bwinput:focus{border-color:var(--gold-dim)}
.rtgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:12px}
.rtbtn{padding:11px 5px;border:1px solid var(--border);background:var(--section);color:var(--text-dim);font-family:'Cinzel',serif;font-size:9px;letter-spacing:1.5px;cursor:pointer;border-radius:2px;transition:all .2s;text-transform:uppercase}
.rtbtn:hover,.rtbtn.sel{border-color:var(--gold);color:var(--gold);background:rgba(200,149,42,.07)}
.rtbtn .sv{display:block;font-family:'Cinzel Decorative',serif;font-size:16px;color:var(--text);margin-bottom:2px}
.verdict{font-family:'Cinzel',serif;font-size:12px;letter-spacing:1.5px;margin-bottom:6px;padding:8px;border-radius:2px;text-align:center}
.vg{color:var(--grace);background:rgba(106,179,200,.07);border:1px solid var(--grace-dim)}
.vd{color:var(--dread);background:rgba(200,90,58,.07);border:1px solid var(--dread-dim)}
.critbadge{display:inline-block;background:var(--gold);color:var(--ink);font-family:'Cinzel',serif;font-size:8px;letter-spacing:2px;padding:3px 9px;border-radius:1px;margin-bottom:8px}
.rollsub{font-size:10px;color:var(--text-dim);font-style:italic;margin-bottom:11px;text-align:center}
.cname{width:100%;background:transparent;border:none;border-bottom:1px solid var(--border);color:var(--text);font-family:'Cinzel',serif;font-size:16px;letter-spacing:2px;text-align:center;outline:none;padding-bottom:3px;margin-bottom:10px;transition:border-color .2s}
.cname:focus{border-color:var(--gold-dim)}
.cname::placeholder{color:var(--text-dim);font-style:italic}
.rolltrig{width:100%;padding:10px;border:1px solid var(--gold-dim);background:var(--section);color:var(--gold);font-family:'Cinzel',serif;font-size:9px;letter-spacing:3px;cursor:pointer;border-radius:2px;transition:all .2s;text-transform:uppercase;margin-top:9px}
.rolltrig:hover{background:rgba(200,149,42,.07);border-color:var(--gold)}
.empty-state-title{font-family:'Cinzel',serif;font-size:14px;color:var(--text-dim);margin-bottom:10px;letter-spacing:2px}
@keyframes rollIn{from{transform:scale(.8) rotate(-4deg);opacity:0}to{transform:scale(1) rotate(0);opacity:1}}
@keyframes slideIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
.modal{animation:slideIn .18s ease-out}
@keyframes spinStop{
  0%{transform:translateY(0)}
  100%{transform:translateY(var(--spin-dist))}
}
.calib-bar-wrap{display:flex;align-items:center;gap:8px;margin-bottom:5px}
.calib-num{font-family:'Cinzel',serif;font-size:9px;color:var(--text-dim);min-width:16px;text-align:right}
.calib-bar{flex:1;height:6px;background:var(--ink);border-radius:2px;overflow:hidden}
.calib-fill{height:100%;border-radius:2px;transition:width .4s cubic-bezier(.4,0,.2,1)}
.calib-pct{font-family:'Cinzel',serif;font-size:8px;color:var(--text-dim);min-width:36px;text-align:right}
`;

/* ══════════════════════════════════════════════════════════════════════════════
   RESOURCE TRACK — continuous fill bar
   Clicking anywhere on the bar sets current proportionally.
   Clicking the cur/max numbers makes them editable inline.
══════════════════════════════════════════════════════════════════════════════ */

function ResourceTrack({
  label, cur, max, fillColor, emptyColor="#1a1209",
  onSetCur, onSetMax,
  locked=false, lockedCount=0,
  sub=null, valColor=null,
  showMaxCtrl=true,
}){
  const [editingCur, setEditingCur] = useState(false);
  const [editingMax, setEditingMax] = useState(false);
  const [draftCur, setDraftCur] = useState("");
  const [draftMax, setDraftMax] = useState("");

  const safeMax = Math.max(1, max);

  const segClick = (i) => {
    // clicking segment i (0-based from left) sets value to that proportion
    const newVal = Math.round(((i + 1) / SEGS) * safeMax);
    onSetCur(clamp(newVal, 0, safeMax));
  };

  const startEditCur = () => { setDraftCur(String(cur)); setEditingCur(true); setEditingMax(false); };
  const startEditMax = () => { if(!locked && showMaxCtrl){ setDraftMax(String(max)); setEditingMax(true); setEditingCur(false); } };

  const commitCur = () => {
    const v = parseInt(draftCur);
    if (!isNaN(v)) onSetCur(clamp(v, 0, safeMax));
    setEditingCur(false);
  };
  const commitMax = () => {
    const v = parseInt(draftMax);
    if (!isNaN(v) && v >= 1) onSetMax(v);
    setEditingMax(false);
  };
  const onKeyDown = (e, commit) => { if(e.key==="Enter") commit(); if(e.key==="Escape") { setEditingCur(false); setEditingMax(false); } };

  const activeColor = valColor || fillColor;

  return (
    <div className="res-track-wrap">
      {/* Header: label left, cur/max right (clickable to edit) */}
      <div className="res-track-header">
        <span className="res-track-label">{label}</span>
        <div style={{display:"flex",alignItems:"baseline",gap:3}}>
          {/* Current value */}
          {editingCur ? (
            <input autoFocus className="res-num-input"
              value={draftCur} onChange={e=>setDraftCur(e.target.value)}
              onBlur={commitCur} onKeyDown={e=>onKeyDown(e,commitCur)}
              style={{color:activeColor,width:38}}
            />
          ) : (
            <span className="res-num-display" style={{color:activeColor,cursor:"pointer",fontSize:16}} onClick={startEditCur} title="Click to edit current value">{cur}</span>
          )}
          <span style={{color:"var(--text-dim)",fontSize:11,margin:"0 1px"}}>/</span>
          {/* Max value */}
          {editingMax ? (
            <input autoFocus className="res-num-input"
              value={draftMax} onChange={e=>setDraftMax(e.target.value)}
              onBlur={commitMax} onKeyDown={e=>onKeyDown(e,commitMax)}
              style={{color:"var(--text-dim)",width:38}}
            />
          ) : (
            <span className="res-num-display"
              style={{color:"var(--text-dim)",cursor:showMaxCtrl&&!locked?"pointer":"default",fontSize:13,opacity:showMaxCtrl&&!locked?1:0.6}}
              onClick={startEditMax}
              title={showMaxCtrl&&!locked?"Click to edit maximum":""}
            >{max}</span>
          )}
        </div>
      </div>

      {/* Continuous bar — click anywhere to set value proportionally */}
      <div
        style={{
          position:"relative", height:8, borderRadius:3,
          background:emptyColor, cursor:"pointer", overflow:"hidden",
        }}
        onClick={e=>{
          const r=e.currentTarget.getBoundingClientRect();
          const pct=(e.clientX-r.left)/r.width;
          const newVal=Math.round(clamp(pct,0,1)*safeMax);
          onSetCur(clamp(newVal,0,safeMax));
        }}
        title={`${cur} / ${safeMax} — click to set`}
      >
        {/* Filled portion */}
        <div style={{
          position:"absolute", left:0, top:0, bottom:0,
          width:`${(clamp(cur,0,safeMax)/safeMax)*100}%`,
          background:fillColor,
          borderRadius:3,
          transition:"width .2s cubic-bezier(.4,0,.2,1)",
          pointerEvents:"none",
        }}/>
        {/* Locked HP overlay — right-side band */}
        {lockedCount>0&&(
          <div style={{
            position:"absolute", right:0, top:0, bottom:0,
            width:`${(lockedCount/safeMax)*100}%`,
            background:"rgba(200,90,58,.35)",
            borderLeft:"1px solid var(--dread-dim)",
            pointerEvents:"none",
          }}/>
        )}
      </div>

      {sub && <div style={{fontSize:8,color:"var(--text-dim)",marginTop:3,fontStyle:"italic"}}>{sub}</div>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   SPELL DATA — Path of Dread Grimoire (v3)
══════════════════════════════════════════════════════════════════════════════ */
const DREAD_SPELLS=[
  // ── Level 1 ──
  {id:1,name:"Morithel",subtitle:"Curse-Speak",pronunciation:"MOR-ith-el",path:"Dread",level:1,mana:1,stress:0,tags:["Debuff"],range:"Near (30ft)",duration:"1 Round",target:"Single Enemy",contested:"Caster's Soul vs. Defender's Soul",effect:"The caster whispers a word of malice. On a failed contest, the target suffers Disadvantage on their next roll.",dice:null},
  {id:2,name:"Rathmorieth",subtitle:"Flame-Diminish",pronunciation:"RATH | MOR-ee-eth",path:"Dread",level:1,mana:1,stress:0,tags:["Damage"],range:"Near (30ft)",duration:"Instant",target:"Single Enemy",contested:null,effect:"A bolt of dark flame strikes the target.",dice:"1d6 fire damage"},
  {id:3,name:"Maerilindel",subtitle:"Hide-Spirit",pronunciation:"MAY-ril | IN-del",path:"Dread",level:1,mana:1,stress:0,tags:["Utility"],range:"Self",duration:"1 Hour",target:"Self",contested:null,effect:"The caster's spiritual presence becomes undetectable. They cannot be sensed by magical detection, Innate Resonance, or Gnomish/Elven sensing abilities. Physical detection (sight, sound, smell) is unaffected.",dice:null},
  {id:4,name:"Thelnithel",subtitle:"Mind-Whisper",pronunciation:"THEL-nith-el",path:"Dread",level:1,mana:1,stress:0,tags:["Control"],range:"Near (30ft)",duration:"Instant",target:"Single Enemy",contested:"Caster's Soul vs. Defender's Mind",effect:"The caster plants a single intrusive thought — a flash of doubt, fear, or hesitation. The target loses their bonus action on their next turn. Does not affect creatures immune to mental effects.",dice:null},
  {id:5,name:"Calindor",subtitle:"Unmake-Agent",pronunciation:"KAL-in-dor",path:"Dread",level:1,mana:1,stress:0,tags:["Damage"],range:"Touch",duration:"Instant",target:"Single Enemy",contested:null,effect:"The caster grips the target. Necrotic energy tears at them from within.",dice:"1d8 necrotic damage"},
  {id:6,name:"Norvalis",subtitle:"Boundary-Edge",pronunciation:"NOR-val-is",path:"Dread",level:1,mana:1,stress:0,tags:["Control","Utility"],range:"Near (30ft)",duration:"10 Minutes",target:"Area (15ft line)",contested:null,effect:"A visible dark line scorches across the ground. Any creature that crosses the line takes damage. The line is visible and can be stepped around, but in tight corridors it becomes a genuine threat.",dice:"1d4 necrotic damage (on crossing)"},
  {id:7,name:"Morindelvyn",subtitle:"False Death",pronunciation:"MOR-in-del | VEEN",path:"Dread",level:1,mana:1,stress:1,tags:["Utility"],range:"Touch",duration:"2 Hours",target:"Single (willing creature or corpse)",contested:null,effect:"The target appears completely dead — no pulse, no breath, cold to the touch. A Medicine check (DR 18) or magical detection can reveal the deception. Useful for faking assassinations, smuggling allies, or surviving a battlefield.",dice:null},
  // ── Level 2 ──
  {id:8,name:"Thalmorieth",subtitle:"Wither",pronunciation:"THAL | MOR-ee-eth",path:"Dread",level:2,mana:2,stress:0,tags:["Debuff"],range:"Near (30ft)",duration:"15 Minutes",target:"Single Enemy",contested:"Caster's Soul vs. Defender's Body",effect:"The target's muscles weaken and joints stiffen. They suffer -2 to all Body rolls and their movement speed is reduced by 10ft for the duration.",dice:null},
  {id:9,name:"Morvelin",subtitle:"Void-Gate",pronunciation:"MOR-vel-in",path:"Dread",level:2,mana:2,stress:0,tags:["Damage"],range:"Far (60ft)",duration:"Instant",target:"Single Enemy",contested:null,effect:"A rift of void energy opens beneath the target's feet, lashing upward with tendrils of darkness.",dice:"2d6 necrotic damage"},
  {id:10,name:"Thelnoral",subtitle:"Mind-Dominate",pronunciation:"THEL-nor-al",path:"Dread",level:2,mana:2,stress:1,tags:["Control"],range:"Near (30ft)",duration:"1 Round",target:"Single Enemy",contested:"Caster's Soul vs. Defender's Soul",effect:"The caster seizes control of the target's next action. The target must use their next turn performing one simple action of the caster's choice (move in a direction, drop a weapon, speak a phrase). Cannot force self-harm or suicidal actions.",dice:null},
  {id:11,name:"Rathenaris",subtitle:"Flame-Bind",pronunciation:"RATH-en-ar-is",path:"Dread",level:2,mana:2,stress:0,tags:["Damage","Control"],range:"Near (30ft)",duration:"2 Rounds",target:"Single Enemy",contested:"Caster's Soul vs. Defender's Body",effect:"Chains of dark fire wrap the target. On a failed contest: Stuck (cannot move) and takes damage each round. On success: half damage only, not Stuck.",dice:"1d6 fire damage per round"},
  {id:12,name:"Norathindel",subtitle:"Hex",pronunciation:"NOR-ath | IN-del",path:"Dread",level:2,mana:2,stress:0,tags:["Debuff"],range:"Far (60ft)",duration:"1 Hour",target:"Single Enemy",contested:"Caster's Soul vs. Defender's Soul",effect:"The caster marks the target with a hex. Whenever the hexed target rolls a natural 1–3 on their d20, they take triggered damage. Only one Hex can be active at a time.",dice:"1d4 psychic damage (triggered on 1–3)"},
  {id:13,name:"Maerilthel",subtitle:"Obscure-Mind",pronunciation:"MAY-ril-thel",path:"Dread",level:2,mana:2,stress:0,tags:["Control"],range:"Near (30ft)",duration:"1 Round",target:"Single Enemy",contested:"Caster's Soul vs. Defender's Mind",effect:"The target's vision fills with crawling shadows. They are Blinded for 1 round.",dice:null},
  // ── Level 3 ──
  {id:14,name:"Calindrath",subtitle:"Immolate",pronunciation:"KAL-ind-rath",path:"Dread",level:3,mana:3,stress:0,tags:["Damage"],range:"Near (30ft)",duration:"Instant",target:"Single Enemy",contested:null,effect:"The caster calls down dark combustion upon the target.",dice:"3d8 fire damage"},
  {id:15,name:"Moriethaen",subtitle:"Drain",pronunciation:"MOR-ee-eth | AYN",path:"Dread",level:3,mana:3,stress:1,tags:["Damage","Utility"],range:"Touch",duration:"Instant",target:"Single Enemy",contested:"Caster's Soul vs. Defender's Soul",effect:"The caster drains life energy from the target. On a failed contest, the target takes damage and the caster heals for half the damage dealt (rounded down). On success, target takes half damage and caster heals nothing.",dice:"2d8 necrotic damage (caster heals half on failed contest)"},
  {id:16,name:"Noralithis",subtitle:"Rupture",pronunciation:"NOR-al-ith-is",path:"Dread",level:3,mana:3,stress:0,tags:["Damage"],range:"Far (60ft)",duration:"Instant",target:"Area (15ft radius)",contested:null,effect:"The ground splits open in the targeted area, releasing a burst of chaotic energy.",dice:"2d6 necrotic damage (area)"},
  {id:17,name:"Thelnarismor",subtitle:"Nightmare",pronunciation:"THEL-nar-is | MOR",path:"Dread",level:3,mana:2,stress:2,tags:["Control","Debuff"],range:"Near (30ft)",duration:"Sustained (1 Mana/round)",target:"Single Enemy",contested:"Caster's Soul vs. Defender's Mind",effect:"The target is trapped in a waking nightmare. Afraid condition (Disadvantage on attacks, cannot willingly approach caster). At the end of each of their turns, target may re-contest.",dice:null},
  {id:18,name:"Vyrcalind",subtitle:"Siphon",pronunciation:"VEER-kal-ind",path:"Dread",level:3,mana:3,stress:0,tags:["Debuff","Utility"],range:"Near (30ft)",duration:"Instant",target:"Single Enemy (must be a spellcaster)",contested:"Caster's Soul vs. Defender's Soul",effect:"The caster siphons raw Resonance from the target. On a failed contest, the target loses 1d4 Mana. The caster gains half (rounded down, minimum 1). On success, no effect. Only works against creatures with a Mana pool.",dice:"1d4 Mana drained from target"},
  {id:19,name:"Enarmor",subtitle:"Shadow Step",pronunciation:"EN-ar-mor",path:"Dread",level:3,mana:2,stress:0,tags:["Utility"],range:"Self",duration:"Instant",target:"Self",contested:null,effect:"The caster steps into a shadow within Touch range and emerges from another shadow within Near range (30ft). Both entry and exit must be in dim light or darkness. Cannot be used in bright light.",dice:null},
  // ── Level 4 ──
  {id:20,name:"Morathisvel",subtitle:"Devouring Dark",pronunciation:"MOR-ath-is-vel",path:"Dread",level:4,mana:4,stress:0,tags:["Damage"],range:"Far (60ft)",duration:"Instant",target:"Single Enemy",contested:null,effect:"A sphere of absolute darkness engulfs the target, crushing inward before detonating outward.",dice:"4d6 necrotic damage"},
  {id:21,name:"Thelcalind",subtitle:"Shatter Will",pronunciation:"THEL-kal-ind",path:"Dread",level:4,mana:3,stress:1,tags:["Control"],range:"Near (30ft)",duration:"1 Round",target:"Single Enemy",contested:"Caster's Soul vs. Defender's Soul",effect:"The caster overwhelms the target's will. On a failed contest, the target is Stunned for 1 round — cannot act, automatic failure on Body defense rolls. Creatures with Soul of 5+ gain Advantage on the contest.",dice:null},
  {id:22,name:"Moriethdor",subtitle:"Rot",pronunciation:"MOR-ee-eth-dor",path:"Dread",level:4,mana:4,stress:0,tags:["Damage","Debuff"],range:"Touch",duration:"3 Rounds",target:"Single Enemy",contested:"Caster's Soul vs. Defender's Body",effect:"The caster's touch causes flesh and armor to corrode. On a failed contest, the target takes damage each round. Armor worn by the target takes 1 Fracture at the start of each round.",dice:"1d8 necrotic damage per round + 1 Fracture/round to worn armor"},
  {id:23,name:"Norathvyr",subtitle:"Wild Surge",pronunciation:"NOR-ath | VEER",path:"Dread",level:4,mana:4,stress:0,tags:["Damage","Buff"],range:"Self",duration:"3 Rounds",target:"Self",contested:null,effect:"The caster channels raw chaos energy. For the duration, all damage rolls gain +1d4. At the end of the duration, the caster takes 1d6 necrotic damage (cannot be reduced). High-risk, high-reward.",dice:"+1d4 to all damage rolls; 1d6 self-damage at duration end"},
  {id:24,name:"Mortharis",subtitle:"False Tongue",pronunciation:"MOR-thar-is",path:"Dread",level:4,mana:3,stress:1,tags:["Control","Utility"],range:"Near (30ft)",duration:"1 Hour",target:"Single (creature that can hear the caster)",contested:"Caster's Soul vs. Defender's Mind",effect:"The caster speaks a single false statement the target believes to be true for the duration. Must be plausible — cannot claim impossible things. The target acts on this belief naturally. After 1 hour, the target realizes the deception and knows who deceived them.",dice:null},
  {id:25,name:"Rathmorvelin",subtitle:"Hellfire Bolt",pronunciation:"RATH | MOR-vel-in",path:"Dread",level:4,mana:4,stress:0,tags:["Damage"],range:"Distant (100ft)",duration:"Instant",target:"Single Enemy",contested:null,effect:"A lance of black-orange fire punches through the air. This spell ignores Armor — damage applied directly to HP.",dice:"3d8 fire damage (ignores Armor)"},
  // ── Level 5 ──
  {id:26,name:"Calindrathaen",subtitle:"Conflagration",pronunciation:"KAL-ind-rath | AYN",path:"Dread",level:5,mana:5,stress:0,tags:["Damage"],range:"Far (60ft)",duration:"Instant",target:"Area (20ft radius)",contested:null,effect:"Dark flame storms down upon the area. All creatures within take damage. Flammable objects ignite.",dice:"4d6 fire damage (area)"},
  {id:27,name:"Morindelthelaris",subtitle:"Soul Tear",pronunciation:"MOR-in-del | THEL-ar-is",path:"Dread",level:5,mana:4,stress:2,tags:["Damage","Debuff"],range:"Near (30ft)",duration:"Instant",target:"Single Enemy",contested:"Caster's Soul vs. Defender's Soul",effect:"The caster reaches into the target's spiritual core and tears. On a failed contest: psychic damage + 2 Stress inflicted on target. On success: half damage + 1 Stress.",dice:"3d8 psychic damage + forced Stress"},
  {id:28,name:"Aenmorindel",subtitle:"Corruption Seed",pronunciation:"AYN | MOR-in-del",path:"Dread",level:5,mana:5,stress:0,tags:["Debuff","Control"],range:"Touch",duration:"Permanent (until dispelled)",target:"Single (willing or unconscious creature)",contested:null,effect:"The caster plants a seed of corrupted Resonance within the target. While the seed remains, the target's Tether shifts 1 step toward Dread at each dawn. The target is unaware unless they receive magical diagnosis. Can be removed by a Grace spell of Level 5+.",dice:null},
  {id:29,name:"Norathcaer",subtitle:"Unleash",pronunciation:"NOR-ath | CARE",path:"Dread",level:5,mana:5,stress:1,tags:["Damage"],range:"Self",duration:"Instant",target:"Area (15ft radius centered on self)",contested:null,effect:"The caster releases a shockwave of chaotic energy from their body. All creatures within 15ft — allies included — take damage. The caster is immune.",dice:"3d8 necrotic damage (area, affects allies, caster immune)"},
  {id:30,name:"Enarmorcaer",subtitle:"Far Shadow Step",pronunciation:"EN-ar-mor | CARE",path:"Dread",level:5,mana:4,stress:0,tags:["Utility"],range:"Self",duration:"Instant",target:"Self",contested:null,effect:"The upgraded version of Shadow Step. The caster steps into any shadow within Near range and emerges from any shadow within Far range (60ft). Entry and exit points must be dim or dark. Cannot be used in bright light.",dice:null},
  // ── Level 6 ──
  {id:31,name:"Morilendcaer",subtitle:"Death Grip",pronunciation:"MOR-il-end | CARE",path:"Dread",level:6,mana:6,stress:1,tags:["Damage"],range:"Close (melee)",duration:"Instant",target:"Single Enemy",contested:null,effect:"The caster grabs the target and channels pure destructive force through them. If this damage reduces the target to 0 HP, they cannot make Death Saves — they must choose Die a Hero or Bargain with Death immediately.",dice:"5d8 necrotic damage"},
  {id:32,name:"Caermorathis",subtitle:"Annihilation Beam",pronunciation:"CARE | MOR-ath-is",path:"Dread",level:6,mana:6,stress:0,tags:["Damage"],range:"Distant (100ft)",duration:"Instant",target:"Line (5ft wide, 100ft long)",contested:null,effect:"A beam of concentrated void energy fires in a straight line. All creatures and objects in its path take damage.",dice:"5d6 necrotic damage (line, all creatures in path)"},
  {id:33,name:"Thelnarisvyn",subtitle:"Amnesia",pronunciation:"THEL-nar-is | VEEN",path:"Dread",level:6,mana:5,stress:2,tags:["Control"],range:"Touch",duration:"Permanent (until dispelled)",target:"Single creature",contested:"Caster's Soul vs. Defender's Mind",effect:"The caster erases a single specific memory — a conversation, a face, an event. The target has no awareness the memory is missing. Reversible by a Grace spell of Level 6+ or overwhelming contrary evidence (GM discretion).",dice:null},
  {id:34,name:"Morvelinath",subtitle:"Shadow Army",pronunciation:"MOR-vel-in-ath",path:"Dread",level:6,mana:6,stress:2,tags:["Utility","Control"],range:"Near (30ft)",duration:"Until End of Encounter",target:"Area",contested:null,effect:"The caster summons 1d4+1 shadow constructs (min 2, max 5). Each has 8 HP, 0 Armor, deals 1d6 necrotic damage, and acts on the caster's initiative. They dissolve instantly in magical light. They obey simple commands only.",dice:"Each construct deals 1d6 necrotic"},
  {id:35,name:"Vyrcalindor",subtitle:"Quake",pronunciation:"VEER | KAL-in-dor",path:"Dread",level:6,mana:6,stress:0,tags:["Damage","Control"],range:"Far (60ft)",duration:"Instant",target:"Area (25ft radius)",contested:"Defender's Body vs. DR 14",effect:"The earth heaves and splits. All creatures in the area take damage and must roll Body vs. DR 14 or be knocked Prone. Structures take double damage.",dice:"3d8 bludgeon damage (area)"},
  // ── Level 7 ──
  {id:36,name:"Noriathaen",subtitle:"Madness",pronunciation:"NOR-ee-ath | AYN",path:"Dread",level:7,mana:6,stress:2,tags:["Control","Debuff"],range:"Near (30ft)",duration:"Until End of Encounter",target:"Single Enemy",contested:"Caster's Soul vs. Defender's Mind",effect:"The target's mind fractures. On a failed contest, at the start of each turn the target rolls 1d6: (1–2) attacks nearest creature regardless of allegiance; (3–4) does nothing and mutters; (5–6) acts normally. Target re-contests at end of each turn.",dice:null},
  {id:37,name:"Calindmorcaer",subtitle:"Obliterate",pronunciation:"KAL-ind | MOR | CARE",path:"Dread",level:7,mana:7,stress:1,tags:["Damage"],range:"Far (60ft)",duration:"Instant",target:"Single Enemy",contested:null,effect:"A concentrated blast of void energy strikes a single target.",dice:"6d8 necrotic damage"},
  {id:38,name:"Morvyrindel",subtitle:"Phantom Chains",pronunciation:"MOR | VEER-in-del",path:"Dread",level:7,mana:6,stress:0,tags:["Control"],range:"Far (60ft)",duration:"Sustained (1 Mana/round)",target:"Up to 3 Enemies",contested:"Caster's Soul vs. each Defender's Body",effect:"Spectral chains bind up to 3 targets. Failed contest per target: Stuck and Weakened (-1 to all attack rolls). Each re-contests at the start of their turn. If the caster drops sustain, all chains break simultaneously. Caster cannot act offensively while sustaining.",dice:null},
  {id:39,name:"Moriethelindel",subtitle:"Wasting Curse",pronunciation:"MOR-ee-eth | el-IN-del",path:"Dread",level:7,mana:5,stress:2,tags:["Debuff"],range:"Near (30ft)",duration:"Permanent (until dispelled)",target:"Single Enemy",contested:"Caster's Soul vs. Defender's Soul",effect:"The target is cursed with slow decay. Each dawn, the target loses 1 maximum HP until cured. When their maximum HP reaches half its original value, they also gain Disadvantage on all Body rolls. Removable by Grace spell of Level 7+ or a legendary healer.",dice:"1 max HP lost per dawn (cumulative)"},
  {id:40,name:"Thalrathvyr",subtitle:"Blight Storm",pronunciation:"THAL-rath | VEER",path:"Dread",level:7,mana:7,stress:0,tags:["Damage"],range:"Far (60ft)",duration:"3 Rounds",target:"Area (30ft radius)",contested:null,effect:"A storm of toxic ash and dark flame fills the area. All creatures (including the caster if in the area) take damage at the start of each round. The area counts as difficult terrain.",dice:"2d6 fire + 1d6 necrotic damage per round (area)"},
  // ── Level 8 ──
  {id:41,name:"Morathisindel",subtitle:"Soul Shatter",pronunciation:"MOR-ath-is | IN-del",path:"Dread",level:8,mana:7,stress:2,tags:["Damage","Debuff"],range:"Near (30ft)",duration:"Instant",target:"Single Enemy",contested:"Caster's Soul vs. Defender's Soul",effect:"The caster attacks the target's very soul. On a failed contest: massive psychic damage + 3 Stress inflicted on target + target's Tether shifts 2 steps toward Dread. On success: half damage + 1 Stress only, no Tether shift.",dice:"5d10 psychic damage (failed contest); half on success"},
  {id:42,name:"Caernorath",subtitle:"Chaos Engine",pronunciation:"CARE | NOR-ath",path:"Dread",level:8,mana:8,stress:0,tags:["Buff","Damage"],range:"Self",duration:"Until End of Encounter",target:"Self",contested:null,effect:"The caster becomes a conduit for raw chaos. For the duration: +2 to all Soul rolls, all damage spells deal +1d6 bonus necrotic damage. However the caster takes 1d4 necrotic at the start of each of their turns (cannot be reduced or prevented).",dice:"+1d6 bonus necrotic to all spells; 1d4 self-damage per turn"},
  {id:43,name:"Calindelareth",subtitle:"Suffocate",pronunciation:"KAL-ind | EL-ar-eth",path:"Dread",level:8,mana:7,stress:2,tags:["Damage","Control"],range:"Near (30ft)",duration:"Sustained (2 Mana/round)",target:"Single Enemy",contested:"Caster's Soul vs. Defender's Body (each round)",effect:"Air is ripped from the target's lungs. On a failed contest each round: damage + target is Silenced (cannot cast Resonance spells). If sustained for 3 consecutive failed rounds, the target falls Unconscious. On success any round, the effect pauses but does not end.",dice:"2d8 damage per round (failed contest)"},
  {id:44,name:"Norvelinmor",subtitle:"Rift Walk",pronunciation:"NOR-vel-in | MOR",path:"Dread",level:8,mana:8,stress:0,tags:["Utility"],range:"Self",duration:"Instant",target:"Self + up to 3 willing creatures (touching)",contested:null,effect:"The caster tears open a rift through the Veil, teleporting themselves and up to 3 willing creatures they are touching to a location the caster has previously visited within 5 miles. Upon arrival, all travelers take 1 Stress from Veil exposure.",dice:"None (1 Stress to all travelers on arrival)"},
  {id:45,name:"Moriethnalath",subtitle:"Blood Boil",pronunciation:"MOR-ee-eth | NAL-ath",path:"Dread",level:8,mana:8,stress:2,tags:["Damage"],range:"Near (30ft)",duration:"Instant",target:"Up to 3 Enemies",contested:"Caster's Soul vs. each Defender's Body",effect:"The caster causes blood (or equivalent fluid) inside up to 3 targets to boil. Failed contest per target: full damage. Success: half damage.",dice:"3d10 necrotic damage per target (failed); half on success"},
  // ── Level 9 ──
  {id:46,name:"Calindmorcaelath",subtitle:"Annihilation",pronunciation:"KAL-ind | MOR | CARE-lath",path:"Dread",level:9,mana:9,stress:2,tags:["Damage"],range:"Far (60ft)",duration:"Instant",target:"Single Enemy",contested:null,effect:"Pure destructive force, unfiltered and absolute. Ignores Armor and Resistance.",dice:"8d8 necrotic damage (ignores Armor and Resistance)"},
  {id:47,name:"Thelnorialaen",subtitle:"Rewrite",pronunciation:"THEL-nor-ee-al | AYN",path:"Dread",level:9,mana:8,stress:4,tags:["Control"],range:"Touch",duration:"Permanent (until dispelled)",target:"Single creature",contested:"Caster's Soul vs. Defender's Soul (Advantage to defender)",effect:"The caster fundamentally alters a core belief or loyalty in the target. The target genuinely believes the rewritten conviction and acts freely on it. Dispellable by Grace spell of Level 9+ or overwhelming contrary evidence (GM discretion).",dice:null},
  {id:48,name:"Aenthormorvelin",subtitle:"Call the Hollow",pronunciation:"AYN-thor | MOR-vel-in",path:"Dread",level:9,mana:9,stress:2,tags:["Utility","Damage"],range:"Near (30ft)",duration:"Until End of Encounter",target:"Area",contested:null,effect:"The caster summons a Hollow — a void entity with 35 HP, 2 Armor, 3d6 necrotic damage on attacks, acts on caster's initiative. If the caster loses consciousness, the Hollow becomes hostile to all creatures until the scene ends.",dice:"Hollow deals 3d6 necrotic per attack"},
  {id:49,name:"Morindelveyrath",subtitle:"Hellstorm",pronunciation:"MOR-in-del | VAY-rath",path:"Dread",level:9,mana:9,stress:0,tags:["Damage"],range:"Distant (100ft)",duration:"3 Rounds",target:"Area (40ft radius)",contested:null,effect:"A devastating storm of void-infused fire descends upon the area. All creatures take damage at the start of each round. The area is heavily obscured and difficult terrain. Caster is not immune.",dice:"3d6 fire + 2d6 necrotic damage per round (area)"},
  {id:50,name:"Thelcalindaris",subtitle:"Ego Death",pronunciation:"THEL | KAL-in-dar-is",path:"Dread",level:9,mana:7,stress:4,tags:["Control","Debuff"],range:"Touch",duration:"Permanent (until dispelled)",target:"Single Enemy",contested:"Caster's Soul vs. Defender's Soul (Advantage to defender)",effect:"The caster destroys the target's sense of self. On a failed contest, the target loses all class abilities, spellcasting, competencies, and class features until dispelled. They retain HP, stats, and basic attacks — effectively a commoner. Dispellable by Grace spell of Level 9+ or divine intervention.",dice:null},
  // ── Level 10 ──
  {id:51,name:"Morathiscaerindel",subtitle:"Avatar of Ruin",pronunciation:"MOR-ath-is | CARE | IN-del",path:"Dread",level:10,mana:10,stress:2,trauma:true,tags:["Buff","Damage"],range:"Self",duration:"5 Rounds",target:"Self",contested:null,effect:"The caster transforms into a conduit of pure destruction. For the duration: all damage spells deal +2d6 bonus necrotic, Resistance to all damage, movement speed doubles, eyes become voids of black. At duration end: caster takes 3d6 necrotic (cannot be reduced) and collapses to Prone.",dice:"+2d6 bonus necrotic per spell; 3d6 self-damage at duration end"},
  {id:52,name:"Calindsilath",subtitle:"Eclipse",pronunciation:"KAL-ind | SIL-ath",path:"Dread",level:10,mana:10,stress:0,trauma:true,tags:["Control","Debuff"],range:"Self",duration:"Until End of Encounter",target:"Area (100ft radius centered on caster, moves with caster)",contested:null,effect:"All light within 100ft is extinguished — magical and mundane. Pitch darkness. Only creatures with darkvision or Ethereal Sight can see. All light-based spells within the area are suppressed. The caster sees normally within the Eclipse.",dice:null},
  {id:53,name:"Norathmorvelin",subtitle:"Unravel",pronunciation:"NOR-ath | MOR-vel-in",path:"Dread",level:10,mana:9,stress:2,trauma:true,tags:["Debuff","Damage"],range:"Near (30ft)",duration:"Instant",target:"Single active spell or magical effect",contested:"Caster's Soul vs. original spell's caster's Soul (DR 16 if absent)",effect:"The caster targets one active spell or magical effect and unravels it violently. The effect is dispelled and the backlash deals damage to whoever originally cast it, even if they are not present.",dice:"5d8 necrotic damage to the original caster of the dispelled effect"},
  {id:54,name:"Morilendvyrathis",subtitle:"Necrosis",pronunciation:"MOR-il-end | VEER-ath-is",path:"Dread",level:10,mana:10,stress:2,trauma:true,tags:["Damage"],range:"Touch",duration:"Instant",target:"Single Enemy",contested:"Caster's Soul vs. Defender's Body",effect:"The caster channels pure entropy into the target through touch. Failed contest: massive necrotic damage + a Critical Injury is applied regardless of damage amount. Success: half damage + Major Injury instead.",dice:"8d6 necrotic damage + forced injury tier"},
  {id:55,name:"Thelnormaeril",subtitle:"Memory Palace",pronunciation:"THEL-nor | MAY-ril",path:"Dread",level:10,mana:8,stress:3,trauma:true,tags:["Control","Utility"],range:"Touch",duration:"Permanent (until dispelled)",target:"Single (willing or unconscious creature)",contested:null,effect:"The caster constructs an entire false history within the target's mind — a complete identity replacing the original, which is locked away but not destroyed. The target lives genuinely as this new person. Reversible by Grace spell of Level 10+ or exposure to a personally significant artifact from their true life (GM discretion).",dice:null},
  // ── Level 11 ──
  {id:56,name:"Calindaenathel",subtitle:"Unborn",pronunciation:"KAL-ind | AYN-ath-el",path:"Dread",level:11,mana:11,stress:3,trauma:true,tags:["Damage","Control"],range:"Touch",duration:"Instant",target:"Single Enemy",contested:"Caster's Soul vs. Defender's Soul (Advantage to defender)",effect:"The caster attempts to permanently sever the target's connection to Resonance. Failed contest: massive necrotic damage + target's maximum Mana permanently becomes 0. Can only be reversed by divine intervention. Success: half damage + Mana reduced to 0 until next Long Rest.",dice:"9d8 necrotic damage + permanent Mana severance (failed contest)"},
  {id:57,name:"Morathisvyrindel",subtitle:"Death Current",pronunciation:"MOR-ath-is | VEER | IN-del",path:"Dread",level:11,mana:10,stress:2,trauma:true,tags:["Damage"],range:"Self",duration:"Instant",target:"Area (60ft cone)",contested:null,effect:"The caster exhales a wave of pure death energy in a massive cone. All living creatures in the area take damage. Creatures reduced to 0 HP by this spell cannot be healed or stabilized for 1 full round — they can only Die a Hero or Bargain with Death.",dice:"9d6 necrotic damage (60ft cone)"},
  {id:58,name:"Noralithcaermor",subtitle:"Reality Fracture",pronunciation:"NOR-al-ith | CARE | MOR",path:"Dread",level:11,mana:11,stress:3,trauma:true,tags:["Damage","Control"],range:"Far (60ft)",duration:"3 Rounds",target:"Area (30ft radius)",contested:null,effect:"Reality cracks within the area. Gravity shifts, distances distort, time stutters. All creatures take damage at the start of each round and must roll Body vs. DR 16 or be teleported to a random position within the zone. Spellcasting within the zone requires a Soul check (DR 14) or the spell fails (Mana still spent). Caster is not immune.",dice:"5d8 necrotic damage per round (area)"},
  // ── Level 12 ──
  {id:59,name:"Morathiscalindaen",subtitle:"Final Word",pronunciation:"MOR-ath-is | KAL-ind | AYN",path:"Dread",level:12,mana:12,stress:4,trauma:true,tags:["Damage"],range:"Near (30ft)",duration:"Instant",target:"Single Enemy",contested:"Caster's Soul vs. Defender's Soul",effect:"The caster speaks the Archalume word for absolute, permanent ending. Failed contest: the target takes catastrophic damage and, if reduced to 0 HP, dies immediately — no Death Saves, no Bargain with Death, no final action. Their body crumbles to ash. Success: half damage, Stunned for 1 round.",dice:"12d10 necrotic damage"},
  {id:60,name:"Calindsilaendorindel",subtitle:"Worldscar",pronunciation:"KAL-ind | SIL | AYN-dor | IN-del",path:"Dread",level:12,mana:12,stress:5,trauma:true,tags:["Damage","Control"],range:"Distant (100ft)",duration:"Until End of Encounter",target:"Area (100ft radius)",contested:null,effect:"The caster tears a wound in the Veil itself. A permanent scar opens between the mortal world and the void. All creatures in the area take damage at the start of each round — no exceptions, caster included. All healing in the area is halved. Shadows gain physical form (4 shadow constructs: 12 HP each, 2d8 necrotic damage, attack randomly). The scar persists for the scene then closes, but leaves a permanent mark on the landscape forever.",dice:"6d8 necrotic per round (area); shadow constructs deal 2d8 each"},
];

const DREAD_SPELL_BALANCE=[
  {level:1,single:"1d6–1d8",area:"1d4 (conditional)",mana:1},
  {level:2,single:"2d6",area:"1d4 (conditional)",mana:2},
  {level:3,single:"3d6–3d8",area:"2d6 (area)",mana:3},
  {level:4,single:"3d8–4d6",area:"3d6 (area)",mana:4},
  {level:5,single:"4d8",area:"4d6 (area)",mana:5},
  {level:6,single:"5d6–5d8",area:"3d8 (area)",mana:6},
  {level:7,single:"6d8",area:"3d6+1d6 (area)",mana:7},
  {level:8,single:"5d10",area:"4d8 (area)",mana:8},
  {level:9,single:"8d8",area:"4d6+2d6 (area)",mana:9},
  {level:10,single:"8d10",area:"5d8 (area)",mana:10},
  {level:11,single:"9d8–10d6",area:"5d8 (area/cone)",mana:11},
  {level:12,single:"12d10",area:"6d8 (area/round)",mana:12},
];

const GRACE_SPELLS=[
  // ── Level 1 ──
  {id:101,name:"Silindaris",subtitle:"Illumination",pronunciation:"SIL-in-dar-is",path:"Grace",level:1,mana:1,stress:0,tags:["Utility"],range:"Self",duration:"1 Hour",target:"Self",contested:null,effect:"The caster emits a warm, steady glow to a 30ft radius. Natural-looking, cannot be identified as magical without an Arcana check (DR 12). Extinguished immediately if the caster is Silenced.",dice:null},
  {id:102,name:"Ilisindel",subtitle:"Shield-Spirit",pronunciation:"IL-is | IN-del",path:"Grace",level:1,mana:1,stress:0,tags:["Buff"],range:"Touch",duration:"1 Round",target:"Single (self or ally)",contested:null,effect:"A shimmer of protective energy surrounds the target. They gain +2 Armor for 1 round. Can be cast on an ally as a bonus action.",dice:null},
  {id:103,name:"Silthilis",subtitle:"Mend",pronunciation:"SIL | THIL-is",path:"Grace",level:1,mana:1,stress:0,tags:["Heal"],range:"Touch",duration:"Instant",target:"Single (self or ally)",contested:null,effect:"The caster channels restorative Resonance into the target, closing minor wounds.",dice:"1d6 HP restored"},
  {id:104,name:"Etharis",subtitle:"Calm",pronunciation:"ETH-ar-is",path:"Grace",level:1,mana:1,stress:0,tags:["Utility","Control"],range:"Near (30ft)",duration:"5 Minutes",target:"Single creature",contested:"Caster's Soul vs. Defender's Soul",effect:"The caster speaks a word of harmony. On a failed contest, a hostile or panicked creature becomes calm and non-aggressive for the duration. Does not work on creatures actively being harmed. Ends immediately if the target takes damage.",dice:null},
  {id:105,name:"Quilindel",subtitle:"Sense",pronunciation:"KWIL-in-del",path:"Grace",level:1,mana:1,stress:0,tags:["Utility"],range:"Self",duration:"5 Minutes",target:"Self",contested:null,effect:"The caster briefly opens their spiritual perception. They can sense the presence and general direction of all living creatures within 30ft, including through walls and floors. Does not reveal exact position or identity.",dice:null},
  {id:106,name:"Venaris",subtitle:"Ward",pronunciation:"VEN-ar-is",path:"Grace",level:1,mana:1,stress:0,tags:["Buff"],range:"Touch",duration:"1 Hour",target:"Single (self or ally)",contested:null,effect:"The caster marks the target with a faint celestial ward. The first time this session the target would gain a Trauma, they may ignore it. Once triggered, the ward is consumed.",dice:null},
  {id:107,name:"Elarindel",subtitle:"Featherfall",pronunciation:"EL-ar | IN-del",path:"Grace",level:1,mana:1,stress:0,tags:["Utility"],range:"Near (30ft)",duration:"Instant",target:"Up to 3 willing creatures",contested:null,effect:"All targeted creatures fall slowly and safely, taking no falling damage regardless of height.",dice:null},
  // ── Level 2 ──
  {id:108,name:"Silivorath",subtitle:"Searing Light",pronunciation:"SIL-iv-or-ath",path:"Grace",level:2,mana:2,stress:0,tags:["Damage"],range:"Near (30ft)",duration:"Instant",target:"Single Enemy",contested:null,effect:"A focused beam of purifying light strikes the target. Deals double damage to undead and void creatures.",dice:"2d6 radiant damage (4d6 vs undead/void)"},
  {id:109,name:"Thilisindel",subtitle:"Fortify",pronunciation:"THIL-is | IN-del",path:"Grace",level:2,mana:2,stress:0,tags:["Buff"],range:"Touch",duration:"15 Minutes",target:"Single (self or ally)",contested:null,effect:"The target gains +2 to all Body rolls and Resistance to the next source of physical damage they receive (half damage, rounded up).",dice:null},
  {id:110,name:"Silindorthilis",subtitle:"Greater Mend",pronunciation:"SIL-in-dor | THIL-is",path:"Grace",level:2,mana:2,stress:1,tags:["Heal"],range:"Touch",duration:"Instant",target:"Single ally",contested:null,effect:"The caster pours their own vitality into the target. The Stress cost represents the physical toll of channeling significant healing through one's own body.",dice:"2d8 HP restored"},
  {id:111,name:"Quilarisindel",subtitle:"Guide",pronunciation:"KWIL-ar-is | IN-del",path:"Grace",level:2,mana:2,stress:0,tags:["Utility"],range:"Self",duration:"1 Hour",target:"Self",contested:null,effect:"The caster attunes to the flow of Resonance in the area. Advantage on all navigation, tracking, and Awareness rolls for the scene. Cannot be magically misdirected — direction-altering illusions automatically fail against the caster.",dice:null},
  {id:112,name:"Ilismor",subtitle:"Sanctify",pronunciation:"IL-is-mor",path:"Grace",level:2,mana:2,stress:0,tags:["Buff","Utility"],range:"Touch",duration:"Until End of Encounter",target:"Area (10ft radius centered on touched point)",contested:null,effect:"The caster consecrates a small area. Undead, void entities, and shadow constructs cannot willingly enter. Dread spells cast within the zone cost 1 additional Mana.",dice:null},
  {id:113,name:"Venthalisindel",subtitle:"Uplift",pronunciation:"VEN-thal-is | IN-del",path:"Grace",level:2,mana:2,stress:0,tags:["Buff"],range:"Near (30ft)",duration:"Instant",target:"Single ally",contested:null,effect:"The caster fills an ally with sudden divine momentum. The target may immediately take a bonus action outside of their normal turn order. Does not replace their regular turn.",dice:null},
  // ── Level 3 ──
  {id:114,name:"Silindarthilis",subtitle:"Restoration",pronunciation:"SIL-in-dar | THIL-is",path:"Grace",level:3,mana:3,stress:1,tags:["Heal"],range:"Touch",duration:"Instant",target:"Single ally",contested:null,effect:"A surge of restorative energy floods the target. Heals HP and removes one active negative Status Effect (Blinded, Poisoned, Weakened, Afraid, Bleeding).",dice:"3d8 HP restored + remove 1 Status Effect"},
  {id:115,name:"Caerilisvyr",subtitle:"Barrier",pronunciation:"CARE-il-is | VEER",path:"Grace",level:3,mana:3,stress:0,tags:["Buff"],range:"Near (30ft)",duration:"15 Minutes",target:"Up to 3 allies",contested:null,effect:"A shimmering field of force surrounds up to 3 allies. Each gains +2 Armor for the duration. The barrier glows visibly, cannot be concealed.",dice:null},
  {id:116,name:"Silivorathaen",subtitle:"Holy Lance",pronunciation:"SIL-iv-or-ath | AYN",path:"Grace",level:3,mana:3,stress:0,tags:["Damage"],range:"Far (60ft)",duration:"Instant",target:"Single Enemy",contested:null,effect:"A spear of concentrated divine light launches at the target.",dice:"3d8 radiant damage"},
  {id:117,name:"Thelindorilis",subtitle:"Mental Fortress",pronunciation:"THEL-in-dor | IL-is",path:"Grace",level:3,mana:2,stress:1,tags:["Buff"],range:"Touch",duration:"Until End of Encounter",target:"Single (self or ally)",contested:null,effect:"The target's mind is fortified against intrusion. Advantage on all Soul rolls to resist Dread spells targeting the Mind. Immune to the Afraid condition for the scene.",dice:null},
  {id:118,name:"Doriethaen",subtitle:"Conjure Sustenance",pronunciation:"DOR-ee-eth | AYN",path:"Grace",level:3,mana:2,stress:0,tags:["Utility"],range:"Touch",duration:"Permanent",target:"Surface (touched)",contested:null,effect:"The caster conjures a simple but nourishing meal for up to 6 people. Counts as a full ration for rest purposes. Lasts 24 hours without spoiling. Cannot create poisons, medicines, or magical consumables.",dice:null},
  {id:119,name:"Silarvyrindel",subtitle:"Beacon",pronunciation:"SIL-ar | VEER | IN-del",path:"Grace",level:3,mana:3,stress:0,tags:["Utility","Buff"],range:"Self",duration:"Until End of Encounter",target:"Self (affects allies within Far range)",contested:null,effect:"The caster becomes a spiritual beacon. All allies within Far range (60ft) gain +1 to their Dread Roll d12, increasing the statistical chance of a Grace result. Passive, requires no action to maintain. Ends if the caster is Silenced or falls unconscious.",dice:null},
  // ── Level 4 ──
  {id:120,name:"Silindarthilisaen",subtitle:"Mass Mend",pronunciation:"SIL-in-dar | THIL-is | AYN",path:"Grace",level:4,mana:4,stress:2,tags:["Heal"],range:"Near (30ft)",duration:"Instant",target:"Up to 4 allies",contested:null,effect:"The caster spreads restorative energy across multiple allies. Each target heals. The Stress cost scales with the number of targets — the more people you heal, the more it costs you personally.",dice:"2d6 HP restored to each target"},
  {id:121,name:"Caervenaris",subtitle:"Divine Strike",pronunciation:"CARE | VEN-ar-is",path:"Grace",level:4,mana:4,stress:0,tags:["Damage"],range:"Near (30ft)",duration:"Instant",target:"Single Enemy",contested:null,effect:"A column of divine energy descends from above. Undead and void creatures must contest Soul vs. DR 16 or be Stunned for 1 round in addition to taking damage.",dice:"4d6 radiant damage (+ Stun check for undead/void)"},
  {id:122,name:"Ethinarisindel",subtitle:"Purge",pronunciation:"ETH-in-ar-is | IN-del",path:"Grace",level:4,mana:3,stress:1,tags:["Utility","Heal"],range:"Touch",duration:"Instant",target:"Single ally",contested:null,effect:"The caster purges corruption from the target. Removes all active negative Status Effects, ends any active Dread spell of Level 4 or lower affecting the target, and reduces one active Injury by 2 Injury HP.",dice:null},
  {id:123,name:"Venilisvyr",subtitle:"Windwall",pronunciation:"VEN-il-is | VEER",path:"Grace",level:4,mana:4,stress:0,tags:["Control","Buff"],range:"Near (30ft)",duration:"15 Minutes",target:"Area (20ft wall, placed by caster)",contested:null,effect:"A wall of forceful wind appears. Non-magical ranged attacks cannot pass through it. Creatures attempting to walk through must roll Body vs. DR 13 or be pushed back 10ft.",dice:null},
  {id:124,name:"Silthelnor",subtitle:"Truth Sight",pronunciation:"SIL | THEL-nor",path:"Grace",level:4,mana:3,stress:0,tags:["Utility"],range:"Self",duration:"1 Round",target:"Self",contested:null,effect:"The caster's eyes glow silver. For 1 round, all illusions and magical deceptions within Far range (60ft) are seen through. Invisible creatures become visible. Active Dread deception spells (False Tongue, False Death, Amnesia, etc.) are immediately and visibly revealed.",dice:null},
  {id:125,name:"Aenthilisindel",subtitle:"Empower",pronunciation:"AYN | THIL-is | IN-del",path:"Grace",level:4,mana:4,stress:0,tags:["Buff"],range:"Touch",duration:"15 Minutes",target:"Single ally",contested:null,effect:"The caster pours raw Resonant energy into an ally, amplifying their natural abilities. The target gains +2 to all rolls and +1d4 to all damage rolls for the duration.",dice:"+1d4 bonus to all damage rolls for target"},
  // ── Level 5 ──
  {id:126,name:"Silindarthilisaeth",subtitle:"Circle of Healing",pronunciation:"SIL-in-dar | THIL-is | AY-eth",path:"Grace",level:5,mana:5,stress:2,tags:["Heal"],range:"Near (30ft)",duration:"Instant",target:"All allies within range (not caster)",contested:null,effect:"A wave of golden light radiates from the caster. Every ally within Near range heals. The caster does not heal themselves — this spell is sacrifice, not convenience.",dice:"2d8 HP restored to all allies in range"},
  {id:127,name:"Silivoraenath",subtitle:"Solar Burst",pronunciation:"SIL-iv-or | AYN-ath",path:"Grace",level:5,mana:5,stress:0,tags:["Damage"],range:"Self",duration:"Instant",target:"Area (20ft radius, enemies only)",contested:"Caster's Soul vs. each Defender's Soul (Blind check only)",effect:"The caster erupts in blinding divine light. All enemies within 20ft take damage and must contest Soul vs. Caster's Soul or be Blinded for 1 round. Allies are completely unaffected — the light knows its own.",dice:"4d6 radiant damage (area, enemies only)"},
  {id:128,name:"Venthalisaen",subtitle:"Resurrection Spark",pronunciation:"VEN-thal-is | AYN",path:"Grace",level:5,mana:5,stress:3,tags:["Heal"],range:"Touch",duration:"Instant",target:"Single downed ally (making Death Saves)",contested:null,effect:"The caster grabs a dying ally and forces Resonance into them, pulling them back from the edge. The target immediately stabilizes at 1 HP, Death Save progress is cleared, and they regain consciousness. All injuries remain.",dice:"Stabilize at 1 HP"},
  {id:129,name:"Iliscaerindel",subtitle:"Aegis",pronunciation:"IL-is | CARE | IN-del",path:"Grace",level:5,mana:5,stress:0,tags:["Buff"],range:"Touch",duration:"Until End of Encounter",target:"Single ally",contested:null,effect:"The caster wraps an ally in powerful divine armor. For the scene: +3 Armor and all Dread spell effects targeting the ally have their duration halved (rounded down). The glowing gold shield cannot be concealed.",dice:null},
  {id:130,name:"Quilindelvyr",subtitle:"Far Sight",pronunciation:"KWIL-in-del | VEER",path:"Grace",level:5,mana:4,stress:0,tags:["Utility"],range:"Up to 1 mile (previously visited location)",duration:"Sustained (1 Mana/10 minutes, real world time)",target:"Self",contested:null,effect:"The caster's sight detaches from their body. They can see and hear from any point they have previously visited within 1 mile. While sustained, they are Blinded to their immediate surroundings.",dice:null},
  // ── Level 6 ──
  {id:131,name:"Silindorthilisaen",subtitle:"Greater Restoration",pronunciation:"SIL-in-dor | THIL-is | AYN",path:"Grace",level:6,mana:6,stress:2,tags:["Heal"],range:"Touch",duration:"Instant",target:"Single ally",contested:null,effect:"A powerful surge of restorative energy floods the target. Heals significant HP, removes all negative Status Effects, and reduces all active Injury HP by 3 (distributed across injuries as the target chooses).",dice:"4d10 HP restored + clear all Status Effects + 3 Injury HP reduced"},
  {id:132,name:"Caervenindor",subtitle:"Smite",pronunciation:"CARE | VEN-in-dor",path:"Grace",level:6,mana:6,stress:0,tags:["Damage"],range:"Far (60ft)",duration:"Instant",target:"Single Enemy",contested:null,effect:"A pillar of divine fire descends on the target. If the target is undead, a void creature, or currently under the effect of a Dread spell, they take double damage.",dice:"5d8 radiant damage (double vs undead/void/cursed)"},
  {id:133,name:"Ethindrisaen",subtitle:"Consecrate Ground",pronunciation:"ETH-in-dris | AYN",path:"Grace",level:6,mana:6,stress:0,tags:["Control","Utility"],range:"Near (30ft)",duration:"Until End of Encounter",target:"Area (30ft radius)",contested:null,effect:"The caster consecrates a large area. Within the zone: undead take 1d6 radiant at start of each round, all healing is increased by +1d4, Dread spells cost 2 additional Mana, and Grace casters gain Advantage on Soul rolls. The zone glows faintly gold.",dice:"1d6 radiant per round to undead in zone; +1d4 to all healing in zone"},
  {id:134,name:"Silthilisindelvyr",subtitle:"Resonance Surge",pronunciation:"SIL | THIL-is | IN-del | VEER",path:"Grace",level:6,mana:5,stress:0,tags:["Buff"],range:"Near (30ft)",duration:"15 Minutes",target:"Up to 3 allies",contested:null,effect:"The caster channels a wave of raw Resonant energy into allies. Each target gains +1 Mana (up to their maximum) and their next spell cast within the duration costs 1 less Mana (minimum 1).",dice:null},
  {id:135,name:"Thelvanorindel",subtitle:"Commune",pronunciation:"THEL-van-or | IN-del",path:"Grace",level:6,mana:5,stress:1,tags:["Utility"],range:"Self",duration:"Instant",target:"Self",contested:null,effect:"The caster briefly opens a channel through the Veil and poses one question to the divine. The GM answers honestly — a single word, brief vision, or symbolic image. Always truthful, potentially cryptic. Once per Long Rest.",dice:null},
  // ── Level 7 ──
  {id:136,name:"Silindorventhalis",subtitle:"Celestial Armor",pronunciation:"SIL-in-dor | VEN-thal-is",path:"Grace",level:7,mana:7,stress:0,tags:["Buff"],range:"Touch",duration:"Until End of Encounter",target:"Single (self or ally)",contested:null,effect:"The target is encased in interlocking plates of hardened divine light. +4 Armor, immunity to the Bleeding condition, and all necrotic damage is halved for the scene. Spectacular in appearance, cannot be concealed.",dice:null},
  {id:137,name:"Silivoraencaer",subtitle:"Heaven's Wrath",pronunciation:"SIL-iv-or | AYN | CARE",path:"Grace",level:7,mana:7,stress:0,tags:["Damage"],range:"Far (60ft)",duration:"Instant",target:"Area (25ft radius, enemies only)",contested:null,effect:"A cascade of radiant bolts rains from above onto the targeted area. All enemies take damage. Allies in the area take no damage.",dice:"5d6 radiant damage (area, enemies only)"},
  {id:138,name:"Aenthilisindelvyr",subtitle:"Lifeline",pronunciation:"AYN | THIL-is | IN-del | VEER",path:"Grace",level:7,mana:6,stress:3,tags:["Heal"],range:"Near (30ft)",duration:"Sustained (1 Mana/round)",target:"Single ally",contested:null,effect:"The caster tethers their own life force to an ally. While sustained, the target heals at the start of each round. If the target would drop to 0 HP while the lifeline is active, the caster takes half the killing blow's damage instead and the target stabilizes at 1 HP — the lifeline then breaks.",dice:"1d8 HP restored per round; caster absorbs half of killing blow"},
  {id:139,name:"Morindelaen",subtitle:"Banishment",pronunciation:"MOR-in-del | AYN",path:"Grace",level:7,mana:7,stress:0,tags:["Control"],range:"Near (30ft)",duration:"Until End of Encounter (or permanent, see Effect)",target:"Single non-native creature (undead, void entity, summoned being)",contested:"Caster's Soul vs. Defender's Soul",effect:"The caster attempts to banish a creature that does not naturally belong in the mortal world. Failed contest: banished to their native plane for the scene. Spending 3 additional Stress on casting makes the banishment permanent (cannot return for one year). Must declare before rolling.",dice:null},
  {id:140,name:"Silindelthelvanor",subtitle:"Clarity",pronunciation:"SIL-in-del | THEL-van-or",path:"Grace",level:7,mana:6,stress:0,tags:["Utility","Heal"],range:"Touch",duration:"Instant",target:"Single ally",contested:null,effect:"The caster cuts through all mental corruption in a single moment. Immediately ends: all mind-control effects, fear effects, amnesia, Corruption Seeds, and any Dread spell of Level 7 or lower affecting the target's mind. The target also loses 1 Stress.",dice:"Target loses 1 Stress"},
  // ── Level 8 ──
  {id:141,name:"Silindorthilisaencaer",subtitle:"Mass Restoration",pronunciation:"SIL-in-dor | THIL-is | AYN | CARE",path:"Grace",level:8,mana:8,stress:3,tags:["Heal"],range:"Near (30ft)",duration:"Instant",target:"All allies within range",contested:null,effect:"A wave of divine restoration floods all allies within range. Each ally heals significant HP, removes one Status Effect of their choice, and any Minor or Moderate Injuries are fully cleared. The caster does not heal themselves.",dice:"4d8 HP restored to all allies; Minor and Moderate Injuries cleared"},
  {id:142,name:"Caervenindorsil",subtitle:"Divine Judgment",pronunciation:"CARE | VEN-in-dor | SIL",path:"Grace",level:8,mana:8,stress:0,tags:["Damage"],range:"Distant (100ft)",duration:"Instant",target:"Single Enemy",contested:null,effect:"The full weight of divine wrath focuses on a single target. A beam of blinding white light strikes from above. Any creature sitting at maximum Dread on the Tether takes double damage.",dice:"6d8 radiant damage (double vs maximum Dread targets)"},
  {id:143,name:"Ilisaenindel",subtitle:"Sanctuary",pronunciation:"IL-is | AYN | IN-del",path:"Grace",level:8,mana:7,stress:0,tags:["Control","Utility"],range:"Near (30ft)",duration:"Until End of Encounter",target:"Area (30ft radius)",contested:null,effect:"The caster creates a zone of absolute sanctuary. No hostile action can be taken by anyone within the zone, allies included. Any creature that takes a hostile action inside is immediately expelled 20ft. Useful for negotiations, triage, protecting civilians. A Grace caster cannot weaponize this — that is intentional.",dice:null},
  {id:144,name:"Venthalisindelvyr",subtitle:"Ascend",pronunciation:"VEN-thal-is | IN-del | VEER",path:"Grace",level:8,mana:8,stress:0,tags:["Buff","Utility"],range:"Near (30ft)",duration:"Until End of Encounter",target:"Up to 4 willing creatures",contested:null,effect:"The caster grants divine buoyancy to up to 4 creatures. All targets gain a flying speed equal to their walking speed for the scene. They shed faint golden light (10ft radius) while airborne, cannot be concealed while flying.",dice:null},
  {id:145,name:"Aenthorsilindel",subtitle:"Call Guardian",pronunciation:"AYN-thor | SIL | IN-del",path:"Grace",level:8,mana:8,stress:2,tags:["Utility"],range:"Near (30ft)",duration:"Until End of Encounter",target:"Area",contested:null,effect:"The caster summons a divine Guardian — a construct of light and Resonance with 30 HP, 3 Armor, attacks dealing 2d8 radiant damage. The Guardian prioritizes protecting the most wounded ally each round and acts on the caster's initiative. If the caster falls unconscious, the Guardian continues protecting allies until the scene ends.",dice:"Guardian deals 2d8 radiant per attack"},
  // ── Level 9 ──
  {id:146,name:"Silindorthiliscaeraeth",subtitle:"Miracle",pronunciation:"SIL-in-dor | THIL-is | CARE | AY-eth",path:"Grace",level:9,mana:9,stress:4,tags:["Heal"],range:"Touch",duration:"Instant",target:"Single (ally at 0 HP or dead within 1 round)",contested:null,effect:"The caster performs a true miracle. The target is restored to full HP, all injuries are cleared, all Status Effects are removed, and one Trauma they carry is permanently removed. If cast on a creature that has just died (within 1 round of death), they are restored to life at full HP. The caster gains 1 Trauma regardless.",dice:"Full HP restoration; all injuries cleared; 1 Trauma removed from target; caster gains 1 Trauma"},
  {id:147,name:"Silivoraenindorcaer",subtitle:"Solar Nova",pronunciation:"SIL-iv-or | AYN | IN-dor | CARE",path:"Grace",level:9,mana:9,stress:0,tags:["Damage"],range:"Far (60ft)",duration:"Instant",target:"Area (40ft radius, enemies only)",contested:"Caster's Soul vs. each Defender's Soul (Blind check only)",effect:"The caster becomes briefly a star — a blinding explosion of radiant energy erupts from the target point. All enemies take massive damage and must contest Soul vs. Caster's Soul or be Blinded for 3 rounds. Allies are completely unaffected.",dice:"7d6 radiant damage (area, enemies only)"},
  {id:148,name:"Ethindrisaencaer",subtitle:"Holy Ground",pronunciation:"ETH-in-dris | AYN | CARE",path:"Grace",level:9,mana:9,stress:0,tags:["Control","Utility"],range:"Near (30ft)",duration:"Permanent",target:"Area (60ft radius)",contested:null,effect:"The caster permanently consecrates a large area. Within this zone forever: undead are instantly destroyed on entry (8d6 radiant, no save), Dread spells cost 3 additional Mana, all healing is doubled, Grace casters gain +2 to all Soul rolls. The zone glows with a permanent faint golden shimmer.",dice:"8d6 radiant to undead on entry; healing doubled in zone"},
  {id:149,name:"Thelvanorindelvyr",subtitle:"Veil Walk",pronunciation:"THEL-van-or | IN-del | VEER",path:"Grace",level:9,mana:8,stress:3,tags:["Utility"],range:"Self",duration:"Sustained (2 Mana/round)",target:"Self",contested:null,effect:"The caster partially steps into the Veil. While sustained: invisible and incorporeal to the physical world, can move through solid objects (but not end their turn inside one), and can observe both worlds simultaneously. Cannot interact with the physical world while incorporeal. Dealing damage or casting a spell immediately ends the effect.",dice:null},
  {id:150,name:"Silindelmaeril",subtitle:"Veil of Forgetting",pronunciation:"SIL-in-del | MAY-ril",path:"Grace",level:9,mana:7,stress:3,tags:["Utility","Control"],range:"Near (30ft)",duration:"Permanent (until dispelled)",target:"All creatures in area (30ft radius)",contested:null,effect:"The caster erases all memory of the last 10 minutes from everyone present in the area. Cannot selectively target — it affects everyone equally, including allies. The caster cannot erase their own memory. Common uses: making witnesses forget an atrocity, protecting a safehouse location, sparing someone the memory of a traumatic event.",dice:null},
  // ── Level 10 ──
  {id:151,name:"Silindorthilisaenindel",subtitle:"Avatar of Grace",pronunciation:"SIL-in-dor | THIL-is | AYN | IN-del",path:"Grace",level:10,mana:10,stress:0,trauma:true,tags:["Buff"],range:"Self",duration:"5 Rounds",target:"Self",contested:null,effect:"The caster becomes a conduit of pure divine Grace. For the duration: all healing spells heal +2d8 additional HP, all radiant damage spells deal +2d6 bonus damage, Resistance to all damage, and allies within Near range gain +1 to all rolls. At duration end: the caster collapses, falling Prone at 1 HP regardless of current HP.",dice:"+2d8 to all healing; +2d6 to all radiant damage; collapse to 1 HP at end"},
  {id:152,name:"Venthalisaencaerindel",subtitle:"True Resurrection",pronunciation:"VEN-thal-is | AYN | CARE | IN-del",path:"Grace",level:10,mana:10,stress:3,trauma:true,tags:["Heal"],range:"Touch",duration:"Instant",target:"Single dead creature (dead up to 1 week)",contested:null,effect:"The caster fully resurrects a dead creature. The target returns to life at full HP, all injuries cleared, all Status Effects cleared, retaining all memories and abilities. The target gains 1 Trauma from the experience of death. The body must be present and mostly intact.",dice:"Full resurrection; target gains 1 Trauma; caster gains 1 Trauma (from Level 10 rule)"},
  {id:153,name:"Silivoraencaerindel",subtitle:"Cleansing Flame",pronunciation:"SIL-iv-or | AYN | CARE | IN-del",path:"Grace",level:10,mana:10,stress:0,trauma:true,tags:["Damage","Utility"],range:"Far (60ft)",duration:"Instant",target:"Area (50ft radius)",contested:null,effect:"Divine fire that burns away corruption and unnatural life. All undead and void creatures in the area are instantly destroyed (no roll, no saves). All other enemies take massive radiant damage. All allies in the area are healed. Active Dread spells of Level 8 or lower affecting anyone in the area are immediately dispelled.",dice:"Undead/void: instant destruction; enemies: 8d6 radiant; allies: 3d8 HP restored"},
  {id:154,name:"Ethinorindelvyr",subtitle:"Equalizer",pronunciation:"ETH-in-or | IN-del | VEER",path:"Grace",level:10,mana:9,stress:0,trauma:true,tags:["Utility","Heal"],range:"Near (30ft)",duration:"Instant",target:"All willing creatures within range",contested:null,effect:"The caster speaks a word of perfect balance. All current HP totals of willing creatures within Near range are averaged — total all current HP and divide evenly among all targets. No creature can be brought below 1 HP by this effect. The caster is included. Useful for redistributing catastrophic damage after a brutal hit.",dice:"HP redistribution (average of all targets' current HP)"},
  {id:155,name:"Quilindelvyrindel",subtitle:"Omniscience",pronunciation:"KWIL-in-del | VEER | IN-del",path:"Grace",level:10,mana:8,stress:2,trauma:true,tags:["Utility"],range:"Self",duration:"5 Minutes",target:"Self",contested:null,effect:"The caster's perception expands to encompass everything within 100ft simultaneously. For the duration: exact position and current HP of every creature in range is known, all illusions and invisibility are seen through, all sounds heard regardless of barriers, cannot be surprised or flanked. The caster may ask the GM one yes/no question about anything occurring within range — the GM must answer truthfully.",dice:null},
  // ── Level 11 ──
  {id:156,name:"Silindorthilisaenindelvyr",subtitle:"Divine Intervention",pronunciation:"SIL-in-dor | THIL-is | AYN | IN-del | VEER",path:"Grace",level:11,mana:11,stress:3,trauma:true,tags:["Heal","Control"],range:"Near (30ft)",duration:"Instant",target:"All allies within range",contested:null,effect:"The caster calls upon the full weight of divine Grace. All allies within range: restored to full HP, all injuries cleared, all Status Effects removed, any Dread spell of any level affecting them instantly dispelled. All enemies within range must contest Soul vs. Caster's Soul or be Stunned for 1 round from the divine wave. The caster does not heal themselves.",dice:"Full HP + all injuries cleared + full dispel for all allies; enemies: Stun check"},
  {id:157,name:"Silivoraencaerindelvyr",subtitle:"Radiant Storm",pronunciation:"SIL-iv-or | AYN | CARE | IN-del | VEER",path:"Grace",level:11,mana:11,stress:0,trauma:true,tags:["Damage","Heal"],range:"Distant (100ft)",duration:"3 Rounds",target:"Area (50ft radius)",contested:null,effect:"A sustained storm of divine radiance descends upon the area. All enemies take massive damage at the start of each round. Allies in the area are healed instead of harmed — they restore HP at the start of each round. The storm distinguishes perfectly between ally and enemy.",dice:"Enemies: 6d8 radiant damage per round; Allies: 2d8 HP restored per round"},
  {id:158,name:"Venthalisaenindorcaer",subtitle:"Apotheosis",pronunciation:"VEN-thal-is | AYN | IN-dor | CARE",path:"Grace",level:11,mana:10,stress:4,trauma:true,tags:["Buff"],range:"Touch",duration:"Until End of Encounter",target:"Single ally",contested:null,effect:"The caster temporarily elevates an ally to a state of near-divine power. For the scene: +3 to all Pillars (Body, Mind, Soul), +2d8 radiant added to all damage, immunity to all Dread spells, cannot be reduced below 1 HP. At scene's end: the target collapses, loses 2 Stress, and gains 1 Trauma as the divine energy leaves their body. Two Traumas total — caster on casting, target at scene end.",dice:"+2d8 radiant to target's attacks; target collapses and gains 1 Trauma at scene end"},
  // ── Level 12 ──
  {id:159,name:"Silindorthilisaenindelvyrcaer",subtitle:"Word of Creation",pronunciation:"SIL-in-dor | THIL-is | AYN | IN-del | VEER | CARE",path:"Grace",level:12,mana:12,stress:4,trauma:true,tags:["Heal","Utility"],range:"Touch",duration:"Permanent",target:"Single dead ally or area",contested:null,effect:"The caster speaks the first word ever spoken — the word that gave shape to Resonance itself. Choose one on casting:\n\nLife: A dead ally is fully resurrected regardless of time since death, condition of the body, or cause of death. Even a creature destroyed by Final Word (Dread, Level 12) can be restored. The target returns at full HP, no injuries, no Status Effects, and permanently loses all Traumas accumulated in their previous life. They are truly reborn.\n\nCreation: The caster speaks a permanent structure, object, or natural feature into existence (a stone bridge, freshwater spring, shelter, wall). The creation is mundane, permanent, and cannot be a weapon or tool of direct harm. Maximum size is roughly a small building. GM has final say on scope.",dice:null},
  {id:160,name:"Silaendorindelvyrcaereth",subtitle:"Light of the Veil",pronunciation:"SIL | AYN-dor | IN-del | VEER | CARE-eth",path:"Grace",level:12,mana:12,stress:5,trauma:true,tags:["Damage","Control","Heal"],range:"Distant (100ft)",duration:"Until End of Encounter",target:"Area (100ft radius)",contested:null,effect:"The caster tears open the Veil, but draws Grace through it instead of void. The full light of divine Resonance floods the area for the scene: all undead and void creatures are instantly and permanently destroyed (no save). All Dread spells of any level within the area are immediately dispelled. All allies within the area are restored to full HP and all injuries are cleared at the start of each round. All enemies (non-void, non-undead) take 5d10 radiant damage at the start of each round and must contest Soul vs. Caster's Soul or be Blinded. The light is visible from miles away. After the scene ends, the area is permanently consecrated (as Holy Ground, Level 9). The caster collapses at 1 HP at the scene's end and loses all remaining Mana.",dice:"Undead/void: instant destruction; enemies: 5d10 radiant per round; allies: full HP + all injuries cleared per round"},
];

const GRACE_SPELL_BALANCE=[
  {level:1,singleHeal:"1d6",areaHeal:"—",radiantST:"—",mana:1},
  {level:2,singleHeal:"—",areaHeal:"2d6",radiantST:"2d6",mana:2},
  {level:3,singleHeal:"3d8",areaHeal:"—",radiantST:"3d8",mana:3},
  {level:4,singleHeal:"2d6 (multi)",areaHeal:"—",radiantST:"4d6",mana:4},
  {level:5,singleHeal:"2d8 (all allies)",areaHeal:"—",radiantST:"4d6 (area)",mana:5},
  {level:6,singleHeal:"4d10",areaHeal:"—",radiantST:"5d8",mana:6},
  {level:7,singleHeal:"1d8/round",areaHeal:"—",radiantST:"5d6 (area)",mana:7},
  {level:8,singleHeal:"4d8 (all allies)",areaHeal:"—",radiantST:"6d8",mana:8},
  {level:9,singleHeal:"Full HP (1 target)",areaHeal:"—",radiantST:"7d6 (area)",mana:9},
  {level:10,singleHeal:"Full HP (scene)",areaHeal:"3d8/round",radiantST:"8d6 (area)",mana:10},
  {level:11,singleHeal:"Full HP (all)",areaHeal:"2d8/round",radiantST:"6d8/round (area)",mana:11},
  {level:12,singleHeal:"Full + clear all",areaHeal:"Full/round",radiantST:"Destruction (undead)",mana:12},
];


const ALL_SPELLS=[...DREAD_SPELLS,...GRACE_SPELLS];
const ALL_SPELL_TAGS=["Damage","Heal","Control","Debuff","Buff","Utility"];

/* ══════════════════════════════════════════════════════════════════════════════
   SPELL REPOSITORY
══════════════════════════════════════════════════════════════════════════════ */
const TAG_COLORS={
  Damage:"var(--dread)",Control:"#9b59b6",Debuff:"#e67e22",
  Buff:"var(--grace)",Utility:"#5a9a5a",Heal:"#e8a87c",
};

function SpellRepository(){
  const[search,setSearch]=useState("");
  const[levelFilter,setLevelFilter]=useState(0);
  const[tagFilter,setTagFilter]=useState("all");
  const[pathFilter,setPathFilter]=useState("all"); // "all"|"Dread"|"Grace"
  const[expanded,setExpanded]=useState({});

  const filtered=ALL_SPELLS.filter(s=>{
    if(pathFilter!=="all"&&s.path!==pathFilter)return false;
    if(levelFilter>0&&s.level!==levelFilter)return false;
    if(tagFilter!=="all"&&!s.tags.includes(tagFilter))return false;
    if(search){
      const q=search.toLowerCase();
      return s.name.toLowerCase().includes(q)||s.subtitle.toLowerCase().includes(q)||s.effect.toLowerCase().includes(q);
    }
    return true;
  });

  const toggle=id=>setExpanded(e=>({...e,[id]:!e[id]}));

  const byLevel={};
  filtered.forEach(s=>{byLevel[s.level]=byLevel[s.level]||[];byLevel[s.level].push(s);});

  const pathColors={Dread:"var(--dread)",Grace:"var(--grace)",all:"var(--gold)"};

  return(
    <div>
      {/* Path filter */}
      <div style={{display:"flex",gap:6,marginBottom:10}}>
        {[["all","All Paths"],["Grace","Path of Grace"],["Dread","Path of Dread"]].map(([val,lbl])=>(
          <button key={val} onClick={()=>setPathFilter(val)} style={{
            flex:1,padding:"6px 8px",border:`1px solid ${pathFilter===val?pathColors[val]:"var(--border)"}`,borderRadius:2,
            background:pathFilter===val?`color-mix(in srgb,${pathColors[val]} 10%,transparent)`:"var(--section)",
            color:pathFilter===val?pathColors[val]:"var(--text-dim)",
            fontFamily:"'Cinzel',serif",fontSize:9,letterSpacing:1,cursor:"pointer",transition:"all .15s",
          }}>{lbl}</button>
        ))}
      </div>

      {/* Search */}
      <input value={search} onChange={e=>setSearch(e.target.value)}
        placeholder="Search spells by name, subtitle, or effect…"
        style={{background:"transparent",border:"none",borderBottom:"1px solid var(--border)",
          color:"var(--text)",fontFamily:"'IM Fell English',serif",fontSize:13,
          outline:"none",padding:"4px 0",width:"100%",marginBottom:10}}/>

      {/* Level filter */}
      <div style={{display:"flex",gap:4,flexWrap:"wrap",alignItems:"center",marginBottom:8}}>
        <span style={{fontFamily:"'Cinzel',serif",fontSize:7,letterSpacing:2,color:"var(--text-dim)"}}>LEVEL:</span>
        <button onClick={()=>setLevelFilter(0)} style={{
          padding:"2px 8px",border:`1px solid ${levelFilter===0?"var(--gold)":"var(--border)"}`,borderRadius:1,
          background:levelFilter===0?"rgba(200,149,42,.1)":"transparent",
          color:levelFilter===0?"var(--gold)":"var(--text-dim)",fontFamily:"'Cinzel',serif",fontSize:8,cursor:"pointer",
        }}>All</button>
        {[1,2,3,4,5,6,7,8,9,10,11,12].map(l=>(
          <button key={l} onClick={()=>setLevelFilter(l===levelFilter?0:l)} style={{
            padding:"2px 6px",border:`1px solid ${levelFilter===l?"var(--gold)":"var(--border)"}`,borderRadius:1,
            background:levelFilter===l?"rgba(200,149,42,.1)":"transparent",
            color:levelFilter===l?"var(--gold)":"var(--text-dim)",fontFamily:"'Cinzel',serif",fontSize:8,cursor:"pointer",
            position:"relative",
          }}>
            {l}{l>=10&&<span style={{position:"absolute",top:-4,right:-1,fontSize:6,color:"var(--dread)"}}>☠</span>}
          </button>
        ))}
      </div>

      {/* Tag filter */}
      <div style={{display:"flex",gap:4,flexWrap:"wrap",alignItems:"center",marginBottom:12}}>
        <span style={{fontFamily:"'Cinzel',serif",fontSize:7,letterSpacing:2,color:"var(--text-dim)"}}>TAG:</span>
        <button onClick={()=>setTagFilter("all")} style={{
          padding:"2px 8px",border:`1px solid ${tagFilter==="all"?"var(--gold)":"var(--border)"}`,borderRadius:1,
          background:tagFilter==="all"?"rgba(200,149,42,.1)":"transparent",
          color:tagFilter==="all"?"var(--gold)":"var(--text-dim)",fontFamily:"'Cinzel',serif",fontSize:8,cursor:"pointer",
        }}>All</button>
        {ALL_SPELL_TAGS.map(t=>(
          <button key={t} onClick={()=>setTagFilter(t===tagFilter?"all":t)} style={{
            padding:"2px 8px",border:`1px solid ${tagFilter===t?TAG_COLORS[t]:"var(--border)"}`,borderRadius:1,
            background:tagFilter===t?`color-mix(in srgb,${TAG_COLORS[t]} 12%,transparent)`:"transparent",
            color:tagFilter===t?TAG_COLORS[t]:"var(--text-dim)",fontFamily:"'Cinzel',serif",fontSize:8,cursor:"pointer",
          }}>{t}</button>
        ))}
      </div>

      <div style={{fontFamily:"'Cinzel',serif",fontSize:8,color:"var(--text-dim)",letterSpacing:1,marginBottom:10}}>
        {filtered.length} spell{filtered.length!==1?"s":""} · {pathFilter==="all"?"Both Paths":pathFilter==="Grace"?"Path of Grace":"Path of Dread"}
      </div>

      {Object.keys(byLevel).sort((a,b)=>a-b).map(lvl=>(
        <div key={lvl} style={{marginBottom:16}}>
          <div style={{
            fontFamily:"'Cinzel',serif",fontSize:8,letterSpacing:3,
            color:parseInt(lvl)>=10?"var(--dread)":"var(--gold-dim)",
            marginBottom:8,paddingBottom:4,
            borderBottom:`1px solid ${parseInt(lvl)>=10?"rgba(200,90,58,.3)":"var(--border)"}`,
            display:"flex",alignItems:"center",gap:6,
          }}>
            LEVEL {lvl}
            {parseInt(lvl)>=10&&<span style={{fontSize:8,color:"var(--dread)"}}>☠ 1 Trauma on cast</span>}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            {byLevel[lvl].map(spell=>{
              const isOpen=!!expanded[spell.id];
              const pathCol=spell.path==="Grace"?"var(--grace)":"var(--dread)";
              return(
                <div key={spell.id} style={{
                  border:`1px solid ${isOpen?pathCol+"44":"var(--border)"}`,borderRadius:3,
                  background:isOpen?`color-mix(in srgb,${pathCol} 4%,var(--section))`:"var(--section)",
                  transition:"background .2s",
                }}>
                  <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 11px",cursor:"pointer"}}
                    onClick={()=>toggle(spell.id)}>
                    {/* Path + Mana pip */}
                    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2,flexShrink:0}}>
                      <div style={{
                        width:20,height:20,borderRadius:"50%",
                        background:`color-mix(in srgb,${pathCol} 15%,transparent)`,
                        border:`1px solid ${pathCol}`,
                        display:"flex",alignItems:"center",justifyContent:"center",
                        fontFamily:"'Cinzel',serif",fontSize:8,color:pathCol,
                      }}>{spell.mana}</div>
                      <div style={{fontFamily:"'Cinzel',serif",fontSize:5,letterSpacing:.5,color:pathCol,opacity:.7}}>{spell.path==="Grace"?"GRC":"DRD"}</div>
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"baseline",gap:6,flexWrap:"wrap"}}>
                        <span style={{fontFamily:"'Cinzel',serif",fontSize:10,letterSpacing:1,color:"var(--text)"}}>{spell.name}</span>
                        <span style={{fontFamily:"'IM Fell English',serif",fontSize:10,color:"var(--text-dim)",fontStyle:"italic"}}>"{spell.subtitle}"</span>
                        {spell.stress>0&&<span style={{fontFamily:"'Cinzel',serif",fontSize:7,color:"var(--purple)",padding:"0 4px",border:"1px solid var(--purple-dim)",borderRadius:1}}>+{spell.stress} Stress</span>}
                        {spell.trauma&&<span style={{fontFamily:"'Cinzel',serif",fontSize:7,color:"var(--dread)",padding:"0 4px",border:"1px solid var(--dread-dim)",borderRadius:1}}>☠ Trauma</span>}
                      </div>
                      <div style={{display:"flex",gap:4,marginTop:3,flexWrap:"wrap"}}>
                        {spell.tags.map(t=>(
                          <span key={t} style={{fontFamily:"'Cinzel',serif",fontSize:6,letterSpacing:1,
                            color:TAG_COLORS[t]||"var(--text-dim)",padding:"1px 4px",
                            border:`1px solid ${TAG_COLORS[t]||"var(--border)"}`,borderRadius:1,opacity:.8}}>{t}</span>
                        ))}
                        <span style={{fontFamily:"'Cinzel',serif",fontSize:6,letterSpacing:1,color:"var(--text-dim)",padding:"1px 4px",border:"1px solid var(--border)",borderRadius:1}}>{spell.range}</span>
                      </div>
                    </div>
                    <span style={{fontSize:9,color:"var(--text-dim)",flexShrink:0}}>{isOpen?"▲":"▼"}</span>
                  </div>

                  {isOpen&&(
                    <div style={{padding:"0 11px 12px",borderTop:"1px solid rgba(74,53,32,.3)"}}>
                      <div style={{marginTop:8,marginBottom:8,fontFamily:"'Cinzel',serif",fontSize:8,letterSpacing:1,color:"var(--gold-dim)"}}>
                        🔊 {spell.pronunciation}
                      </div>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
                        {[
                          ["Mana",spell.mana,pathCol],
                          spell.stress>0?["Stress",`+${spell.stress}`,"var(--purple)"]:null,
                          ["Range",spell.range,"var(--text-dim)"],
                          ["Duration",spell.duration,"var(--text-dim)"],
                          ["Target",spell.target,"var(--text-dim)"],
                        ].filter(Boolean).map(([k,v,c])=>(
                          <div key={k} style={{padding:"3px 8px",background:"var(--ink)",borderRadius:2,border:"1px solid var(--border)"}}>
                            <div style={{fontFamily:"'Cinzel',serif",fontSize:6,letterSpacing:2,color:"var(--text-dim)",marginBottom:1}}>{k.toUpperCase()}</div>
                            <div style={{fontFamily:"'Cinzel',serif",fontSize:9,color:c}}>{v}</div>
                          </div>
                        ))}
                      </div>
                      {spell.contested&&(
                        <div style={{marginBottom:7,fontSize:9,color:"var(--text-dim)",fontStyle:"italic"}}>
                          <span style={{fontFamily:"'Cinzel',serif",fontSize:7,letterSpacing:1,color:"var(--gold-dim)"}}>CONTESTED: </span>{spell.contested}
                        </div>
                      )}
                      <div style={{fontSize:10,color:"var(--text)",lineHeight:1.65,marginBottom:spell.dice?8:0,whiteSpace:"pre-line"}}>{spell.effect}</div>
                      {spell.dice&&(
                        <div style={{marginTop:8,padding:"6px 10px",background:`color-mix(in srgb,${pathCol} 6%,transparent)`,border:`1px solid ${pathCol}44`,borderRadius:2,fontFamily:"'Cinzel',serif",fontSize:9,color:pathCol}}>
                          ⚄ {spell.dice}
                        </div>
                      )}
                      {spell.trauma&&(
                        <div style={{marginTop:6,fontSize:9,color:"var(--dread)",fontStyle:"italic",fontFamily:"'Cinzel',serif"}}>
                          ☠ Casting this spell inflicts 1 Trauma on the caster.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {filtered.length===0&&(
        <div style={{textAlign:"center",padding:"20px",fontSize:11,color:"var(--text-dim)",fontStyle:"italic",border:"1px dashed var(--border)",borderRadius:2}}>
          No spells match your search.
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   GUIDES TAB
══════════════════════════════════════════════════════════════════════════════ */
function GuidesTab(){
  const[section,setSection]=useState("resonance");

  const SECTIONS=[
    {id:"resonance",label:"Resonance & Spells"},
    {id:"balance_dread",label:"Dread Damage Ref"},
    {id:"balance_grace",label:"Grace Heal/Dmg Ref"},
  ];

  const Rule=({title,children})=>(
    <div style={{marginBottom:14,paddingBottom:14,borderBottom:"1px solid var(--border)"}}>
      <div style={{fontFamily:"'Cinzel',serif",fontSize:9,letterSpacing:2,color:"var(--gold)",marginBottom:6}}>{title.toUpperCase()}</div>
      <div style={{fontSize:11,color:"var(--text-dim)",lineHeight:1.7}}>{children}</div>
    </div>
  );

  return(
    <div>
      {/* Section nav */}
      <div style={{display:"flex",gap:5,marginBottom:14,flexWrap:"wrap"}}>
        {SECTIONS.map(s=>(
          <button key={s.id} onClick={()=>setSection(s.id)} style={{
            padding:"5px 12px",border:`1px solid ${section===s.id?"var(--gold)":"var(--border)"}`,borderRadius:2,
            background:section===s.id?"rgba(200,149,42,.08)":"var(--section)",
            color:section===s.id?"var(--gold)":"var(--text-dim)",
            fontFamily:"'Cinzel',serif",fontSize:8,letterSpacing:1,cursor:"pointer",transition:"all .15s",
          }}>{s.label}</button>
        ))}
      </div>

      {section==="resonance"&&(
        <div className="panel">
          <div className="slabel">Resonance — Spell Rules</div>
          <div style={{fontSize:11,color:"var(--text-dim)",lineHeight:1.7,marginBottom:14,fontStyle:"italic",padding:"8px 10px",border:"1px solid var(--border)",borderRadius:2,background:"var(--ink)"}}>
            Resonance is purely verbal magic. The caster speaks the Archalume word(s) and channels their own spiritual energy through their voice. A <b style={{color:"var(--text)"}}>Silenced</b> caster cannot Resonate.
          </div>

          <Rule title="Core Costs">
            <b style={{color:"var(--text)"}}>Mana</b> = Mana cost of the spell.<br/>
            <b style={{color:"var(--text)"}}>Stress</b> = Additional Stress cost on top of Mana, if listed.<br/>
            <b style={{color:"var(--text)"}}>Contested</b> = Defender rolls their listed stat against the Caster's Soul. Caster must beat the defender, and vice versa.
          </Rule>

          <Rule title="Sustained Spells">
            Sustained spells cost <b style={{color:"var(--text)"}}>1 Mana per round</b> to maintain unless the spell notes otherwise. Dropping sustain ends the effect immediately.
          </Rule>

          <Rule title="Spell Burn">
            The <b style={{color:"var(--text)"}}>first time</b> you cast a spell between Long Rests costs only its listed Mana. Each <b style={{color:"var(--text)"}}>additional cast</b> of the same spell before your next Long Rest costs <b style={{color:"var(--text)"}}>1 additional Stress per repeat</b>:
            <ul style={{marginTop:6,paddingLeft:16}}>
              <li>2nd cast: +1 Stress</li>
              <li>3rd cast: +2 Stress</li>
              <li>4th cast: +3 Stress</li>
            </ul>
            Spell Burn resets on Long Rest. Applies to <b style={{color:"var(--text)"}}>all spells regardless of level</b>.
          </Rule>

          <Rule title="Holding a Spell">
            A caster may hold a damage-dealing spell in a primed state. The energy manifests visibly at the caster's hands.<br/><br/>
            <b style={{color:"var(--text)"}}>Brief utility</b> (lighting a torch, melting ice, burning a rope) is essentially free.<br/><br/>
            If held for <b style={{color:"var(--text)"}}>longer than 5 minutes</b> (real world time), the caster takes <b style={{color:"var(--dread)"}}>1d6 damage</b> of the spell's type every 5 minutes.<br/><br/>
            If the caster <b style={{color:"var(--text)"}}>takes damage or is Silenced</b> while holding, the spell releases uncontrolled, centered on the caster at full effect.
          </Rule>

          <Rule title="Duration (Time-Based)">
            Any duration listed in minutes or hours (e.g. <i>15 Minutes, 1 Hour</i>) refers to <b style={{color:"var(--text)"}}>real world time</b> — use a phone timer. This is not in-game time.
          </Rule>

          <Rule title="Trauma Cost (Level 10–12)">
            Spells of <b style={{color:"var(--dread)"}}>Level 10 and above</b> automatically inflict <b style={{color:"var(--dread)"}}>1 Trauma</b> on the caster upon casting.<br/><br/>
            This has no impact on the Tether — it is a flat resource cost. The Tether moves only through natural d12 Dread Roll results during play. Spells do not manually push the Tether.
          </Rule>

          <div style={{padding:"8px 10px",background:"rgba(200,90,58,.06)",border:"1px solid var(--dread-dim)",borderRadius:2,fontSize:10,color:"var(--text-dim)",lineHeight:1.6}}>
            <span style={{fontFamily:"'Cinzel',serif",fontSize:8,color:"var(--dread)",letterSpacing:1}}>DESIGN NOTE — </span>
            Spell Burn makes spamming any single spell increasingly expensive in Stress, ensuring casters rotate their toolkit or pay the resource tax. Trauma at Level 10–12 replaces all Tether shift language.
          </div>
        </div>
      )}

      {section==="balance_dread"&&(
        <div className="panel">
          <div className="slabel" style={{color:"var(--dread)"}}>Dread — Balance Reference</div>
          <div style={{fontSize:10,color:"var(--text-dim)",marginBottom:12,fontStyle:"italic"}}>Expected damage output by spell level.</div>
          <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'Cinzel',serif",fontSize:9}}>
            <thead>
              <tr style={{borderBottom:"1px solid var(--dread-dim)"}}>
                {["Level","Single Target","Area Damage","Mana"].map(h=>(
                  <th key={h} style={{padding:"5px 8px",textAlign:"left",color:"var(--dread-dim)",letterSpacing:1,fontSize:7,fontWeight:"normal"}}>{h.toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DREAD_SPELL_BALANCE.map((row,i)=>(
                <tr key={row.level} style={{background:i%2===0?"transparent":"rgba(74,53,32,.15)",borderBottom:"1px solid rgba(74,53,32,.2)"}}>
                  <td style={{padding:"6px 8px",color:row.level>=10?"var(--dread)":"var(--gold)",fontWeight:"bold"}}>
                    {row.level}{row.level>=10?"☠":""}
                  </td>
                  <td style={{padding:"6px 8px",color:"var(--text)"}}>{row.single}</td>
                  <td style={{padding:"6px 8px",color:"var(--text-dim)"}}>{row.area}</td>
                  <td style={{padding:"6px 8px"}}>
                    <span style={{padding:"1px 8px",borderRadius:8,background:"rgba(200,90,58,.1)",color:"var(--dread)",fontSize:9}}>{row.mana}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {section==="balance_grace"&&(
        <div className="panel">
          <div className="slabel" style={{color:"var(--grace)"}}>Grace — Balance Reference</div>
          <div style={{fontSize:10,color:"var(--text-dim)",marginBottom:12,fontStyle:"italic"}}>Expected healing and radiant damage output by spell level.</div>
          <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'Cinzel',serif",fontSize:9}}>
            <thead>
              <tr style={{borderBottom:"1px solid rgba(106,179,200,.4)"}}>
                {["Level","Single Heal","Area Heal","Radiant (ST)","Mana"].map(h=>(
                  <th key={h} style={{padding:"5px 6px",textAlign:"left",color:"rgba(106,179,200,.6)",letterSpacing:1,fontSize:7,fontWeight:"normal"}}>{h.toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {GRACE_SPELL_BALANCE.map((row,i)=>(
                <tr key={row.level} style={{background:i%2===0?"transparent":"rgba(74,53,32,.15)",borderBottom:"1px solid rgba(74,53,32,.2)"}}>
                  <td style={{padding:"6px 6px",color:row.level>=10?"var(--dread)":"var(--gold)",fontWeight:"bold"}}>
                    {row.level}{row.level>=10?"☠":""}
                  </td>
                  <td style={{padding:"6px 6px",color:"var(--grace)",fontSize:9}}>{row.singleHeal}</td>
                  <td style={{padding:"6px 6px",color:"var(--text-dim)",fontSize:9}}>{row.areaHeal}</td>
                  <td style={{padding:"6px 6px",color:"var(--text)",fontSize:9}}>{row.radiantST}</td>
                  <td style={{padding:"6px 6px"}}>
                    <span style={{padding:"1px 8px",borderRadius:8,background:"rgba(106,179,200,.1)",color:"var(--grace)",fontSize:9}}>{row.mana}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════════════
   DICE ROLLER — slot-machine style visible cycling
   DiceRoller: self-contained die that spins visibly before landing.
   useDiceRoller: hook for inline use in other modals.
══════════════════════════════════════════════════════════════════════════════ */

// Easing helper — starts fast, slows to a stop
function easeOutCubic(t){ return 1 - Math.pow(1-t, 3); }

function useDiceRoller(faces){
  const[displayed,setDisplayed]=useState(null);
  const[rolling,setRolling]=useState(false);
  const[result,setResult]=useState(null);
  const rafRef=useRef(null);

  const roll=useCallback(()=>{
    return new Promise(resolve=>{
      const finalVal=Math.ceil(Math.random()*faces);
      const totalDuration=1400; // ms total roll duration
      const start=performance.now();
      setRolling(true);
      setResult(null);

      // Build a sequence of faces to flash through, cycling 1..faces repeatedly
      // Speed: starts at ~40ms/frame, slows to ~200ms/frame
      let lastFlipTime=start;
      let flipInterval=40;

      const tick=(now)=>{
        const elapsed=now-start;
        const progress=Math.min(elapsed/totalDuration,1);
        const eased=easeOutCubic(progress);

        // Interval between flips grows from 40ms → 220ms as we slow down
        flipInterval=40+eased*180;

        if(now-lastFlipTime>=flipInterval){
          lastFlipTime=now;
          if(progress<1){
            // Still spinning — show random face
            setDisplayed(Math.ceil(Math.random()*faces));
          }
        }

        if(progress>=1){
          // Land on final value
          setDisplayed(finalVal);
          setResult(finalVal);
          setRolling(false);
          resolve(finalVal);
          return;
        }
        rafRef.current=requestAnimationFrame(tick);
      };

      rafRef.current=requestAnimationFrame(tick);
    });
  },[faces]);

  // Cleanup on unmount
  const cleanup=useCallback(()=>{
    if(rafRef.current) cancelAnimationFrame(rafRef.current);
  },[]);

  return{displayed,rolling,result,roll,cleanup};
}

function DiceDisplay({faces,label,color="var(--gold)",onRolled,showRollBtn=true,size=28}){
  const{displayed,rolling,roll}=useDiceRoller(faces);
  const handleRoll=async()=>{
    const v=await roll();
    if(onRolled)onRolled(v);
  };
  return(
    <div className="die-card" style={{minWidth:64,position:"relative"}}>
      <div className="die-lbl">{label||`d${faces}`}</div>
      <div className="die-val" style={{
        color:rolling?"var(--text-dim)":color,
        minHeight:44,display:"flex",alignItems:"center",justifyContent:"center",
        fontSize:size,transition:"color .15s",
      }}>
        {displayed!==null ? displayed : <span style={{color:"var(--text-dim)",fontSize:18}}>—</span>}
      </div>
      {showRollBtn&&(
        <button onClick={handleRoll} disabled={rolling}
          style={{marginTop:4,width:"100%",padding:"3px",border:"1px solid var(--border)",background:"var(--section)",
            color:"var(--text-dim)",fontFamily:"'Cinzel',serif",fontSize:8,letterSpacing:1,cursor:"pointer",
            borderRadius:1,transition:"all .15s",opacity:rolling?.5:1}}>
          {rolling?"Rolling…":"Roll"}
        </button>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   SETTINGS TAB — dice calibration
══════════════════════════════════════════════════════════════════════════════ */
function SettingsTab(){
  const[results,setResults]=useState(null);
  const[running,setRunning]=useState(false);
  const[progress,setProgress]=useState(0);

  const DICE=[4,6,8,12,20];
  const ROLLS=100;

  const runCalibration=()=>{
    setRunning(true);
    setProgress(0);
    setResults(null);
    // Run 100 rolls per die asynchronously to let UI update
    const allResults={};
    DICE.forEach(d=>{allResults[d]={};for(let i=1;i<=d;i++)allResults[d][i]=0;});
    let done=0;
    const total=DICE.length*ROLLS;
    const step=()=>{
      const die=DICE[Math.floor(done/ROLLS)];
      if(!die){setResults(allResults);setRunning(false);return;}
      allResults[die][Math.ceil(Math.random()*die)]++;
      done++;
      setProgress(Math.round((done/total)*100));
      if(done<total) setTimeout(step,4);
      else{setResults({...allResults});setRunning(false);setProgress(100);}
    };
    setTimeout(step,10);
  };

  const dieColor=d=>d===4?"var(--grace)":d===6?"var(--gold)":d===8?"var(--purple)":d===12?"var(--dread)":"#c8a840";

  return(
    <div>
      <div className="panel">
        <div className="slabel">Dice Calibration</div>
        <div style={{fontSize:11,color:"var(--text-dim)",fontStyle:"italic",lineHeight:1.6,marginBottom:12}}>
          Roll each die 100 times to "calibrate" your luck. This resets the feel of your rolls and shows the distribution across all faces.
        </div>
        <button className="mprimary" onClick={runCalibration} disabled={running}>
          {running?`Calibrating… ${progress}%`:"⚄ Run Calibration (100 rolls each)"}
        </button>
        {running&&(
          <div style={{marginTop:10,height:4,background:"var(--ink)",borderRadius:2,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${progress}%`,background:"var(--gold)",borderRadius:2,transition:"width .1s"}}/>
          </div>
        )}
      </div>

      {results&&DICE.map(d=>(
        <div className="panel" key={d}>
          <div className="slabel" style={{color:dieColor(d)}}>d{d} — {ROLLS} Rolls</div>
          <div style={{marginTop:8}}>
            {Object.entries(results[d]).map(([face,count])=>{
              const pct=(count/ROLLS)*100;
              const expected=100/d;
              const over=pct>expected+5;
              const under=pct<expected-5;
              const barColor=over?"var(--grace)":under?"var(--dread)":dieColor(d);
              return(
                <div key={face} className="calib-bar-wrap">
                  <span className="calib-num">{face}</span>
                  <div className="calib-bar">
                    <div className="calib-fill" style={{width:`${Math.min(100,pct*d)}%`,background:barColor}}/>
                  </div>
                  <span className="calib-pct">{pct.toFixed(1)}%</span>
                  {over&&<span style={{fontSize:8,color:"var(--grace)"}}>▲</span>}
                  {under&&<span style={{fontSize:8,color:"var(--dread)"}}>▼</span>}
                </div>
              );
            })}
            <div style={{fontSize:8,color:"var(--text-dim)",marginTop:6,fontStyle:"italic"}}>Expected: {(100/d).toFixed(1)}% per face</div>
          </div>
        </div>
      ))}

      {results&&(
        <div className="panel" style={{textAlign:"center"}}>
          <div style={{fontFamily:"'Cinzel',serif",fontSize:10,color:"var(--gold)",letterSpacing:2,marginBottom:6}}>✦ Calibration Complete</div>
          <div style={{fontSize:11,color:"var(--text-dim)",fontStyle:"italic",lineHeight:1.6}}>
            Your dice have been recalibrated. The fates have been consulted.<br/>
            <span style={{color:"var(--text)"}}>May fortune favor the bold.</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   TETHER BAR
══════════════════════════════════════════════════════════════════════════════ */
function TetherBar({pos,baseline,setPos,setBaseline}){
  const lbl=tetherLabel(pos);
  const pct=((pos-TMIN)/(TMAX-TMIN))*100;
  const bPct=((baseline-TMIN)/(TMAX-TMIN))*100;
  const c=50;
  const[fl,fw,fc]=pos<0?[pct,c-pct,"var(--dread-dim)"]:pos>0?[c,pct-c,"var(--grace-dim)"]:[c,0,"transparent"];
  const click=useCallback(e=>{
    const r=e.currentTarget.getBoundingClientRect();
    setPos(clamp(Math.round((e.clientX-r.left)/r.width*(TMAX-TMIN)+TMIN),TMIN,TMAX));
  },[setPos]);
  return(
    <div>
      <div className="tb-labels"><span style={{color:"var(--dread)"}}>◀ 10D DREAD</span><span style={{color:"var(--grace)"}}>GRACE 10G ▶</span></div>
      <div className="tether-outer" onClick={click}>
        <div className="tether-fill" style={{left:`${fl}%`,width:`${fw}%`,background:fc}}/>
        <div className="tcenter"/>
        <div className="bmarker" style={{left:`${bPct}%`}}/>
        <div className="tcursor" style={{left:`calc(${pct}% - 1.5px)`}}/>
      </div>
      <div className="tpos" style={{color:lbl.color}}>{lbl.text}</div>
      <div className="tctrl">
        <button className="tbtn d" onClick={()=>setPos(clamp(pos-2,TMIN,TMAX))}>◀◀</button>
        <button className="tbtn d" onClick={()=>setPos(clamp(pos-1,TMIN,TMAX))}>◀</button>
        <span style={{fontFamily:"'Cinzel',serif",fontSize:9,color:"var(--text-dim)",letterSpacing:2}}>MOVE</span>
        <button className="tbtn g" onClick={()=>setPos(clamp(pos+1,TMIN,TMAX))}>▶</button>
        <button className="tbtn g" onClick={()=>setPos(clamp(pos+2,TMIN,TMAX))}>▶▶</button>
      </div>
      <div className="bctrl">
        <button onClick={()=>setBaseline(clamp(baseline-1,BMIN,BMAX))}>◀</button>
        <span>Baseline: {baselineLabel(baseline)}</span>
        <button onClick={()=>setBaseline(clamp(baseline+1,BMIN,BMAX))}>▶</button>
        <button onClick={()=>setPos(baseline)} style={{marginLeft:5,padding:"1px 7px",border:"1px solid var(--border)",background:"var(--section)",color:"var(--text-dim)",cursor:"pointer",fontSize:8,borderRadius:1}}>Reset</button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   TETHER ROLL MODAL
══════════════════════════════════════════════════════════════════════════════ */
function TetherRollModal({stats,competencies,critNumber,dreadPool,onClose,onResult}){
  const[sel,setSel]=useState(null);
  const[comp,setComp]=useState("");
  const[mode,setMode]=useState("normal"); // "normal"|"adv"|"dis"
  const[res,setRes]=useState(null);
  const opts=[{k:"mind",l:"Mind"},{k:"body",l:"Body"},{k:"soul",l:"Soul"}];

  const getMod=()=>{
    if(comp&&competencies&&competencies[comp]!==undefined) return competencies[comp];
    return sel?statMod(stats[sel]):0;
  };
  const getModLabel=()=>{
    if(comp&&competencies&&competencies[comp]!==undefined) return ALL_COMP.find(c=>c.key===comp)?.name||comp;
    return sel?sel.toUpperCase():"";
  };

  const d20a=useDiceRoller(20); // primary / only d20 in normal mode
  const d20b=useDiceRoller(20); // second d20 for adv/dis
  const d12r=useDiceRoller(12);
  const rolling=d20a.rolling||d20b.rolling||d12r.rolling;
  const showDice=d20a.displayed!==null;

  const roll=async()=>{
    if(!sel||rolling)return;
    setRes(null);
    const mod=getMod(); const modLabel=getModLabel();

    if(mode==="normal"){
      const[fD20,fD12]=await Promise.all([d20a.roll(),d12r.roll()]);
      const isGrace=fD12>=7;
      const isCrit=critNumber!==null&&fD12===critNumber;
      setRes({d20:fD20,d20b:null,chosen:fD20,d12:fD12,mod,modLabel,isGrace,isCrit,steps:isCrit?2:1,sl:sel,comp,mode});
    } else {
      // Roll both d20s and d12 simultaneously
      const[rA,rB,fD12]=await Promise.all([d20a.roll(),d20b.roll(),d12r.roll()]);
      const chosen=mode==="adv"?Math.max(rA,rB):Math.min(rA,rB);
      const isGrace=fD12>=7;
      const isCrit=critNumber!==null&&fD12===critNumber;
      setRes({d20:rA,d20b:rB,chosen,d12:fD12,mod,modLabel,isGrace,isCrit,steps:isCrit?2:1,sl:sel,comp,mode});
    }
  };

  const compRank=comp&&competencies?competencies[comp]??0:null;

  // Which d20 is the "winner" (chosen)
  const pickedA=res?res.chosen===res.d20:true;
  const pickedB=res&&res.d20b!==null?res.chosen===res.d20b:false;
  // If both equal, both are picked
  const bothEqual=res&&res.d20b!==null&&res.d20===res.d20b;

  return(
    <div className="moverlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        {/* Info strip */}
        <div style={{display:"flex",gap:10,justifyContent:"center",marginBottom:12,flexWrap:"wrap"}}>
          <div style={{padding:"4px 10px",border:"1px solid var(--border)",borderRadius:2,background:"var(--section)",fontFamily:"'Cinzel',serif",fontSize:9,color:"var(--text-dim)",letterSpacing:1}}>
            CRIT: <span style={{color:critNumber===null?"var(--text-dim)":critNumber>=7?"var(--grace)":"var(--dread)",fontFamily:"'Cinzel Decorative',serif",fontSize:13}}>{critNumber??"—"}</span>
            {critNumber!==null&&<span style={{fontSize:8,marginLeft:4,color:critNumber>=7?"var(--grace)":"var(--dread)"}}>{critNumber>=7?"GRACE":"DREAD"}</span>}
          </div>
          {dreadPool!==null&&dreadPool!==undefined&&(
            <div style={{padding:"4px 10px",border:"1px solid var(--dread-dim)",borderRadius:2,background:"rgba(200,90,58,.06)",fontFamily:"'Cinzel',serif",fontSize:9,color:"var(--text-dim)",letterSpacing:1}}>
              GM DREAD: <span style={{color:"var(--dread)",fontFamily:"'Cinzel Decorative',serif",fontSize:13}}>{dreadPool}</span><span style={{fontSize:8,color:"var(--text-dim)"}}>/12</span>
            </div>
          )}
        </div>

        <div className="mtitle">⚄ Tether Roll</div>

        {!showDice&&(
          <>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:8,letterSpacing:2,color:"var(--text-dim)",textAlign:"center",marginBottom:9}}>SELECT STAT</div>
            <div className="rtgrid">
              {opts.map(o=>(
                <button key={o.k} className={`rtbtn${sel===o.k?" sel":""}`} onClick={()=>setSel(o.k)}>
                  <span className="sv">{modStr(stats[o.k])}</span>{o.l}
                </button>
              ))}
            </div>

            {/* Adv / Normal / Dis toggle */}
            <div style={{display:"flex",gap:5,justifyContent:"center",margin:"10px 0"}}>
              {[["dis","Disadvantage","var(--dread-dim)","var(--dread)"],
                ["normal","Normal","var(--border)","var(--text)"],
                ["adv","Advantage","var(--grace-dim)","var(--grace)"]].map(([m,l,bc,tc])=>(
                <button key={m} onClick={()=>setMode(m)} style={{
                  flex:1,padding:"6px 4px",border:`1px solid ${mode===m?tc:bc}`,borderRadius:2,
                  background:mode===m?`color-mix(in srgb,${tc} 12%,transparent)`:"var(--section)",
                  color:mode===m?tc:"var(--text-dim)",fontFamily:"'Cinzel',serif",fontSize:8,
                  letterSpacing:1,cursor:"pointer",transition:"all .15s",textTransform:"uppercase",
                }}>
                  {m==="adv"?"ADV":m==="dis"?"DIS":"Normal"}
                  {m!=="normal"&&<span style={{display:"block",fontSize:7,opacity:.7,letterSpacing:.5,marginTop:1}}>{m==="adv"?"Take Higher":"Take Lower"}</span>}
                </button>
              ))}
            </div>

            <div className="id-field" style={{marginBottom:6}}>
              <div className="id-label">Competency (optional)</div>
              <select className="id-select" value={comp} onChange={e=>setComp(e.target.value)}>
                <option value="">— None / Use Stat Modifier —</option>
                {Object.entries(COMPETENCIES).map(([stat,list])=>(
                  <optgroup key={stat} label={`${stat} Competencies`}>
                    {list.map(c=><option key={c.key} value={c.key}>{c.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            {comp&&compRank!==null&&(
              <div style={{textAlign:"center",fontSize:10,color:"var(--gold)",fontFamily:"'Cinzel',serif",marginBottom:12,letterSpacing:1}}>
                {ALL_COMP.find(c=>c.key===comp)?.name} — Bonus <b>{compRank>=0?`+${compRank}`:compRank}</b>
              </div>
            )}
            <button className="mprimary" onClick={roll} disabled={!sel}>
              {mode==="adv"?"Roll 2d20 (Advantage) + d12":mode==="dis"?"Roll 2d20 (Disadvantage) + d12":"Roll d20 + d12"}
            </button>
            <button className="msec" onClick={onClose}>Cancel</button>
          </>
        )}

        {/* Dice display — shown while rolling and as result */}
        {showDice&&(
          <div style={{marginBottom:10}}>
            {/* d20 row */}
            <div style={{display:"flex",gap:8,justifyContent:"center",marginBottom:8,flexWrap:"wrap"}}>
              {/* Primary d20 */}
              {(()=>{
                const isChosen=!res||(pickedA||bothEqual);
                const isMuted=res&&res.mode!=="normal"&&!pickedA&&!bothEqual;
                return(
                  <div className="die-card" style={{
                    flex:"1",minWidth:80,
                    opacity:isMuted?.38:1,
                    border:res&&isChosen&&res.mode!=="normal"?"2px solid var(--gold)":"1px solid var(--border)",
                    transform:isMuted?"scale(.92)":"scale(1)",transition:"all .3s",position:"relative",
                  }}>
                    {res&&isChosen&&res.mode!=="normal"&&(
                      <div style={{position:"absolute",top:-10,left:"50%",transform:"translateX(-50%)",background:"var(--gold)",color:"var(--ink)",fontFamily:"'Cinzel',serif",fontSize:7,letterSpacing:1,padding:"1px 6px",borderRadius:1,whiteSpace:"nowrap"}}>
                        {res.mode==="adv"?"▲ HIGHEST":"▼ LOWEST"}
                      </div>
                    )}
                    <div className="die-lbl">{res?`d20 #1 (${res.mode==="adv"?"ADV":res.mode==="dis"?"DIS":""})`:"d20 — rolling…"}</div>
                    <div className="die-val" style={{
                      color:rolling?"var(--text-dim)":isMuted?"var(--text-dim)":isChosen?"var(--text)":"var(--text-dim)",
                      fontSize:isMuted?28:38,minHeight:50,display:"flex",alignItems:"center",justifyContent:"center",transition:"all .3s",
                    }}>
                      {d20a.displayed}
                    </div>
                    {res&&!rolling&&<div style={{fontSize:9,color:"var(--text-dim)",textAlign:"center",marginTop:2}}>{res.d20} + {res.mod} = {res.d20+res.mod}</div>}
                    {isMuted&&<div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%) rotate(-12deg)",fontSize:18,color:"var(--text-dim)",opacity:.5,pointerEvents:"none"}}>✕</div>}
                  </div>
                );
              })()}

              {/* Second d20 — only shown in adv/dis */}
              {mode!=="normal"&&(
                (()=>{
                  const isChosen=res&&(pickedB||bothEqual);
                  const isMuted=res&&!pickedB&&!bothEqual;
                  return(
                    <div className="die-card" style={{
                      flex:"1",minWidth:80,
                      opacity:isMuted?.38:1,
                      border:res&&isChosen?"2px solid var(--gold)":"1px solid var(--border)",
                      transform:isMuted?"scale(.92)":"scale(1)",transition:"all .3s",position:"relative",
                    }}>
                      {res&&isChosen&&(
                        <div style={{position:"absolute",top:-10,left:"50%",transform:"translateX(-50%)",background:"var(--gold)",color:"var(--ink)",fontFamily:"'Cinzel',serif",fontSize:7,letterSpacing:1,padding:"1px 6px",borderRadius:1,whiteSpace:"nowrap"}}>
                          {res.mode==="adv"?"▲ HIGHEST":"▼ LOWEST"}
                        </div>
                      )}
                      <div className="die-lbl">{res?"d20 #2":"d20 — rolling…"}</div>
                      <div className="die-val" style={{
                        color:rolling?"var(--text-dim)":isMuted?"var(--text-dim)":isChosen?"var(--text)":"var(--text-dim)",
                        fontSize:isMuted?28:38,minHeight:50,display:"flex",alignItems:"center",justifyContent:"center",transition:"all .3s",
                      }}>
                        {d20b.displayed}
                      </div>
                      {res&&!rolling&&<div style={{fontSize:9,color:"var(--text-dim)",textAlign:"center",marginTop:2}}>{res.d20b} + {res.mod} = {res.d20b+res.mod}</div>}
                      {isMuted&&<div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%) rotate(-12deg)",fontSize:18,color:"var(--text-dim)",opacity:.5,pointerEvents:"none"}}>✕</div>}
                    </div>
                  );
                })()
              )}

              {/* d12 Tether */}
              <div className="die-card" style={{flex:"1",minWidth:80}}>
                <div className="die-lbl">d12 — TETHER</div>
                <div className="die-val" style={{fontSize:38,minHeight:50,display:"flex",alignItems:"center",justifyContent:"center",
                  color:rolling?"var(--text-dim)":res?(res.isGrace?"var(--grace)":"var(--dread)"):"var(--text)",transition:"color .3s"}}>
                  {d12r.displayed}
                </div>
                {res&&!rolling&&<div style={{fontSize:9,fontFamily:"'Cinzel',serif",letterSpacing:1,textAlign:"center",marginTop:2,color:res.isGrace?"var(--grace)":"var(--dread)"}}>{res.isGrace?"GRACE":"DREAD"}</div>}
              </div>
            </div>

            {/* Final d20 total banner */}
            {res&&!rolling&&(
              <div style={{textAlign:"center",marginBottom:4,fontFamily:"'Cinzel',serif",fontSize:10,color:"var(--gold)",letterSpacing:2}}>
                FINAL d20: {res.chosen} + {res.mod} = <span style={{fontSize:16,color:"var(--text)"}}>{res.chosen+res.mod}</span>
              </div>
            )}
          </div>
        )}

        {res&&!rolling&&(
          <>
            {res.isCrit&&<div style={{textAlign:"center",marginBottom:7}}><span className="critbadge">✦ CRIT — {res.steps} STEPS ✦</span></div>}
            <div className={`verdict ${res.isGrace?"vg":"vd"}`}>{res.isGrace?"GRACE":"DREAD"} — Move {res.steps} step{res.steps>1?"s":""} toward {res.isGrace?"Grace":"Dread"}</div>
            <button className="mprimary" style={{marginTop:8}} onClick={()=>{onResult(res);onClose();}}>Apply Movement</button>
            <button className="msec" onClick={()=>setRes(null)}>Roll Again</button>
            <button className="msec" onClick={onClose}>Dismiss</button>
          </>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   UNIFIED LEVEL UP MODAL
   Steps: stat_roll (levels 5/8/10/12) → comp_alloc (every level) →
          subclass (level 3) → spec (level 8) → abilities (placeholder)
══════════════════════════════════════════════════════════════════════════════ */
function LevelUpModal({char,onConfirm,onClose}){
  const level=char.level;

  // Determine which steps apply
  const needStatRoll=LEVELUP_STAT_LEVELS.includes(level)&&!char.completedStatRolls.includes(level);
  const needComp=!char.completedCompRolls.includes(level);
  const needSubclass=level===3&&!char.subclass&&char.cls;
  const needSpec=level===8&&char.subclass&&!char.spec;
  const availableQualities=char.cradle?getAvailableQualities(char.cradle,level).filter(q=>!(char.cradleQualities||[]).includes(q.id)):[];
  const needCradleQuality=QUALITY_UNLOCK_LEVELS.includes(level)&&level>1&&char.cradle&&availableQualities.length>0;
  // Spell gain steps
  const cls=char.cls||"";
  const charPath=char.path==="dread"?"Dread":"Grace";
  const prog=SPELL_PROGRESSION[cls];
  const needClassSpell=prog?.levelsGained.includes(level)??false;
  const needSubclassSpell=!needSubclass&&level===3&&char.subclass&&!!SUBCLASS_SPELL_BONUS[char.subclass];
  const needSpecSpell=!needSpec&&level===8&&char.spec&&!!SPEC_SPELL_BONUS[char.spec];

  const steps=[];
  if(needStatRoll)       steps.push("stat");
  if(needComp)           steps.push("comp");
  if(needSubclass)       steps.push("subclass");
  if(needSpec)           steps.push("spec");
  if(needCradleQuality)  steps.push("cradle");
  if(needClassSpell)     steps.push("spell_class");
  if(needSubclassSpell)  steps.push("spell_subclass");
  if(needSpecSpell)      steps.push("spell_spec");
  steps.push("abilities");

  const[stepIdx,setStepIdx]=useState(0);
  const step=steps[stepIdx];
  const isLast=stepIdx===steps.length-1;

  // Accumulated changes
  const[statAlloc,setStatAlloc]=useState({mind:0,body:0,soul:0});
  const[compAlloc,setCompAlloc]=useState(Object.fromEntries(ALL_COMP.map(c=>[c.key,0])));
  const[subclassSel,setSubclassSel]=useState("");
  const[newSpells,setNewSpells]=useState([]);
  const[specSel,setSpecSel]=useState("");
  const[cradleQualitySel,setCradleQualitySel]=useState("");
  const d4r=useDiceRoller(4);
  const d4Rolled=d4r.result;
  const d4Rolling=d4r.rolling;

  const advance=()=>{
    if(isLast) commitAll();
    else setStepIdx(i=>i+1);
  };

  const commitAll=()=>{
    onConfirm({statAlloc,compAlloc,subclass:subclassSel,spec:specSel,cradleQuality:cradleQualitySel,newSpells,level,needStatRoll,needComp,needSubclass,needSpec,needCradleQuality,needClassSpell,needSubclassSpell,needSpecSpell});
  };

  // Per-step validation
  const canAdvance=()=>{
    if(step==="stat") return d4Rolled!==null&&(statAlloc.mind+statAlloc.body+statAlloc.soul)===d4Rolled;
    if(step==="comp"){
      const pts=COMP_POINTS_PER_LEVEL(level);
      return Object.values(compAlloc).reduce((a,b)=>a+b,0)===pts;
    }
    if(step==="subclass") return subclassSel!=="";
    if(step==="spec") return specSel!=="";
    if(step==="cradle") return cradleQualitySel!=="";
    if(step==="spell_class"||step==="spell_subclass"||step==="spell_spec") return newSpells.length>0;
    return true;
  };

  const stepLabel={stat:"Stat Increase",comp:"Competency Points",subclass:"Choose Subclass",spec:"Choose Specialization",cradle:"Cradle Quality",abilities:"Class Abilities"}[step];
  const stepNum=stepIdx+1;
  const totalSteps=steps.length;

  // ── Stat step ──
  const StatStep=()=>{
    const spent=statAlloc.mind+statAlloc.body+statAlloc.soul;
    const remaining=d4Rolled!==null?d4Rolled-spent:null;
    const adj=(k,d)=>{
      if(d>0&&remaining<=0)return;
      if(d<0&&statAlloc[k]<=0)return;
      setStatAlloc(a=>({...a,[k]:a[k]+d}));
    };
    return(
      <div>
        <div className="mbody">Roll a d4 and distribute the result across your stats. You may only roll once.</div>
        {d4Rolled===null?(
          <button className="mprimary" onClick={()=>d4r.roll()} disabled={d4Rolling}>{d4Rolling?"Rolling…":"Roll d4"}</button>
        ):(
          <>
            <div className="dice-row"><div className="die-card"><div className="die-lbl">d4</div><div className="die-val" style={{color:d4Rolling?"var(--text-dim)":"var(--gold)",fontSize:42,transition:"color .3s"}}>{d4r.displayed??d4Rolled}</div></div></div>
            <div className="remaining-badge">{remaining} point{remaining!==1?"s":""} remaining</div>
            <div className="alloc-grid">
              {[["mind","Mind"],["body","Body"],["soul","Soul"]].map(([k,l])=>(
                <div className="alloc-card" key={k}>
                  <div className="alloc-name">{l}</div>
                  <div className="alloc-val">{char.stats[k]}{statAlloc[k]>0?<span style={{color:"var(--grace)",fontSize:14}}> +{statAlloc[k]}</span>:""}</div>
                  <div style={{fontSize:10,color:"var(--grace)",minHeight:14,marginTop:2,fontStyle:"italic"}}>{statAlloc[k]>0?`→ ${char.stats[k]+statAlloc[k]}`:""}</div>
                  <div className="rbtnrow" style={{marginTop:5}}>
                    <button className="rbtn" onClick={()=>adj(k,-1)}>−</button>
                    <button className="rbtn" onClick={()=>adj(k,1)} disabled={remaining<=0}>+</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

  // ── Comp step ──
  const CompStep=()=>{
    const pts=COMP_POINTS_PER_LEVEL(level);
    const spent=Object.values(compAlloc).reduce((a,b)=>a+b,0);
    const remaining=pts-spent;
    const adj=(key,d)=>{
      if(d>0&&remaining<=0)return;
      if(d<0&&compAlloc[key]<=0)return;
      setCompAlloc(a=>({...a,[key]:a[key]+d}));
    };
    return(
      <div>
        <div className="mbody">Allocate {pts} competency point{pts>1?"s":""} across your skills.</div>
        <div className="remaining-badge">{remaining} point{remaining!==1?"s":""} remaining</div>
        {Object.entries(COMPETENCIES).map(([stat,list])=>(
          <div className="comp-section" key={stat}>
            <div className="comp-section-hdr" style={{color:stat==="Body"?"var(--dread)":stat==="Mind"?"var(--grace)":"var(--purple)"}}>{stat.toUpperCase()}</div>
            {list.map(comp=>{
              const rank=(char.competencies[comp.key]||0)+(compAlloc[comp.key]||0);
              const meta=char.compMeta?.[comp.key]||"normal";
              return(
                <div className="comp-row editable" key={comp.key} style={{borderColor:compAlloc[comp.key]>0?"var(--gold)":""}}>
                  <div className="comp-marker">{meta==="proficient"?"↑":meta==="deficient"?"↓":""}</div>
                  <div className="comp-name" style={{color:meta==="proficient"?"var(--gold)":meta==="deficient"?"var(--dread)":"var(--text)"}}>{comp.name}</div>
                  <button className="comp-rbtn" onClick={()=>adj(comp.key,-1)}>−</button>
                  <div className="comp-rank">{rank}</div>
                  <button className="comp-rbtn" onClick={()=>adj(comp.key,1)} disabled={remaining<=0}>+</button>
                  <div className="comp-bonus" style={{color:rank>0?"var(--gold)":rank<0?"var(--dread)":"var(--text-dim)"}}>{rank===0?"—":rank>0?`+${rank}`:`${rank}`}</div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  // ── Subclass step ──
  const SubclassStep=()=>(
    <div>
      <div className="mbody">Your training has deepened. Choose the path that defines your approach to your craft.</div>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:14}}>
        {getSubs(char.cls).map(s=>(
          <button key={s.name} className={`opt-btn${subclassSel===s.name?" sel":""}`} onClick={()=>setSubclassSel(s.name)} style={{textAlign:"left",padding:"10px 12px"}}>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:11,letterSpacing:1,color:subclassSel===s.name?"var(--gold)":"var(--text)",marginBottom:4}}>{s.name}</div>
            <div style={{fontSize:9,color:"var(--text-dim)",fontStyle:"italic"}}>Specializations at level 8: {s.specs.join(", ")}</div>
          </button>
        ))}
      </div>
    </div>
  );

  // ── Spec step ──
  const SpecStep=()=>(
    <div>
      <div className="mbody">Your mastery has reached a turning point. Choose the specialization that defines your legend.</div>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:14}}>
        {getSpecs(char.cls,char.subclass||subclassSel).map(s=>(
          <button key={s} className={`opt-btn${specSel===s?" sel":""}`} onClick={()=>setSpecSel(s)} style={{padding:"12px 14px"}}>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:11,letterSpacing:1,color:specSel===s?"var(--gold)":"var(--text)"}}>{s}</div>
          </button>
        ))}
      </div>
    </div>
  );

  // ── Abilities placeholder step ──
  const AbilitiesStep=()=>(
    <div>
      <div style={{padding:"14px",border:"1px dashed var(--border)",borderRadius:2,background:"var(--section)",textAlign:"center",marginBottom:14}}>
        <div style={{fontFamily:"'Cinzel',serif",fontSize:10,color:"var(--gold-dim)",letterSpacing:2,marginBottom:6}}>CLASS ABILITIES</div>
        <div style={{fontSize:11,color:"var(--text-dim)",fontStyle:"italic",lineHeight:1.6}}>
          Class abilities are a work in progress.<br/>
          This step will unlock ability choices in a future update.
        </div>
        <div style={{marginTop:10,fontSize:10,color:"var(--text-dim)"}}>
          <b style={{color:"var(--text)"}}>{char.cls||"No class"}</b>{char.subclass?` → ${char.subclass||""}`:""}{char.spec||specSel?` → ${char.spec||specSel}`:""}
        </div>
      </div>
    </div>
  );

  const CradleStep=()=>{
    const chosen=availableQualities.find(q=>q.id===cradleQualitySel);
    // Group by level for display
    const byLevel={};
    (CRADLE_QUALITIES[char.cradle]?QUALITY_UNLOCK_LEVELS.filter(l=>l<=level):[] ).forEach(l=>{
      const qs=(CRADLE_QUALITIES[char.cradle]?.[l]??[]).filter(q=>!(char.cradleQualities||[]).includes(q.id));
      if(qs.length) byLevel[l]=qs;
    });
    return(
      <div>
        <div className="mbody">
          Choose one Cradle Quality. You may pick any unpicked quality from levels up to {level}. Once chosen, qualities cannot be removed.
        </div>
        {Object.entries(byLevel).map(([lvl,qs])=>(
          <div key={lvl} style={{marginBottom:12}}>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:8,letterSpacing:2,color:"var(--gold-dim)",marginBottom:7,paddingBottom:4,borderBottom:"1px solid var(--border)"}}>
              LEVEL {lvl} QUALITIES
            </div>
            {qs.map(q=>{
              const isSel=cradleQualitySel===q.id;
              return(
                <div key={q.id} onClick={()=>setCradleQualitySel(q.id)} style={{
                  padding:"10px 12px",marginBottom:6,borderRadius:2,cursor:"pointer",transition:"all .15s",
                  border:`1px solid ${isSel?"var(--gold)":"var(--border)"}`,
                  background:isSel?"rgba(200,149,42,.07)":"var(--section)",
                }}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                    <div style={{
                      width:14,height:14,borderRadius:"50%",border:`2px solid ${isSel?"var(--gold)":"var(--border)"}`,
                      background:isSel?"var(--gold)":"transparent",flexShrink:0,transition:"all .15s",
                    }}/>
                    <div style={{fontFamily:"'Cinzel',serif",fontSize:10,letterSpacing:1,color:isSel?"var(--gold)":"var(--text)",flex:1}}>{q.label}</div>
                  </div>
                  <div style={{fontSize:10,color:"var(--text-dim)",lineHeight:1.5,fontStyle:"italic",paddingLeft:22}}>{q.desc}</div>
                </div>
              );
            })}
          </div>
        ))}
        {Object.keys(byLevel).length===0&&(
          <div style={{fontSize:11,color:"var(--text-dim)",fontStyle:"italic",textAlign:"center",padding:"14px",border:"1px dashed var(--border)",borderRadius:2}}>
            All available qualities for this Cradle have been chosen.
          </div>
        )}
      </div>
    );
  };

  const nextStepLabel=(idx)=>{
    const s=steps[idx];
    return{stat:"Stat Increase",comp:"Competency Points",subclass:"Choose Subclass",spec:"Choose Specialization",cradle:"Cradle Quality",abilities:"Class Abilities"}[s]||s;
  };

  return(
    <div className="moverlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal wide" style={{maxHeight:"92vh"}}>
        <div style={{display:"flex",gap:3,marginBottom:14}}>
          {steps.map((s,i)=>(
            <div key={s} style={{flex:1,height:3,borderRadius:2,background:i<=stepIdx?"var(--gold)":"var(--border)",transition:"background .3s"}}/>
          ))}
        </div>

        <div className="mtitle">✦ Level {level} Reached</div>
        <div style={{fontFamily:"'Cinzel',serif",fontSize:8,letterSpacing:2,color:"var(--text-dim)",textAlign:"center",marginBottom:16}}>
          STEP {stepNum} OF {totalSteps} — {stepLabel.toUpperCase()}
        </div>

        {step==="stat"&&<StatStep/>}
        {step==="comp"&&<CompStep/>}
        {step==="subclass"&&<SubclassStep/>}
        {step==="spec"&&<SpecStep/>}
        {step==="cradle"&&<CradleStep/>}
        {(step==="spell_class"||step==="spell_subclass"||step==="spell_spec")&&(()=>{
          const isClass=step==="spell_class";
          const isSubclass=step==="spell_subclass";
          const maxLevel=prog?.maxSpellLevel||6;
          const rule=isClass
            ?{path:"chosen",maxLevel:Math.min(maxLevel,level<=4?level:level),tags:null}
            :isSubclass
              ?SUBCLASS_SPELL_BONUS[char.subclass]
              :SPEC_SPELL_BONUS[char.spec];
          const alreadyKnown=[...(char.knownSpells||[]),...newSpells];
          const spellPicked=newSpells.length>0;
          return(
            <div>
              {!spellPicked?(
                <SpellPicker
                  rule={rule}
                  chosenPath={charPath}
                  maxSpellLevel={maxLevel}
                  alreadyKnown={alreadyKnown}
                  onPick={id=>setNewSpells([...newSpells,id])}
                  title={isClass?"CLASS SPELL GAINED":isSubclass?"SUBCLASS BONUS SPELL":"SPECIALIZATION BONUS SPELL"}
                  subtitle={isClass?`${cls} gains a spell at Level ${level}.`:isSubclass?`${char.subclass} subclass grants a bonus spell.`:`${char.spec} specialization grants a bonus spell.`}
                />
              ):(()=>{
                const picked=ALL_SPELLS.find(s=>s.id===newSpells[newSpells.length-1]);
                const pc=picked?.path==="Grace"?"var(--grace)":"var(--dread)";
                return(
                  <div style={{padding:"14px",border:`1px solid ${pc}44`,borderRadius:2,background:`color-mix(in srgb,${pc} 5%,transparent)`}}>
                    <div style={{fontFamily:"'Cinzel',serif",fontSize:8,letterSpacing:2,color:pc,marginBottom:8}}>SPELL SELECTED</div>
                    <div style={{fontFamily:"'Cinzel',serif",fontSize:11,color:pc,marginBottom:4}}>{picked?.name}</div>
                    <div style={{fontFamily:"'IM Fell English',serif",fontSize:10,color:"var(--text-dim)",fontStyle:"italic",marginBottom:8}}>"{picked?.subtitle}"</div>
                    <div style={{fontSize:10,color:"var(--text-dim)",lineHeight:1.5}}>{picked?.effect}</div>
                    <button onClick={()=>setNewSpells(newSpells.slice(0,-1))} style={{marginTop:10,padding:"4px 10px",border:"1px solid var(--border)",background:"transparent",color:"var(--text-dim)",fontFamily:"'Cinzel',serif",fontSize:8,cursor:"pointer",borderRadius:1}}>← Choose Different</button>
                  </div>
                );
              })()}
            </div>
          );
        })()}
        {step==="abilities"&&<AbilitiesStep/>}

        <button className="mprimary" onClick={advance} disabled={!canAdvance()} style={{marginTop:8}}>
          {isLast?"✦ Confirm & Apply All":canAdvance()?`Next: ${nextStepLabel(stepIdx+1)} →`:"Complete this step to continue →"}
        </button>
        <button className="msec" onClick={onClose}>Save Progress & Close</button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   MILESTONE MODAL (GM-triggered)
══════════════════════════════════════════════════════════════════════════════ */
function MilestoneModal({chars,onClose}){
  const[direction,setDirection]=useState("grant"); // "grant"|"deduct"
  const[pts,setPts]=useState(1);
  const[mode,setMode]=useState("gm"); // "gm"|"player"
  const[selectedChars,setSelectedChars]=useState([]);
  const[specificComp,setSpecificComp]=useState("");
  const[allocs,setAllocs]=useState({});

  const toggleChar=id=>setSelectedChars(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);

  const setAlloc=(charId,key,delta)=>{
    setAllocs(a=>{
      const cur=a[charId]||Object.fromEntries(ALL_COMP.map(c=>[c.key,0]));
      const spent=Object.values(cur).reduce((x,y)=>x+y,0);
      if(delta>0&&spent>=pts)return a;
      if(delta<0&&(cur[key]||0)<=0)return a;
      return{...a,[charId]:{...cur,[key]:(cur[key]||0)+delta}};
    });
  };
  const getAllocSpent=charId=>Object.values(allocs[charId]||{}).reduce((a,b)=>a+b,0);

  const handleApply=()=>{
    if(!selectedChars.length)return;
    if(mode==="gm"&&!specificComp)return;
    onClose({direction,type:mode,chars:selectedChars,comp:specificComp,allocs,pts});
  };

  const canApply=selectedChars.length>0&&(mode==="player"||(mode==="gm"&&specificComp));

  const isGrant=direction==="grant";

  return(
    <div className="moverlay" onClick={e=>e.target===e.currentTarget&&onClose(null)}>
      <div className="modal wide">
        <div className="mtitle">⚔ GM Milestone</div>

        {/* Direction */}
        <div className="slabel">Type</div>
        <div className="opt-grid cols2" style={{marginBottom:14}}>
          <button className={`opt-btn${isGrant?" sel":""}`} onClick={()=>setDirection("grant")}>
            Grant Points<span className="opt-sub">Increase competency bonuses</span>
          </button>
          <button className={`opt-btn${!isGrant?" sel":""}`} onClick={()=>setDirection("deduct")} style={{borderColor:!isGrant?"var(--dread)":"",color:!isGrant?"var(--dread)":"",background:!isGrant?"rgba(200,90,58,.07)":""}}>
            Deduct Points<span className="opt-sub">Reduce competency bonuses</span>
          </button>
        </div>

        {/* Points */}
        <div className="slabel">Points to {isGrant?"Grant":"Deduct"}</div>
        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:14}}>
          <button className="rbtn" onClick={()=>setPts(Math.max(1,pts-1))}>−</button>
          <span style={{fontFamily:"'Cinzel Decorative',serif",fontSize:22,color:isGrant?"var(--gold)":"var(--dread)",minWidth:28,textAlign:"center"}}>{pts}</span>
          <button className="rbtn" onClick={()=>setPts(pts+1)}>+</button>
        </div>

        {/* Mode */}
        <div className="slabel">Allocation Mode</div>
        <div className="opt-grid cols2" style={{marginBottom:14}}>
          <button className={`opt-btn${mode==="gm"?" sel":""}`} onClick={()=>setMode("gm")}>
            GM Assigns<span className="opt-sub">Pick a specific competency</span>
          </button>
          <button className={`opt-btn${mode==="player"?" sel":""}`} onClick={()=>setMode("player")}>
            {isGrant?"Player Chooses":"GM Allocates per Character"}<span className="opt-sub">{isGrant?"Players distribute freely":"Assign per competency below"}</span>
          </button>
        </div>

        {/* Specific comp for GM mode */}
        {mode==="gm"&&(
          <>
            <div className="slabel">Competency</div>
            <select className="id-select" value={specificComp} onChange={e=>setSpecificComp(e.target.value)} style={{marginBottom:14}}>
              <option value="">— Select Competency —</option>
              {Object.entries(COMPETENCIES).map(([stat,list])=>(
                <optgroup key={stat} label={stat}>
                  {list.map(c=><option key={c.key} value={c.key}>{c.name}</option>)}
                </optgroup>
              ))}
            </select>
          </>
        )}

        {/* Characters */}
        <div className="slabel">Affected Characters</div>
        {chars.length===0&&<div style={{fontSize:10,color:"var(--text-dim)",fontStyle:"italic",marginBottom:12}}>No active characters. Players must create characters first.</div>}
        <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:14}}>
          {chars.map(c=>{
            const isSel=selectedChars.includes(c.id);
            const spent=getAllocSpent(c.id);
            return(
              <div key={c.id} style={{border:`1px solid ${isSel?(isGrant?"var(--gold-dim)":"var(--dread-dim)"):"var(--border)"}`,borderRadius:2,padding:"8px 10px",background:isSel?(isGrant?"rgba(200,149,42,.05)":"rgba(200,90,58,.05)"):"var(--section)"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:isSel&&mode==="player"?8:0}}>
                  <input type="checkbox" checked={isSel} onChange={()=>toggleChar(c.id)} id={`mc_${c.id}`} style={{cursor:"pointer"}}/>
                  <label htmlFor={`mc_${c.id}`} style={{fontFamily:"'Cinzel',serif",fontSize:10,color:isSel?(isGrant?"var(--gold)":"var(--dread)"):"var(--text-dim)",cursor:"pointer",letterSpacing:1,flex:1}}>
                    {c.name||"Unnamed"} <span style={{fontSize:8,color:"var(--text-dim)"}}>(Lvl {c.level} · {c.cls||"No class"})</span>
                  </label>
                  {isSel&&mode==="player"&&<span style={{fontFamily:"'Cinzel',serif",fontSize:9,color:isGrant?"var(--gold)":"var(--dread)"}}>{spent}/{pts}</span>}
                </div>
                {isSel&&mode==="player"&&(
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:4,marginTop:6}}>
                    {ALL_COMP.map(comp=>{
                      const cur=((allocs[c.id]||{})[comp.key]||0);
                      const existing=c.competencies?.[comp.key]??0;
                      return(
                        <div key={comp.key} style={{display:"flex",alignItems:"center",gap:4,padding:"3px 5px",background:"var(--ink)",borderRadius:1,border:"1px solid var(--border)"}}>
                          <button className="rbtn" style={{width:14,height:14,fontSize:10,flexShrink:0}} onClick={()=>setAlloc(c.id,comp.key,-1)} disabled={cur<=0}>−</button>
                          <span style={{flex:1,fontFamily:"'Cinzel',serif",fontSize:8,color:cur>0?(isGrant?"var(--gold)":"var(--dread)"):"var(--text-dim)"}}>{comp.name}</span>
                          <span style={{fontSize:9,color:"var(--text-dim)"}}>({existing>=0?`+${existing}`:existing})</span>
                          <span style={{fontFamily:"'Cinzel Decorative',serif",fontSize:11,minWidth:12,color:cur>0?(isGrant?"var(--gold)":"var(--dread)"):"var(--text-dim)"}}>{cur}</span>
                          <button className="rbtn" style={{width:14,height:14,fontSize:10,flexShrink:0}} onClick={()=>setAlloc(c.id,comp.key,1)} disabled={spent>=pts}>+</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <button className="mprimary" onClick={handleApply} disabled={!canApply}
          style={{borderColor:isGrant?"var(--gold-dim)":"var(--dread-dim)",color:isGrant?"var(--gold)":"var(--dread)",background:isGrant?"rgba(200,149,42,.07)":"rgba(200,90,58,.07)"}}>
          {isGrant?"✦ Apply Grants":"⚠ Apply Deductions"}
        </button>
        <button className="msec" onClick={()=>onClose(null)}>Cancel</button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   COMPETENCY DISPLAY (read-only with tooltip)
══════════════════════════════════════════════════════════════════════════════ */
function CompetencyDisplay({competencies,compMeta}){
  const[tooltip,setTooltip]=useState(null);
  return(
    <div>
      {Object.entries(COMPETENCIES).map(([stat,list])=>(
        <div className="comp-section" key={stat}>
          <div className="comp-section-hdr" style={{color:stat==="Body"?"var(--dread)":stat==="Mind"?"var(--grace)":"var(--purple)"}}>{stat.toUpperCase()} COMPETENCIES</div>
          {list.map(comp=>{
            const rank=competencies[comp.key]||0;
            const meta=compMeta?.[comp.key]||"normal";
            return(
              <div key={comp.key} className={`comp-row${rank>0?" has-rank":""}`}
                onMouseEnter={e=>{const r=e.currentTarget.getBoundingClientRect();setTooltip({comp,x:r.left,y:r.top});}}
                onMouseLeave={()=>setTooltip(null)}>
                <div className="comp-marker" style={{color:meta==="proficient"?"var(--gold)":meta==="deficient"?"var(--dread)":"transparent"}}>
                  {meta==="proficient"?"↑":meta==="deficient"?"↓":"·"}
                </div>
                <div className="comp-name" style={{color:meta==="proficient"?"var(--gold)":meta==="deficient"?"var(--dread)":"var(--text)"}}>{comp.name}</div>
                <div className="comp-rank">{rank}</div>
                <div className="comp-bonus" style={{color:rank>0?"var(--gold)":rank<0?"var(--dread)":"var(--text-dim)"}}>{rank===0?"—":rank>0?`+${rank}`:`${rank}`}</div>
              </div>
            );
          })}
        </div>
      ))}
      {tooltip&&(
        <div className="comp-desc-box" style={{left:Math.min(tooltip.x+10,window.innerWidth-270),top:tooltip.y>window.innerHeight/2?tooltip.y-90:tooltip.y+14}}>
          <div className="comp-desc-name">{tooltip.comp.name}</div>
          <div className="comp-desc-text">{tooltip.comp.desc}</div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   DEATH STATE MODAL
══════════════════════════════════════════════════════════════════════════════ */
function DeathStateModal({current,path,tether,onConfirm,onClose}){
  const[choice,setChoice]=useState(current==="alive"?"":current);
  const[heroText,setHeroText]=useState("");
  const[savePips,setSavePips]=useState([]);
  const[saveTetherDelta,setSaveTetherDelta]=useState(0);
  const[critNum]=useState(Math.ceil(Math.random()*12));
  const saveD12=useDiceRoller(12);

  const addSavePip=(type)=>{
    if(savePips.length>=6)return;
    setSavePips(p=>[...p,type]);
    setSaveTetherDelta(d=>d+(type==="revival"?1:-1));
  };

  const rollSave=async()=>{
    if(saveD12.rolling)return;
    const finalD12=await saveD12.roll();
    addSavePip(finalD12>=7?"revival":"death");
  };

  // Victory conditions
  const revivals=savePips.filter(p=>p==="revival").length;
  const deaths=savePips.filter(p=>p==="death").length;
  const stabilized=revivals>=3;
  const dead=deaths>=3;

  const handleConfirm=()=>{
    if(choice==="die"){
      if(!heroText.trim())return;
      onConfirm({state:"dead",heroText,tetherDelta:0});
    } else if(choice==="saves"){
      if(!stabilized&&!dead)return;
      if(stabilized) onConfirm({state:"stabilized",tetherDelta:saveTetherDelta});
      else onConfirm({state:"dead",tetherDelta:saveTetherDelta,fromSaves:true});
    } else if(choice==="bargain"){
      // Shift 6 toward the "bad" direction for this path
      const delta=path==="dread"?6:-6; // dread path: grace is bad, so +6; grace path: dread is bad, so -6
      onConfirm({state:"bargain",tetherDelta:delta});
    } else if(choice==="alive"){
      onConfirm({state:"alive",tetherDelta:0});
    }
  };

  const canConfirm=choice==="die"?heroText.trim().length>0
    :choice==="saves"?(stabilized||dead)
    :choice==="bargain"||choice==="alive";

  return(
    <div className="moverlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <div className="mtitle">⚔ Death State</div>
        <div className="death-state-row">
          {[["alive","Alive","alive"],["die","Die a Hero","die"],["saves","Death Saves","saves"],["bargain","Bargain","bargain"]].map(([k,l,cls])=>(
            <button key={k} className={`ds-btn${choice===k?" "+cls:""}`} onClick={()=>setChoice(k)}>{l}</button>
          ))}
        </div>

        {choice===""&&<div className="mbody">Select a death state above.</div>}

        {choice==="alive"&&(
          <div style={{padding:"10px",border:"1px solid var(--green)",borderRadius:2,background:"rgba(90,154,90,.07)",color:"var(--green)",fontSize:11,marginBottom:12}}>
            Character is alive and active.
          </div>
        )}

        {choice==="die"&&(
          <div>
            <div style={{color:"var(--dread)",fontFamily:"'Cinzel',serif",fontSize:10,letterSpacing:1,marginBottom:8}}>✦ Die a Hero</div>
            <div className="mbody">Declare your final heroic action. Your death must be confirmed by the GM.</div>
            <div className="id-label" style={{marginBottom:6}}>Describe how you die and what you accomplish:</div>
            <textarea className="chronicle-textarea" value={heroText} onChange={e=>setHeroText(e.target.value)} placeholder="With the last of their strength, they…" rows={4} style={{marginBottom:8}}/>
            <div style={{fontSize:9,color:"var(--text-dim)",fontStyle:"italic",padding:"6px 8px",border:"1px solid var(--border)",borderRadius:2,marginBottom:12}}>
              Subject to GM approval. On confirmation, your character dies permanently and performs one final automatic success or gains massive advantage.
            </div>
          </div>
        )}

        {choice==="saves"&&(
          <div>
            <div style={{color:"var(--gold)",fontFamily:"'Cinzel',serif",fontSize:10,letterSpacing:1,marginBottom:8}}>✦ Death Saves</div>
            <div className="mbody">Roll the d12 Tether die with no modifiers. ♥ = Revival point (Grace 7–12). ☠ = Death point (Dread 1–6). These rolls move your Tether bar.</div>
            <div style={{display:"flex",gap:8,marginBottom:12}}>
              {[0,1,2].map(i=>(
                <div key={i} className={`pip ${i<revivals?"revival":i<deaths+revivals&&i>=revivals?"":"empty"}`} style={{borderColor:i<revivals?"var(--grace)":i<deaths&&savePips[i]==="death"?"var(--dread)":"var(--border)"}}>
                  {savePips[i]==="revival"?"♥":savePips[i]==="death"?"☠":""}
                </div>
              ))}
              <span style={{alignSelf:"center",color:"var(--text-dim)",fontSize:9}}>Revival</span>
            </div>
            <div style={{display:"flex",gap:8,marginBottom:12}}>
              {[0,1,2].map(i=>(
                <div key={i} className={`pip ${i<deaths?"death":"empty"}`}>
                  {i<deaths?"☠":""}
                </div>
              ))}
              <span style={{alignSelf:"center",color:"var(--text-dim)",fontSize:9}}>Death</span>
            </div>
            {!stabilized&&!dead&&savePips.length<6&&(
              <>
                {saveD12.displayed!==null&&(
                  <div style={{textAlign:"center",marginBottom:6}}>
                    <div className="die-card" style={{display:"inline-block",minWidth:64}}>
                      <div className="die-lbl">d12 — Tether Save</div>
                      <div className="die-val" style={{
                        color:saveD12.rolling?"var(--text-dim)":saveD12.displayed>=7?"var(--grace)":"var(--dread)",
                        fontSize:38,minHeight:48,display:"flex",alignItems:"center",justifyContent:"center",transition:"color .3s"
                      }}>
                        {saveD12.displayed}
                      </div>
                      {!saveD12.rolling&&saveD12.result&&(
                        <div style={{fontSize:9,color:saveD12.result>=7?"var(--grace)":"var(--dread)",marginTop:2,fontStyle:"italic",textAlign:"center"}}>
                          {saveD12.result>=7?"Grace — Revival":"Dread — Death"}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <button className="mprimary" style={{marginBottom:8}} onClick={rollSave} disabled={stabilized||dead||saveD12.rolling}>
                  {saveD12.rolling?"Rolling…":"Roll d12 (Tether Save)"}
                </button>
              </>
            )}
            {stabilized&&<div style={{color:"var(--grace)",fontFamily:"'Cinzel',serif",fontSize:11,textAlign:"center",marginBottom:10}}>✦ Stabilized — Character survives at 1 HP</div>}
            {dead&&<div style={{color:"var(--dread)",fontFamily:"'Cinzel',serif",fontSize:11,textAlign:"center",marginBottom:10}}>☠ Three failures — Character dies</div>}
            {saveTetherDelta!==0&&<div style={{fontSize:9,color:"var(--text-dim)",fontStyle:"italic",textAlign:"center",marginBottom:8}}>Tether shift from saves: {saveTetherDelta>0?`+${saveTetherDelta}`:saveTetherDelta}</div>}
          </div>
        )}

        {choice==="bargain"&&(
          <div>
            <div style={{color:"var(--purple)",fontFamily:"'Cinzel',serif",fontSize:10,letterSpacing:1,marginBottom:8}}>✦ Bargain with Death</div>
            <div style={{padding:"10px",border:"1px solid var(--purple-dim)",borderRadius:2,background:"rgba(168,120,216,.07)",fontSize:11,color:"var(--text-dim)",lineHeight:1.6,marginBottom:12}}>
              Return immediately to 1 HP.<br/>
              <span style={{color:"var(--purple)"}}>Tether shifts 6 steps toward {path==="dread"?"Grace (your trauma direction)":"Dread"}.</span><br/>
              Baseline shifts 1 step toward Dread permanently.
            </div>
          </div>
        )}

        <button className="mprimary" onClick={handleConfirm} disabled={!canConfirm}>Confirm</button>
        <button className="msec" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   ARCHIVE PROMPT
══════════════════════════════════════════════════════════════════════════════ */
function ArchiveModal({charName,onArchive,onDelete,onClose}){
  return(
    <div className="moverlay">
      <div className="modal">
        <div className="mtitle">☠ {charName} has Fallen</div>
        <div className="mbody">This character has died. Would you like to archive them? Archived characters are preserved and can be restored by the GM.</div>
        <button className="mprimary" onClick={onArchive}>Archive Character</button>
        <button className="mdanger" onClick={onDelete}>Delete Permanently</button>
        <button className="msec" onClick={onClose}>Keep Active</button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   INVENTORY PANEL
══════════════════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════════════════
   INVENTORY PANEL — Equipped + Person + Backpack + Aux bags
══════════════════════════════════════════════════════════════════════════════ */

// Equip slot definitions
const EQUIP_SLOTS=[
  {id:"weapon_primary",   label:"Primary Weapon",  group:"Weapons"},
  {id:"weapon_secondary", label:"Secondary Weapon", group:"Weapons"},
  {id:"jewelry_1",        label:"Jewelry 1",        group:"Jewelry"},
  {id:"jewelry_2",        label:"Jewelry 2",        group:"Jewelry"},
  {id:"jewelry_3",        label:"Jewelry 3",        group:"Jewelry"},
  {id:"armor_1",          label:"Armor (Head)",     group:"Armor"},
  {id:"armor_2",          label:"Armor (Chest)",    group:"Armor"},
  {id:"armor_3",          label:"Armor (Hands)",    group:"Armor"},
  {id:"armor_4",          label:"Armor (Legs)",     group:"Armor"},
  {id:"armor_5",          label:"Armor (Feet)",     group:"Armor"},
  {id:"armor_6",          label:"Armor (Accessory)",group:"Armor"},
  {id:"clothing_1",       label:"Clothing (Top)",   group:"Clothing"},
  {id:"clothing_2",       label:"Clothing (Bottom)",group:"Clothing"},
  {id:"clothing_3",       label:"Clothing (Outer)", group:"Clothing"},
  {id:"clothing_4",       label:"Clothing (Other)", group:"Clothing"},
  {id:"bag_backpack",     label:"Backpack",         group:"Bags"},
  {id:"bag_aux_1",        label:"Auxiliary Pack 1", group:"Bags"},
  {id:"bag_aux_2",        label:"Auxiliary Pack 2", group:"Bags"},
];

// Which item slot keys can go in which equip slot id
// item.slot values: "weapon","jewelry","armor","clothing","bag_backpack","bag_aux"
const SLOT_ACCEPTS={
  weapon_primary:"weapon", weapon_secondary:"weapon",
  jewelry_1:"jewelry", jewelry_2:"jewelry", jewelry_3:"jewelry",
  armor_1:"armor", armor_2:"armor", armor_3:"armor",
  armor_4:"armor", armor_5:"armor", armor_6:"armor",
  clothing_1:"clothing", clothing_2:"clothing", clothing_3:"clothing", clothing_4:"clothing",
  bag_backpack:"bag_backpack", bag_aux_1:"bag_aux", bag_aux_2:"bag_aux",
};

const SLOT_LABELS={"weapon":"Weapon","jewelry":"Jewelry","armor":"Armor","clothing":"Clothing","bag_backpack":"Backpack","bag_aux":"Auxiliary Bag"};
const ITEM_SLOTS=["weapon","jewelry","armor","clothing","bag_backpack","bag_aux"];

function InventoryPanel({bodyWeight,bodyMod,updChar,cPerson,cBackpack,cAux1,cAux2,cEquipped}){
  // invSub: "equipped"|"person"|"backpack"|"aux1"|"aux2"
  const[invSub,setInvSub]=useState("person");

  // Local lists — synced up via updChar
  const person    = cPerson    || [];
  const backpack  = cBackpack  || [];
  const aux1Items = cAux1      || [];
  const aux2Items = cAux2      || [];
  const equipped  = cEquipped  || {};

  // Helpers
  const updList=(key,fn)=>updChar(p=>({...p,[key]:fn(p[key]||[])}));
  const addItem=key=>updList(key,l=>[...l,{id:uid(),name:"",qty:1,weight:0,notes:"",slot:""}]);
  const updItem=(key,id,field,val)=>updList(key,l=>l.map(i=>i.id===id?{...i,[field]:val}:i));
  const remItem=(key,id)=>{
    // Also unequip if needed
    updChar(p=>{
      const newEq={...p.invEquipped||{}};
      Object.keys(newEq).forEach(s=>{if(newEq[s]===id)delete newEq[s];});
      return{...p,[key]:(p[key]||[]).filter(i=>i.id!==id),invEquipped:newEq};
    });
  };

  // Equip / unequip
  const equipItem=(slotId,itemId)=>{
    updChar(p=>({...p,invEquipped:{...(p.invEquipped||{}),[slotId]:itemId}}));
  };
  const unequipSlot=slotId=>{
    updChar(p=>{const e={...(p.invEquipped||{})};delete e[slotId];return{...p,invEquipped:e};});
  };

  // Encumbrance
  const allItems=[...person,...backpack,...aux1Items,...aux2Items];
  const tw=list=>list.reduce((a,i)=>a+(parseFloat(i.weight)||0)*(parseInt(i.qty)||1),0);
  const totalWeight=tw(allItems);
  const travelT=bodyWeight*(0.20+bodyMod*0.02);
  const actionT=bodyWeight*(0.40+bodyMod*0.02);
  const enc=totalWeight>=actionT?"action":totalWeight>=travelT?"travel":"none";
  const encColor=enc==="action"?"var(--dread)":enc==="travel"?"var(--gold)":"var(--grace)";

  // Equipped backpack & aux names and capacities
  const bpId=equipped.bag_backpack;
  const aux1Id=equipped.bag_aux_1;
  const aux2Id=equipped.bag_aux_2;
  const findItem=id=>allItems.find(i=>i.id===id);
  const bpItem=bpId?findItem(bpId):null;
  const aux1Item=aux1Id?findItem(aux1Id):null;
  const aux2Item=aux2Id?findItem(aux2Id):null;
  const bpName=bpItem?.name||"Backpack";
  const aux1Name=aux1Item?.name||"Aux Pack 1";
  const aux2Name=aux2Item?.name||"Aux Pack 2";
  // Capacity: item's weight field repurposed as "units capacity" for bags
  const bpCap=bpItem?parseFloat(bpItem.weight)||0:0;
  const aux1Cap=aux1Item?parseFloat(aux1Item.weight)||0:0;
  const aux2Cap=aux2Item?parseFloat(aux2Item.weight)||0:0;

  // Find all equippable items in all lists for a given slot type
  const getEquippableForSlot=slotId=>{
    const accepts=SLOT_ACCEPTS[slotId];
    return allItems.filter(i=>i.slot===accepts);
  };

  // Render an item row in a bag list
  const ItemRow=({item,listKey})=>(
    <tr key={item.id}>
      <td>
        <input className="iinput" value={item.name}
          onChange={e=>updItem(listKey,item.id,"name",e.target.value)} placeholder="Item…"/>
      </td>
      <td>
        <input className="inum" type="number" value={item.qty} min={1}
          onChange={e=>updItem(listKey,item.id,"qty",e.target.value)}/>
      </td>
      <td>
        <input className="inum" type="number" value={item.weight} min={0} step={0.5}
          onChange={e=>updItem(listKey,item.id,"weight",e.target.value)}/>
      </td>
      <td>
        <select className="id-select" value={item.slot||""}
          onChange={e=>updItem(listKey,item.id,"slot",e.target.value)}
          style={{fontSize:8,padding:"1px 3px",minWidth:80}}>
          <option value="">— no slot —</option>
          {ITEM_SLOTS.map(s=><option key={s} value={s}>{SLOT_LABELS[s]}</option>)}
        </select>
      </td>
      <td><input className="iinput" value={item.notes}
        onChange={e=>updItem(listKey,item.id,"notes",e.target.value)} placeholder="…"/></td>
      <td><button className="idelbtn" onClick={()=>remItem(listKey,item.id)}>✕</button></td>
    </tr>
  );

  const BagPanel=({listKey,items,capacity,aux=false})=>(
    <>
      <table className="invtable">
        <thead>
          <tr>
            <th>Item</th><th style={{width:32}}>Qty</th>
            <th style={{width:42}}>Units</th><th style={{width:85}}>Slot Type</th>
            <th style={{width:60}}>Notes</th><th style={{width:20}}/>
          </tr>
        </thead>
        <tbody>
          {items.map(item=><ItemRow key={item.id} item={item} listKey={listKey}/>)}
          {items.length===0&&<tr><td colSpan={6} style={{color:"var(--text-dim)",fontStyle:"italic",fontSize:10,padding:"7px 5px"}}>Empty</td></tr>}
        </tbody>
      </table>
      <div style={{display:"flex",gap:9,alignItems:"center",marginTop:7,flexWrap:"wrap"}}>
        <button className="iaddbtn" onClick={()=>addItem(listKey)}>+ Add Item</button>
        {capacity>0&&(
          <span style={{fontSize:9,color:"var(--text-dim)",fontFamily:"'Cinzel',serif"}}>
            {tw(items).toFixed(1)} / {capacity} units
          </span>
        )}
        {aux&&<div style={{fontSize:9,color:"var(--text-dim)",fontStyle:"italic",marginLeft:"auto"}}>Bonus action to access in combat</div>}
      </div>
    </>
  );

  // ── Equipped panel ──
  const EquippedPanel=()=>(
    <div>
      {["Weapons","Jewelry","Armor","Clothing","Bags"].map(group=>{
        const slots=EQUIP_SLOTS.filter(s=>s.group===group);
        return(
          <div key={group} style={{marginBottom:12}}>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:8,letterSpacing:2,color:"var(--gold-dim)",marginBottom:6,paddingBottom:4,borderBottom:"1px solid var(--border)"}}>{group.toUpperCase()}</div>
            {slots.map(slot=>{
              const equippedId=equipped[slot.id];
              const equippedItem=equippedId?findItem(equippedId):null;
              const candidates=getEquippableForSlot(slot.id);
              return(
                <div key={slot.id} style={{
                  display:"flex",alignItems:"center",gap:8,padding:"7px 10px",marginBottom:5,
                  border:`1px solid ${equippedItem?"var(--gold-dim)":"var(--border)"}`,
                  borderRadius:2,background:equippedItem?"rgba(200,149,42,.05)":"var(--section)",
                }}>
                  <div style={{fontFamily:"'Cinzel',serif",fontSize:8,letterSpacing:1,color:"var(--text-dim)",minWidth:100,flexShrink:0}}>{slot.label}</div>
                  {equippedItem?(
                    <>
                      <div style={{flex:1,fontFamily:"'Cinzel',serif",fontSize:10,color:"var(--gold)"}}>{equippedItem.name||"(unnamed)"}</div>
                      {equippedItem.notes&&<div style={{fontSize:9,color:"var(--text-dim)",flex:2,fontStyle:"italic"}}>{equippedItem.notes}</div>}
                      <button onClick={()=>unequipSlot(slot.id)} style={{
                        padding:"2px 8px",border:"1px solid var(--border)",borderRadius:1,
                        background:"transparent",color:"var(--text-dim)",fontFamily:"'Cinzel',serif",
                        fontSize:7,letterSpacing:1,cursor:"pointer",flexShrink:0,
                      }}>Unequip</button>
                    </>
                  ):(
                    <>
                      <select onChange={e=>{if(e.target.value)equipItem(slot.id,e.target.value);}}
                        value=""
                        style={{flex:1,background:"transparent",border:"none",
                          borderBottom:"1px solid var(--border)",color:"var(--text-dim)",
                          fontFamily:"'IM Fell English',serif",fontSize:11,outline:"none",cursor:"pointer"}}>
                        <option value="">— empty —</option>
                        {candidates.filter(it=>!Object.values(equipped).includes(it.id)||equipped[slot.id]===it.id).map(it=>(
                          <option key={it.id} value={it.id}>{it.name||"(unnamed)"}</option>
                        ))}
                      </select>
                      {candidates.length===0&&<span style={{fontSize:8,color:"var(--text-dim)",fontStyle:"italic",flex:1}}>No {SLOT_LABELS[SLOT_ACCEPTS[slot.id]]?.toLowerCase()} items in inventory</span>}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );

  // Build dynamic subtabs
  const subTabs=[
    {id:"equipped",label:"Equipped"},
    {id:"person", label:"Person"},
    ...(bpItem?[{id:"backpack",label:bpName}]:[]),
    ...(aux1Item?[{id:"aux1",label:aux1Name}]:[]),
    ...(aux2Item?[{id:"aux2",label:aux2Name}]:[]),
  ];

  // If current invSub is no longer valid (e.g. aux bag unequipped), reset
  const validSub=subTabs.find(t=>t.id===invSub)?invSub:"person";

  return(
    <div>
      {/* Encumbrance */}
      <div className="panel">
        <div className="slabel">Encumbrance</div>
        <div style={{display:"flex",gap:9,marginBottom:8,flexWrap:"wrap",fontSize:8,color:"var(--text-dim)"}}>
          <span>Body wt: <b style={{color:"var(--text)"}}>{bodyWeight} lbs</b></span>
          <span>Body mod: <b style={{color:"var(--text)"}}>{modStr(bodyMod)}</b></span>
          <span>Carried: <b style={{color:"var(--text)"}}>{totalWeight.toFixed(1)} units</b></span>
          <span style={{color:encColor}}>Status: <b>{enc==="none"?"Clear":enc==="travel"?"Travel Enc.":"Action Enc."}</b></span>
        </div>
        <div style={{height:4,background:"var(--ink)",borderRadius:2,overflow:"hidden"}}>
          <div style={{height:"100%",width:`${Math.min(100,bodyWeight>0?(totalWeight/actionT)*100:0)}%`,background:encColor,borderRadius:2,transition:"width .3s"}}/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7,marginTop:8}}>
          <div className="enccard"><div className="enccardlabel">TRAVEL</div><div className="enccardval" style={{color:"var(--gold)",fontSize:12}}>{travelT.toFixed(1)}</div><div style={{fontSize:7,color:"var(--text-dim)"}}>Speed halved</div></div>
          <div className="enccard"><div className="enccardlabel">ACTION</div><div className="enccardval" style={{color:"var(--dread)",fontSize:12}}>{actionT.toFixed(1)}</div><div style={{fontSize:7,color:"var(--text-dim)"}}>Disadv: Body/combat</div></div>
          <div className="enccard"><div className="enccardlabel">STATUS</div><div className="enccardval" style={{color:encColor,fontSize:11}}>{enc==="none"?"Clear":enc==="travel"?"Travel":"Action Enc."}</div></div>
        </div>
      </div>

      {/* Subtab bar */}
      <div className="sstabs" style={{flexWrap:"wrap"}}>
        {subTabs.map(t=>(
          <button key={t.id} className={`sstab${validSub===t.id?" on":""}`}
            onClick={()=>setInvSub(t.id)}
            style={{maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="panel">
        {validSub==="equipped"&&(
          <>
            <div className="slabel">Equipped Items</div>
            <EquippedPanel/>
          </>
        )}
        {validSub==="person"&&(
          <>
            <div className="slabel">Person <span style={{fontFamily:"'IM Fell English',serif",fontStyle:"italic",fontSize:10,color:"var(--text-dim)",letterSpacing:0}}>(on your body — 15 slot max)</span></div>
            <BagPanel listKey="invPerson" items={person} capacity={15}/>
          </>
        )}
        {validSub==="backpack"&&bpItem&&(
          <>
            <div className="slabel">{bpName} <span style={{fontFamily:"'IM Fell English',serif",fontStyle:"italic",fontSize:10,color:"var(--text-dim)",letterSpacing:0}}>({bpCap} units capacity)</span></div>
            <BagPanel listKey="invBackpack" items={backpack} capacity={bpCap}/>
          </>
        )}
        {validSub==="aux1"&&aux1Item&&(
          <>
            <div className="slabel">{aux1Name} <span style={{fontFamily:"'IM Fell English',serif",fontStyle:"italic",fontSize:10,color:"var(--text-dim)",letterSpacing:0}}>({aux1Cap} units · bonus action to access)</span></div>
            <BagPanel listKey="invAux1" items={aux1Items} capacity={aux1Cap} aux/>
          </>
        )}
        {validSub==="aux2"&&aux2Item&&(
          <>
            <div className="slabel">{aux2Name} <span style={{fontFamily:"'IM Fell English',serif",fontStyle:"italic",fontSize:10,color:"var(--text-dim)",letterSpacing:0}}>({aux2Cap} units · bonus action to access)</span></div>
            <BagPanel listKey="invAux2" items={aux2Items} capacity={aux2Cap} aux/>
          </>
        )}
      </div>
    </div>
  );
}


function Journal({initEntries=[]}){
  const[entries,setEntries]=useState(initEntries);
  const add=()=>setEntries(l=>[...l,{id:uid(),title:"",body:"",readonly:false}]);
  const upd=(id,f,v)=>setEntries(l=>l.map(e=>e.id===id?{...e,[f]:v}:e));
  const rem=id=>setEntries(l=>l.filter(e=>e.id!==id));
  return(
    <div className="panel">
      <div className="slabel">Journal</div>
      {entries.map(e=>(
        <div className="gitem" key={e.id} style={{marginBottom:9}}>
          <div className="gitemrow">
            <input className="gname" value={e.title} onChange={ev=>upd(e.id,"title",ev.target.value)} placeholder="Entry title…"/>
            {!e.readonly&&<button className="idelbtn" onClick={()=>rem(e.id)}>✕</button>}
          </div>
          <textarea className="gdesc" value={e.body} onChange={ev=>upd(e.id,"body",ev.target.value)} placeholder="Write here…" rows={4} style={{minHeight:60}}/>
          {e.readonly&&<div style={{fontSize:8,color:"var(--gold-dim)",fontFamily:"'Cinzel',serif",marginTop:4}}>✦ Chronicle</div>}
        </div>
      ))}
      {entries.length===0&&<div style={{color:"var(--text-dim)",fontStyle:"italic",fontSize:10,marginBottom:9}}>No entries yet.</div>}
      <button className="iaddbtn" onClick={add}>+ New Entry</button>
    </div>
  );
}

function Conditions(){
  const[conds,setConds]=useState([]);
  const[draft,setDraft]=useState("");
  const add=()=>{if(!draft.trim())return;setConds(l=>[...l,{id:uid(),name:draft.trim(),notes:""}]);setDraft("");};
  const rem=id=>setConds(l=>l.filter(c=>c.id!==id));
  const upd=(id,v)=>setConds(l=>l.map(c=>c.id===id?{...c,notes:v}:c));
  return(
    <div className="panel">
      <div className="slabel">Active Conditions</div>
      {conds.map(c=>(
        <div className="condrow" key={c.id}>
          <div style={{flex:1}}>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:10,color:"var(--dread)",marginBottom:2}}>{c.name}</div>
            <input className="iinput" value={c.notes} onChange={e=>upd(c.id,e.target.value)} placeholder="Effect notes…" style={{fontSize:10,color:"var(--text-dim)"}}/>
          </div>
          <button className="condrm" onClick={()=>rem(c.id)}>✕</button>
        </div>
      ))}
      {conds.length===0&&<div style={{color:"var(--text-dim)",fontStyle:"italic",fontSize:10,marginBottom:9}}>No conditions.</div>}
      <div style={{display:"flex",gap:7,marginTop:9,alignItems:"center"}}>
        <input className="condinput" value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} placeholder="Condition name…"/>
        <button className="iaddbtn" style={{marginTop:0}} onClick={add}>+ Add</button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   CHARACTER CREATION WIZARD
══════════════════════════════════════════════════════════════════════════════ */
const STEPS=["basics","cradle","path","stats","class","community","convictions","chronicles","weapon","spells","review"];
const STEP_LABELS=["Basics","Cradle","Path","Stats","Class","Community","Convictions","Chronicles","Weapon","Review"];

function WizardProg({step}){
  const idx=STEPS.indexOf(step);
  return(
    <div style={{display:"flex",gap:3,marginBottom:14,flexWrap:"wrap"}}>
      {STEPS.map((s,i)=>(
        <div key={s} style={{height:3,flex:1,minWidth:18,borderRadius:2,background:i<=idx?"var(--gold)":"var(--border)",transition:"background .3s"}}/>
      ))}
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════════════
   SPELL TIMER / COUNTER SYSTEM
   parseDuration(spell) → {type:"instant"|"timer"|"counter"|"sustained"|"encounter", value:N}
   ActiveTimerBar — renders up to 3 active timers in the top area
══════════════════════════════════════════════════════════════════════════════ */

function parseDuration(spell){
  const d=(spell.duration||"").toLowerCase();
  if(d==="instant")return{type:"instant"};
  if(d.includes("sustained"))return{type:"sustained",manaPerRound:d.includes("2 mana")?2:1};
  if(d.includes("until end of encounter"))return{type:"encounter"};
  // Rounds
  const roundMatch=d.match(/^(\d+)\s*round/);
  if(roundMatch)return{type:"counter",total:parseInt(roundMatch[1]),unit:"round"};
  // Real-time minutes
  const minMatch=d.match(/^(\d+)\s*min/);
  if(minMatch)return{type:"timer",seconds:parseInt(minMatch[1])*60};
  // Real-time hours
  const hrMatch=d.match(/^(\d+)\s*hour/);
  if(hrMatch)return{type:"timer",seconds:parseInt(hrMatch[1])*3600};
  // "5 minutes/round" sustained variant
  if(d.includes("mana/10 minutes"))return{type:"timer",seconds:600,label:"10 min sustain"};
  // Default — treat as encounter
  return{type:"encounter"};
}

function fmtTime(sec){
  const m=Math.floor(sec/60),s=sec%60;
  return `${m}:${s.toString().padStart(2,"0")}`;
}

function ActiveTimerBar({timers,onUpdate,onRemove}){
  // Drive real-time countdown via interval
  useEffect(()=>{
    const iv=setInterval(()=>{
      onUpdate(timers.map(t=>{
        if(t.type!=="timer"||t.paused||t.remaining<=0)return t;
        const next=t.remaining-1;
        return{...t,remaining:next,expired:next<=0};
      }));
    },1000);
    return()=>clearInterval(iv);
  },[timers]);

  if(timers.length===0)return null;

  return(
    <div style={{
      display:"flex",gap:6,padding:"5px 8px",
      background:"rgba(0,0,0,.35)",borderBottom:"1px solid var(--border)",
      flexWrap:"wrap",alignItems:"center",
    }}>
      <span style={{fontFamily:"'Cinzel',serif",fontSize:7,letterSpacing:2,color:"var(--text-dim)",flexShrink:0}}>ACTIVE:</span>
      {timers.map(t=>{
        const isExpired=t.expired||(t.type==="timer"&&t.remaining<=0)||(t.type==="counter"&&t.current>=t.total);
        const pathCol=t.spellPath==="Grace"?"var(--grace)":"var(--dread)";
        const urgentCol=t.type==="timer"&&t.remaining<=10&&!isExpired?"var(--dread)":pathCol;

        return(
          <div key={t.id} style={{
            display:"flex",alignItems:"center",gap:5,padding:"3px 8px",
            border:`1px solid ${isExpired?"var(--dread-dim)":urgentCol}44`,borderRadius:2,
            background:isExpired?"rgba(200,90,58,.08)":`color-mix(in srgb,${urgentCol} 6%,transparent)`,
            fontSize:9,transition:"all .3s",
          }}>
            {/* Spell name */}
            <span style={{fontFamily:"'Cinzel',serif",fontSize:8,color:isExpired?"var(--dread)":urgentCol,whiteSpace:"nowrap",maxWidth:90,overflow:"hidden",textOverflow:"ellipsis"}} title={t.spellName}>
              {t.spellName}
            </span>

            {/* Timer display */}
            {t.type==="timer"&&(
              <span style={{fontFamily:"'Cinzel Decorative',serif",fontSize:11,color:urgentCol,minWidth:36,textAlign:"center"}}>
                {isExpired?"DONE":fmtTime(t.remaining)}
              </span>
            )}
            {t.type==="counter"&&(
              <span style={{fontFamily:"'Cinzel Decorative',serif",fontSize:11,color:isExpired?"var(--dread)":urgentCol,minWidth:28,textAlign:"center"}}>
                {isExpired?"DONE":`${t.current}/${t.total}`}
              </span>
            )}
            {t.type==="sustained"&&(
              <span style={{fontFamily:"'Cinzel Decorative',serif",fontSize:11,color:urgentCol,minWidth:28,textAlign:"center"}}>
                {t.current}r
              </span>
            )}
            {t.type==="encounter"&&(
              <span style={{fontFamily:"'Cinzel',serif",fontSize:8,color:urgentCol}}>ENC</span>
            )}

            {/* Controls */}
            <div style={{display:"flex",gap:3,flexShrink:0}}>
              {t.type==="timer"&&!isExpired&&(
                <button onClick={()=>onUpdate(timers.map(x=>x.id===t.id?{...x,paused:!x.paused}:x))}
                  style={{background:"transparent",border:`1px solid ${urgentCol}44`,borderRadius:1,color:urgentCol,cursor:"pointer",fontSize:9,padding:"1px 5px",fontFamily:"'Cinzel',serif",fontSize:7}}>
                  {t.paused?"▶":"⏸"}
                </button>
              )}
              {(t.type==="counter"||t.type==="sustained")&&!isExpired&&(
                <button onClick={()=>onUpdate(timers.map(x=>x.id===t.id?{...x,current:x.current+1,expired:x.type==="counter"&&x.current+1>=x.total}:x))}
                  style={{background:"transparent",border:`1px solid ${urgentCol}44`,borderRadius:1,color:urgentCol,cursor:"pointer",padding:"1px 5px",fontFamily:"'Cinzel',serif",fontSize:8}}>
                  +1
                </button>
              )}
              <button onClick={()=>onRemove(t.id)}
                style={{background:"transparent",border:`1px solid rgba(200,90,58,.3)`,borderRadius:1,color:"var(--text-dim)",cursor:"pointer",padding:"1px 4px",fontSize:9}}>
                ✕
              </button>
            </div>

            {isExpired&&<span style={{fontFamily:"'Cinzel',serif",fontSize:6,color:"var(--dread)",letterSpacing:1}}>ENDED</span>}
          </div>
        );
      })}
      {timers.length>0&&<span style={{fontFamily:"'Cinzel',serif",fontSize:7,color:"var(--text-dim)",marginLeft:"auto"}}>{timers.length}/3</span>}
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════════════
   TALENTS TAB COMPONENT — extracted to allow hook usage
══════════════════════════════════════════════════════════════════════════════ */
function TalentsTab({c,updChar,setShowLevelUp,activeTimers,onCastSpell}){
  const[talSub,setTalSub]=useState("competencies");
  const talSubs=[{id:"competencies",label:"Competencies"},{id:"abilities",label:"Abilities"},{id:"spells",label:"Spells"}];

  const[castFlash,setCastFlash]=useState(null); // {spellId, msg} — brief confirmation

  const castSpell=(spell,dur)=>{
    const manaCost=spell.mana||0;
    const stressCost=spell.stress||0;
    const addsTrauma=!!spell.trauma; // level 10+

    // Deduct resources
    updChar(p=>{
      const newMana=Math.max(0,p.mana-manaCost);
      const newStress=Math.min(p.stressMax,p.stress+stressCost);
      const newTraumas=addsTrauma?p.traumas+1:p.traumas;
      return{...p,mana:newMana,stress:newStress,traumas:newTraumas};
    });

    // Build flash message
    const parts=[];
    if(manaCost>0)parts.push(`−${manaCost} Mana`);
    if(stressCost>0)parts.push(`+${stressCost} Stress`);
    if(addsTrauma)parts.push(`+1 Trauma`);
    setCastFlash({spellId:spell.id,msg:parts.join(" · ")||"Cast!"});
    setTimeout(()=>setCastFlash(null),2200);

    // Start timer/counter if applicable
    if(dur.type!=="instant"&&activeTimers.length<3&&!activeTimers.some(t=>t.spellId===spell.id)){
      const base={id:uid(),spellId:spell.id,spellName:spell.name,spellPath:spell.path,paused:false,expired:false};
      let t;
      if(dur.type==="timer")        t={...base,type:"timer",remaining:dur.seconds,total:dur.seconds};
      else if(dur.type==="counter") t={...base,type:"counter",current:0,total:dur.total};
      else if(dur.type==="sustained")t={...base,type:"sustained",current:0,manaPerRound:dur.manaPerRound};
      else                           t={...base,type:"encounter",current:0};
      onCastSpell(t);
    }
  };

  const known=(c.knownSpells||[]).map(id=>ALL_SPELLS.find(s=>s.id===id)).filter(Boolean);

  return(
    <div>
      {/* Pillar stats */}
      <div className="panel">
        <div className="slabel">Stats (Pillars of Creation)</div>
        <div className="sgrid">
          {[["mind","Mind"],["body","Body"],["soul","Soul"]].map(([k,l])=>(
            <div className="scard" key={k}>
              <div className="sname">{l}</div>
              <input className="sinput" type="number" min={1} value={c.stats[k]}
                onChange={e=>updChar(p=>({...p,stats:{...p.stats,[k]:Math.max(1,parseInt(e.target.value)||1)}}))}
                disabled={c.archived}/>
              <div className="smod">{modStr(c.stats[k])}</div>
            </div>
          ))}
        </div>
        <div style={{marginTop:10,display:"flex",alignItems:"center",gap:7}}>
          <span style={{fontFamily:"'Cinzel',serif",fontSize:8,letterSpacing:2,color:"var(--text-dim)"}}>BODY WEIGHT</span>
          <input className="bwinput" type="number" min={0} value={c.bodyWeight}
            onChange={e=>updChar(p=>({...p,bodyWeight:Math.max(0,parseInt(e.target.value)||0)}))}
            style={{border:"1px solid var(--border)",borderRadius:1,padding:"2px 3px"}} disabled={c.archived}/>
          <span style={{fontSize:8,color:"var(--text-dim)"}}>lbs</span>
        </div>
      </div>

      {/* Sub-subtab nav */}
      <div className="sstabs">
        {talSubs.map(t=>(
          <button key={t.id} className={`sstab${talSub===t.id?" on":""}`} onClick={()=>setTalSub(t.id)}>{t.label}</button>
        ))}
      </div>

      {/* ── COMPETENCIES ── */}
      {talSub==="competencies"&&(
        <div>
          {c.pendingStatLevelUp&&(
            <div className="panel" style={{border:"1px solid var(--gold)",textAlign:"center",padding:"14px"}}>
              <div style={{fontFamily:"'Cinzel',serif",fontSize:9,color:"var(--gold)",letterSpacing:2,marginBottom:8}}>✦ LEVEL {c.pendingStatLevelUp} — STAT ROLL PENDING</div>
              <button className="mprimary" onClick={()=>setShowLevelUp(true)}>Open Level Up Modal</button>
            </div>
          )}
          <div className="panel">
            <div className="slabel">Competencies <span style={{fontFamily:"'IM Fell English',serif",fontStyle:"italic",fontSize:10,color:"var(--text-dim)",letterSpacing:0}}>(read-only — edited at level-up or GM Milestone)</span></div>
            <div style={{fontSize:9,color:"var(--text-dim)",fontStyle:"italic",marginBottom:8}}>↑ Proficient &nbsp;·&nbsp; ↓ Deficient &nbsp;·&nbsp; Hover for description</div>
            <CompetencyDisplay competencies={c.competencies} compMeta={c.compMeta}/>
          </div>
          {c.pendingCompLevelUp&&(
            <div className="panel" style={{border:"1px solid var(--gold-dim)",textAlign:"center",padding:"14px"}}>
              <div style={{fontFamily:"'Cinzel',serif",fontSize:9,color:"var(--gold-dim)",letterSpacing:2,marginBottom:8}}>✦ LEVEL {c.pendingCompLevelUp} — COMPETENCY POINTS PENDING</div>
              <button className="mprimary" onClick={()=>setShowLevelUp(true)}>Open Level Up Modal</button>
            </div>
          )}
        </div>
      )}

      {/* ── ABILITIES ── */}
      {talSub==="abilities"&&(
        c.cradle?(()=>{
          const chosen=c.cradleQualities||[];
          const allQualities=QUALITY_UNLOCK_LEVELS.flatMap(l=>(CRADLE_QUALITIES[c.cradle]?.[l]??[]).map(q=>({...q,unlockLevel:l})));
          return(
            <CradleQualitiesPanel
              cradleName={c.cradle}
              chosenQualities={allQualities.filter(q=>chosen.includes(q.id))}
              unavailableQualities={allQualities.filter(q=>!chosen.includes(q.id))}
            />
          );
        })():(
          <div className="panel" style={{textAlign:"center",fontSize:10,color:"var(--text-dim)",fontStyle:"italic",padding:"16px"}}>No Cradle selected.</div>
        )
      )}

      {/* ── SPELLS ── */}
      {talSub==="spells"&&(
        <div>
          {known.length===0?(
            <div className="panel" style={{textAlign:"center",fontSize:10,color:"var(--text-dim)",fontStyle:"italic",padding:"16px"}}>
              No spells known. Spells are added during character creation and level-up.
            </div>
          ):known.map(spell=>{
            const pc=spell.path==="Grace"?"var(--grace)":"var(--dread)";

            return(
              <div key={spell.id} style={{
                padding:"10px 12px",marginBottom:7,borderRadius:3,
                border:`1px solid ${pc}44`,background:`color-mix(in srgb,${pc} 4%,var(--section))`,
              }}>
                <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
                  <div style={{
                    width:22,height:22,borderRadius:"50%",flexShrink:0,
                    background:`color-mix(in srgb,${pc} 15%,transparent)`,
                    border:`1px solid ${pc}`,display:"flex",alignItems:"center",
                    justifyContent:"center",fontFamily:"'Cinzel',serif",fontSize:8,color:pc,marginTop:1,
                  }}>{spell.mana}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"baseline",gap:6,flexWrap:"wrap",marginBottom:3}}>
                      <span style={{fontFamily:"'Cinzel',serif",fontSize:10,letterSpacing:1,color:pc}}>{spell.name}</span>
                      <span style={{fontFamily:"'IM Fell English',serif",fontSize:9,color:"var(--text-dim)",fontStyle:"italic"}}>"{spell.subtitle}"</span>
                      {spell.stress>0&&<span style={{fontFamily:"'Cinzel',serif",fontSize:7,color:"var(--purple)",padding:"1px 4px",border:"1px solid var(--purple-dim)",borderRadius:1}}>+{spell.stress} Stress</span>}
                      {spell.trauma&&<span style={{fontFamily:"'Cinzel',serif",fontSize:7,color:"var(--dread)",padding:"1px 4px",border:"1px solid var(--dread-dim)",borderRadius:1}}>☠ Trauma</span>}
                    </div>
                    <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:5}}>
                      {spell.tags.map(t=><span key={t} style={{fontFamily:"'Cinzel',serif",fontSize:6,color:TAG_COLORS[t]||"var(--text-dim)",padding:"1px 4px",border:`1px solid ${TAG_COLORS[t]||"var(--border)"}`,borderRadius:1,opacity:.8}}>{t}</span>)}
                      <span style={{fontFamily:"'Cinzel',serif",fontSize:6,color:"var(--text-dim)",padding:"1px 4px",border:"1px solid var(--border)",borderRadius:1}}>{spell.range}</span>
                      <span style={{fontFamily:"'Cinzel',serif",fontSize:6,color:"var(--text-dim)",padding:"1px 4px",border:"1px solid var(--border)",borderRadius:1}}>{spell.duration}</span>
                    </div>
                    <div style={{fontSize:10,color:"var(--text-dim)",lineHeight:1.5,fontStyle:"italic",marginBottom:spell.dice?5:0}}>{spell.effect}</div>
                    {spell.dice&&<div style={{padding:"4px 8px",background:`color-mix(in srgb,${pc} 8%,transparent)`,border:`1px solid ${pc}33`,borderRadius:2,fontFamily:"'Cinzel',serif",fontSize:8,color:pc}}>⚄ {spell.dice}</div>}
                  </div>
                </div>

                {/* Cast row — always shown */}
                {(()=>{
                  const dur=parseDuration(spell);
                  const atMax=dur.type!=="instant"&&activeTimers.length>=3;
                  const alreadyActive=activeTimers.some(t=>t.spellId===spell.id);
                  const flash=castFlash?.spellId===spell.id;

                  const manaCost=spell.mana||0;
                  const stressCost=spell.stress||0;
                  const notEnoughMana=c.mana<manaCost;
                  const notEnoughStress=stressCost>0&&c.stress>=(c.stressMax); // at max stress
                  const resourceBlocked=notEnoughMana; // low mana blocks; stress warning but doesn't block

                  // Cost summary label
                  const costParts=[];
                  if(manaCost>0)costParts.push(`${manaCost} Mana`);
                  if(stressCost>0)costParts.push(`+${stressCost} Stress`);
                  if(spell.trauma)costParts.push(`+1 Trauma`);

                  // Duration label
                  const durLabel=dur.type==="instant"?"Instant":
                    dur.type==="timer"?fmtTime(dur.seconds):
                    dur.type==="counter"?`${dur.total} round${dur.total!==1?"s":""}`:
                    dur.type==="sustained"?`${dur.manaPerRound} Mana/round`:"Until end";

                  return(
                    <div style={{marginTop:7,paddingTop:6,borderTop:`1px solid ${pc}22`}}>
                      {flash?(
                        <div style={{
                          padding:"5px 12px",borderRadius:2,fontFamily:"'Cinzel',serif",fontSize:9,
                          color:pc,border:`1px solid ${pc}44`,
                          background:`color-mix(in srgb,${pc} 10%,transparent)`,
                          letterSpacing:1,textAlign:"center",animation:"slideIn .2s ease-out",
                        }}>✦ {castFlash.msg}</div>
                      ):(
                        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                          <button
                            onClick={()=>castSpell(spell,dur)}
                            disabled={resourceBlocked}
                            style={{
                              padding:"4px 14px",border:`1px solid ${resourceBlocked?"var(--border)":pc}`,borderRadius:2,
                              background:resourceBlocked?"transparent":`color-mix(in srgb,${pc} 10%,transparent)`,
                              color:resourceBlocked?"var(--text-dim)":pc,fontFamily:"'Cinzel',serif",fontSize:8,
                              letterSpacing:1,cursor:resourceBlocked?"not-allowed":"pointer",opacity:resourceBlocked?.4:1,
                            }}>
                            {dur.type==="instant"?"⚡ Cast":
                             dur.type==="timer"?"⏱ Cast + Timer":
                             dur.type==="counter"||dur.type==="sustained"?"⚄ Cast + Counter":
                             "⚔ Cast + Track"}
                          </button>

                          {/* Cost chips */}
                          {manaCost>0&&(
                            <span style={{fontFamily:"'Cinzel',serif",fontSize:8,color:notEnoughMana?"var(--dread)":"var(--grace)",display:"flex",alignItems:"center",gap:3}}>
                              <span style={{opacity:.6}}>−</span>{manaCost} Mana
                              {notEnoughMana&&<span style={{color:"var(--dread)",fontSize:7}}> (low!)</span>}
                            </span>
                          )}
                          {stressCost>0&&(
                            <span style={{fontFamily:"'Cinzel',serif",fontSize:8,color:"var(--purple)"}}>
                              +{stressCost} Stress
                            </span>
                          )}
                          {spell.trauma&&(
                            <span style={{fontFamily:"'Cinzel',serif",fontSize:8,color:"var(--dread)"}}>+1 Trauma</span>
                          )}
                          {dur.type!=="instant"&&(
                            <span style={{fontFamily:"'Cinzel',serif",fontSize:8,color:"var(--text-dim)",marginLeft:"auto"}}>{durLabel}</span>
                          )}
                          {alreadyActive&&<span style={{fontFamily:"'Cinzel',serif",fontSize:7,color:"var(--gold)"}}>timer active</span>}
                          {atMax&&!alreadyActive&&<span style={{fontFamily:"'Cinzel',serif",fontSize:7,color:"var(--dread)"}}>3/3 timers full</span>}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   SPELL PICKER — reusable modal/inline component for spell selection
   rule = {path:"Dread"|"Grace"|"any"|"chosen"|"other", maxLevel:N, tags:[...]}
   chosenPath = character's chosen path ("Grace"|"Dread")
   maxSpellLevel = class cap
   alreadyKnown = array of spell IDs already known
   onPick(spellId) called when a spell is selected
══════════════════════════════════════════════════════════════════════════════ */
function SpellPicker({rule,chosenPath,maxSpellLevel,alreadyKnown=[],onPick,onSkip,title,subtitle,allowSkip=false}){
  const[search,setSearch]=useState("");
  const[levelF,setLevelF]=useState(0);
  const[tagF,setTagF]=useState("all");
  const[sel,setSel]=useState(null);

  // Determine effective constraints
  const effectivePath=rule?.path==="chosen"?chosenPath:rule?.path==="other"?(chosenPath==="Grace"?"Dread":"Grace"):rule?.path||"any";
  const effectiveMaxLevel=Math.min(rule?.maxLevel||99,maxSpellLevel||99);
  const effectiveTags=rule?.tags||null;

  const eligible=ALL_SPELLS.filter(s=>{
    if(alreadyKnown.includes(s.id))return false;
    if(s.level>effectiveMaxLevel)return false;
    if(effectivePath!=="any"&&s.path!==effectivePath)return false;
    if(effectiveTags&&!s.tags.some(t=>effectiveTags.includes(t)))return false;
    if(levelF>0&&s.level!==levelF)return false;
    if(tagF!=="all"&&!s.tags.includes(tagF))return false;
    if(search){const q=search.toLowerCase();return s.name.toLowerCase().includes(q)||s.subtitle.toLowerCase().includes(q);}
    return true;
  });

  const byLevel={};
  eligible.forEach(s=>{byLevel[s.level]=byLevel[s.level]||[];byLevel[s.level].push(s);});

  const pathLabel=effectivePath==="any"?"Any Path":effectivePath==="Grace"?"Path of Grace":"Path of Dread";
  const pathCol=effectivePath==="Grace"?"var(--grace)":effectivePath==="Dread"?"var(--dread)":"var(--gold)";

  return(
    <div>
      {/* Header info */}
      <div style={{padding:"8px 12px",background:"var(--ink)",border:"1px solid var(--border)",borderRadius:2,marginBottom:10}}>
        <div style={{fontFamily:"'Cinzel',serif",fontSize:8,letterSpacing:2,color:"var(--gold-dim)",marginBottom:4}}>{title||"SELECT A SPELL"}</div>
        {subtitle&&<div style={{fontSize:10,color:"var(--text-dim)",fontStyle:"italic",marginBottom:6}}>{subtitle}</div>}
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <span style={{fontFamily:"'Cinzel',serif",fontSize:8,color:pathCol}}>Path: {pathLabel}</span>
          <span style={{fontFamily:"'Cinzel',serif",fontSize:8,color:"var(--text-dim)"}}>Max Level: {effectiveMaxLevel}</span>
          {effectiveTags&&<span style={{fontFamily:"'Cinzel',serif",fontSize:8,color:"var(--text-dim)"}}>Tags: {effectiveTags.join(" or ")}</span>}
          <span style={{fontFamily:"'Cinzel',serif",fontSize:8,color:"var(--text-dim)"}}>{eligible.length} eligible</span>
        </div>
      </div>

      {/* Filters */}
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…"
        style={{width:"100%",background:"transparent",border:"none",borderBottom:"1px solid var(--border)",
          color:"var(--text)",fontFamily:"'IM Fell English',serif",fontSize:12,outline:"none",padding:"3px 0",marginBottom:8}}/>
      <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:10}}>
        {[0,...Array.from({length:effectiveMaxLevel},(_,i)=>i+1)].map(l=>(
          <button key={l} onClick={()=>setLevelF(l===levelF?0:l)} style={{
            padding:"2px 6px",border:`1px solid ${levelF===l?pathCol:"var(--border)"}`,borderRadius:1,
            background:levelF===l?`color-mix(in srgb,${pathCol} 12%,transparent)`:"transparent",
            color:levelF===l?pathCol:"var(--text-dim)",fontFamily:"'Cinzel',serif",fontSize:7,cursor:"pointer",
          }}>{l===0?"All":l}</button>
        ))}
      </div>

      {/* Spell list */}
      <div style={{maxHeight:320,overflowY:"auto",display:"flex",flexDirection:"column",gap:5,paddingRight:2}}>
        {Object.keys(byLevel).sort((a,b)=>a-b).map(lvl=>(
          <div key={lvl}>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:7,letterSpacing:2,color:"var(--gold-dim)",padding:"4px 0 3px",borderBottom:"1px solid var(--border)",marginBottom:4}}>
              LEVEL {lvl}{parseInt(lvl)>=10?" ☠":""}
            </div>
            {byLevel[lvl].map(spell=>{
              const isSel=sel===spell.id;
              const pc=spell.path==="Grace"?"var(--grace)":"var(--dread)";
              return(
                <div key={spell.id} onClick={()=>setSel(isSel?null:spell.id)} style={{
                  padding:"8px 10px",borderRadius:2,cursor:"pointer",
                  border:`1px solid ${isSel?pc:"var(--border)"}`,
                  background:isSel?`color-mix(in srgb,${pc} 8%,transparent)`:"var(--section)",
                  transition:"all .15s",
                }}>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:isSel?4:0}}>
                    <div style={{
                      width:14,height:14,borderRadius:"50%",flexShrink:0,
                      border:`2px solid ${isSel?pc:"var(--border)"}`,
                      background:isSel?pc:"transparent",transition:"all .15s",
                    }}/>
                    <span style={{fontFamily:"'Cinzel',serif",fontSize:9,letterSpacing:1,color:isSel?pc:"var(--text)",flex:1}}>{spell.name}</span>
                    <span style={{fontFamily:"'IM Fell English',serif",fontSize:9,color:"var(--text-dim)",fontStyle:"italic"}}>"{spell.subtitle}"</span>
                    <span style={{fontFamily:"'Cinzel',serif",fontSize:7,color:pc,padding:"1px 4px",border:`1px solid ${pc}44`,borderRadius:1,flexShrink:0}}>{spell.path==="Grace"?"GRC":"DRD"} {spell.level}</span>
                  </div>
                  {isSel&&(
                    <div style={{paddingLeft:20}}>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:4}}>
                        {spell.tags.map(t=><span key={t} style={{fontFamily:"'Cinzel',serif",fontSize:6,color:TAG_COLORS[t]||"var(--text-dim)",padding:"1px 4px",border:`1px solid ${TAG_COLORS[t]||"var(--border)"}`,borderRadius:1}}>{t}</span>)}
                        <span style={{fontFamily:"'Cinzel',serif",fontSize:6,color:"var(--text-dim)",padding:"1px 4px",border:"1px solid var(--border)",borderRadius:1}}>{spell.range}</span>
                        {spell.stress>0&&<span style={{fontFamily:"'Cinzel',serif",fontSize:6,color:"var(--purple)",padding:"1px 4px",border:"1px solid var(--purple-dim)",borderRadius:1}}>+{spell.stress} Stress</span>}
                      </div>
                      <div style={{fontSize:9,color:"var(--text-dim)",lineHeight:1.5,fontStyle:"italic"}}>{spell.effect.slice(0,160)}{spell.effect.length>160?"…":""}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {eligible.length===0&&<div style={{textAlign:"center",padding:"14px",fontSize:10,color:"var(--text-dim)",fontStyle:"italic"}}>No eligible spells found.</div>}
      </div>

      <div style={{display:"flex",gap:7,marginTop:12}}>
        <button onClick={()=>{if(sel)onPick(sel);}} disabled={!sel} style={{
          flex:1,padding:"8px",border:`1px solid ${sel?pathCol:"var(--border)"}`,borderRadius:2,
          background:sel?`color-mix(in srgb,${pathCol} 10%,transparent)`:"transparent",
          color:sel?pathCol:"var(--text-dim)",fontFamily:"'Cinzel',serif",fontSize:9,
          letterSpacing:1,cursor:sel?"pointer":"not-allowed",opacity:sel?1:.5,
        }}>✦ Add to Spellbook</button>
        {allowSkip&&<button onClick={onSkip} style={{
          padding:"8px 14px",border:"1px solid var(--border)",borderRadius:2,
          background:"transparent",color:"var(--text-dim)",fontFamily:"'Cinzel',serif",fontSize:9,cursor:"pointer",
        }}>Skip</button>}
      </div>
    </div>
  );
}

function CharWizard({onComplete,onCancel}){
  const[step,setStep]=useState("basics");
  const[d,setD]=useState({
    name:"",height:"",weight:150,eyeColor:"",hair:"",features:"",
    motivation:"",values:"",
    cradle:"",path:"",
    stats:{mind:0,body:0,soul:0},diceRolls:null,diceAssigned:{mind:null,body:null,soul:null},
    statRollDone:false,
    cls:"",community:null,
    convictions:[],
    chronicles:[
      {type:"positive",backstory:"",competency:""},
      {type:"positive",backstory:"",competency:""},
      {type:"negative",backstory:"",competency:""},
    ],
    weapon:"",personalItem:"",cradleQuality:"",knownSpells:[],
  });
  const upd=(f,v)=>setD(x=>({...x,[f]:v}));
  const next=()=>{const i=STEPS.indexOf(step);if(i<STEPS.length-1)setStep(STEPS[i+1]);};
  const back=()=>{const i=STEPS.indexOf(step);if(i>0)setStep(STEPS[i-1]);};
  const sidx=STEPS.indexOf(step);

  // Build starting inventory
  const buildInventory=(comm,weaponName)=>{
    const isMillitary=comm?.name==="Military";
    const w=CRUDE_WEAPONS.find(x=>x.name===weaponName);
    const dispName=isMillitary&&w?w.name.replace("Crude","Standard"):w?.name;
    const primary=[];
    const auxiliary=[];
    // Weapon
    if(w) primary.push({id:uid(),name:dispName,qty:1,weight:w.weight||2,notes:`${w.damage} · ${w.notes}`});
    // Starting gear
    STARTING_GEAR_FIXED.forEach(g=>primary.push({id:uid(),name:g.name,qty:g.qty,weight:g.weight,notes:g.notes}));
    // Clothes
    if(comm) primary.push({id:uid(),name:comm.clothes,qty:1,weight:1,notes:"Starting attire"});
    // Armor
    if(isMillitary) primary.push({id:uid(),name:"Leather Armor",qty:1,weight:5,notes:"Starting armor (Military)"});
    // Bag goes to appropriate slot
    if(comm?.bag.type==="auxiliary") auxiliary.push({id:uid(),name:comm.bag.name,qty:1,weight:1,notes:`Auxiliary bag — ${comm.bag.units} unit capacity`});
    return{primary,auxiliary};
  };

  // Build journal entries from chronicles
  const buildJournal=chronicles=>chronicles.map((ch,i)=>({
    id:uid(),
    title:ch.type==="positive"?`Chronicle ${i+1} — ${ALL_COMP.find(c=>c.key===ch.competency)?.name||"?"}`:
          `Negative Chronicle — ${ALL_COMP.find(c=>c.key===ch.competency)?.name||"?"}`,
    body:ch.backstory,
    readonly:true,
  }));

  const buildChar=()=>{
    const comm=d.community;
    const sb=comm?.statBonus??{};
    const stats={mind:d.stats.mind+(sb.mind||0),body:d.stats.body+(sb.body||0),soul:d.stats.soul+(sb.soul||0)};
    const comps=initComps();
    const meta=initCompMeta();
    // Convictions
    d.convictions.forEach(cvName=>{
      const cv=ALL_CONVICTIONS.find(c=>c.name===cvName);
      if(cv&&comps[cv.comp]!==undefined) comps[cv.comp]+=2;
    });
    // Chronicles
    d.chronicles.forEach(ch=>{
      if(!ch.competency||comps[ch.competency]===undefined)return;
      if(ch.type==="positive"){comps[ch.competency]+=2;meta[ch.competency]="proficient";}
      else{comps[ch.competency]-=2;meta[ch.competency]="deficient";}
    });
    const{primary,auxiliary}=buildInventory(comm,d.weapon);
    const journalEntries=buildJournal(d.chronicles);
    return{d,stats,comps,meta,primary,auxiliary,journalEntries,community:comm,knownSpells:d.knownSpells||[]};
  };

  return(
    <div className="moverlay" onClick={e=>e.target===e.currentTarget&&onCancel()}>
      <div className="modal wide">
        <WizardProg step={step}/>
        <div className="mtitle">Character Creation</div>
        <div className="mstep">Step {sidx+1} of {STEPS.length} — {STEP_LABELS[sidx]}</div>

        {step==="basics"&&(
          <div>
            <div className="slabel" style={{marginBottom:6}}>Name</div>
            <input className="cname" value={d.name} onChange={e=>upd("name",e.target.value)} placeholder="What name do they carry through the fog of the Tether?" style={{marginBottom:16}}/>
            <div className="slabel" style={{marginBottom:6}}>Physical Attributes</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
              {[["height","Height","e.g. 5'10\""],["eyeColor","Eye Color","e.g. Amber"],["hair","Hair","e.g. Long black"],["features","Notable Features","Scars, tattoos…"]].map(([k,l,ph])=>(
                <div className="id-field" key={k}><div className="id-label">{l}</div><input className="id-input" value={d[k]} onChange={e=>upd(k,e.target.value)} placeholder={ph}/></div>
              ))}
            </div>
            <div className="id-field" style={{marginBottom:16}}>
              <div className="id-label">Body Weight (lbs — affects encumbrance)</div>
              <input type="number" className="id-input" value={d.weight} min={0} onChange={e=>upd("weight",parseInt(e.target.value)||0)} style={{width:80}}/>
            </div>
            <div className="slabel" style={{marginBottom:6}}>Brief Summary</div>
            <div className="id-field" style={{marginBottom:8}}><div className="id-label">What motivates them?</div><textarea className="chronicle-textarea" value={d.motivation} onChange={e=>upd("motivation",e.target.value)} placeholder="Gold, revenge, a cure, loyalty…" rows={2}/></div>
            <div className="id-field" style={{marginBottom:16}}><div className="id-label">Core values or beliefs?</div><textarea className="chronicle-textarea" value={d.values} onChange={e=>upd("values",e.target.value)} placeholder="Collective good, survival, honor…" rows={2}/></div>
            <button className="mprimary" onClick={next} disabled={!d.name.trim()}>Continue →</button>
            <button className="msec" onClick={onCancel}>Cancel</button>
          </div>
        )}

        {step==="cradle"&&(
          <div>
            <div className="mbody">Choose your Cradle — the race that shapes your body and soul.</div>

            {/* Cradle selector grid */}
            <div className="opt-grid cols2" style={{marginBottom:14}}>
              {CRADLES.map(cr=>{
                const cd=CRADLE_DATA[cr];
                return(
                  <button key={cr} className={`opt-btn${d.cradle===cr?" sel":""}`}
                    onClick={()=>{upd("cradle",cr);upd("cradleQuality","");}}
                    style={{textAlign:"left",padding:"9px 12px"}}>
                    <div style={{fontFamily:"'Cinzel',serif",fontSize:10,letterSpacing:1,color:d.cradle===cr?"var(--gold)":"var(--text)",marginBottom:2}}>{cr}</div>
                    {cd&&<div style={{fontSize:9,color:"var(--text-dim)",fontStyle:"italic",lineHeight:1.4}}>{cd.identity}</div>}
                  </button>
                );
              })}
            </div>

            {/* Selected cradle details */}
            {d.cradle&&(()=>{
              const cd=CRADLE_DATA[d.cradle];
              if(!cd)return null;
              return(
                <div>
                  <div style={{padding:"10px 12px",border:"1px solid var(--border)",borderRadius:2,background:"var(--section)",marginBottom:10,fontSize:11,color:"var(--text-dim)",lineHeight:1.6,fontStyle:"italic"}}>
                    {cd.lore}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                    <div style={{background:"var(--section)",border:"1px solid var(--border)",borderRadius:2,padding:"10px 12px"}}>
                      <div style={{fontFamily:"'Cinzel',serif",fontSize:8,letterSpacing:2,color:"var(--gold-dim)",marginBottom:8}}>BEGINNING STATS</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
                        {[["HP",cd.stats.hp,"#8b1a1a"],["Stress",cd.stats.stress,"var(--purple)"],["Mana",cd.stats.mana,"var(--grace)"],["Armor",cd.stats.armor,"var(--gold)"]].map(([k,v,c])=>(
                          <div key={k} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"3px 6px",background:"var(--ink)",borderRadius:1}}>
                            <span style={{fontFamily:"'Cinzel',serif",fontSize:8,color:"var(--text-dim)"}}>{k}</span>
                            <span style={{fontFamily:"'Cinzel Decorative',serif",fontSize:14,color:c}}>{v}</span>
                          </div>
                        ))}
                      </div>
                      {cd.flexPoint&&<div style={{marginTop:6,fontSize:9,color:"var(--gold)",fontStyle:"italic",fontFamily:"'Cinzel',serif"}}>+1 Flex Point (assign to any stat)</div>}
                    </div>
                    <div style={{background:"var(--section)",border:"1px solid var(--border)",borderRadius:2,padding:"10px 12px"}}>
                      <div style={{fontFamily:"'Cinzel',serif",fontSize:8,letterSpacing:2,color:"var(--gold-dim)",marginBottom:8}}>CRIT ABILITY</div>
                      <div style={{fontSize:10,color:"var(--text)",lineHeight:1.6}}>{cd.crit}</div>
                    </div>
                  </div>
                  <div style={{background:"var(--section)",border:"1px solid var(--border)",borderRadius:2,padding:"10px 12px",marginBottom:14}}>
                    <div style={{fontFamily:"'Cinzel',serif",fontSize:8,letterSpacing:2,color:"var(--gold-dim)",marginBottom:8}}>CORE RACIAL FEATURES</div>
                    {cd.features.map((f,i)=>(
                      <div key={i} style={{marginBottom:i<cd.features.length-1?8:0,paddingBottom:i<cd.features.length-1?8:0,borderBottom:i<cd.features.length-1?"1px solid rgba(74,53,32,.3)":"none"}}>
                        <div style={{fontFamily:"'Cinzel',serif",fontSize:9,letterSpacing:1,color:"var(--gold)",marginBottom:2}}>{f.name}</div>
                        <div style={{fontSize:10,color:"var(--text-dim)",lineHeight:1.5}}>{f.desc}</div>
                      </div>
                    ))}
                  </div>
                  <div className="slabel" style={{marginBottom:8}}>Level 1 Cradle Quality — Choose One</div>
                  {(CRADLE_QUALITIES[d.cradle]?.[1]??[]).map(q=>(
                    <div key={q.id} onClick={()=>upd("cradleQuality",q.id)} style={{
                      padding:"10px 12px",marginBottom:7,borderRadius:2,cursor:"pointer",transition:"all .15s",
                      border:`1px solid ${d.cradleQuality===q.id?"var(--gold)":"var(--border)"}`,
                      background:d.cradleQuality===q.id?"rgba(200,149,42,.07)":"var(--section)",
                    }}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                        <div style={{width:14,height:14,borderRadius:"50%",flexShrink:0,transition:"all .15s",
                          border:`2px solid ${d.cradleQuality===q.id?"var(--gold)":"var(--border)"}`,
                          background:d.cradleQuality===q.id?"var(--gold)":"transparent"}}/>
                        <div style={{fontFamily:"'Cinzel',serif",fontSize:10,letterSpacing:1,color:d.cradleQuality===q.id?"var(--gold)":"var(--text)"}}>{q.label}</div>
                      </div>
                      <div style={{fontSize:10,color:"var(--text-dim)",lineHeight:1.5,fontStyle:"italic",paddingLeft:22}}>{q.desc}</div>
                    </div>
                  ))}
                </div>
              );
            })()}

            <button className="mprimary" onClick={next} disabled={!d.cradle||!d.cradleQuality}>Continue →</button>
            <button className="msec" onClick={back}>← Back</button>
          </div>
        )}

        {step==="path"&&(
          <div>
            <div className="mbody">Choose your path. This determines how the universe reacts to your soul.</div>
            <div className="opt-grid cols2" style={{marginBottom:14}}>
              <button className={`opt-btn${d.path==="grace"?" sel-grace":""}`} onClick={()=>upd("path","grace")} style={{padding:16,textAlign:"left"}}>
                <div style={{fontFamily:"'Cinzel',serif",fontSize:11,color:d.path==="grace"?"var(--grace)":"var(--text)",marginBottom:6,letterSpacing:1}}>PATH OF GRACE</div>
                <div style={{fontSize:10,color:"var(--text-dim)",lineHeight:1.5,fontStyle:"italic"}}>Maxing Grace → <span style={{color:"var(--grace)"}}>Inspiration</span>.<br/>Maxing Dread → <span style={{color:"var(--dread)"}}>Trauma</span>.<br/>Power from hope and connection.</div>
              </button>
              <button className={`opt-btn${d.path==="dread"?" sel-dread":""}`} onClick={()=>upd("path","dread")} style={{padding:16,textAlign:"left"}}>
                <div style={{fontFamily:"'Cinzel',serif",fontSize:11,color:d.path==="dread"?"var(--dread)":"var(--text)",marginBottom:6,letterSpacing:1}}>PATH OF DREAD</div>
                <div style={{fontSize:10,color:"var(--text-dim)",lineHeight:1.5,fontStyle:"italic"}}>Maxing Dread → <span style={{color:"var(--grace)"}}>Inspiration</span>.<br/>Maxing Grace → <span style={{color:"var(--dread)"}}>Trauma</span>.<br/>Power from surviving darkness.</div>
              </button>
            </div>
            <button className="mprimary" onClick={next} disabled={!d.path}>Continue →</button>
            <button className="msec" onClick={back}>← Back</button>
          </div>
        )}

        {step==="stats"&&<WizStepStats d={d} upd={upd} next={next} back={back}/>}

        {step==="class"&&(
          <div>
            <div className="mbody">Choose your Class. Subclass (level 3) and Specialization (level 8) unlock during play.</div>
            <div className="opt-grid cols2" style={{marginBottom:14}}>
              {CLASS_DATA.map(c=>(
                <button key={c.name} className={`opt-btn${d.cls===c.name?" sel":""}`} onClick={()=>upd("cls",c.name)}>
                  {c.name}<span className="opt-sub">{c.subclasses.map(s=>s.name).join(" · ")}</span>
                </button>
              ))}
            </div>
            <div style={{padding:"8px 10px",border:"1px solid var(--border)",borderRadius:2,background:"var(--section)",fontSize:10,color:"var(--text-dim)",fontStyle:"italic",marginBottom:14}}>✦ Class Abilities (choose 2) will be available in a future update.</div>
            <button className="mprimary" onClick={next} disabled={!d.cls}>Continue →</button>
            <button className="msec" onClick={back}>← Back</button>
          </div>
        )}

        {step==="community"&&<WizStepCommunity d={d} upd={upd} next={next} back={back}/>}
        {step==="convictions"&&<WizStepConvictions d={d} upd={upd} next={next} back={back}/>}
        {step==="chronicles"&&<WizStepChronicles d={d} upd={upd} next={next} back={back}/>}
        {step==="weapon"&&<WizStepWeapon d={d} upd={upd} next={next} back={back}/>}
        {step==="spells"&&<WizStepSpells d={d} upd={upd} next={next} back={back}/>}
        {step==="review"&&<WizStepReview d={d} upd={upd} onComplete={()=>onComplete(buildChar())} back={back}/>}
      </div>
    </div>
  );
}

function WizStepStats({d,upd,next,back}){
  const rollDice=()=>{
    if(d.statRollDone)return;
    const rolls=[Math.ceil(Math.random()*6),Math.ceil(Math.random()*6),Math.ceil(Math.random()*6)];
    upd("diceRolls",rolls);
    upd("diceAssigned",{mind:null,body:null,soul:null});
    upd("stats",{mind:0,body:0,soul:0});
  };
  const{diceRolls,diceAssigned,statRollDone}=d;
  const assignDie=(stat,idx)=>{
    const prev={...diceAssigned};
    Object.keys(prev).forEach(s=>{if(prev[s]===idx)prev[s]=null;});
    prev[stat]=prev[stat]===idx?null:idx;
    upd("diceAssigned",prev);
    const ns={mind:0,body:0,soul:0};
    Object.entries(prev).forEach(([s,i])=>{if(i!==null)ns[s]=diceRolls[i];});
    upd("stats",ns);
  };
  const allAssigned=diceRolls&&Object.values(diceAssigned).every(v=>v!==null);
  const handleNext=()=>{upd("statRollDone",true);next();};
  return(
    <div>
      <div className="mbody">Roll 3d6. Assign each die value to Mind, Body, or Soul. You may only roll once.</div>
      {!diceRolls?(
        <button className="mprimary" onClick={rollDice} disabled={statRollDone}>Roll 3d6</button>
      ):(
        <>
          <div className="dice-row">
            {diceRolls.map((v,i)=>{
              const usedBy=Object.entries(diceAssigned).find(([,idx])=>idx===i);
              return(
                <div key={i} className="die-card" style={{border:usedBy?"1px solid var(--gold)":"1px solid var(--border)"}}>
                  <div className="die-lbl">Die {i+1}{usedBy?` → ${usedBy[0].toUpperCase()}`:""}</div>
                  <div className="die-val" style={{color:usedBy?"var(--gold)":"var(--text)"}}>{v}</div>
                </div>
              );
            })}
          </div>
          <div style={{fontSize:10,color:"var(--text-dim)",fontStyle:"italic",textAlign:"center",marginBottom:10}}>Click a die value below to assign it to a stat</div>
          <div className="alloc-grid" style={{marginBottom:14}}>
            {[["mind","Mind"],["body","Body"],["soul","Soul"]].map(([k,l])=>(
              <div className="alloc-card" key={k}>
                <div className="alloc-name">{l}</div>
                <div className="alloc-val">{d.stats[k]||"—"}</div>
                <div style={{fontSize:9,color:"var(--text-dim)",marginTop:2,fontStyle:"italic"}}>{d.stats[k]?modStr(d.stats[k]):""}</div>
                <div className="rbtnrow" style={{marginTop:6}}>
                  {diceRolls.map((v,i)=>{
                    const assignedTo=Object.entries(diceAssigned).find(([,idx])=>idx===i)?.[0];
                    const assignedHere=diceAssigned[k]===i;
                    const taken=assignedTo&&assignedTo!==k;
                    return(
                      <button key={i} className="rbtn" onClick={()=>assignDie(k,i)}
                        style={{width:24,fontSize:10,opacity:taken?.3:1,background:assignedHere?"rgba(200,149,42,.15)":"var(--ink)",borderColor:assignedHere?"var(--gold-dim)":"var(--border)"}}
                        disabled={taken} title={`Assign ${v} to ${l}`}>{v}</button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {statRollDone&&<div style={{fontSize:9,color:"var(--text-dim)",fontStyle:"italic",textAlign:"center",marginBottom:8}}>Stats locked — roll used.</div>}
        </>
      )}
      <button className="mprimary" onClick={handleNext} disabled={!allAssigned||statRollDone&&!allAssigned}>Continue →</button>
      <button className="msec" onClick={back}>← Back</button>
    </div>
  );
}

function WizStepCommunity({d,upd,next,back}){
  const sel=d.community;
  return(
    <div>
      <div className="mbody">Your Community shapes your starting resources, equipment, and stat bonuses.</div>
      <div style={{display:"flex",flexDirection:"column",gap:7,marginBottom:14}}>
        {COMMUNITIES.map(c=>{
          const isSel=sel?.name===c.name;
          const bonus=Object.entries(c.statBonus).map(([k,v])=>`+${v} ${k.charAt(0).toUpperCase()+k.slice(1)}`).join(", ");
          return(
            <button key={c.name} className={`opt-btn${isSel?" sel":""}`} onClick={()=>upd("community",c)} style={{textAlign:"left",padding:"10px 12px"}}>
              <div style={{fontFamily:"'Cinzel',serif",fontSize:10,letterSpacing:1,color:isSel?"var(--gold)":"var(--text)",marginBottom:3}}>{c.name}</div>
              <div style={{fontSize:9,color:"var(--text-dim)",lineHeight:1.5}}>
                {c.gold>0?`${c.gold} ${c.goldUnit}`:"No money"} · {bonus} · {c.bag.name} ({c.bag.units} units)
                {c.note&&<><br/><em>{c.note}</em></>}
              </div>
            </button>
          );
        })}
      </div>
      <button className="mprimary" onClick={next} disabled={!sel}>Continue →</button>
      <button className="msec" onClick={back}>← Back</button>
    </div>
  );
}

function WizStepConvictions({d,upd,next,back}){
  const toggle=name=>{
    const cur=d.convictions;
    if(cur.includes(name))upd("convictions",cur.filter(n=>n!==name));
    else if(cur.length<2)upd("convictions",[...cur,name]);
  };
  return(
    <div>
      <div className="mbody">Choose 2 Convictions. Each grants +2 to its Competency and a unique perk.</div>
      <div style={{fontSize:10,color:"var(--gold)",fontFamily:"'Cinzel',serif",letterSpacing:1,textAlign:"center",marginBottom:10}}>{d.convictions.length} / 2 selected</div>
      {Object.entries(CONVICTIONS).map(([stat,list])=>(
        <div key={stat} style={{marginBottom:14}}>
          <div className="comp-section-hdr" style={{fontFamily:"'Cinzel',serif",fontSize:8,letterSpacing:3,marginBottom:7,paddingBottom:4,borderBottom:"1px solid var(--border)",color:stat==="Body"?"var(--dread)":stat==="Mind"?"var(--grace)":"var(--purple)"}}>{stat.toUpperCase()} CONVICTIONS</div>
          {list.map(cv=>{
            const isSel=d.convictions.includes(cv.name);
            const disabled=!isSel&&d.convictions.length>=2;
            return(
              <div key={cv.name} className={`conv-card${isSel?" sel":""}`} onClick={()=>!disabled&&toggle(cv.name)} style={{opacity:disabled?.4:1}}>
                <div className="conv-name">{cv.name}</div>
                <div className="conv-comp">{ALL_COMP.find(c=>c.key===cv.comp)?.name||cv.comp} +2</div>
                <div className="conv-perk">{cv.perk}</div>
              </div>
            );
          })}
        </div>
      ))}
      <button className="mprimary" onClick={next} disabled={d.convictions.length<2}>Continue →</button>
      <button className="msec" onClick={back}>← Back</button>
    </div>
  );
}

function WizStepChronicles({d,upd,next,back}){
  const needExtra=d.community?.name==="Military";
  const positiveCount=needExtra?1:2;
  const chronicles=d.chronicles;
  const ensured=()=>{
    const pos=Array.from({length:2},(_,i)=>chronicles[i]||{type:"positive",backstory:"",competency:""});
    const negs=needExtra?[
      chronicles[2]||{type:"negative",backstory:"",competency:""},
      chronicles[3]||{type:"negative",backstory:"",competency:""},
    ]:[chronicles[2]||{type:"negative",backstory:"",competency:""}];
    return[...pos.slice(0,positiveCount),...negs];
  };
  const chrons=ensured();
  const updCh=(idx,field,val)=>{const n=chrons.map((c,i)=>i===idx?{...c,[field]:val}:c);upd("chronicles",n);};
  const isComplete=chrons.every(c=>c.backstory.trim()&&c.competency);
  return(
    <div>
      <div className="mbody">Create your Chronicles — lived experiences that shaped your Competencies. These will become Journal entries.{needExtra&&<span style={{color:"var(--dread)"}}> Military: 2 negative chronicles.</span>}</div>
      {chrons.map((ch,idx)=>{
        const isPos=ch.type==="positive";
        return(
          <div className="chronicle-item" key={idx}>
            <div className={`chronicle-type ${isPos?"chronicle-pos":"chronicle-neg"}`}>{isPos?`✦ Chronicle ${idx+1} — Positive (+2 competency)`:`✦ Negative Chronicle (−2 competency)`}</div>
            <textarea className="chronicle-textarea" value={ch.backstory} onChange={e=>updCh(idx,"backstory",e.target.value)} placeholder={isPos?"Describe a formative experience that strengthened this skill…":"Describe an experience that left a lasting weakness…"} rows={3}/>
            <div className="id-label" style={{marginBottom:4}}>Linked Competency</div>
            <select className="id-select" value={ch.competency} onChange={e=>updCh(idx,"competency",e.target.value)}>
              <option value="">— Select Competency —</option>
              {Object.entries(COMPETENCIES).map(([stat,list])=>(
                <optgroup key={stat} label={`${stat} Competencies`}>
                  {list.map(c=><option key={c.key} value={c.key}>{c.name}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        );
      })}
      <button className="mprimary" onClick={next} disabled={!isComplete}>Continue →</button>
      <button className="msec" onClick={back}>← Back</button>
    </div>
  );
}

function WizStepWeapon({d,upd,next,back}){
  const isMil=d.community?.name==="Military";
  return(
    <div>
      <div className="mbody">Choose your starting weapon.{isMil&&<span style={{color:"var(--gold)"}}> Military: Standard weapon (+2 fracture max).</span>}</div>
      {CRUDE_WEAPONS.map(w=>{
        const isSel=d.weapon===w.name;
        const displayName=isMil?w.name.replace("Crude","Standard"):w.name;
        const frac=isMil&&typeof w.fractures==="number"?w.fractures+2:w.fractures;
        return(
          <div key={w.name} className={`weapon-card${isSel?" sel":""}`} onClick={()=>upd("weapon",w.name)}>
            <div className="weapon-name"><span>{displayName}</span><span style={{fontSize:9,color:"var(--text-dim)"}}>{w.hands===1?"1H":w.hands===2?"2H":"1H/2H"}</span></div>
            <div className="weapon-stats">DMG: {w.damage} · Fractures: {frac}</div>
            <div className="weapon-notes">{w.notes}</div>
          </div>
        );
      })}
      <button className="mprimary" onClick={next} disabled={!d.weapon}>Continue →</button>
      <button className="msec" onClick={back}>← Back</button>
    </div>
  );
}

function WizStepSpells({d,upd,next,back}){
  const cls=d.cls?.name||d.cls||"";
  const path=d.path==="grace"?"Grace":d.path==="dread"?"Dread":"Grace";
  const cradle=d.cradle||"";

  const prog=SPELL_PROGRESSION[cls];
  const cradleBonus=CRADLE_SPELL_BONUS[cradle]||0;
  // Class bonus at level 1 (Resonant/Witch get extra)
  const classStartBonus=(cls==="Witch"||cls==="Resonant")?1:0;
  const totalSlots=1+cradleBonus+classStartBonus; // starting slots

  const knownSpells=d.knownSpells||[];
  const slotsLeft=totalSlots-knownSpells.length;

  const maxLevel=prog?.maxSpellLevel||6;
  // Starting rule: chosen path, max level based on class, no tag restriction
  const startRule={path:"chosen",maxLevel:Math.min(maxLevel,4),tags:null};

  const pickSpell=spellId=>{
    if(knownSpells.includes(spellId))return;
    upd("knownSpells",[...knownSpells,spellId]);
  };
  const removeSpell=spellId=>{
    upd("knownSpells",knownSpells.filter(id=>id!==spellId));
  };

  const knownSpellObjs=knownSpells.map(id=>ALL_SPELLS.find(s=>s.id===id)).filter(Boolean);

  return(
    <div>
      <div className="mbody">
        Choose your starting spells. Your class, cradle, and path determine how many you begin with.
      </div>

      {/* Slot summary */}
      <div style={{display:"flex",gap:6,alignItems:"center",padding:"8px 12px",border:"1px solid var(--gold-dim)",borderRadius:2,background:"rgba(200,149,42,.05)",marginBottom:12,flexWrap:"wrap"}}>
        <div style={{fontFamily:"'Cinzel',serif",fontSize:9,color:"var(--gold)",letterSpacing:1}}>Starting Slots:</div>
        <div style={{display:"flex",gap:4}}>
          {Array.from({length:totalSlots},(_,i)=>(
            <div key={i} style={{width:14,height:14,borderRadius:"50%",border:`2px solid ${i<knownSpells.length?"var(--gold)":"var(--border)"}`,background:i<knownSpells.length?"var(--gold)":"transparent"}}/>
          ))}
        </div>
        <span style={{fontFamily:"'Cinzel',serif",fontSize:8,color:"var(--text-dim)"}}>{knownSpells.length}/{totalSlots} chosen</span>
        <div style={{marginLeft:"auto",display:"flex",gap:8,fontSize:8,color:"var(--text-dim)",fontFamily:"'Cinzel',serif",flexWrap:"wrap"}}>
          <span>Class: {cls||"—"}</span>
          <span>Path: {path}</span>
          <span>Cradle: {cradle||"—"}</span>
        </div>
      </div>

      {/* Slot breakdown */}
      <div style={{marginBottom:12,fontSize:9,color:"var(--text-dim)",lineHeight:1.7,padding:"6px 10px",background:"var(--section)",border:"1px solid var(--border)",borderRadius:2}}>
        <span style={{fontFamily:"'Cinzel',serif",fontSize:7,letterSpacing:2,color:"var(--gold-dim)",display:"block",marginBottom:4}}>WHY {totalSlots} SLOT{totalSlots!==1?"S":""}?</span>
        Base: 1 spell (all classes)
        {cradleBonus>0&&<span> · +{cradleBonus} ({cradle} cradle bonus)</span>}
        {classStartBonus>0&&<span> · +{classStartBonus} (Resonant class bonus)</span>}
      </div>

      {/* Chosen spells */}
      {knownSpellObjs.length>0&&(
        <div style={{marginBottom:12}}>
          <div style={{fontFamily:"'Cinzel',serif",fontSize:8,letterSpacing:2,color:"var(--gold-dim)",marginBottom:6}}>CHOSEN SPELLS</div>
          {knownSpellObjs.map(spell=>{
            const pc=spell.path==="Grace"?"var(--grace)":"var(--dread)";
            return(
              <div key={spell.id} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",marginBottom:5,border:`1px solid ${pc}44`,borderRadius:2,background:`color-mix(in srgb,${pc} 5%,transparent)`}}>
                <div style={{flex:1}}>
                  <span style={{fontFamily:"'Cinzel',serif",fontSize:9,color:pc}}>{spell.name}</span>
                  <span style={{fontFamily:"'IM Fell English',serif",fontSize:9,color:"var(--text-dim)",fontStyle:"italic",marginLeft:6}}>"{spell.subtitle}"</span>
                  <span style={{fontFamily:"'Cinzel',serif",fontSize:7,color:"var(--text-dim)",marginLeft:6}}>Lvl {spell.level} · {spell.path}</span>
                </div>
                <button onClick={()=>removeSpell(spell.id)} style={{background:"transparent",border:"none",color:"var(--text-dim)",cursor:"pointer",fontSize:11,padding:"0 3px"}}>✕</button>
              </div>
            );
          })}
        </div>
      )}

      {/* Picker — only if slots remain */}
      {slotsLeft>0?(
        <SpellPicker
          rule={startRule}
          chosenPath={path}
          maxSpellLevel={Math.min(maxLevel,4)}
          alreadyKnown={knownSpells}
          onPick={spellId=>pickSpell(spellId)}
          title={`PICK SPELL ${knownSpells.length+1} OF ${totalSlots}`}
          subtitle={`${path} path · Max Level ${Math.min(maxLevel,4)} · ${slotsLeft} slot${slotsLeft!==1?"s":""} remaining`}
        />
      ):(
        <div style={{padding:"12px",border:"1px solid var(--grace-dim)",borderRadius:2,background:"rgba(106,179,200,.05)",textAlign:"center",fontSize:10,color:"var(--grace)",fontFamily:"'Cinzel',serif",letterSpacing:1}}>
          ✦ All spell slots filled
        </div>
      )}

      <button className="mprimary" onClick={next} disabled={knownSpells.length<totalSlots} style={{marginTop:12}}>
        {knownSpells.length<totalSlots?`Choose all ${totalSlots} spell${totalSlots!==1?"s":""} to continue`:"Continue → Review"}
      </button>
      <button className="msec" onClick={back}>← Back</button>
    </div>
  );
}

function WizStepReview({d,upd,onComplete,back}){
  const comm=d.community;
  const sb=comm?.statBonus??{};
  const fs={mind:d.stats.mind+(sb.mind||0),body:d.stats.body+(sb.body||0),soul:d.stats.soul+(sb.soul||0)};
  const sw=CRUDE_WEAPONS.find(w=>w.name===d.weapon);
  const dispW=comm?.name==="Military"&&sw?{...sw,name:sw.name.replace("Crude","Standard")}:sw;
  return(
    <div>
      <div className="mbody">Review your character before entering Cadmia.</div>
      <div className="panel" style={{marginBottom:9}}>
        <div className="slabel">Identity</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,fontSize:11}}>
          {[["Name",d.name],["Cradle",d.cradle],["Class",d.cls],["Path",d.path==="grace"?"Path of Grace":"Path of Dread"],["Community",comm?.name??"—"]].map(([k,v])=>(
            <div key={k}><span style={{color:"var(--text-dim)",fontFamily:"'Cinzel',serif",fontSize:8,letterSpacing:1.5}}>{k.toUpperCase()}: </span><span>{v||"—"}</span></div>
          ))}
        </div>
      </div>
      <div className="panel" style={{marginBottom:9}}>
        <div className="slabel">Final Stats</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7}}>
          {[["mind","Mind"],["body","Body"],["soul","Soul"]].map(([k,l])=>(
            <div key={k} style={{textAlign:"center",background:"var(--section)",border:"1px solid var(--border)",borderRadius:2,padding:8}}>
              <div style={{fontFamily:"'Cinzel',serif",fontSize:8,color:"var(--gold-dim)",marginBottom:3}}>{l}</div>
              <div style={{fontFamily:"'Cinzel Decorative',serif",fontSize:20}}>{fs[k]}</div>
              <div style={{fontSize:9,color:"var(--text-dim)",fontStyle:"italic"}}>{modStr(fs[k])}</div>
              {sb[k]&&<div style={{fontSize:8,color:"var(--grace)"}}>+{sb[k]} from {comm.name}</div>}
            </div>
          ))}
        </div>
      </div>
      <div className="panel" style={{marginBottom:9}}>
        <div className="slabel">Starting Equipment (will auto-populate Inventory)</div>
        <table className="gear-review-table">
          <thead><tr><th>Item</th><th>Notes</th></tr></thead>
          <tbody>
            {dispW&&<tr><td>{dispW.name}</td><td>{dispW.damage} · {dispW.notes}</td></tr>}
            {comm&&<tr><td>{comm.bag.name}</td><td>{comm.bag.type} · {comm.bag.units} units</td></tr>}
            {comm&&<tr><td>{comm.clothes}</td><td>Attire</td></tr>}
            {comm?.startsWithArmor&&<tr><td>{comm.startsWithArmor}</td><td></td></tr>}
            {STARTING_GEAR_FIXED.map(g=><tr key={g.name}><td>{g.name} ×{g.qty}</td><td>{g.notes}</td></tr>)}
          </tbody>
        </table>
      </div>
      <div className="panel" style={{marginBottom:9}}>
        <div className="slabel">Personal Item <span style={{color:"var(--text-dim)",fontStyle:"italic",fontSize:8,letterSpacing:0}}>(lore only, required)</span></div>
        <textarea className="chronicle-textarea" value={d.personalItem} onChange={e=>upd("personalItem",e.target.value)} placeholder="Describe your character's personal item — no mechanical advantage, lore only…" rows={2}/>
      </div>
      <button className="mprimary" onClick={onComplete} disabled={!d.personalItem.trim()}>✦ Enter the World</button>
      <button className="msec" onClick={back}>← Back</button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   makeCharSheet
══════════════════════════════════════════════════════════════════════════════ */
function makeCharSheet(built){
  const{d,stats,comps,meta,primary,auxiliary,journalEntries,community,knownSpells:builtSpells=[]}=built;
  // Apply cradle beginning stats
  const cradleStats=CRADLE_DATA[d.cradle]?.stats??{hp:16,stress:5,mana:3,armor:0};
  const baseHp=cradleStats.hp;
  const baseStress=cradleStats.stress;
  const baseMana=cradleStats.mana;
  const baseArmor=cradleStats.armor;
  return{
    id:uid(),name:d.name,cradle:d.cradle,path:d.path,cls:d.cls,subclass:"",spec:"",
    community:community?.name??"",level:1,
    stats:{...stats},competencies:{...comps},compMeta:{...meta},
    convictions:[...d.convictions],chronicles:d.chronicles.map(c=>({...c})),
    weapon:d.weapon,personalItem:d.personalItem,
    height:d.height,eyeColor:d.eyeColor,hair:d.hair,features:d.features,
    bodyWeight:d.weight,motivation:d.motivation,values:d.values,
    hp:baseHp,hpMax:baseHp,hpMaxLocked:false,tempHp:0,lockedHp:0,
    stress:baseStress,stressMax:baseStress,mana:baseMana,manaMax:baseMana,armor:baseArmor,armorMax:Math.max(6,baseArmor+3),tempArmor:0,
    inspirations:0,traumas:0,
    injuries:{minor:false,major:false,serious:false,critical:false},
    deathState:"alive",
    cradleQualities:d.cradleQuality?[d.cradleQuality]:[],
    tether:0,baseline:d.path==="dread"?-1:d.path==="grace"?1:0,
    notes:"",
    pendingStatLevelUp:null,
    pendingCompLevelUp:null,
    pendingSubclassChoice:false,
    tacticHand:[],
    knownSpells:builtSpells,
    tacticSpells:[],
    pendingSpecChoice:false,
    completedStatRolls:[],
    completedCompRolls:[],
    archived:false,
    invPerson:primary,
    invBackpack:[],
    invAux1:[],
    invAux2:[],
    invEquipped:{},
    initJournal:journalEntries,
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
   PREMADE TEST CHARACTER
══════════════════════════════════════════════════════════════════════════════ */
function makePremadeChar(){
  const id=uid();
  return{
    id,
    name:"Aldric Vane",
    cradle:"Human",
    path:"grace",
    cls:"Soldier",
    subclass:"",
    spec:"",
    community:"Military",
    level:3,
    stats:{mind:4,body:6,soul:2},
    competencies:{
      warfare:3,subterfuge:1,resilience:2,athleticism:1,strength:2,
      scholarship:0,survival:1,intrigue:1,medicine:0,awareness:2,
      magic:0,influence:1,performance:0,conviction:2,devotion:0,
    },
    compMeta:{
      warfare:"proficient",subterfuge:"normal",resilience:"proficient",
      athleticism:"normal",strength:"normal",scholarship:"normal",
      survival:"normal",intrigue:"deficient",medicine:"normal",awareness:"normal",
      magic:"normal",influence:"normal",performance:"normal",conviction:"normal",devotion:"normal",
    },
    convictions:["Unyielding","Relentless"],
    chronicles:[
      {type:"positive",backstory:"Served three years on the northern wall, learning warfare at the edge of a blade. Every scar is a lesson he carries forward.",competency:"warfare"},
      {type:"positive",backstory:"Survived a plague that swept his garrison. He held his post while others fled, building a body that resists almost anything.",competency:"resilience"},
      {type:"negative",backstory:"Interrogated the wrong man once — misread the situation entirely. The man was innocent. Aldric doesn't trust his read of people since.",competency:"intrigue"},
    ],
    weapon:"Crude Sword",
    personalItem:"A signet ring with a broken seal — the family crest of someone he couldn't save.",
    height:"6'1\"",
    eyeColor:"Grey",
    hair:"Short, dark brown, close-cropped",
    features:"Prominent jaw scar from a blade, calloused hands",
    bodyWeight:195,
    motivation:"Redemption — he failed his company in a critical moment and intends to earn that debt back.",
    values:"Duty above comfort, but never at the cost of those under his protection.",
    hp:18,hpMax:18,hpMaxLocked:false,tempHp:0,lockedHp:0,
    stress:6,stressMax:6,mana:2,manaMax:2,armor:3,armorMax:6,tempArmor:0,
    inspirations:0,traumas:0,
    injuries:{minor:false,major:false,serious:false,critical:false},
    deathState:"alive",
    cradleQualities:["human_1a","human_3a"],
    tether:1,
    baseline:1,
    notes:"Conviction: Unyielding — Guard action grants +1 temp Armor.\nConviction: Relentless — First time hitting 0 HP per session, stabilize at 1 HP instead.",
    pendingStatLevelUp:null,
    pendingCompLevelUp:null,
    pendingSubclassChoice:false,
    pendingSpecChoice:false,
    completedStatRolls:[],
    completedCompRolls:[],
    tacticHand:["human_1a","human_3a"],
    knownSpells:[],
    tacticSpells:[],
    archived:false,
    invPerson:[
      {id:uid(),name:"Standard Sword",qty:1,weight:2,slot:"weapon",notes:"1d6 · Parry (contested Mind). Fractures: 8"},
      {id:uid(),name:"Dagger",qty:1,weight:1,slot:"weapon",notes:"1d4 · Swift. Can be thrown 20ft."},
      {id:uid(),name:"Leather Armor",qty:1,weight:5,slot:"armor",notes:"Starting armor — Military community"},
      {id:uid(),name:"Military Uniform",qty:1,weight:1,slot:"clothing",notes:"Starting attire"},
      {id:uid(),name:"Torch",qty:1,weight:4,slot:"",notes:"1d4 melee (destroyed on use). Bright: melee. Dim: close."},
      {id:uid(),name:"Medkit",qty:1,weight:2,slot:"",notes:"Req. to heal injuries. DC 17 Medicine = +1d4 IP."},
      {id:uid(),name:"Gear Repair Kit",qty:2,weight:1,slot:"",notes:"Repairs 1d4 fractures. DC 17 Crafting = +1d4."},
      {id:uid(),name:"Rope (20 ft)",qty:1,weight:3,slot:"",notes:"Standard rope."},
      {id:uid(),name:"Simple Bandage",qty:2,weight:1,slot:"",notes:"Bonus action: 1d4 HP. Action/OOC: 4 HP."},
      {id:uid(),name:"Soldier's Pack",qty:1,weight:20,slot:"bag_backpack",notes:"Standard military-issue pack. 20 unit capacity."},
    ],
    invBackpack:[],
    invAux1:[],
    invAux2:[],
    invEquipped:{weapon_primary:null,weapon_secondary:null},
    initJournal:[
      {id:uid(),title:"Chronicle 1 — Warfare (Proficient)",body:"Served three years on the northern wall, learning warfare at the edge of a blade. Every scar is a lesson he carries forward.",readonly:true},
      {id:uid(),title:"Chronicle 2 — Resilience (Proficient)",body:"Survived a plague that swept his garrison. He held his post while others fled, building a body that resists almost anything.",readonly:true},
      {id:uid(),title:"Negative Chronicle — Intrigue (Deficient)",body:"Interrogated the wrong man once — misread the situation entirely. The man was innocent. Aldric doesn't trust his read of people since.",readonly:true},
    ],
  };
}

function makePremadeSpellcaster(){
  const id=uid();
  // Vaelindra Ash — Elf Resonant, Path of Dread, Level 5
  // Soul-heavy, magic-focused, high Mana. Subclass: Druid → leaning dark.
  // Spells: a curated set of Dread spells at levels 1–3 fitting her level 5 progression.
  // Elf starting spells: 3 total (base 1 + Elf +2). Resonant gains at levels 1,2,3,4,5 = 5 total.
  // Picks: Dread-weighted (8 chosen / 4 other). All chosen = Dread here.
  const spellIds=[
    2,   // Rathmorieth — Flame-Diminish (Lvl 1 Dmg, bolt)
    4,   // Thelnithel — Mind-Whisper (Lvl 1 Ctrl, loses bonus action)
    1,   // Morithel — Curse-Speak (Lvl 1 Debuff, disadvantage)
    9,   // Morvelin — Void-Gate (Lvl 2 Dmg, 2d6 necrotic)
    12,  // Norathindel — Hex (Lvl 2 Debuff, triggered on 1-3)
  ];
  return{
    id,
    name:"Vaelindra Ash",
    cradle:"Elf",
    path:"dread",
    cls:"Witch",
    subclass:"Druid",
    spec:"",
    community:"Academic",
    level:5,
    stats:{mind:7,body:3,soul:9},
    competencies:{
      warfare:0,subterfuge:2,resilience:0,athleticism:0,strength:0,
      scholarship:3,survival:0,intrigue:2,medicine:1,awareness:2,
      magic:4,influence:1,performance:0,conviction:0,devotion:0,
    },
    compMeta:{
      warfare:"normal",subterfuge:"normal",resilience:"normal",
      athleticism:"normal",strength:"normal",scholarship:"proficient",
      survival:"normal",intrigue:"normal",medicine:"normal",awareness:"normal",
      magic:"proficient",influence:"normal",performance:"normal",conviction:"normal",devotion:"deficient",
    },
    convictions:["Relentless","Cunning"],
    chronicles:[
      {type:"positive",backstory:"Spent a decade in the Elven Archive of Vyr studying forbidden resonance texts. Her command of dark theory is without equal among her peers.",competency:"magic"},
      {type:"positive",backstory:"Survived the Sundering of Aldenmere by outthinking a void entity — not outfighting it. She walked out while veterans didn't.",competency:"scholarship"},
      {type:"negative",backstory:"Swore an oath to a god she no longer believes in. The devotion feels hollow and her prayers go unanswered.",competency:"devotion"},
    ],
    weapon:"Wand of Resonance",
    personalItem:"A black glass vial of ash from her mentor's library — all that remained after the fire she may have caused.",
    height:"5'9\"",
    eyeColor:"Silver-grey",
    hair:"White, kept loose past her shoulders",
    features:"Faint dark veins visible at her temples when she casts; long, ink-stained fingers",
    bodyWeight:128,
    motivation:"Knowledge — specifically, the parts of Resonance that the Elven academies locked away.",
    values:"Truth over comfort. Power is neutral. Intent is everything.",
    // Elf stats: HP 15, Stress 5, Mana 10, Armor 0
    hp:15,hpMax:15,hpMaxLocked:false,tempHp:0,lockedHp:0,
    stress:5,stressMax:5,mana:10,manaMax:10,armor:0,armorMax:6,tempArmor:0,
    inspirations:0,traumas:0,
    injuries:{minor:false,major:false,serious:false,critical:false},
    deathState:"alive",
    cradleQualities:["elf_1a","elf_3b"], // Resonant Echo + Piercing Gaze
    tether:-2,  // 2 steps Dread
    baseline:-1, // Path of Dread baseline
    notes:"Innate Resonance: Can cast one Level 4 or under spell per Long Rest at no Mana cost.\nArcane Recovery: First time Tether reaches 8G per reset — regain 2 Mana.\nFragile Frame: Disadvantage on Body rolls vs. physical effects.",
    pendingStatLevelUp:null,
    pendingCompLevelUp:null,
    pendingSubclassChoice:false,
    pendingSpecChoice:false,
    completedStatRolls:[3],
    completedCompRolls:[1,2,3,4,5],
    tacticHand:["elf_1a","elf_3b"],
    knownSpells:spellIds,
    tacticSpells:[],
    archived:false,
    invPerson:[
      {id:uid(),name:"Wand of Resonance",qty:1,weight:1,slot:"weapon",notes:"Arcane focus. Use Soul for to-hit on wand attacks."},
      {id:uid(),name:"Scholar's Robe",qty:1,weight:2,slot:"clothing",notes:"Dark grey, silver-stitched. Academic community attire."},
      {id:uid(),name:"Ink & Quill Set",qty:1,weight:1,slot:"",notes:"For transcribing spell formulae and research."},
      {id:uid(),name:"Simple Bandage",qty:3,weight:1,slot:"",notes:"Bonus action: 1d4 HP. Action/OOC: 4 HP."},
      {id:uid(),name:"Resonance Focus Crystal",qty:1,weight:0,slot:"jewelry",notes:"+1 to Soul rolls when casting. Fractures: 4."},
      {id:uid(),name:"Dark Cloak",qty:1,weight:1,slot:"clothing",notes:"Treated cloth. Advantage on Subterfuge in dim light."},
      {id:uid(),name:"Medkit",qty:1,weight:2,slot:"",notes:"Req. to heal injuries. DC 17 Medicine = +1d4 IP."},
      {id:uid(),name:"Scholar's Satchel",qty:1,weight:12,slot:"bag_backpack",notes:"Leather bag with scroll compartments. 12 unit capacity."},
    ],
    invBackpack:[
      {id:uid(),name:"Arcane Research Notes",qty:1,weight:1,slot:"",notes:"Three volumes of forbidden resonance theory. Illegal in Elven territories."},
      {id:uid(),name:"Preserved Rations",qty:4,weight:1,slot:"",notes:"4 days of food."},
      {id:uid(),name:"Candles (x6)",qty:1,weight:1,slot:"",notes:"For ritual casting in darkness."},
    ],
    invAux1:[],
    invAux2:[],
    invEquipped:{},
    initJournal:[
      {id:uid(),title:"Chronicle 1 — Magic (Proficient)",body:"Spent a decade in the Elven Archive of Vyr studying forbidden resonance texts. Her command of dark theory is without equal among her peers.",readonly:true},
      {id:uid(),title:"Chronicle 2 — Scholarship (Proficient)",body:"Survived the Sundering of Aldenmere by outthinking a void entity — not outfighting it. She walked out while veterans didn't.",readonly:true},
      {id:uid(),title:"Negative Chronicle — Devotion (Deficient)",body:"Swore an oath to a god she no longer believes in. The devotion feels hollow and her prayers go unanswered.",readonly:true},
      {id:uid(),title:"Field Note — The Ash Vial",body:"I carry it as a reminder, not of guilt — I haven't decided yet whether I feel guilty — but of what knowledge costs when wielded carelessly. The fire was an accident. Probably.",readonly:false},
    ],
  };
}
function IdentityStrip({c}){
  const pathCls=c.path==="grace"?"path-grace":"path-dread";
  const tags=[
    c.cradle&&{l:"Cradle",v:c.cradle},
    c.cls&&{l:"Class",v:c.cls},
    c.subclass&&{l:"Subclass",v:c.subclass},
    c.spec&&{l:"Spec",v:c.spec},
    c.community&&{l:"Community",v:c.community},
  ].filter(Boolean);
  return(
    <div>
      <div className="identity-strip">
        <div className="level-badge">LVL {c.level}</div>
        <div style={{fontFamily:"'Cinzel',serif",fontSize:14,letterSpacing:2,color:"var(--text)",flex:1}}>
          {c.name||<span style={{color:"var(--text-dim)",fontStyle:"italic",fontSize:12}}>Unnamed</span>}
        </div>
        {c.archived&&<span style={{fontFamily:"'Cinzel',serif",fontSize:8,color:"var(--text-dim)",border:"1px dashed var(--border)",borderRadius:2,padding:"2px 6px"}}>ARCHIVED</span>}
        {c.path&&<div className={`path-badge ${pathCls}`}>{c.path==="grace"?"Grace":"Dread"}</div>}
      </div>
      {tags.length>0&&(
        <div style={{display:"flex",gap:10,flexWrap:"wrap",paddingTop:4,borderTop:"1px solid var(--border)",marginTop:4}}>
          {tags.map(t=><span key={t.l} className="id-tag">{t.l}: <span>{t.v}</span></span>)}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   TACTICS TAB
   Full ability reference with usage tracking + pinned quick-action bar
   Core Racial Features = gold  (passive, always on)
   Cradle Qualities     = purple
   Spells               = green  (player-managed)
   Class Abilities      = blue   (placeholder)
══════════════════════════════════════════════════════════════════════════════ */
const TACTIC_COLORS={
  racial: {bg:"rgba(200,149,42,.08)", border:"var(--gold-dim)",  accent:"var(--gold)",   badge:"RACIAL FEATURE"},
  quality:{bg:"rgba(168,120,216,.08)",border:"var(--purple-dim)",accent:"var(--purple)",  badge:"CRADLE QUALITY"},
  spell:  {bg:"rgba(90,154,90,.08)", border:"#2a6a2a",          accent:"#5a9a5a",         badge:"SPELL"},
  ability:{bg:"rgba(60,100,200,.08)",border:"#2a4a8a",          accent:"#5a8adc",         badge:"CLASS ABILITY"},
};

// Usage-reset categories
const RESET_LABELS={"encounter":"Per Encounter","short":"Per Short Rest","long":"Per Long Rest","session":"Per Session","passive":"Passive","at-will":"At Will"};

function AbilityCard({card,pinned,onPin,onUnpin,canPin,expanded,onToggle}){
  const col=TACTIC_COLORS[card.type]||TACTIC_COLORS.ability;
  const used=card.used||false;
  const reset=card.reset||"passive";
  const isPassive=reset==="passive"||reset==="at-will";

  return(
    <div style={{
      border:`1px solid ${pinned?col.accent:used&&!isPassive?"var(--border)":col.border}`,
      borderRadius:3,background:used&&!isPassive?"var(--ink)":col.bg,
      marginBottom:6,transition:"all .2s",opacity:used&&!isPassive?.55:1,
    }}>
      {/* Header row */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"9px 11px",cursor:"pointer"}}
        onClick={onToggle}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
            <span style={{fontFamily:"'Cinzel',serif",fontSize:10,letterSpacing:1,
              color:used&&!isPassive?"var(--text-dim)":pinned?col.accent:"var(--text)"}}>{card.label}</span>
            <span style={{fontFamily:"'Cinzel',serif",fontSize:6,letterSpacing:1.5,
              color:col.accent,padding:"1px 5px",border:`1px solid ${col.border}`,borderRadius:1,opacity:.8}}>
              {col.badge}
            </span>
            {card.cost&&<span style={{fontFamily:"'Cinzel',serif",fontSize:7,color:"var(--text-dim)",padding:"1px 5px",border:"1px solid var(--border)",borderRadius:1}}>{card.cost}</span>}
            {!isPassive&&<span style={{fontFamily:"'Cinzel',serif",fontSize:7,color:"var(--text-dim)",padding:"1px 5px",border:"1px solid var(--border)",borderRadius:1}}>{RESET_LABELS[reset]||reset}</span>}
            {pinned&&<span style={{fontFamily:"'Cinzel',serif",fontSize:6,color:col.accent,padding:"1px 5px",border:`1px solid ${col.accent}`,borderRadius:1}}>★ PINNED</span>}
          </div>
        </div>
        <span style={{fontSize:9,color:"var(--text-dim)",flexShrink:0}}>{expanded?"▲":"▼"}</span>
      </div>

      {/* Expanded body */}
      {expanded&&(
        <div style={{padding:"0 11px 10px"}}>
          <div style={{fontSize:10,color:"var(--text-dim)",lineHeight:1.6,fontStyle:"italic",marginBottom:8}}>{card.desc}</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {/* Usage toggle — non-passive only */}
            {!isPassive&&(
              <button onClick={e=>{e.stopPropagation();card.onToggleUsed&&card.onToggleUsed();}} style={{
                padding:"3px 10px",border:`1px solid ${used?"var(--border)":col.accent}`,borderRadius:1,
                background:used?"transparent":col.bg,
                color:used?"var(--text-dim)":col.accent,
                fontFamily:"'Cinzel',serif",fontSize:8,letterSpacing:1,cursor:"pointer",transition:"all .15s",
              }}>{used?"↺ Mark Available":"✓ Mark Used"}</button>
            )}
            {/* Pin toggle */}
            {card.type!=="racial"&&(
              pinned?(
                <button onClick={e=>{e.stopPropagation();onUnpin();}} style={{
                  padding:"3px 10px",border:`1px solid ${col.accent}`,borderRadius:1,
                  background:"transparent",color:col.accent,
                  fontFamily:"'Cinzel',serif",fontSize:8,letterSpacing:1,cursor:"pointer",transition:"all .15s",
                }}>★ Unpin</button>
              ):(
                <button onClick={e=>{e.stopPropagation();if(canPin)onPin();}} style={{
                  padding:"3px 10px",border:`1px solid ${canPin?col.border:"var(--border)"}`,borderRadius:1,
                  background:"transparent",color:canPin?"var(--text-dim)":"var(--border)",
                  fontFamily:"'Cinzel',serif",fontSize:8,letterSpacing:1,cursor:canPin?"pointer":"not-allowed",opacity:canPin?1:.4,
                }}>☆ Pin to Bar</button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TacticsTab({c,updChar}){
  const[expanded,setExpanded]=useState({});
  const[spellName,setSpellName]=useState("");
  const[spellCost,setSpellCost]=useState("");
  const[spellReset,setSpellReset]=useState("encounter");
  const[spellDesc,setSpellDesc]=useState("");
  const[addingSpell,setAddingSpell]=useState(false);
  const[filter,setFilter]=useState("all"); // "all"|"racial"|"quality"|"spell"|"ability"
  const[usedMap,setUsedMap]=useState({}); // {cardId:bool}

  const pinnedIds=c.tacticHand||[];
  const spells=c.tacticSpells||[];
  const PIN_MAX=5;

  const toggle=id=>setExpanded(e=>({...e,[id]:!e[id]}));
  const toggleUsed=id=>setUsedMap(m=>({...m,[id]:!m[id]}));

  const pin=id=>{
    if(pinnedIds.includes(id)||pinnedIds.length>=PIN_MAX)return;
    updChar(p=>({...p,tacticHand:[...p.tacticHand,id]}));
  };
  const unpin=id=>updChar(p=>({...p,tacticHand:p.tacticHand.filter(x=>x!==id)}));

  // Reset used state
  const resetEncounter=()=>setUsedMap({});
  const resetCategory=cat=>{
    const next={...usedMap};
    allCards.filter(c=>c.reset===cat).forEach(c=>{delete next[c.id];});
    setUsedMap(next);
  };

  // Build all cards
  const racialCards=(CRADLE_DATA[c.cradle]?.features||[]).map((f,i)=>({
    id:`racial_${i}`,label:f.name,desc:f.desc,type:"racial",reset:"passive",
  }));

  const allQuals=c.cradle?Object.values(CRADLE_QUALITIES[c.cradle]||{}).flat():[];
  const qualityCards=(c.cradleQualities||[]).map(qid=>{
    const q=allQuals.find(x=>x.id===qid);
    return q?{...q,type:"quality",reset:"passive"}:null;
  }).filter(Boolean);

  const spellCards=spells.map(s=>({
    id:`spell_${s.id}`,label:s.name,desc:s.desc||"",type:"spell",
    cost:s.cost||"",reset:s.reset||"encounter",
  }));

  const abilityCards=[{
    id:"ability_placeholder",label:"Class Abilities",
    desc:"Class abilities will appear here as they are implemented in a future update.",
    type:"ability",reset:"passive",
  }];

  const allCards=[...racialCards,...qualityCards,...spellCards,...abilityCards];
  const filteredCards=filter==="all"?allCards:allCards.filter(x=>x.type===filter);

  // Pinned cards for the quick bar
  const pinnedCards=allCards.filter(x=>pinnedIds.includes(x.id));

  // Add spell
  const addSpell=()=>{
    if(!spellName.trim())return;
    const s={id:uid(),name:spellName.trim(),desc:spellDesc.trim(),cost:spellCost.trim(),reset:spellReset};
    const next=[...spells,s];
    updChar(p=>({...p,tacticSpells:next}));
    setSpellName("");setSpellCost("");setSpellDesc("");setSpellReset("encounter");setAddingSpell(false);
  };
  const removeSpell=sid=>{
    const next=spells.filter(s=>s.id!==sid);
    updChar(p=>({...p,tacticSpells:next,tacticHand:p.tacticHand.filter(x=>x!==`spell_${sid}`)}));
  };

  const filterBtns=[["all","All"],["racial","Racial"],["quality","Quality"],["spell","Spell"],["ability","Ability"]];

  return(
    <div>
      {/* ── QUICK ACTION BAR (pinned) ── */}
      <div className="panel" style={{borderColor:"rgba(200,149,42,.3)"}}>
        <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:8}}>
          <div className="slabel" style={{margin:0}}>Quick Bar</div>
          <span style={{fontFamily:"'Cinzel',serif",fontSize:8,color:"var(--text-dim)"}}>{pinnedIds.length}/{PIN_MAX} pinned</span>
          <span style={{marginLeft:"auto",fontFamily:"'Cinzel',serif",fontSize:8,color:"var(--text-dim)",fontStyle:"italic"}}>Pin abilities below for fast reference</span>
        </div>
        {pinnedIds.length===0?(
          <div style={{padding:"12px",border:"1px dashed var(--border)",borderRadius:2,textAlign:"center",fontSize:10,color:"var(--text-dim)",fontStyle:"italic"}}>
            No abilities pinned yet. Expand an ability below and click "☆ Pin to Bar".
          </div>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            {pinnedCards.map(card=>{
              const col=TACTIC_COLORS[card.type]||TACTIC_COLORS.ability;
              const used=usedMap[card.id]||false;
              const isPassive=card.reset==="passive"||card.reset==="at-will";
              return(
                <div key={card.id} style={{
                  display:"flex",alignItems:"center",gap:8,padding:"7px 10px",borderRadius:2,
                  border:`1px solid ${used&&!isPassive?"var(--border)":col.border}`,
                  background:used&&!isPassive?"var(--ink)":col.bg,
                  opacity:used&&!isPassive?.5:1,transition:"all .2s",
                }}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontFamily:"'Cinzel',serif",fontSize:9,letterSpacing:1,color:used&&!isPassive?"var(--text-dim)":col.accent,marginBottom:1}}>{card.label}</div>
                    {card.cost&&<span style={{fontSize:8,color:"var(--text-dim)"}}>{card.cost}</span>}
                    {!isPassive&&<span style={{fontSize:8,color:"var(--text-dim)",marginLeft:card.cost?6:0}}>{RESET_LABELS[card.reset]||card.reset}</span>}
                  </div>
                  {!isPassive&&(
                    <button onClick={()=>toggleUsed(card.id)} style={{
                      padding:"2px 8px",border:`1px solid ${used?"var(--border)":col.accent}`,borderRadius:1,
                      background:"transparent",color:used?"var(--text-dim)":col.accent,
                      fontFamily:"'Cinzel',serif",fontSize:7,letterSpacing:1,cursor:"pointer",whiteSpace:"nowrap",
                    }}>{used?"↺":"✓"}</button>
                  )}
                  <button onClick={()=>unpin(card.id)} title="Unpin" style={{
                    background:"transparent",border:"none",color:"var(--text-dim)",cursor:"pointer",fontSize:11,padding:"0 2px",flexShrink:0,
                  }}>✕</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reset controls */}
      <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
        <span style={{fontFamily:"'Cinzel',serif",fontSize:8,letterSpacing:1,color:"var(--text-dim)",alignSelf:"center"}}>RESET:</span>
        {[["encounter","Encounter"],["short","Short Rest"],["long","Long Rest"]].map(([cat,lbl])=>(
          <button key={cat} onClick={()=>resetCategory(cat)} style={{
            padding:"3px 9px",border:"1px solid var(--border)",background:"var(--section)",
            color:"var(--text-dim)",fontFamily:"'Cinzel',serif",fontSize:8,letterSpacing:1,cursor:"pointer",borderRadius:1,transition:"all .15s",
          }}>{lbl}</button>
        ))}
        <button onClick={resetEncounter} style={{
          padding:"3px 9px",border:"1px solid var(--dread-dim)",background:"rgba(200,90,58,.06)",
          color:"var(--dread)",fontFamily:"'Cinzel',serif",fontSize:8,letterSpacing:1,cursor:"pointer",borderRadius:1,
        }}>Reset All</button>
      </div>

      {/* ── FILTER BAR ── */}
      <div style={{display:"flex",gap:4,marginBottom:10,flexWrap:"wrap"}}>
        {filterBtns.map(([val,lbl])=>{
          const col=val==="all"?{accent:"var(--text-dim)",border:"var(--border)"}:TACTIC_COLORS[val]||{accent:"var(--text-dim)",border:"var(--border)"};
          const on=filter===val;
          return(
            <button key={val} onClick={()=>setFilter(val)} style={{
              padding:"4px 10px",border:`1px solid ${on?col.accent:col.border}`,borderRadius:2,
              background:on?`color-mix(in srgb,${col.accent} 10%,transparent)`:"transparent",
              color:on?col.accent:"var(--text-dim)",fontFamily:"'Cinzel',serif",fontSize:8,
              letterSpacing:1,cursor:"pointer",transition:"all .15s",
            }}>{lbl}</button>
          );
        })}
      </div>

      {/* ── ABILITY LIST ── */}
      {filteredCards.map(card=>(
        <AbilityCard key={card.id}
          card={{...card,used:usedMap[card.id]||false,onToggleUsed:()=>toggleUsed(card.id)}}
          type={card.type}
          pinned={pinnedIds.includes(card.id)}
          canPin={!pinnedIds.includes(card.id)&&pinnedIds.length<PIN_MAX&&card.type!=="racial"}
          onPin={()=>pin(card.id)}
          onUnpin={()=>unpin(card.id)}
          expanded={!!expanded[card.id]}
          onToggle={()=>toggle(card.id)}
        />
      ))}
      {filteredCards.length===0&&(
        <div style={{textAlign:"center",padding:"16px",fontSize:10,color:"var(--text-dim)",fontStyle:"italic",border:"1px dashed var(--border)",borderRadius:2}}>
          No abilities in this category yet.
        </div>
      )}

      {/* ── ADD SPELL ── */}
      <div className="panel" style={{borderColor:"#2a6a2a",marginTop:4}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:addingSpell?10:0}}>
          <div className="slabel" style={{margin:0,color:"#5a9a5a"}}>Spells</div>
          <button onClick={()=>setAddingSpell(v=>!v)} style={{
            marginLeft:"auto",padding:"3px 10px",border:"1px solid #2a6a2a",borderRadius:1,
            background:addingSpell?"rgba(90,154,90,.1)":"transparent",color:"#5a9a5a",
            fontFamily:"'Cinzel',serif",fontSize:8,letterSpacing:1,cursor:"pointer",
          }}>{addingSpell?"✕ Cancel":"+ Add Spell"}</button>
        </div>
        {addingSpell&&(
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {[["Spell Name",spellName,setSpellName,"e.g. Fireball"],["Cost (optional)",spellCost,setSpellCost,"e.g. 2 Mana, 1 Stress"]].map(([lbl,val,setter,ph])=>(
              <div key={lbl}>
                <div style={{fontFamily:"'Cinzel',serif",fontSize:7,letterSpacing:2,color:"var(--text-dim)",marginBottom:3}}>{lbl.toUpperCase()}</div>
                <input value={val} onChange={e=>setter(e.target.value)}
                  placeholder={ph}
                  style={{width:"100%",background:"transparent",border:"none",borderBottom:"1px solid #2a6a2a",
                    color:"var(--text)",fontFamily:"'IM Fell English',serif",fontSize:12,outline:"none",padding:"2px 0"}}/>
              </div>
            ))}
            <div>
              <div style={{fontFamily:"'Cinzel',serif",fontSize:7,letterSpacing:2,color:"var(--text-dim)",marginBottom:3}}>RESETS</div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                {Object.entries(RESET_LABELS).map(([k,l])=>(
                  <button key={k} onClick={()=>setSpellReset(k)} style={{
                    padding:"2px 8px",border:`1px solid ${spellReset===k?"#5a9a5a":"var(--border)"}`,borderRadius:1,
                    background:spellReset===k?"rgba(90,154,90,.1)":"transparent",
                    color:spellReset===k?"#5a9a5a":"var(--text-dim)",fontFamily:"'Cinzel',serif",fontSize:8,cursor:"pointer",
                  }}>{l}</button>
                ))}
              </div>
            </div>
            <div>
              <div style={{fontFamily:"'Cinzel',serif",fontSize:7,letterSpacing:2,color:"var(--text-dim)",marginBottom:3}}>DESCRIPTION (optional)</div>
              <textarea value={spellDesc} onChange={e=>setSpellDesc(e.target.value)}
                placeholder="Effect, range, duration…"
                rows={2}
                style={{width:"100%",background:"var(--section)",border:"1px solid #2a6a2a",borderRadius:2,
                  color:"var(--text)",fontFamily:"'IM Fell English',serif",fontSize:11,outline:"none",
                  padding:"6px 8px",resize:"none",fontStyle:"italic"}}/>
            </div>
            <button onClick={addSpell} disabled={!spellName.trim()} style={{
              padding:"7px",border:"1px solid #5a9a5a",borderRadius:2,
              background:"rgba(90,154,90,.08)",color:"#5a9a5a",fontFamily:"'Cinzel',serif",
              fontSize:9,letterSpacing:2,cursor:spellName.trim()?"pointer":"not-allowed",
              opacity:spellName.trim()?1:.4,
            }}>✦ Add to Ability List</button>
          </div>
        )}
        {/* Existing spells quick list */}
        {spells.length>0&&!addingSpell&&(
          <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:3}}>
            {spells.map(s=>(
              <div key={s.id} style={{display:"flex",alignItems:"center",gap:8,fontSize:9,color:"#5a9a5a",fontFamily:"'Cinzel',serif"}}>
                <span style={{flex:1}}>{s.name}</span>
                {s.cost&&<span style={{color:"var(--text-dim)",fontSize:8}}>{s.cost}</span>}
                <button onClick={()=>removeSpell(s.id)} style={{background:"transparent",border:"none",color:"var(--dread-dim)",cursor:"pointer",fontSize:10,padding:0}}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CradleQualitiesPanel({cradleName,chosenQualities,unavailableQualities}){
  const[showUnavailable,setShowUnavailable]=useState(false);

  const QualityRow=({q,active,muted})=>(
    <div style={{
      display:"flex",gap:10,alignItems:"flex-start",
      padding:"9px 10px",marginBottom:6,borderRadius:2,
      border:`1px solid ${active?"var(--gold-dim)":"var(--border)"}`,
      background:active?"rgba(200,149,42,.05)":"var(--section)",
      opacity:muted?.45:1,
    }}>
      <div style={{
        width:14,height:14,borderRadius:"50%",flexShrink:0,marginTop:2,
        background:active?"var(--gold)":"transparent",
        border:`2px solid ${active?"var(--gold)":"var(--border)"}`,
        transition:"all .2s",
      }}/>
      <div style={{flex:1}}>
        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:3}}>
          <span style={{fontFamily:"'Cinzel',serif",fontSize:9,letterSpacing:1,color:active?"var(--gold)":"var(--text-dim)"}}>{q.label}</span>
          <span style={{fontFamily:"'Cinzel',serif",fontSize:7,color:"var(--text-dim)",padding:"1px 5px",border:"1px solid var(--border)",borderRadius:1}}>LVL {q.unlockLevel}</span>
          {active&&<span style={{fontFamily:"'Cinzel',serif",fontSize:7,color:"var(--gold)",padding:"1px 5px",border:"1px solid var(--gold-dim)",borderRadius:1}}>✦ ACTIVE</span>}
          {!active&&q.unlockLevel&&<span style={{fontFamily:"'Cinzel',serif",fontSize:7,color:"var(--text-dim)",padding:"1px 5px",border:"1px solid var(--border)",borderRadius:1}}>NOT CHOSEN</span>}
        </div>
        <div style={{fontSize:10,color:"var(--text-dim)",lineHeight:1.5,fontStyle:"italic"}}>{q.desc}</div>
      </div>
    </div>
  );

  return(
    <div className="panel">
      <div className="slabel">{cradleName} Cradle Qualities</div>

      {chosenQualities.length===0?(
        <div style={{fontSize:10,color:"var(--text-dim)",fontStyle:"italic",padding:"10px",border:"1px dashed var(--border)",borderRadius:2,textAlign:"center",marginBottom:10}}>
          No qualities chosen yet. Level up to select your first.
        </div>
      ):(
        chosenQualities.map(q=><QualityRow key={q.id} q={q} active muted={false}/>)
      )}

      {unavailableQualities.length>0&&(
        <div style={{marginTop:chosenQualities.length>0?8:0}}>
          <button onClick={()=>setShowUnavailable(v=>!v)} style={{
            width:"100%",padding:"6px 10px",border:"1px solid var(--border)",borderRadius:2,
            background:"var(--section)",color:"var(--text-dim)",fontFamily:"'Cinzel',serif",
            fontSize:8,letterSpacing:2,cursor:"pointer",display:"flex",alignItems:"center",
            justifyContent:"space-between",transition:"all .15s",
          }}>
            <span>VIEW UNCHOSEN QUALITIES ({unavailableQualities.length})</span>
            <span style={{fontSize:10}}>{showUnavailable?"▲":"▼"}</span>
          </button>
          {showUnavailable&&(
            <div style={{marginTop:6}}>
              {unavailableQualities.map(q=><QualityRow key={q.id} q={q} active={false} muted/>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   PLAYER SHEET
══════════════════════════════════════════════════════════════════════════════ */
function PlayerSheet({critNumber,dreadPool,onCharsChange,initialChars=[],activeTimers=[],onCastSpell=()=>{}}){
  const[sub,setSub]=useState("main");
  const[chars,setChars]=useState(initialChars);
  const[activeId,setActiveId]=useState(initialChars[0]?.id??null);
  const[showWizard,setShowWizard]=useState(false);
  const[showRoll,setShowRoll]=useState(false);
  const[showDeath,setShowDeath]=useState(false);
  const[showArchive,setShowArchive]=useState(false);

  useEffect(()=>{
    setChars(initialChars);
    setActiveId(current=>initialChars.some(char=>char.id===current)?current:(initialChars[0]?.id??null));
  },[initialChars]);

  const activeChar=chars.find(x=>x.id===activeId)??null;

  // Lift chars to parent whenever they change so GM can see them
  const setCharsAndNotify=fn=>{
    setChars(prev=>{
      const next=typeof fn==="function"?fn(prev):fn;
      if(onCharsChange)onCharsChange(next);
      return next;
    });
  };

  const addChar=built=>{
    const c=makeCharSheet(built);
    setCharsAndNotify(p=>[...p,c]);
    setActiveId(c.id);
    setShowWizard(false);
  };

  const updChar=fn=>setCharsAndNotify(cs=>cs.map(c=>c.id===activeId?fn(c):c));
  const getChar=()=>chars.find(x=>x.id===activeId);

  const archiveChar=id=>{setCharsAndNotify(cs=>cs.map(c=>c.id===id?{...c,archived:true,deathState:"dead"}:c));setShowArchive(false);};
  const deleteChar=id=>{const n=chars.filter(x=>x.id!==id);setCharsAndNotify(n);if(activeId===id)setActiveId(n[0]?.id??null);};
  const restoreChar=id=>setCharsAndNotify(cs=>cs.map(c=>c.id===id?{...c,archived:false}:c));

  if(chars.length===0||(chars.length>0&&!activeChar&&!chars.some(c=>!c.archived))){
    const loadPremade=()=>{
      const a=makePremadeChar();
      const b=makePremadeSpellcaster();
      setCharsAndNotify([a,b]);
      setActiveId(a.id);
    };
    return(
      <div>
        <div className="panel" style={{textAlign:"center",padding:"36px 20px"}}>
          <div className="empty-state-title">No Characters Yet</div>
          <div style={{color:"var(--text-dim)",fontStyle:"italic",fontSize:12,marginBottom:20,lineHeight:1.6}}>
            Begin your story in Cadmia.<br/>Create your first character to start tracking.
          </div>
          <button className="mprimary" style={{maxWidth:260,margin:"0 auto 10px"}} onClick={()=>setShowWizard(true)}>✦ Create a Character</button>
          <div style={{margin:"8px auto",maxWidth:260}}>
            <button onClick={loadPremade} style={{
              width:"100%",padding:"8px",border:"1px dashed var(--gold-dim)",background:"transparent",
              color:"var(--gold-dim)",fontFamily:"'Cinzel',serif",fontSize:9,letterSpacing:2,
              cursor:"pointer",borderRadius:2,transition:"all .2s",
            }}
            onMouseOver={e=>{e.currentTarget.style.color="var(--gold)";e.currentTarget.style.borderColor="var(--gold)";}}
            onMouseOut={e=>{e.currentTarget.style.color="var(--gold-dim)";e.currentTarget.style.borderColor="var(--gold-dim)";}}>
              ⚄ Load Test Characters
            </button>
            <div style={{fontSize:9,color:"var(--text-dim)",fontStyle:"italic",marginTop:6}}>
              Aldric Vane &amp; Vaelindra Ash
            </div>
          </div>
        </div>
        {showWizard&&<CharWizard onComplete={addChar} onCancel={()=>setShowWizard(false)}/>}
      </div>
    );
  }

  const c=activeChar;
  if(!c)return(
    <div>
      <div className="char-bar">
        {chars.map(ch=>(
          <div key={ch.id} className={`char-chip${ch.archived?" archived":""}`}>
            <span onClick={()=>setActiveId(ch.id)} style={{cursor:"pointer"}}>{ch.name||"Unnamed"}{ch.archived?" ⚐":""}</span>
            {ch.archived?<button className="char-chip-del" onClick={()=>restoreChar(ch.id)} title="Restore">↺</button>:<button className="char-chip-del" onClick={()=>{if(confirm(`Delete ${ch.name}?`))deleteChar(ch.id);}}>✕</button>}
          </div>
        ))}
        <button className="add-char-btn" onClick={()=>setShowWizard(true)}>+ New Character</button>
      </div>
      {showWizard&&<CharWizard onComplete={addChar} onCancel={()=>setShowWizard(false)}/>}
    </div>
  );

  const effStressMax=Math.max(0,c.stressMax+c.inspirations-c.traumas);
  const effHpMax=Math.max(0,c.hpMax-c.lockedHp);
  const injDefs=[{k:"minor",l:"Minor",hp:0},{k:"major",l:"Major",hp:1},{k:"serious",l:"Serious",hp:2},{k:"critical",l:"Critical",hp:3}];

  const toggleInj=k=>{
    const n={...c.injuries,[k]:!c.injuries[k]};
    const locked=injDefs.reduce((a,d)=>a+(n[d.k]?d.hp:0),0);
    updChar(p=>({...p,injuries:n,lockedHp:locked}));
  };

  const applyTetherMove=v=>{
    const nv=clamp(v,TMIN,TMAX);
    if(nv>=TMAX){
      const gives=c.path==="dread"?"trauma":"inspiration";
      setTimeout(()=>alert(`10G — Grace Limit!\n${gives==="inspiration"?"Gain 1 Inspiration":"Gain 1 Trauma"}. Tether resets to Baseline.`),50);
      updChar(p=>gives==="inspiration"?{...p,tether:p.baseline,inspirations:p.inspirations+1}:{...p,tether:p.baseline,traumas:p.traumas+1});
    } else if(nv<=TMIN){
      const gives=c.path==="dread"?"inspiration":"trauma";
      setTimeout(()=>alert(`10D — Dread Limit!\n${gives==="inspiration"?"Gain 1 Inspiration":"Gain 1 Trauma"}. Tether resets to Baseline.`),50);
      updChar(p=>gives==="inspiration"?{...p,tether:p.baseline,inspirations:p.inspirations+1}:{...p,tether:p.baseline,traumas:p.traumas+1});
    } else {
      updChar(p=>({...p,tether:nv}));
    }
  };

  const handleRoll=res=>applyTetherMove(c.tether+(res.isGrace?1:-1)*res.steps);

  const handleDeathConfirm=result=>{
    if(result.state==="alive"){
      updChar(p=>({...p,deathState:"alive"}));
    } else if(result.state==="dead"||result.state==="stabilized"){
      const newState=result.state==="stabilized"?"alive":"dead";
      let updates={deathState:newState};
      if(result.tetherDelta) updates={...updates,tether:clamp(c.tether+result.tetherDelta,TMIN,TMAX)};
      updChar(p=>({...p,...updates}));
      if(result.state==="dead") setShowArchive(true);
    } else if(result.state==="bargain"){
      // Shift 6 toward the "bad" direction based on path
      const newTether=clamp(c.tether+result.tetherDelta,TMIN,TMAX);
      const newBaseline=clamp(c.baseline-1,BMIN,BMAX);
      updChar(p=>({...p,deathState:"bargain",tether:newTether,baseline:newBaseline}));
    }
    setShowDeath(false);
  };

  const[showLevelUp,setShowLevelUp]=useState(false);

  const handleLevelUp=nl=>{
    const newLevel=clamp(nl,1,12);
    if(nl>c.level){
      updChar(p=>({...p,level:newLevel}));
      setShowLevelUp(true);
    } else {
      updChar(p=>({...p,level:newLevel}));
    }
  };

  const handleLevelUpConfirm=result=>{
    updChar(p=>{
      let next={...p};
      if(result.needStatRoll){
        next.stats={mind:p.stats.mind+result.statAlloc.mind,body:p.stats.body+result.statAlloc.body,soul:p.stats.soul+result.statAlloc.soul};
        next.completedStatRolls=[...p.completedStatRolls,result.level];
      }
      if(result.needComp){
        next.competencies=Object.fromEntries(Object.entries(p.competencies).map(([k,v])=>[k,v+(result.compAlloc[k]||0)]));
        next.completedCompRolls=[...p.completedCompRolls,result.level];
      }
      if(result.needSubclass&&result.subclass) next.subclass=result.subclass;
      if(result.needSpec&&result.spec) next.spec=result.spec;
      if(result.needCradleQuality&&result.cradleQuality){
        const existing=p.cradleQualities||[];
        if(!existing.includes(result.cradleQuality))
          next.cradleQualities=[...existing,result.cradleQuality];
      }
      if(result.newSpells&&result.newSpells.length>0){
        const existing=p.knownSpells||[];
        next.knownSpells=[...existing,...result.newSpells.filter(id=>!existing.includes(id))];
      }
      next.pendingStatLevelUp=null;
      next.pendingCompLevelUp=null;
      next.pendingSubclassChoice=false;
      next.pendingSpecChoice=false;
      return next;
    });
    setShowLevelUp(false);
  };

  const SUBS=["main","character","talents","inventory","guides","journal","conditions","settings","tactics"];
  const SLBLS=["Overview","Character","Talents","Inventory","Guides","Journal","Conditions","Settings","Tactics"];

  return(
    <div>
      <div className="char-bar">
        {chars.map(ch=>(
          <div key={ch.id} className={`char-chip${ch.id===activeId?" on":""}${ch.archived?" archived":""}`}>
            <span onClick={()=>setActiveId(ch.id)} style={{cursor:"pointer"}}>{ch.name||"Unnamed"}{ch.archived?" ⚐":""}</span>
            {ch.archived
              ?<button className="char-chip-del" onClick={()=>restoreChar(ch.id)} title="Restore (GM)">↺</button>
              :<button className="char-chip-del" onClick={()=>{if(confirm(`Delete ${ch.name}?`))deleteChar(ch.id);}}>✕</button>}
          </div>
        ))}
        <button className="add-char-btn" onClick={()=>setShowWizard(true)}>+ New Character</button>
      </div>

      {c.archived&&(
        <div style={{padding:"10px 14px",border:"1px dashed var(--border)",borderRadius:2,background:"rgba(0,0,0,.3)",color:"var(--text-dim)",fontSize:11,fontStyle:"italic",marginBottom:12,textAlign:"center"}}>
          ⚐ This character is archived. They can be restored by the GM.
        </div>
      )}

      <div className="stabs">
        {SUBS.map((s,i)=><button key={s} className={`stab${sub===s?" on":""}`} onClick={()=>setSub(s)}>{SLBLS[i]}</button>)}
      </div>

      {/* ── OVERVIEW ── */}
      {sub==="main"&&(
        <div>
          <div className="panel">
            <IdentityStrip c={c}/>
            <div style={{marginTop:12}} className="slabel">The Tether</div>
            <TetherBar pos={c.tether} baseline={c.baseline}
              setPos={applyTetherMove}
              setBaseline={v=>updChar(p=>({...p,baseline:clamp(v,BMIN,BMAX)}))}/>
            <button className="rolltrig" onClick={()=>setShowRoll(true)}>⚄ Make a Tether Roll</button>
          </div>

          <div className="panel">
            <div className="slabel">Resources</div>

            {/* ROW 1: HP + Temp HP */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:4}}>
              <ResourceTrack
                label="HP"
                cur={c.hp} max={effHpMax}
                fillColor="#8b1a1a"
                onSetCur={v=>updChar(p=>({...p,hp:clamp(v,0,Math.max(0,p.hpMax-p.lockedHp))}))}
                onSetMax={v=>{if(!c.hpMaxLocked)updChar(p=>({...p,hpMax:Math.max(1,v)}));}}
                locked={c.hpMaxLocked}
                lockedCount={c.lockedHp}
                sub={c.lockedHp>0?`${c.lockedHp} HP locked by injury`:null}
              />
              <ResourceTrack
                label="Temp HP"
                cur={c.tempHp} max={Math.max(c.tempHp,10)}
                fillColor="#c45a5a"
                onSetCur={v=>updChar(p=>({...p,tempHp:Math.max(0,v)}))}
                onSetMax={v=>updChar(p=>({...p,tempHp:Math.max(0,v)}))}
                showMaxCtrl={false}
                valColor="#c45a5a"
                sub="Absorbs damage first"
              />
            </div>

            <div style={{borderTop:"1px solid var(--border)",margin:"10px 0",opacity:.4}}/>

            {/* ROW 2: Armor + Temp Armor */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:4}}>
              <ResourceTrack
                label="Armor"
                cur={c.armor} max={c.armorMax||6}
                fillColor="#1a3a6b"
                onSetCur={v=>updChar(p=>({...p,armor:clamp(v,0,p.armorMax||6)}))}
                onSetMax={v=>updChar(p=>({...p,armorMax:Math.max(1,v),armor:Math.min(p.armor,Math.max(1,v))}))}
                sub="From equipment"
              />
              <ResourceTrack
                label="Temp Armor"
                cur={c.tempArmor||0} max={Math.max(c.tempArmor||0,6)}
                fillColor="#4a90c4"
                onSetCur={v=>updChar(p=>({...p,tempArmor:Math.max(0,v)}))}
                onSetMax={v=>updChar(p=>({...p,tempArmor:Math.max(0,v)}))}
                showMaxCtrl={false}
                valColor="#4a90c4"
                sub="Temporary"
              />
            </div>

            <div style={{borderTop:"1px solid var(--border)",margin:"10px 0",opacity:.4}}/>

            {/* ROW 3: Stress + Mana */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
              <ResourceTrack
                label="Stress"
                cur={c.stress} max={effStressMax}
                fillColor="var(--purple)"
                onSetCur={v=>updChar(p=>({...p,stress:clamp(v,0,Math.max(0,p.stressMax+p.inspirations-p.traumas))}))}
                onSetMax={v=>updChar(p=>({...p,stressMax:Math.max(1,v)}))}
                valColor="var(--purple)"
                sub={`Insp +${c.inspirations} / Trauma −${c.traumas}`}
              />
              <ResourceTrack
                label="Mana"
                cur={c.mana} max={c.manaMax}
                fillColor="#4ab87a"
                onSetCur={v=>updChar(p=>({...p,mana:clamp(v,0,p.manaMax)}))}
                onSetMax={v=>updChar(p=>({...p,manaMax:Math.max(0,v),mana:Math.min(p.mana,Math.max(0,v))}))}
                valColor="#4ab87a"
              />
            </div>

            <div style={{display:"flex",alignItems:"center",gap:6,marginTop:10}}>
              <input type="checkbox" checked={c.hpMaxLocked} onChange={e=>updChar(p=>({...p,hpMaxLocked:e.target.checked}))} id={`hl_${c.id}`} style={{cursor:"pointer"}}/>
              <label htmlFor={`hl_${c.id}`} style={{fontSize:9,color:"var(--text-dim)",cursor:"pointer",fontFamily:"'Cinzel',serif",letterSpacing:1}}>Lock HP Max</label>
              <span style={{marginLeft:"auto",fontSize:8,color:"var(--text-dim)",fontStyle:"italic"}}>Click segment to set value · Click number to edit</span>
            </div>
          </div>

          <div className="panel">
            <div className="slabel">Injuries</div>
            <div className="injgrid">
              {injDefs.map(d=>(
                <div key={d.k} className={`inj${c.injuries[d.k]?" on":""}`} onClick={()=>toggleInj(d.k)}>
                  <div className="injname">{d.l}</div>
                  <div className="injhp">{d.hp>0?`Locks ${d.hp} HP`:"Cosmetic"}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Death State */}
          <div className="panel">
            <div className="slabel">Death State</div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
              <div className={`ds-btn ${c.deathState}`} style={{cursor:"default",flex:"0 0 auto",minWidth:90,textAlign:"center",fontFamily:"'Cinzel',serif",fontSize:9}}>
                {c.deathState==="alive"?"● ALIVE":c.deathState==="bargain"?"✦ BARGAIN":c.deathState==="dead"?"☠ DEAD":c.deathState.toUpperCase()}
              </div>
              <button className="level-btn" onClick={()=>setShowDeath(true)}>Change State</button>
            </div>
            {c.deathState==="bargain"&&<div style={{fontSize:9,color:"var(--purple)",fontStyle:"italic"}}>⚠ Bargain active — baseline shifted toward Dread.</div>}
          </div>

          <div className="panel">
            <div className="slabel">Notes</div>
            <textarea className="narea" value={c.notes} onChange={e=>updChar(p=>({...p,notes:e.target.value}))} placeholder="Conditions, reminders, session notes…"/>
          </div>
        </div>
      )}

      {/* ── CHARACTER ── */}
      {sub==="character"&&(
        <div>
          <div className="panel">
            <input className="cname" value={c.name} onChange={e=>updChar(p=>({...p,name:e.target.value}))} placeholder="Character Name" disabled={c.archived}/>
            <div className="slabel">Level</div>
            <div className="level-row">
              <div className="level-num">{c.level}</div>
              <div className="level-ctrl">
                <button className="level-btn" onClick={()=>handleLevelUp(c.level+1)} disabled={c.level>=12||c.archived}>Level Up ▲</button>
                <button className="level-btn" onClick={()=>updChar(p=>({...p,level:Math.max(1,p.level-1)}))} disabled={c.level<=1||c.archived}>Level Down ▼</button>
              </div>
              {(c.pendingStatLevelUp||c.pendingCompLevelUp||c.pendingSubclassChoice||c.pendingSpecChoice)&&(
                <div className="levelup-notice" style={{fontSize:9}}>
                  ✦ Level {c.level} upgrades pending!
                  <button className="level-btn" style={{marginTop:4,display:"block",borderColor:"var(--gold)",color:"var(--gold)"}} onClick={()=>setShowLevelUp(true)}>Open Level Up →</button>
                </div>
              )}
            </div>

            <div className="slabel">Identity</div>
            <div className="id-grid">
              <div className="id-field"><div className="id-label">Cradle</div>
                <select className="id-select" value={c.cradle} onChange={e=>updChar(p=>({...p,cradle:e.target.value}))} disabled={c.archived}>
                  <option value="">— Select —</option>
                  {CRADLES.map(cr=><option key={cr} value={cr}>{cr}</option>)}
                </select>
              </div>
              <div className="id-field"><div className="id-label">Class</div>
                <select className="id-select" value={c.cls} onChange={e=>updChar(p=>({...p,cls:e.target.value,subclass:"",spec:""}))} disabled={c.archived}>
                  <option value="">— Select —</option>
                  {CLASS_DATA.map(cl=><option key={cl.name} value={cl.name}>{cl.name}</option>)}
                </select>
              </div>
              <div className="id-field">
                <div className="id-label">Subclass
                  {!c.subclass&&c.level<3&&<span style={{color:"var(--text-dim)",fontStyle:"italic",fontSize:8}}> (Lvl 3)</span>}
                  {!c.subclass&&c.level>=3&&<span style={{color:"var(--gold)",fontStyle:"italic",fontSize:8}}> (choose!)</span>}
                </div>
                <select className="id-select" value={c.subclass} onChange={e=>updChar(p=>({...p,subclass:e.target.value,spec:""}))} disabled={c.level<3||!c.cls||c.archived}>
                  <option value="">— Select —</option>
                  {getSubs(c.cls).map(s=><option key={s.name} value={s.name}>{s.name}</option>)}
                </select>
              </div>
              <div className="id-field">
                <div className="id-label">Specialization
                  {!c.spec&&c.level<8&&<span style={{color:"var(--text-dim)",fontStyle:"italic",fontSize:8}}> (Lvl 8)</span>}
                  {!c.spec&&c.level>=8&&c.subclass&&<span style={{color:"var(--gold)",fontStyle:"italic",fontSize:8}}> (choose!)</span>}
                </div>
                <select className="id-select" value={c.spec} onChange={e=>updChar(p=>({...p,spec:e.target.value}))} disabled={c.level<8||!c.subclass||c.archived}>
                  <option value="">— Select —</option>
                  {getSpecs(c.cls,c.subclass).map(s=><option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="slabel">Inspirations & Traumas</div>
            <div className="itrow">
              <div className="itcard ins">
                <div className="itname">INSPIRATIONS</div>
                <div className="itval">{c.inspirations}</div>
                <div className="rbtnrow"><button className="rbtn" onClick={()=>updChar(p=>({...p,inspirations:Math.max(0,p.inspirations-1)}))}>−</button><button className="rbtn" onClick={()=>updChar(p=>({...p,inspirations:p.inspirations+1}))}>+</button></div>
                <div style={{fontSize:8,color:"var(--text-dim)",marginTop:2,fontStyle:"italic"}}>+{c.inspirations} Stress Max</div>
              </div>
              <div className="itcard trm">
                <div className="itname">TRAUMAS</div>
                <div className="itval">{c.traumas}</div>
                <div className="rbtnrow"><button className="rbtn" onClick={()=>updChar(p=>({...p,traumas:Math.max(0,p.traumas-1)}))}>−</button><button className="rbtn" onClick={()=>updChar(p=>({...p,traumas:p.traumas+1}))}>+</button></div>
                <div style={{fontSize:8,color:"var(--text-dim)",marginTop:2,fontStyle:"italic"}}>−{c.traumas} Stress Max</div>
              </div>
            </div>
          </div>

          {c.motivation&&(
            <div className="panel">
              <div className="slabel">Background</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:11,marginBottom:8}}>
                {[["Height",c.height],["Eye Color",c.eyeColor],["Hair",c.hair],["Features",c.features]].filter(([,v])=>v).map(([l,v])=>(
                  <div key={l}><span style={{color:"var(--text-dim)",fontSize:8,fontFamily:"'Cinzel',serif",letterSpacing:1}}>{l}: </span><span>{v}</span></div>
                ))}
              </div>
              {c.motivation&&<div style={{marginBottom:6,fontSize:11}}><span style={{color:"var(--text-dim)",fontSize:8,fontFamily:"'Cinzel',serif",letterSpacing:1}}>MOTIVATION: </span>{c.motivation}</div>}
              {c.values&&<div style={{fontSize:11}}><span style={{color:"var(--text-dim)",fontSize:8,fontFamily:"'Cinzel',serif",letterSpacing:1}}>VALUES: </span>{c.values}</div>}
            </div>
          )}
        </div>
      )}

      {/* ── TALENTS ── */}
        {sub==="talents"&&activeChar&&<TalentsTab c={c} updChar={updChar} setShowLevelUp={setShowLevelUp} activeTimers={activeTimers} onCastSpell={onCastSpell}/>}
      {sub==="inventory"&&<InventoryPanel
        bodyWeight={c.bodyWeight} bodyMod={statMod(c.stats.body)}
        updChar={updChar}
        cPerson={c.invPerson??[]} cBackpack={c.invBackpack??[]}
        cAux1={c.invAux1??[]} cAux2={c.invAux2??[]}
        cEquipped={c.invEquipped??{}}
      />}
      {sub==="guides"&&<GuidesTab/>}
      {sub==="journal"&&<Journal initEntries={c.initJournal??[]}/>}
      {sub==="conditions"&&<Conditions/>}
      {sub==="settings"&&<SettingsTab/>}
      {sub==="tactics"&&activeChar&&<TacticsTab c={activeChar} updChar={updChar}/>}

      {showRoll&&<TetherRollModal stats={c.stats} competencies={c.competencies} critNumber={critNumber} dreadPool={dreadPool} onClose={()=>setShowRoll(false)} onResult={handleRoll}/>}
      {showDeath&&<DeathStateModal current={c.deathState} path={c.path} tether={c.tether} onConfirm={handleDeathConfirm} onClose={()=>setShowDeath(false)}/>}
      {showArchive&&<ArchiveModal charName={c.name} onArchive={()=>archiveChar(c.id)} onDelete={()=>deleteChar(c.id)} onClose={()=>setShowArchive(false)}/>}
      {showWizard&&<CharWizard onComplete={addChar} onCancel={()=>setShowWizard(false)}/>}
      {showLevelUp&&<LevelUpModal char={c} onConfirm={handleLevelUpConfirm} onClose={()=>setShowLevelUp(false)}/>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   GM TAB
══════════════════════════════════════════════════════════════════════════════ */
function GmTab({allChars,onMilestone,critNumber,setCritNumber,dreadPool,setDreadPool,dreadVisible,setDreadVisible}){
  const[showMilestone,setShowMilestone]=useState(false);
  const critD12=useDiceRoller(12);
  const critGrace=critNumber!==null&&critNumber>=7;

  const rollCrit=async()=>{
    const v=await critD12.roll();
    setCritNumber(v);
  };

  // During roll, show spinner value; otherwise show committed critNumber
  const displayedCrit=critD12.rolling?critD12.displayed:critNumber;
  const displayGrace=critD12.rolling?(critD12.displayed>=7):critGrace;

  return(
    <div>
      <div className="panel">
        <div className="slabel">GM Dread Pool</div>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
          <div style={{color:"var(--text-dim)",fontSize:9,fontStyle:"italic",flex:1}}>Spent on enemy actions & complications. Cap: 12.</div>
          <button onClick={()=>setDreadVisible(v=>!v)} style={{padding:"3px 9px",border:`1px solid ${dreadVisible?"var(--grace-dim)":"var(--border)"}`,background:dreadVisible?"rgba(106,179,200,.07)":"var(--section)",color:dreadVisible?"var(--grace)":"var(--text-dim)",fontFamily:"'Cinzel',serif",fontSize:8,letterSpacing:1,cursor:"pointer",borderRadius:1,whiteSpace:"nowrap"}}>
            {dreadVisible?"👁 Visible to Players":"👁 Hidden from Players"}
          </button>
        </div>
        <div className="bigval" style={{color:"var(--dread)"}}>{dreadPool}</div>
        <div className="biglabel">/ 12</div>
        <div className="ctrbtns">
          <button className="ctrbtn" onClick={()=>setDreadPool(Math.max(0,dreadPool-1))}>−</button>
          <button className="ctrbtn" onClick={()=>setDreadPool(Math.min(12,dreadPool+1))}>+</button>
        </div>
        <div style={{marginTop:8,height:4,background:"var(--ink)",borderRadius:2,overflow:"hidden"}}>
          <div style={{height:"100%",width:`${(dreadPool/12)*100}%`,background:"var(--dread)",borderRadius:2,transition:"width .3s"}}/>
        </div>
      </div>
      <div className="panel">
        <div className="slabel">Encounter Crit Number</div>
        <div style={{color:"var(--text-dim)",fontSize:9,fontStyle:"italic",marginBottom:10}}>Roll once per encounter. Player's d12 matching = Crit (2 Tether steps). Visible to all players.</div>
        <div className={`bigval${displayedCrit===null?"":(displayGrace?" grc":" drc")}`} style={{transition:"color .3s"}}>{displayedCrit??"—"}</div>
        <div className="biglabel" style={displayedCrit!==null?{color:displayGrace?"var(--grace)":"var(--dread)"}:{}}>{critD12.rolling?"Rolling…":critNumber!==null?(critGrace?"Grace Crit":"Dread Crit"):"Not Set"}</div>
        <div className="ctrbtns"><button className="ctrbtn" onClick={rollCrit} disabled={critD12.rolling} style={{fontSize:11,padding:"6px 16px"}}>{critD12.rolling?"Rolling…":"Roll d12"}</button></div>
        <div className="critgrid">
          {Array.from({length:12},(_,i)=>i+1).map(n=>(
            <button key={n} className="cnbtn" onClick={()=>setCritNumber(n)} style={{
              borderColor:critNumber===n?(n>=7?"var(--grace)":"var(--dread)"):"var(--border)",
              color:critNumber===n?(n>=7?"var(--grace)":"var(--dread)"):"var(--text-dim)",
              background:critNumber===n?(n>=7?"rgba(106,179,200,.1)":"rgba(200,90,58,.1)"):"var(--section)",
            }}>{n}</button>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="slabel">Milestone — Competency Adjustments</div>
        <div style={{color:"var(--text-dim)",fontSize:9,fontStyle:"italic",marginBottom:10}}>Grant or deduct competency points for selected characters. Applies immediately.</div>
        <button className="mprimary" onClick={()=>setShowMilestone(true)}>⚑ Open Milestone Panel</button>
        {allChars.length===0&&<div style={{fontSize:9,color:"var(--text-dim)",fontStyle:"italic",marginTop:6}}>No active characters yet — players must create characters first.</div>}
      </div>
      {showMilestone&&<MilestoneModal chars={allChars} onClose={result=>{if(result)onMilestone(result);setShowMilestone(false);}}/>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   ADD PLAYER MODAL
══════════════════════════════════════════════════════════════════════════════ */
function AddPlayerModal({onAdd,onClose}){
  const[name,setName]=useState("");
  return(
    <div className="moverlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:320}}>
        <div className="mtitle">Add Player</div>
        <div className="mbody">Enter the player's name to create their tab.</div>
        <input className="cname" value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&name.trim()&&onAdd(name.trim())} placeholder="Player name…" autoFocus style={{marginBottom:14}}/>
        <button className="mprimary" onClick={()=>onAdd(name.trim())} disabled={!name.trim()}>Add Player</button>
        <button className="msec" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   ROOT APP
══════════════════════════════════════════════════════════════════════════════ */
export default function App(){
  const[sharedState,setSharedState]=useState(DEFAULT_EXTENSION_STATE);
  const[activeTab,setActiveTab]=useState("gm");
  const[showAdd,setShowAdd]=useState(false);
  const[isReady,setIsReady]=useState(false);
  const[isGM,setIsGM]=useState(true);
  const lastSavedStateRef=useRef(JSON.stringify(DEFAULT_EXTENSION_STATE));

  const setExtensionState=updater=>{
    setSharedState(prev=>normalizeExtensionState(typeof updater==="function"?updater(prev):updater));
  };

  useEffect(()=>{
    let mounted=true;
    let unsubscribe=()=>{};

    const applyLoadedState=rawState=>{
      const nextState=normalizeExtensionState(rawState);
      lastSavedStateRef.current=JSON.stringify(nextState);
      if(mounted) setSharedState(nextState);
    };

    if(hasObrSdk()){
      OBR.onReady(async()=>{
        const role=await OBR.player.getRole();
        if(!mounted) return;
        setIsGM(role==="GM");
        const metadata=await OBR.room.getMetadata();
        if(!mounted) return;
        applyLoadedState(metadata[ROOM_STATE_KEY]);
        setIsReady(true);
        unsubscribe=OBR.room.onMetadataChange(metadata=>{
          applyLoadedState(metadata[ROOM_STATE_KEY]);
        });
      });
    }else{
      try{
        applyLoadedState(JSON.parse(localStorage.getItem(LOCAL_STATE_KEY)??"null"));
      }catch{
        applyLoadedState(DEFAULT_EXTENSION_STATE);
      }
      setIsReady(true);
    }

    return()=>{
      mounted=false;
      unsubscribe();
    };
  },[]);

  useEffect(()=>{
    if(!isReady) return;
    const serialized=JSON.stringify(sharedState);
    if(serialized===lastSavedStateRef.current) return;
    lastSavedStateRef.current=serialized;

    if(hasObrSdk()){
      void OBR.room.setMetadata({[ROOM_STATE_KEY]:sharedState});
    }else{
      localStorage.setItem(LOCAL_STATE_KEY, serialized);
    }
  },[isReady,sharedState]);

  const { players, gmCritNumber, activeTimers, gmDreadPool, dreadVisible, playerChars } = sharedState;
  const visibleTab=activeTab==="gm"&&!isGM?(players[0]?.id??null):activeTab;

  useEffect(()=>{
    if(visibleTab==="gm"&&isGM) return;
    if(visibleTab!==null&&visibleTab!=="gm"&&players.some(player=>player.id===visibleTab)) return;
    if(isGM){
      setActiveTab("gm");
    }else if(players.length>0){
      setActiveTab(players[0].id);
    }
  },[isGM,players,visibleTab]);

  const addTimer=t=>setExtensionState(prev=>({
    ...prev,
    activeTimers: prev.activeTimers.length>=3?prev.activeTimers:[...prev.activeTimers,t],
  }));
  const updateTimers=ts=>setExtensionState(prev=>({...prev,activeTimers:ts}));
  const removeTimer=id=>setExtensionState(prev=>({...prev,activeTimers:prev.activeTimers.filter(t=>t.id!==id)}));

  const handleCharsChange=(playerId,chars)=>{
    setExtensionState(prev=>({...prev,playerChars:{...prev.playerChars,[playerId]:chars}}));
  };

  const addPlayer=name=>{
    const id=uid();
    setExtensionState(prev=>({
      ...prev,
      players:[...prev.players,{id,name}],
      playerChars:{...prev.playerChars,[id]:[]},
    }));
    setActiveTab(id);
    setShowAdd(false);
  };
  const removePlayer=id=>{
    setExtensionState(prev=>{
      const nextChars={...prev.playerChars};
      delete nextChars[id];
      return{
        ...prev,
        players:prev.players.filter(pl=>pl.id!==id),
        playerChars:nextChars,
      };
    });
    if(activeTab===id)setActiveTab(isGM?"gm":null);
  };

  // All active chars for GM milestone
  const allActiveChars=Object.values(playerChars).flat().filter(c=>!c.archived);

  // Apply milestone result directly to lifted char state
  const handleMilestone=result=>{
    if(!result)return;
    setExtensionState(prev=>{
      const next={};
      Object.entries(prev.playerChars).forEach(([pid,chars])=>{
        next[pid]=chars.map(c=>{
          if(!result.chars.includes(c.id))return c;
          const sign=result.direction==="grant"?1:-1;
          const newComps={...c.competencies};
          if(result.type==="gm"&&result.comp){
            newComps[result.comp]=Math.max(0,(newComps[result.comp]||0)+sign*result.pts);
          } else if(result.type==="player"&&result.allocs?.[c.id]){
            Object.entries(result.allocs[c.id]).forEach(([k,v])=>{
              newComps[k]=Math.max(0,(newComps[k]||0)+sign*v);
            });
          }
          return{...c,competencies:newComps};
        });
      });
      return {...prev,playerChars:next};
    });
  };

  const setGmCritNumber=value=>setExtensionState(prev=>({...prev,gmCritNumber:typeof value==="function"?value(prev.gmCritNumber):value}));
  const setGmDreadPool=value=>setExtensionState(prev=>({...prev,gmDreadPool:typeof value==="function"?value(prev.gmDreadPool):value}));
  const setDreadVisible=value=>setExtensionState(prev=>({...prev,dreadVisible:typeof value==="function"?value(prev.dreadVisible):value}));

  if(!isReady){
    return(
      <>
        <style>{CSS}</style>
        <div className="app">
          <div className="panel" style={{textAlign:"center",padding:"32px 20px",color:"var(--text-dim)",fontStyle:"italic"}}>
            Loading Tether…
          </div>
        </div>
      </>
    );
  }

  return(
    <>
      <style>{CSS}</style>
      <div className="app">
        <div className="hdr">
          <div className="title">TETHER</div>
          <div className="subtitle">Session Tracker — Cadmia</div>
        </div>

        <ActiveTimerBar timers={activeTimers} onUpdate={updateTimers} onRemove={removeTimer}/>
        <div className="ptabs-wrap">
          {isGM&&<button className={`ptab${visibleTab==="gm"?" on":""}`} onClick={()=>setActiveTab("gm")}>⚔ GM</button>}
          {players.map(pl=>(
            <button key={pl.id} className={`ptab${visibleTab===pl.id?" on":""}`} onClick={()=>setActiveTab(pl.id)}>
              {pl.name}
              <span className="ptab-x" onClick={e=>{e.stopPropagation();if(confirm(`Remove ${pl.name}'s tab?`))removePlayer(pl.id);}}>✕</span>
            </button>
          ))}
          <button className="add-player-btn" onClick={()=>setShowAdd(true)}>+ Add Player</button>
        </div>

        {visibleTab==="gm"&&isGM&&<GmTab
          allChars={allActiveChars}
          onMilestone={handleMilestone}
          critNumber={gmCritNumber} setCritNumber={setGmCritNumber}
          dreadPool={gmDreadPool} setDreadPool={setGmDreadPool}
          dreadVisible={dreadVisible} setDreadVisible={setDreadVisible}
        />}
        {players.map(pl=>(
          <div key={pl.id} style={{display:visibleTab===pl.id?"block":"none"}}>
            <PlayerSheet
              critNumber={gmCritNumber}
              dreadPool={dreadVisible?gmDreadPool:null}
              onCharsChange={chars=>handleCharsChange(pl.id,chars)}
              initialChars={playerChars[pl.id]||[]}
              activeTimers={activeTimers}
              onCastSpell={addTimer}
            />
          </div>
        ))}

        {players.length===0&&visibleTab==="gm"&&(
          <div style={{textAlign:"center",marginTop:24,color:"var(--text-dim)",fontSize:11,fontStyle:"italic"}}>
            Click <b style={{color:"var(--gold-dim)"}}>+ Add Player</b> to create player tabs.
          </div>
        )}
        {players.length===0&&visibleTab===null&&(
          <div style={{textAlign:"center",marginTop:24,color:"var(--text-dim)",fontSize:11,fontStyle:"italic"}}>
            Ask the GM to create a player tab to begin tracking.
          </div>
        )}

        {showAdd&&<AddPlayerModal onAdd={addPlayer} onClose={()=>setShowAdd(false)}/>}
      </div>
    </>
  );
}
