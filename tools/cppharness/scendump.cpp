// `BOE_DUMP_SCEN=<file> boe-native` — load a scenario the way the game does
// (`load_scenario`: legacy `.exs` or packed `.boes`) and print what it built as
// JSON, then exit. `test/legacyImport.test.ts` holds this port's `.exs`
// import against it.
//
// The keys are **this port's** field names, not the C++'s, so the test only
// has to reshape the few places the two models are built differently. Strings
// are raw bytes: anything above 0x7f is written as `\u00XX` — Latin-1, not the
// scenario's own character set — and the test decodes its side the same way.
//
// It runs from a constructor rather than from `main` because the harness has
// one `main` already. This object links last (`stubs.o` and this sort after
// every `src_*.o`), so every other static initializer has run by then.

#include <cstdio>
#include <cstdlib>
#include <string>
#include <unistd.h>

#include "scenario/scenario.hpp"
#include "scenario/town.hpp"
#include "scenario/outdoors.hpp"
#include "scenario/monster.hpp"
#include "scenario/item.hpp"
#include "scenario/shop.hpp"
#include "fileio/fileio.hpp"
#include "fileio/resmgr/res_strings.hpp"

extern fs::path tempDir;

namespace {

std::string out;

void str(const std::string& s) {
	out += '"';
	for(unsigned char c : s) {
		if(c == '"' || c == '\\') { out += '\\'; out += char(c); }
		else if(c < 0x20 || c >= 0x7f) {
			char buf[8];
			snprintf(buf, sizeof buf, "\\u%04x", c);
			out += buf;
		} else out += char(c);
	}
	out += '"';
}

void num(long long n) { out += std::to_string(n); }
void boolean(bool b) { out += b ? "true" : "false"; }

// A tiny comma-tracking writer. `key()` leaves a key pending, and the next
// value written takes it instead of a comma.
std::vector<bool> first;
bool pending_key = false;
void sep() {
	if(pending_key) { pending_key = false; return; }
	if(!first.empty()) {
		if(!first.back()) out += ',';
		first.back() = false;
	}
}
void obj() { sep(); out += '{'; first.push_back(true); }
void arr() { sep(); out += '['; first.push_back(true); }
void end_obj() { out += '}'; first.pop_back(); }
void end_arr() { out += ']'; first.pop_back(); }
void key(const char* k) { sep(); str(k); out += ':'; pending_key = true; }
void v_num(long long v) { sep(); num(v); }
void v_str(const std::string& v) { sep(); str(v); }
void v_bool(bool v) { sep(); boolean(v); }
void kv(const char* k, long long v) { key(k); v_num(v); }
void kb(const char* k, bool v) { key(k); v_bool(v); }
void ks(const char* k, const std::string& v) { key(k); v_str(v); }
void kobj(const char* k) { key(k); obj(); }
void karr(const char* k) { key(k); arr(); }
void kend_obj() { end_obj(); }
void kend_arr() { end_arr(); }

void loc(const char* k, location l) { kobj(k); kv("x", l.x); kv("y", l.y); kend_obj(); }
void rect(const rectangle& r) { kv("top", r.top); kv("left", r.left); kv("bottom", r.bottom); kv("right", r.right); }

void special(const cSpecial& s) {
	obj();
	kv("type", int(s.type)); kv("sd1", s.sd1); kv("sd2", s.sd2); kv("m1", s.m1); kv("m2", s.m2);
	kv("m3", s.m3); kv("pic", s.pic); kv("pictype", s.pictype); kv("ex1a", s.ex1a);
	kv("ex1b", s.ex1b); kv("ex1c", s.ex1c); kv("ex2a", s.ex2a); kv("ex2b", s.ex2b);
	kv("ex2c", s.ex2c); kv("jumpto", s.jumpto);
	end_obj();
}

void specials(const char* k, const std::vector<cSpecial>& list) {
	karr(k);
	for(auto& s : list) special(s);
	kend_arr();
}

void strings(const char* k, const std::vector<std::string>& list) {
	karr(k);
	for(auto& s : list) v_str(s);
	kend_arr();
}

void item(const cItem& i) {
	obj();
	kv("variety", int(i.variety)); kv("itemLevel", i.item_level); kv("awkward", i.awkward);
	kv("bonus", i.bonus); kv("protection", i.protection); kv("charges", i.charges);
	kv("maxCharges", i.max_charges); kv("weapType", int(i.weap_type));
	kv("magicUseType", int(i.magic_use_type)); kv("graphicNum", i.graphic_num);
	kv("ability", int(i.ability)); kv("abilStrength", i.abil_strength);
	kv("abilData", i.abil_data.value); kv("typeFlag", i.type_flag); kv("isSpecial", i.is_special);
	kv("value", i.value); kv("weight", i.weight); kv("specialClass", i.special_class);
	kv("missile", i.missile); loc("itemLoc", i.item_loc); ks("fullName", i.full_name);
	ks("name", i.name); kv("treasClass", i.treas_class); kb("ident", i.ident);
	kb("property", i.property); kb("magic", i.magic); kb("contained", i.contained);
	kb("held", i.held); kb("cursed", i.cursed); kb("concealed", i.concealed);
	kb("enchanted", i.enchanted); kb("unsellable", i.unsellable);
	kb("rechargeable", i.rechargeable); ks("desc", i.desc);
	end_obj();
}

void monster(const cMonster& m) {
	obj();
	ks("name", m.m_name); kv("level", m.level); kv("health", m.m_health); kv("armor", m.armor);
	kv("skill", m.skill);
	karr("attacks");
	for(auto& a : m.a) { obj(); kv("dice", a.dice); kv("sides", a.sides); kv("type", int(a.type)); end_obj(); }
	kend_arr();
	kv("race", int(m.m_type)); kv("speed", m.speed); kv("mu", m.mu); kv("cl", m.cl);
	kv("treasure", m.treasure);
	kobj("abil");
	for(auto& p : m.abil) {
		if(!p.second.active) continue;
		std::string id = std::to_string(int(p.first));
		kobj(id.c_str());
		const uAbility& a = p.second;
		switch(getMonstAbilCategory(p.first)) {
			case eMonstAbilCat::MISSILE:
				kv("type", int(a.missile.type)); kv("pic", a.missile.pic); kv("dice", a.missile.dice);
				kv("sides", a.missile.sides); kv("skill", a.missile.skill); kv("range", a.missile.range);
				kv("odds", a.missile.odds);
				break;
			case eMonstAbilCat::GENERAL:
				kv("type", int(a.gen.type)); kv("pic", a.gen.pic); kv("strength", a.gen.strength);
				kv("range", a.gen.range); kv("odds", a.gen.odds); kv("extra", int(a.gen.stat));
				break;
			case eMonstAbilCat::SUMMON:
				kv("type", int(a.summon.type)); kv("what", a.summon.what); kv("min", a.summon.min);
				kv("max", a.summon.max); kv("len", a.summon.len); kv("chance", a.summon.chance);
				break;
			case eMonstAbilCat::RADIATE:
				kv("type", int(a.radiate.type)); kv("chance", a.radiate.chance); kv("pat", int(a.radiate.pat));
				break;
			case eMonstAbilCat::SPECIAL:
				kv("extra1", a.special.extra1); kv("extra2", a.special.extra2); kv("extra3", a.special.extra3);
				break;
			case eMonstAbilCat::INVALID: break;
		}
		kend_obj();
	}
	kend_obj();
	kv("corpseItem", m.corpse_item); kv("corpseItemChance", m.corpse_item_chance);
	karr("resist");
	for(int d = 0; d < 10; d++) v_num(m.resist[eDamageType(d)]);
	kend_arr();
	kb("mindless", m.mindless); kb("invuln", m.invuln); kb("invisible", m.invisible);
	kb("guard", m.guard); kb("amorphous", m.amorphous); kv("xWidth", m.x_width);
	kv("yWidth", m.y_width); kv("defaultAttitude", int(m.default_attitude));
	kv("summonType", m.summon_type); kv("defaultFacialPic", m.default_facial_pic);
	kv("pictureNum", m.picture_num); kv("ambientSound", m.ambient_sound); kv("seeSpec", m.see_spec);
	end_obj();
}

void terrain(const cTerrain& t) {
	obj();
	ks("name", t.name); kv("picture", t.picture); kv("blockage", int(t.blockage));
	kv("flag1", t.flag1); kv("flag2", t.flag2); kv("flag3", t.flag3); kv("special", int(t.special));
	kv("transToWhat", t.trans_to_what); kb("flyOver", t.fly_over); kb("boatOver", t.boat_over);
	kb("blockHorse", t.block_horse); kb("isArchetype", t.is_archetype);
	kv("lightRadius", t.light_radius); kv("stepSound", int(t.step_sound));
	kv("shortcutKey", (unsigned char)t.shortcut_key); kv("objNum", t.obj_num);
	kv("groundType", t.ground_type); kv("trimType", int(t.trim_type)); kv("trimTer", t.trim_ter);
	kv("frillFor", t.frill_for); kv("frillChance", t.frill_chance); kv("combatArena", t.combat_arena);
	loc("objPos", t.obj_pos); loc("objSize", t.obj_size); kv("mapPic", t.map_pic);
	end_obj();
}

void spec_locs(const char* k, const std::vector<spec_loc_t>& list) {
	karr(k);
	for(auto& l : list) { obj(); kv("x", l.x); kv("y", l.y); kv("spec", l.spec); end_obj(); }
	kend_arr();
}

void area(const cArea& a) {
	ks("name", a.name);
	karr("terrain");
	for(size_t x = 0; x < a.max_dim; x++) {
		arr();
		for(size_t y = 0; y < a.max_dim; y++) v_num(a.terrain[x][y]);
		end_arr();
	}
	kend_arr();
	spec_locs("specialLocs", a.special_locs);
	karr("signLocs");
	for(auto& s : a.sign_locs) { obj(); kv("x", s.x); kv("y", s.y); ks("text", s.text); end_obj(); }
	kend_arr();
	karr("areaDesc");
	for(auto& r : a.area_desc) { obj(); rect(r); ks("descr", r.descr); end_obj(); }
	kend_arr();
	specials("specials", a.specials);
}

void wandering(const cOutdoors::cWandering& w) {
	obj();
	karr("monst"); for(auto m : w.monst) v_num(m); kend_arr();
	karr("friendly"); for(auto m : w.friendly) v_num(m); kend_arr();
	kv("specOnMeet", w.spec_on_meet); kv("specOnWin", w.spec_on_win);
	kv("specOnFlee", w.spec_on_flee); kb("cantFlee", w.cant_flee); kb("forced", w.forced);
	kv("endSpec1", w.end_spec1); kv("endSpec2", w.end_spec2);
	end_obj();
}

void sector(const cOutdoors& o) {
	obj();
	area(o);
	ks("comment", o.comment);
	kv("ambientSound", int(o.ambient_sound));
	karr("specialSpot");
	for(int x = 0; x < 48; x++) { arr(); for(int y = 0; y < 48; y++) v_bool(o.special_spot[x][y]); end_arr(); }
	kend_arr();
	karr("roads");
	for(int x = 0; x < 48; x++) { arr(); for(int y = 0; y < 48; y++) v_bool(o.roads[x][y]); end_arr(); }
	kend_arr();
	spec_locs("cityLocs", o.city_locs);
	strings("specStrs", o.spec_strs);
	karr("wandering"); for(auto& w : o.wandering) wandering(w); kend_arr();
	karr("specialEnc"); for(auto& w : o.special_enc) wandering(w); kend_arr();
	karr("wanderingLocs");
	for(auto& l : o.wandering_locs) { obj(); kv("x", l.x); kv("y", l.y); end_obj(); }
	kend_arr();
	end_obj();
}

void town(const cTown& t) {
	obj();
	area(t);
	kv("maxDim", t.max_dim);
	karr("lighting");
	for(size_t x = 0; x < t.max_dim; x++) { arr(); for(size_t y = 0; y < t.max_dim; y++) v_num(t.lighting[x][y]); end_arr(); }
	kend_arr();
	karr("comment"); for(auto& c : t.comment) v_str(c); kend_arr();
	kv("townChopTime", t.town_chop_time); kv("townChopKey", t.town_chop_key);
	kv("maxNumMonst", t.max_num_monst);
	karr("wandering");
	for(auto& w : t.wandering) { arr(); for(auto m : w.monst) v_num(m); end_arr(); }
	kend_arr();
	karr("wanderingLocs");
	for(auto& l : t.wandering_locs) { obj(); kv("x", l.x); kv("y", l.y); end_obj(); }
	kend_arr();
	kv("lightingType", int(t.lighting_type));
	karr("startLocs");
	for(auto& l : t.start_locs) { obj(); kv("x", l.x); kv("y", l.y); end_obj(); }
	kend_arr();
	spec_locs("exits", std::vector<spec_loc_t>(t.exits.begin(), t.exits.end()));
	kobj("inTownRect"); rect(t.in_town_rect); kend_obj();
	karr("presetItems");
	for(auto& i : t.preset_items) {
		obj(); loc("loc", i.loc); kv("code", i.code); kv("ability", int(i.ability));
		kv("charges", i.charges); kb("alwaysThere", i.always_there); kb("property", i.property);
		kb("contained", i.contained); end_obj();
	}
	kend_arr();
	karr("presetFields");
	for(auto& f : t.preset_fields) { obj(); loc("loc", f.loc); kv("type", int(f.type)); end_obj(); }
	kend_arr();
	karr("creatures");
	for(auto& c : t.creatures) {
		obj(); kv("number", c.number); kv("startAttitude", int(c.start_attitude));
		loc("startLoc", c.start_loc); kv("mobility", c.mobility); kv("timeFlag", int(c.time_flag));
		kv("spec1", c.spec1); kv("spec2", c.spec2); kv("specEncCode", c.spec_enc_code);
		kv("timeCode", c.time_code); kv("monsterTime", c.monster_time);
		kv("personality", c.personality); kv("specialOnKill", c.special_on_kill);
		kv("specialOnTalk", c.special_on_talk); kv("facialPic", c.facial_pic); end_obj();
	}
	kend_arr();
	kv("specOnEntry", t.spec_on_entry); kv("specOnEntryIfDead", t.spec_on_entry_if_dead);
	kv("specOnHostile", t.spec_on_hostile);
	karr("timers");
	for(auto& tm : t.timers) { obj(); kv("time", tm.time); kv("node", tm.node); end_obj(); }
	kend_arr();
	kb("strongBarriers", t.strong_barriers); kb("defyMapping", t.defy_mapping);
	kb("defyScrying", t.defy_scrying); kb("isHidden", t.is_hidden); kb("hasTavern", t.has_tavern);
	kv("difficulty", t.difficulty);
	strings("specStrs", t.spec_strs);
	kobj("talk");
	karr("people");
	for(auto& p : t.talking.people) {
		obj(); ks("title", p.title); ks("look", p.look); ks("name", p.name); ks("job", p.job);
		ks("dunno", p.dunno); end_obj();
	}
	kend_arr();
	karr("talkNodes");
	for(auto& n : t.talking.talk_nodes) {
		obj(); kv("personality", n.personality); kv("type", int(n.type));
		ks("link1", std::string(n.link1, 4)); ks("link2", std::string(n.link2, 4));
		karr("extras"); for(auto e : n.extras) v_num(e); kend_arr();
		ks("str1", n.str1); ks("str2", n.str2); end_obj();
	}
	kend_arr();
	kend_obj();
	end_obj();
}

void vehicles(const char* k, const std::vector<cVehicle>& list) {
	karr(k);
	for(auto& v : list) {
		obj(); loc("loc", v.loc); loc("sector", v.sector); kv("whichTown", v.which_town);
		kb("exists", v.exists); kb("property", v.property); end_obj();
	}
	kend_arr();
}

void shop(cShop& s) {
	obj();
	ks("name", s.getName()); kv("type", int(s.getType())); kv("prompt", int(s.getPrompt()));
	kv("face", s.getFace()); kv("costAdj", s.getCostAdjust());
	karr("items");
	for(size_t i = 0; i < s.size(); i++) {
		cShopItem e = s.getItem(i);
		obj(); kv("type", int(e.type)); kv("quantity", e.quantity); kv("index", e.index);
		key("item"); item(e.item);
		end_obj();
	}
	kend_arr();
	end_obj();
}

void dump(cScenario& s) {
	obj();
	ks("title", s.scen_name);
	karr("teasers"); v_str(s.teaser_text[0]); v_str(s.teaser_text[1]); kend_arr();
	karr("introMsgs"); for(auto& m : s.intro_strs) v_str(m); kend_arr();
	kv("introPic", s.intro_pic); kv("numTowns", s.towns.size());
	kv("outWidth", s.outdoors.width()); kv("outHeight", s.outdoors.height());
	kv("startTown", s.which_town_start); kv("difficulty", s.difficulty);
	kb("adjustDiff", s.adjust_diff); kb("isLegacy", s.is_legacy);
	loc("townStart", s.where_start); loc("outdoorStart", s.out_sec_start);
	loc("sectorStart", s.out_start);
	karr("terTypes"); for(auto& t : s.ter_types) terrain(t); kend_arr();
	karr("scenItems"); for(auto& i : s.scen_items) item(i); kend_arr();
	karr("scenMonsters"); for(auto& m : s.scen_monsters) monster(m); kend_arr();
	karr("towns"); for(auto t : s.towns) town(*t); kend_arr();
	karr("outdoors");
	for(size_t x = 0; x < s.outdoors.width(); x++) {
		arr();
		for(size_t y = 0; y < s.outdoors.height(); y++) sector(*s.outdoors[x][y]);
		end_arr();
	}
	kend_arr();
	specials("scenSpecials", s.scen_specials);
	karr("shops"); for(auto& sh : s.shops) shop(sh); kend_arr();
	karr("specialItems");
	for(auto& si : s.special_items) {
		obj(); kv("flags", si.flags); kv("special", si.special); ks("name", si.name);
		ks("descr", si.descr); end_obj();
	}
	kend_arr();
	karr("scenarioTimers");
	for(auto& tm : s.scenario_timers) { obj(); kv("time", tm.time); kv("node", tm.node); end_obj(); }
	kend_arr();
	kv("initSpec", s.init_spec);
	strings("specStrs", s.spec_strs);
	karr("townMods");
	for(auto& m : s.town_mods) { obj(); kv("spec", m.spec); kv("x", m.x); kv("y", m.y); end_obj(); }
	kend_arr();
	kobj("storeItemRects");
	for(auto& p : s.store_item_rects) {
		std::string id = std::to_string(p.first);
		kobj(id.c_str()); rect(p.second); kend_obj();
	}
	kend_obj();
	vehicles("boats", s.boats);
	vehicles("horses", s.horses);
	end_obj();
}

__attribute__((constructor)) void boe_dump_scenario() {
	const char* path = getenv("BOE_DUMP_SCEN");
	if(path == nullptr) return;
	// What `init_directories` would have set up: the string lists the loader
	// reads (`magic-names`, …) and a scratch directory it clears graphics into.
	const char* data = getenv("BOE_DUMP_DATA");
	const char* temp = getenv("BOE_TEMP_DIR");
	if(data == nullptr || temp == nullptr) {
		fprintf(stderr, "BOE_DUMP_SCEN needs BOE_DUMP_DATA and BOE_TEMP_DIR (use dump-scen.sh)\n");
		_exit(2);
	}
	ResMgr::strings.pushPath(fs::path(data)/"strings");
	tempDir = temp;
	cScenario scenario;
	if(!load_scenario(path, scenario)) {
		fprintf(stderr, "could not load %s\n", path);
		_exit(1);
	}
	dump(scenario);
	// The loader prints progress to stdout too, so the JSON follows a marker.
	fputs("\n@@SCENDUMP@@\n", stdout);
	fwrite(out.data(), 1, out.size(), stdout);
	fflush(stdout);
	_exit(0);
}

} // namespace
