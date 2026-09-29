/**
 * Special-node records — the scenario scripting bytecode.
 * Ported from ../exile-wasm/src/scenario/special.hpp. Enum values are part
 * of the file format and MUST stay numerically identical.
 */

export enum SpecType {
  INVALID = -1,
  NONE = 0,
  SET_SDF = 1,
  INC_SDF = 2,
  DISPLAY_MSG = 3,
  ENTER_SHOP = 4,
  DISPLAY_SM_MSG = 5,
  FLIP_SDF = 6,
  SDF_RANDOM = 7,
  SDF_ADD = 8,
  SDF_DIFF = 9,
  STORY_DIALOG = 10,
  CANT_ENTER = 11,
  CHANGE_TIME = 12,
  SCEN_TIMER_START = 13,
  PLAY_SOUND = 14,
  CHANGE_HORSE_OWNER = 15,
  CHANGE_BOAT_OWNER = 16,
  SET_TOWN_VISIBILITY = 17,
  MAJOR_EVENT_OCCURRED = 18,
  FORCED_GIVE = 19,
  BUY_ITEMS_OF_TYPE = 20,
  CALL_GLOBAL = 21,
  SET_SDF_ROW = 22,
  COPY_SDF = 23,
  DISPLAY_PICTURE = 24,
  REST = 25,
  TITLED_MSG = 26,
  END_SCENARIO = 27,
  SET_POINTER = 28,
  SET_CAMP_FLAG = 29,
  PRINT_NUMS = 30,
  SDF_TIMES = 31,
  SDF_DIVIDE = 32,
  SDF_POWER = 33,
  CHANGE_TER = 34,
  SWAP_TER = 35,
  TRANS_TER = 36,
  CLEAR_BUF = 37,
  APPEND_STRING = 38,
  APPEND_NUM = 39,
  APPEND_MONST = 40,
  APPEND_ITEM = 41,
  APPEND_TER = 42,
  PAUSE = 43,
  START_TALK = 44,
  UPDATE_QUEST = 45,
  SWAP_STR_BUF = 46,
  STR_BUF_TO_SIGN = 47,
  /**
   * An exile-js opcode, not in BoE or OBoE: add journal string `ex1a` to the
   * events journal, dated today. OBoE has the journal and `add_to_journal`
   * but no node that calls it; Exile III adds entries from its scripts.
   */
  ADD_JOURNAL = 48,

  ONCE_GIVE_ITEM = 50,
  ONCE_GIVE_SPEC_ITEM = 51,
  ONCE_NULL = 52,
  ONCE_SET_SDF = 53,
  ONCE_DISPLAY_MSG = 54,
  ONCE_DIALOG = 55,
  UNUSED13 = 56,
  UNUSED14 = 57,
  ONCE_GIVE_ITEM_DIALOG = 58,
  UNUSED15 = 59,
  UNUSED16 = 60,
  ONCE_OUT_ENCOUNTER = 61,
  ONCE_TOWN_ENCOUNTER = 62,
  ONCE_TRAP = 63,

  SELECT_TARGET = 80,
  DAMAGE = 81,
  AFFECT_HP = 82,
  AFFECT_SP = 83,
  AFFECT_XP = 84,
  AFFECT_SKILL_PTS = 85,
  AFFECT_DEADNESS = 86,
  AFFECT_STATUS = 87,
  AFFECT_TRAITS = 88,
  AFFECT_AP = 89,
  AFFECT_NAME = 90,
  AFFECT_LEVEL = 91,
  AFFECT_MORALE = 92,
  AFFECT_SOUL_CRYSTAL = 93,
  GIVE_ITEM = 94,
  AFFECT_MONST_TARG = 95,
  AFFECT_MONST_ATT = 96,
  AFFECT_MONST_STAT = 97,
  AFFECT_STAT = 98,
  AFFECT_MAGE_SPELL = 99,
  AFFECT_PRIEST_SPELL = 100,
  AFFECT_GOLD = 101,
  AFFECT_FOOD = 102,
  AFFECT_ALCHEMY = 103,
  AFFECT_PARTY_STATUS = 104,
  CREATE_NEW_PC = 105,
  STORE_PC = 106,
  UNSTORE_PC = 107,
  /**
   * An exile-js opcode, not in BoE or OBoE: each target's health becomes
   * `ex1a` percent of what it is, rounded down. Exile III halves the party's
   * in the Pit of the Wyrm (DIVERGENCES.md #22).
   */
  AFFECT_HP_PERCENT = 108,
  /**
   * An exile-js opcode, not in BoE or OBoE: every magic item leaves each
   * living target's pack, and with `ex1a` 1 every magic item lying in the
   * town is destroyed. Exile III's Great Circle does both (DIVERGENCES.md #22).
   */
  AFFECT_TAKE_MAGIC_ITEMS = 109,

  IF_SDF = 130,
  IF_TOWN_NUM = 131,
  IF_RANDOM = 132,
  IF_HAVE_SPECIAL_ITEM = 133,
  IF_SDF_COMPARE = 134,
  IF_TER_TYPE = 135,
  IF_ALIVE = 136,
  IF_HAS_GOLD = 137,
  IF_HAS_FOOD = 138,
  IF_ITEM_CLASS_ON_SPACE = 139,
  IF_HAVE_ITEM_CLASS = 140,
  IF_EQUIP_ITEM_CLASS = 141,
  IF_MAGE_SPELL = 142,
  IF_PRIEST_SPELL = 143,
  IF_RECIPE = 144,
  IF_STATUS = 145,
  IF_LOOKING = 146,
  IF_DAY_REACHED = 147,
  IF_FIELDS = 148,
  IF_PARTY_SIZE = 149,
  IF_EVENT_OCCURRED = 150,
  IF_SPECIES = 151,
  IF_TRAIT = 152,
  IF_STATISTIC = 153,
  IF_TEXT_RESPONSE = 154,
  IF_SDF_EQ = 155,
  IF_CONTEXT = 156,
  IF_NUM_RESPONSE = 157,
  IF_IN_BOAT = 158,
  IF_ON_HORSE = 159,
  IF_QUEST = 160,
  /**
   * An exile-js opcode, not in BoE or OBoE: jump to `ex1b` if town `ex1a`
   * shows on the map (`can_find`). SET_TOWN_VISIBILITY sets it, but no node
   * reads it; Exile III's scripts test it (`can_find_town[t]`).
   */
  IF_TOWN_VISIBLE = 161,
  /**
   * An exile-js opcode, not in BoE or OBoE: jump to `ex1c` if the party came
   * into the current town with an entry direction from `ex1a` to `ex1b`
   * (`start_town_mode`'s `entry_dir`: 0–3 an entrance, 9 put there by a
   * script). Exile III's town loader tests it.
   */
  IF_ENTRY_DIR = 162,
  /**
   * An exile-js opcode, not in BoE or OBoE: jump to `ex1b` if the town's
   * creature in slot `ex1a` passes test `ex2a` — 0 it is here (alive), 1 it
   * is here with attitude `ex2b`, 2 its group has not been brought in yet
   * (its live encounter code is still set), or 3 — whatever the slot — the
   * town has fewer than `ex2b` creatures here. Exile III reads its
   * creatures' records directly (DIVERGENCES.md #21).
   */
  IF_CREATURE = 163,

  MAKE_TOWN_HOSTILE = 170,
  TOWN_RUN_MISSILE = 171,
  TOWN_MONST_ATTACK = 172,
  TOWN_BOOM_SPACE = 173,
  TOWN_MOVE_PARTY = 174,
  TOWN_HIT_SPACE = 175,
  TOWN_EXPLODE_SPACE = 176,
  TOWN_LOCK_SPACE = 177,
  TOWN_UNLOCK_SPACE = 178,
  TOWN_SFX_BURST = 179,
  TOWN_CREATE_WANDERING = 180,
  TOWN_PLACE_MONST = 181,
  TOWN_DESTROY_MONST = 182,
  TOWN_NUKE_MONSTS = 183,
  TOWN_GENERIC_LEVER = 184,
  TOWN_GENERIC_PORTAL = 185,
  TOWN_GENERIC_BUTTON = 186,
  TOWN_GENERIC_STAIR = 187,
  TOWN_LEVER = 188,
  TOWN_PORTAL = 189,
  TOWN_STAIR = 190,
  TOWN_RELOCATE = 191,
  TOWN_PLACE_ITEM = 192,
  TOWN_SPLIT_PARTY = 193,
  TOWN_REUNITE_PARTY = 194,
  TOWN_TIMER_START = 195,
  TOWN_CHANGE_LIGHTING = 196,
  TOWN_SET_ATTITUDE = 197,
  TOWN_SET_CENTER = 198,
  TOWN_LIFT_FOG = 199,
  TOWN_START_TARGETING = 200,
  TOWN_SPELL_PAT_FIELD = 201,
  TOWN_SPELL_PAT_BOOM = 202,
  TOWN_RELOCATE_CREATURE = 203,
  TOWN_PLACE_LABEL = 204,
  /**
   * An exile-js opcode, not in BoE or OBoE: change the town's creature in
   * slot `ex1a` (-1 every creature, -2 the one being talked to), only where
   * it is here. `ex1b` names what: 0 wakes it to hunt the party (`active`
   * 2), 1 sets its health to `ex1c`, 2 takes it away, and 3 takes it away
   * and sets its death flag, as a conversation's END_DIE does. `ex2a`, when
   * positive, keeps to creatures of attitude `ex2a - 1`. Exile III writes
   * its creatures' records directly (DIVERGENCES.md #21).
   */
  TOWN_SET_CREATURE = 205,
  /**
   * An exile-js opcode, not in BoE or OBoE: the `ex2a` × `ex2b` rectangle at
   * (`ex1b`, `ex1c`) takes the terrain town record `ex1a` has there, square
   * by square as CHANGE_TER would. Exile III rebuilds a village on every
   * visit, with each building ruined once its day has come; the converter
   * keeps each village's ruins in a record of its own (DIVERGENCES.md #24).
   */
  TOWN_COPY_TERRAIN = 206,

  RECT_PLACE_FIELD = 210,
  RECT_SET_EXPLORED = 211,
  RECT_MOVE_ITEMS = 212,
  RECT_DESTROY_ITEMS = 213,
  RECT_CHANGE_TER = 214,
  RECT_SWAP_TER = 215,
  RECT_TRANS_TER = 216,
  RECT_LOCK = 217,
  RECT_UNLOCK = 218,

  OUT_MAKE_WANDER = 225,
  OUT_FORCE_TOWN = 226,
  OUT_PLACE_ENCOUNTER = 227,
  OUT_MOVE_PARTY = 228,
}

/** PIC_CUSTOM_FULL — a scenario's `sheet<pic>`, drawn whole (pictypes.hpp). */
export const PIC_CUSTOM_FULL = 111;

/** PIC_DLOG — the default pictype for nodes (pictypes.hpp). */
export const PIC_DLOG = 4;
/** PIC_SCEN — the scenario's own icon sheet, which `handle_message` falls back to. */
export const PIC_SCEN = 6;

/** The 15-short cSpecial record, kept raw for file-format fidelity. */
export interface SpecialNode {
  type: SpecType;
  sd1: number;
  sd2: number;
  m1: number;
  m2: number;
  m3: number;
  pic: number;
  pictype: number;
  ex1a: number;
  ex1b: number;
  ex1c: number;
  ex2a: number;
  ex2b: number;
  ex2c: number;
  jumpto: number;
}

/** Field defaults from SpecialParser::init_block. */
export function emptySpecialNode(): SpecialNode {
  return {
    type: SpecType.NONE,
    sd1: -1,
    sd2: -1,
    m1: -1,
    m2: -1,
    m3: -1,
    pic: -1,
    pictype: PIC_DLOG,
    ex1a: -1,
    ex1b: -1,
    ex1c: -1,
    ex2a: -1,
    ex2b: -1,
    ex2c: -1,
    jumpto: -1,
  };
}
