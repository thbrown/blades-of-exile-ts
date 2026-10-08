/**
 * The service worker that lets the published game run offline (a PWA).
 *
 * Plain JS, not TypeScript: vite.config.ts (`serviceWorker()`) copies it to
 * `<outDir>/sw.js` after a build, replacing the placeholders below with the
 * build's version and its lists of files. The dev server never registers
 * it (main.ts), so `npm run dev` and the verify scripts are unaffected.
 *
 * - **Precached**: the game, its graphics/sounds/fonts/dialogs, the Exile III
 *   pages, the library's catalog, and of each bundled scenario only what the
 *   startup screen shows (`scenario.xml` for its card, `preview.png`). One
 *   cache per build; a new build's worker fills its own and deletes the old.
 * - **A bundled scenario is cached once it's played**: the first time the
 *   game loads any other file of `scenarios/<id>/`, the worker fetches the
 *   whole directory into a cache of its own, `boe-scenario-<id>-<hash>`, the
 *   hash being of that scenario's files. A build that leaves a scenario alone
 *   keeps its cache as it is; one that changes it refreshes it the next time
 *   it's played online, and until then — or offline — the old copy serves.
 *   Exile III isn't among them: the browser converts it from the installer
 *   and keeps it in IndexedDB (src/platform/exile3.ts).
 * - **Cached when first fetched**: the library's previews and the Exile III
 *   installer. The library's scenario zips are not: an installed scenario is
 *   already kept whole in IndexedDB, so a second copy here would only cost
 *   the player space.
 * - **Pages are network-first**, so an online player always gets the latest
 *   build; offline, any page under the site falls back to its cached copy
 *   (the query string — `?scenario=`, `?seed=` — is ignored for that).
 */

const VERSION = 'c17fa4b9105394cd';
/** Paths relative to the worker's scope (the site's base URL). */
const PRECACHE = /** @type {string[]} */ (["assets/common-BIJYUJ0k.css","assets/common-Cp8bwXiZ.js","assets/e3ItemUse-BXg4fznU.js","assets/e3StartItems-B3ZY3hLa.js","assets/exile3Worker-Bm4vbS31.js","assets/index-ZKF56ozP.js","assets/items-D-cVuubu.js","assets/items-qKx4mHF8.css","assets/main-CWcOQXs3.js","assets/map-B221-i07.css","assets/map-OC_mKMyO.js","assets/spellTarget-DKmFWFTp.js","assets/spells-DkzrlkCc.css","assets/spells-mBsuqr-V.js","assets/terrainPics-Brc4NVrv.js","assets/tiling-CCQu8FX0.js","data/cursors/E.gif","data/cursors/N.gif","data/cursors/NE.gif","data/cursors/NW.gif","data/cursors/READ_BEFORE_EDITING.txt","data/cursors/S.gif","data/cursors/SE.gif","data/cursors/SW.gif","data/cursors/W.gif","data/cursors/boot.gif","data/cursors/bottomright.gif","data/cursors/brush.gif","data/cursors/bucket.gif","data/cursors/drop.gif","data/cursors/eraser.gif","data/cursors/eyedropper.gif","data/cursors/hand.gif","data/cursors/key.gif","data/cursors/look.gif","data/cursors/spraycan.gif","data/cursors/sword.gif","data/cursors/talk.gif","data/cursors/target.gif","data/cursors/topleft.gif","data/cursors/wait.gif","data/cursors/wand.gif","data/cursors/watch.gif","data/dialogs/.gitignore","data/dialogs/1str-lg.xml","data/dialogs/1str-title-lg.xml","data/dialogs/1str-title.xml","data/dialogs/1str.xml","data/dialogs/2str-lg.xml","data/dialogs/2str-title-lg.xml","data/dialogs/2str-title.xml","data/dialogs/2str.xml","data/dialogs/abort-game.xml","data/dialogs/about-boe.xml","data/dialogs/about-pced.xml","data/dialogs/about-scened.xml","data/dialogs/add-new-sheet.xml","data/dialogs/add-random-items.xml","data/dialogs/adventure-notes.xml","data/dialogs/ask-save-replay.xml","data/dialogs/attack-friendly.xml","data/dialogs/basic-button.xml","data/dialogs/basic-lever.xml","data/dialogs/basic-portal.xml","data/dialogs/basic-slope-down.xml","data/dialogs/basic-slope-up.xml","data/dialogs/basic-stair-down.xml","data/dialogs/basic-stair-up.xml","data/dialogs/basic-trap.xml","data/dialogs/boat-bridge.xml","data/dialogs/cast-spell.xml","data/dialogs/change-terrain.xml","data/dialogs/choose-bg.xml","data/dialogs/choose-edit-string.xml","data/dialogs/choose-location.xml","data/dialogs/choose-pattern.xml","data/dialogs/choose-pict.xml","data/dialogs/choose-sdf.xml","data/dialogs/choose-string.xml","data/dialogs/clear-items-confirm.xml","data/dialogs/confirm-edit-item.xml","data/dialogs/confirm-edit-monst.xml","data/dialogs/confirm-edit-out-wand.xml","data/dialogs/confirm-edit-personality.xml","data/dialogs/confirm-edit-quest.xml","data/dialogs/confirm-edit-shop.xml","data/dialogs/confirm-edit-spec-item.xml","data/dialogs/confirm-edit-spells.xml","data/dialogs/confirm-edit-terrain.xml","data/dialogs/confirm-interrupt-replay.xml","data/dialogs/confirm-interrupt-special.xml","data/dialogs/confirm-overwrite.xml","data/dialogs/confirm-reset-help.xml","data/dialogs/confirm-spend-xp.xml","data/dialogs/congrats-save.xml","data/dialogs/convert-pics-now.xml","data/dialogs/dark-slope-down.xml","data/dialogs/dark-slope-up.xml","data/dialogs/data-dump-confirm.xml","data/dialogs/debug-crash-confirm.xml","data/dialogs/delete-pc-confirm.xml","data/dialogs/delete-town-confirm.xml","data/dialogs/dialog.css","data/dialogs/dialog.xsl","data/dialogs/discard-special-node.xml","data/dialogs/drop-item-confirm.xml","data/dialogs/edit-day.xml","data/dialogs/edit-dialog-text.xml","data/dialogs/edit-intro.xml","data/dialogs/edit-item-abils.xml","data/dialogs/edit-item-shortcut.xml","data/dialogs/edit-item.xml","data/dialogs/edit-mabil-general.xml","data/dialogs/edit-mabil-missile.xml","data/dialogs/edit-mabil-overwrite.xml","data/dialogs/edit-mabil-radiate.xml","data/dialogs/edit-mabil-special.xml","data/dialogs/edit-mabil-summon.xml","data/dialogs/edit-monster-abils.xml","data/dialogs/edit-monster.xml","data/dialogs/edit-outdoor-details.xml","data/dialogs/edit-outdoor-encounter.xml","data/dialogs/edit-party.xml","data/dialogs/edit-personality.xml","data/dialogs/edit-placed-item.xml","data/dialogs/edit-quest.xml","data/dialogs/edit-scenario-advanced.xml","data/dialogs/edit-scenario-details.xml","data/dialogs/edit-scenario-events.xml","data/dialogs/edit-shop-item.xml","data/dialogs/edit-shop-special.xml","data/dialogs/edit-shop.xml","data/dialogs/edit-sign.xml","data/dialogs/edit-sounds.xml","data/dialogs/edit-special-assign.xml","data/dialogs/edit-special-item.xml","data/dialogs/edit-special-node.xml","data/dialogs/edit-special-text-sm.xml","data/dialogs/edit-special-text.xml","data/dialogs/edit-talk-node.xml","data/dialogs/edit-ter-obj.xml","data/dialogs/edit-terrain.xml","data/dialogs/edit-text.xml","data/dialogs/edit-town-advanced.xml","data/dialogs/edit-town-details.xml","data/dialogs/edit-town-events.xml","data/dialogs/edit-town-varying.xml","data/dialogs/edit-town-wandering.xml","data/dialogs/edit-townperson-advanced.xml","data/dialogs/edit-townperson.xml","data/dialogs/edit-vehicle.xml","data/dialogs/edit-xp.xml","data/dialogs/event-journal.xml","data/dialogs/get-items.xml","data/dialogs/get-mabil-num.xml","data/dialogs/get-num.xml","data/dialogs/get-response.xml","data/dialogs/graphic-sheets.xml","data/dialogs/graphic-types.xml","data/dialogs/have-no-pics.xml","data/dialogs/have-only-full-pics.xml","data/dialogs/help-combat.xml","data/dialogs/help-contest.xml","data/dialogs/help-debug.xml","data/dialogs/help-distributing.xml","data/dialogs/help-editing.xml","data/dialogs/help-fields.xml","data/dialogs/help-hints.xml","data/dialogs/help-inventory.xml","data/dialogs/help-magic.xml","data/dialogs/help-or-harm.xml","data/dialogs/help-outdoor.xml","data/dialogs/help-party.xml","data/dialogs/help-testing.xml","data/dialogs/help-town.xml","data/dialogs/inventory-full.xml","data/dialogs/item-info.xml","data/dialogs/job-board.xml","data/dialogs/keep-stored-items.xml","data/dialogs/kill-party-confirm.xml","data/dialogs/known-bugs.xml","data/dialogs/leave-scenario.xml","data/dialogs/leave-town.xml","data/dialogs/locked-door-action.xml","data/dialogs/make-scenario1.xml","data/dialogs/make-scenario2.xml","data/dialogs/many-str.xml","data/dialogs/monster-info.xml","data/dialogs/must-delete-in-order.xml","data/dialogs/need-party.xml","data/dialogs/new-party.xml","data/dialogs/new-shop.xml","data/dialogs/new-town.xml","data/dialogs/no-items-added.xml","data/dialogs/no-items-property.xml","data/dialogs/no-items.xml","data/dialogs/not-at-edge.xml","data/dialogs/not-split.xml","data/dialogs/party-death.xml","data/dialogs/pc-alchemy-info.xml","data/dialogs/pc-info.xml","data/dialogs/pc-spell-info.xml","data/dialogs/pick-pc-name.xml","data/dialogs/pick-potion.xml","data/dialogs/pick-race-abil.xml","data/dialogs/pick-save.xml","data/dialogs/pick-scenario.xml","data/dialogs/pick-spec-type.xml","data/dialogs/pref-character.xml","data/dialogs/pref-scenario.xml","data/dialogs/preferences.xml","data/dialogs/preview-dialogs-confirm.xml","data/dialogs/quest-info.xml","data/dialogs/quit-confirm-nosave.xml","data/dialogs/quit-confirm-save.xml","data/dialogs/removed-special-items.xml","data/dialogs/reset-story.xml","data/dialogs/resize-outdoors.xml","data/dialogs/restart-game.xml","data/dialogs/reunite-first.xml","data/dialogs/reunited.xml","data/dialogs/save-before-close.xml","data/dialogs/save-before-launch.xml","data/dialogs/save-before-load.xml","data/dialogs/save-before-quit.xml","data/dialogs/save-before-revert.xml","data/dialogs/save-close.xml","data/dialogs/save-legacy-scen.xml","data/dialogs/save-open.xml","data/dialogs/save-quit.xml","data/dialogs/save-revert.xml","data/dialogs/scen-version-mismatch.xml","data/dialogs/select-import-town.xml","data/dialogs/select-pc.xml","data/dialogs/select-sector.xml","data/dialogs/select-town-edit.xml","data/dialogs/select-town-enter.xml","data/dialogs/set-area-desc.xml","data/dialogs/set-not-owned.xml","data/dialogs/set-sdf.xml","data/dialogs/shift-outdoor-section.xml","data/dialogs/shift-town-entrance.xml","data/dialogs/show-map.xml","data/dialogs/skill-info.xml","data/dialogs/slimy-stair-down.xml","data/dialogs/slimy-stair-up.xml","data/dialogs/soul-crystal.xml","data/dialogs/spell-info.xml","data/dialogs/spend-xp.xml","data/dialogs/steal-item.xml","data/dialogs/talk-notes.xml","data/dialogs/text-dump-confirm.xml","data/dialogs/tip-of-day.xml","data/dialogs/view-sign.xml","data/dialogs/welcome.xml","data/fonts/bold.ttf","data/fonts/dungeon.ttf","data/fonts/maidenword.ttf","data/fonts/plain.ttf","data/graphics/CREDITS.md","data/graphics/bigscenpics.png","data/graphics/blank.png","data/graphics/boe-icon.png","data/graphics/booms.png","data/graphics/buttons.png","data/graphics/bwpats.png","data/graphics/dlgbtnred.png","data/graphics/dlogbtnhelp.png","data/graphics/dlogbtnled.png","data/graphics/dlogbtnlg.png","data/graphics/dlogbtnmed.png","data/graphics/dlogbtnsm.png","data/graphics/dlogbtntall.png","data/graphics/dlogpics.png","data/graphics/dlogscrollled.png","data/graphics/dlogscrollwh.png","data/graphics/edbuttons.png","data/graphics/edsplash.png","data/graphics/fields.png","data/graphics/fighthelp.png","data/graphics/icon.png","data/graphics/invenbtns.png","data/graphics/inventory.png","data/graphics/missiles.png","data/graphics/monst1.png","data/graphics/monst10.png","data/graphics/monst11.png","data/graphics/monst2.png","data/graphics/monst3.png","data/graphics/monst4.png","data/graphics/monst5.png","data/graphics/monst6.png","data/graphics/monst7.png","data/graphics/monst8.png","data/graphics/monst9.png","data/graphics/objects.png","data/graphics/outhelp.png","data/graphics/pcedbuttons.png","data/graphics/pcedtitle.png","data/graphics/pcs.png","data/graphics/pixpats.png","data/graphics/scenpics.png","data/graphics/spidlogo.png","data/graphics/startanim.png","data/graphics/startbut.png","data/graphics/startsplash.png","data/graphics/startup.png","data/graphics/statarea.png","data/graphics/staticons.png","data/graphics/talkportraits.png","data/graphics/ter1.png","data/graphics/ter10.png","data/graphics/ter11.png","data/graphics/ter12.png","data/graphics/ter13.png","data/graphics/ter14.png","data/graphics/ter19.png","data/graphics/ter2.png","data/graphics/ter3.png","data/graphics/ter4.png","data/graphics/ter5.png","data/graphics/ter6.png","data/graphics/ter7.png","data/graphics/ter8.png","data/graphics/ter9.png","data/graphics/teranim.png","data/graphics/termap.png","data/graphics/terscreen.png","data/graphics/textbar.png","data/graphics/tinyobj.png","data/graphics/townhelp.png","data/graphics/transcript.png","data/graphics/trim.png","data/graphics/vehicle.png","data/shaders/mask.frag","data/shaders/mask.vert","data/sounds/SND0.wav","data/sounds/SND1.wav","data/sounds/SND10.wav","data/sounds/SND11.wav","data/sounds/SND12.wav","data/sounds/SND13.wav","data/sounds/SND14.wav","data/sounds/SND15.wav","data/sounds/SND16.wav","data/sounds/SND17.wav","data/sounds/SND18.wav","data/sounds/SND19.wav","data/sounds/SND2.wav","data/sounds/SND20.wav","data/sounds/SND21.wav","data/sounds/SND22.wav","data/sounds/SND23.wav","data/sounds/SND24.wav","data/sounds/SND25.wav","data/sounds/SND26.wav","data/sounds/SND27.wav","data/sounds/SND28.wav","data/sounds/SND29.wav","data/sounds/SND3.wav","data/sounds/SND30.wav","data/sounds/SND31.wav","data/sounds/SND32.wav","data/sounds/SND33.wav","data/sounds/SND34.wav","data/sounds/SND35.wav","data/sounds/SND36.wav","data/sounds/SND37.wav","data/sounds/SND38.wav","data/sounds/SND39.wav","data/sounds/SND4.wav","data/sounds/SND40.wav","data/sounds/SND41.wav","data/sounds/SND42.wav","data/sounds/SND43.wav","data/sounds/SND44.wav","data/sounds/SND45.wav","data/sounds/SND46.wav","data/sounds/SND47.wav","data/sounds/SND48.wav","data/sounds/SND49.wav","data/sounds/SND5.wav","data/sounds/SND50.wav","data/sounds/SND51.wav","data/sounds/SND52.wav","data/sounds/SND53.wav","data/sounds/SND54.wav","data/sounds/SND55.wav","data/sounds/SND56.wav","data/sounds/SND57.wav","data/sounds/SND58.wav","data/sounds/SND59.wav","data/sounds/SND6.wav","data/sounds/SND60.wav","data/sounds/SND61.wav","data/sounds/SND62.wav","data/sounds/SND63.wav","data/sounds/SND64.wav","data/sounds/SND65.wav","data/sounds/SND66.wav","data/sounds/SND67.wav","data/sounds/SND68.wav","data/sounds/SND69.wav","data/sounds/SND7.wav","data/sounds/SND70.wav","data/sounds/SND71.wav","data/sounds/SND72.wav","data/sounds/SND73.wav","data/sounds/SND74.wav","data/sounds/SND75.wav","data/sounds/SND76.wav","data/sounds/SND77.wav","data/sounds/SND78.wav","data/sounds/SND79.wav","data/sounds/SND8.wav","data/sounds/SND80.wav","data/sounds/SND81.wav","data/sounds/SND82.wav","data/sounds/SND83.wav","data/sounds/SND84.wav","data/sounds/SND85.wav","data/sounds/SND86.wav","data/sounds/SND87.wav","data/sounds/SND88.wav","data/sounds/SND89.wav","data/sounds/SND9.wav","data/sounds/SND90.wav","data/sounds/SND91.wav","data/sounds/SND92.wav","data/sounds/SND93.wav","data/sounds/SND94.wav","data/sounds/SND95.wav","data/sounds/SND96.wav","data/sounds/SND97.wav","data/sounds/SND98.wav","data/sounds/SND99.wav","data/strings/alchemy.txt","data/strings/arena-names.txt","data/strings/help.txt","data/strings/item-abilities.txt","data/strings/item-types-display.txt","data/strings/item-types.txt","data/strings/mage-spells.txt","data/strings/magic-names.txt","data/strings/monster-abilities.txt","data/strings/pcedit.txt","data/strings/picture-types.txt","data/strings/priest-spells.txt","data/strings/shop-specials.txt","data/strings/skills.txt","data/strings/sound-names.txt","data/strings/special-contexts.txt","data/strings/specials-opcodes.txt","data/strings/specials-text-affect.txt","data/strings/specials-text-general.txt","data/strings/specials-text-ifthen.txt","data/strings/specials-text-once.txt","data/strings/specials-text-outdoor.txt","data/strings/specials-text-rect.txt","data/strings/specials-text-town.txt","data/strings/spell-times.txt","data/strings/talk-node-descs.txt","data/strings/ter-flag1.txt","data/strings/ter-flag2.txt","data/strings/ter-flag3.txt","data/strings/tiny-icons.txt","data/strings/tips.txt","data/strings/town-advanced-help.txt","data/strings/traits.txt","data/strings/trap-types.txt","data/strings/trim-names.txt","exile3/README.md","exile3/items.html","exile3/map.html","exile3/spells.html","exile3-icon.png","exile3-preview.png","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/maskable-512.png","index.html","library/catalog.json","manifest.webmanifest","scenarios/busywork/preview.png","scenarios/busywork/scenario.xml","scenarios/stealth/preview.png","scenarios/stealth/scenario.xml","scenarios/valleydy/preview.png","scenarios/valleydy/scenario.xml","scenarios/zakhazi/preview.png","scenarios/zakhazi/scenario.xml"]);
/**
 * Each bundled scenario's files not in `PRECACHE`, relative to its directory,
 * and a hash of their contents.
 */
const SCENARIOS = /** @type {Record<string, {hash: string, files: string[]}>} */ ({"busywork":{"hash":"3b7fec3d78734153","files":["header.exs","items.xml","monsters.xml","out/out0~0.map","out/out0~0.spec","out/out0~0.xml","out/out0~1.map","out/out0~1.spec","out/out0~1.xml","out/out0~2.map","out/out0~2.spec","out/out0~2.xml","scenario.spec","terrain.xml","towns/talk0.xml","towns/talk1.xml","towns/talk2.xml","towns/talk3.xml","towns/town0.map","towns/town0.spec","towns/town0.xml","towns/town1.map","towns/town1.spec","towns/town1.xml","towns/town2.map","towns/town2.spec","towns/town2.xml","towns/town3.map","towns/town3.spec","towns/town3.xml"]},"stealth":{"hash":"e6bf25c3373deafa","files":["graphics/sheet0.png","header.exs","items.xml","monsters.xml","out/out0~0.map","out/out0~0.spec","out/out0~0.xml","out/out0~1.map","out/out0~1.spec","out/out0~1.xml","out/out0~2.map","out/out0~2.spec","out/out0~2.xml","out/out1~0.map","out/out1~0.spec","out/out1~0.xml","out/out1~1.map","out/out1~1.spec","out/out1~1.xml","out/out1~2.map","out/out1~2.spec","out/out1~2.xml","out/out2~0.map","out/out2~0.spec","out/out2~0.xml","out/out2~1.map","out/out2~1.spec","out/out2~1.xml","out/out2~2.map","out/out2~2.spec","out/out2~2.xml","out/out3~0.map","out/out3~0.spec","out/out3~0.xml","out/out3~1.map","out/out3~1.spec","out/out3~1.xml","out/out3~2.map","out/out3~2.spec","out/out3~2.xml","scenario.spec","terrain.xml","towns/talk0.xml","towns/talk1.xml","towns/talk10.xml","towns/talk11.xml","towns/talk12.xml","towns/talk13.xml","towns/talk14.xml","towns/talk15.xml","towns/talk16.xml","towns/talk17.xml","towns/talk18.xml","towns/talk19.xml","towns/talk2.xml","towns/talk20.xml","towns/talk3.xml","towns/talk4.xml","towns/talk5.xml","towns/talk6.xml","towns/talk7.xml","towns/talk8.xml","towns/talk9.xml","towns/town0.map","towns/town0.spec","towns/town0.xml","towns/town1.map","towns/town1.spec","towns/town1.xml","towns/town10.map","towns/town10.spec","towns/town10.xml","towns/town11.map","towns/town11.spec","towns/town11.xml","towns/town12.map","towns/town12.spec","towns/town12.xml","towns/town13.map","towns/town13.spec","towns/town13.xml","towns/town14.map","towns/town14.spec","towns/town14.xml","towns/town15.map","towns/town15.spec","towns/town15.xml","towns/town16.map","towns/town16.spec","towns/town16.xml","towns/town17.map","towns/town17.spec","towns/town17.xml","towns/town18.map","towns/town18.spec","towns/town18.xml","towns/town19.map","towns/town19.spec","towns/town19.xml","towns/town2.map","towns/town2.spec","towns/town2.xml","towns/town20.map","towns/town20.spec","towns/town20.xml","towns/town3.map","towns/town3.spec","towns/town3.xml","towns/town4.map","towns/town4.spec","towns/town4.xml","towns/town5.map","towns/town5.spec","towns/town5.xml","towns/town6.map","towns/town6.spec","towns/town6.xml","towns/town7.map","towns/town7.spec","towns/town7.xml","towns/town8.map","towns/town8.spec","towns/town8.xml","towns/town9.map","towns/town9.spec","towns/town9.xml"]},"valleydy":{"hash":"663573ac70056253","files":["graphics/sheet0.png","header.exs","items.xml","monsters.xml","out/out0~0.map","out/out0~0.spec","out/out0~0.xml","out/out0~1.map","out/out0~1.spec","out/out0~1.xml","out/out0~2.map","out/out0~2.spec","out/out0~2.xml","out/out1~0.map","out/out1~0.spec","out/out1~0.xml","out/out1~1.map","out/out1~1.spec","out/out1~1.xml","out/out1~2.map","out/out1~2.spec","out/out1~2.xml","out/out2~0.map","out/out2~0.spec","out/out2~0.xml","out/out2~1.map","out/out2~1.spec","out/out2~1.xml","out/out2~2.map","out/out2~2.spec","out/out2~2.xml","scenario.spec","terrain.xml","towns/talk0.xml","towns/talk1.xml","towns/talk10.xml","towns/talk11.xml","towns/talk12.xml","towns/talk13.xml","towns/talk14.xml","towns/talk15.xml","towns/talk16.xml","towns/talk17.xml","towns/talk18.xml","towns/talk19.xml","towns/talk2.xml","towns/talk20.xml","towns/talk3.xml","towns/talk4.xml","towns/talk5.xml","towns/talk6.xml","towns/talk7.xml","towns/talk8.xml","towns/talk9.xml","towns/town0.map","towns/town0.spec","towns/town0.xml","towns/town1.map","towns/town1.spec","towns/town1.xml","towns/town10.map","towns/town10.spec","towns/town10.xml","towns/town11.map","towns/town11.spec","towns/town11.xml","towns/town12.map","towns/town12.spec","towns/town12.xml","towns/town13.map","towns/town13.spec","towns/town13.xml","towns/town14.map","towns/town14.spec","towns/town14.xml","towns/town15.map","towns/town15.spec","towns/town15.xml","towns/town16.map","towns/town16.spec","towns/town16.xml","towns/town17.map","towns/town17.spec","towns/town17.xml","towns/town18.map","towns/town18.spec","towns/town18.xml","towns/town19.map","towns/town19.spec","towns/town19.xml","towns/town2.map","towns/town2.spec","towns/town2.xml","towns/town20.map","towns/town20.spec","towns/town20.xml","towns/town3.map","towns/town3.spec","towns/town3.xml","towns/town4.map","towns/town4.spec","towns/town4.xml","towns/town5.map","towns/town5.spec","towns/town5.xml","towns/town6.map","towns/town6.spec","towns/town6.xml","towns/town7.map","towns/town7.spec","towns/town7.xml","towns/town8.map","towns/town8.spec","towns/town8.xml","towns/town9.map","towns/town9.spec","towns/town9.xml"]},"zakhazi":{"hash":"cb663f69bcbc6e1b","files":["graphics/sheet0.png","header.exs","items.xml","monsters.xml","out/out0~0.map","out/out0~0.spec","out/out0~0.xml","out/out0~1.map","out/out0~1.spec","out/out0~1.xml","out/out0~10.map","out/out0~10.spec","out/out0~10.xml","out/out0~11.map","out/out0~11.spec","out/out0~11.xml","out/out0~12.map","out/out0~12.spec","out/out0~12.xml","out/out0~13.map","out/out0~13.spec","out/out0~13.xml","out/out0~14.map","out/out0~14.spec","out/out0~14.xml","out/out0~2.map","out/out0~2.spec","out/out0~2.xml","out/out0~3.map","out/out0~3.spec","out/out0~3.xml","out/out0~4.map","out/out0~4.spec","out/out0~4.xml","out/out0~5.map","out/out0~5.spec","out/out0~5.xml","out/out0~6.map","out/out0~6.spec","out/out0~6.xml","out/out0~7.map","out/out0~7.spec","out/out0~7.xml","out/out0~8.map","out/out0~8.spec","out/out0~8.xml","out/out0~9.map","out/out0~9.spec","out/out0~9.xml","scenario.spec","terrain.xml","towns/talk0.xml","towns/talk1.xml","towns/talk10.xml","towns/talk11.xml","towns/talk12.xml","towns/talk13.xml","towns/talk14.xml","towns/talk15.xml","towns/talk16.xml","towns/talk17.xml","towns/talk18.xml","towns/talk19.xml","towns/talk2.xml","towns/talk20.xml","towns/talk21.xml","towns/talk22.xml","towns/talk3.xml","towns/talk4.xml","towns/talk5.xml","towns/talk6.xml","towns/talk7.xml","towns/talk8.xml","towns/talk9.xml","towns/town0.map","towns/town0.spec","towns/town0.xml","towns/town1.map","towns/town1.spec","towns/town1.xml","towns/town10.map","towns/town10.spec","towns/town10.xml","towns/town11.map","towns/town11.spec","towns/town11.xml","towns/town12.map","towns/town12.spec","towns/town12.xml","towns/town13.map","towns/town13.spec","towns/town13.xml","towns/town14.map","towns/town14.spec","towns/town14.xml","towns/town15.map","towns/town15.spec","towns/town15.xml","towns/town16.map","towns/town16.spec","towns/town16.xml","towns/town17.map","towns/town17.spec","towns/town17.xml","towns/town18.map","towns/town18.spec","towns/town18.xml","towns/town19.map","towns/town19.spec","towns/town19.xml","towns/town2.map","towns/town2.spec","towns/town2.xml","towns/town20.map","towns/town20.spec","towns/town20.xml","towns/town21.map","towns/town21.spec","towns/town21.xml","towns/town22.map","towns/town22.spec","towns/town22.xml","towns/town3.map","towns/town3.spec","towns/town3.xml","towns/town4.map","towns/town4.spec","towns/town4.xml","towns/town5.map","towns/town5.spec","towns/town5.xml","towns/town6.map","towns/town6.spec","towns/town6.xml","towns/town7.map","towns/town7.spec","towns/town7.xml","towns/town8.map","towns/town8.spec","towns/town8.xml","towns/town9.map","towns/town9.spec","towns/town9.xml"]}});

const PRECACHE_NAME = `boe-precache-${VERSION}`;
/** Kept across builds: what's in it is named by what it is, not by a build. */
const RUNTIME_NAME = 'boe-runtime-1';

const scope = new URL(self.registration.scope);
const toUrl = (path) => new URL(path, scope).href;

/** Same-origin paths fetched on demand and then kept. */
const RUNTIME_CACHED = [/^library\/previews\//, /^exile3\/EXL3INST\.EXE$/];
/** Fetched fresh when online, served from the cache when not. */
const NETWORK_FIRST = [/^library\/catalog\.json$/];
const SCENARIO_FILE = /^scenarios\/([^/]+)\/(.+)$/;
const SCENARIO_CACHE = 'boe-scenario-';
const scenarioCacheName = (id) => `${SCENARIO_CACHE}${id}-${SCENARIOS[id]?.hash}`;
/** The scenario a `boe-scenario-<id>-<hash>` cache holds. */
const scenarioOfCache = (name) => name.slice(SCENARIO_CACHE.length, name.lastIndexOf('-'));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE_NAME);
    // `cache: 'reload'` past the HTTP cache, so a file the browser still
    // holds from an older build isn't stored under this build's name.
    await cache.addAll(PRECACHE.map((p) => new Request(toUrl(p), { cache: 'reload' })));
    // Take over at once rather than when every tab has closed: otherwise a
    // player who only ever reloads one tab would never see an update. A tab
    // still running the old build loses nothing it hasn't already loaded,
    // and anything it fetches later falls through to the network, as it
    // would with no worker at all.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('boe-precache-') && name !== PRECACHE_NAME) await caches.delete(name);
      // A scenario this build no longer ships. One it ships changed stays
      // until its new copy is whole (`fetchScenario`).
      if (name.startsWith(SCENARIO_CACHE) && !(scenarioOfCache(name) in SCENARIOS)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const path = url.pathname.slice(scope.pathname.length);

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, PRECACHE_NAME, { ignoreSearch: true }));
  } else if (NETWORK_FIRST.some((re) => re.test(path))) {
    event.respondWith(networkFirst(req, PRECACHE_NAME, {}));
  } else if (RUNTIME_CACHED.some((re) => re.test(path))) {
    event.respondWith(cacheFirst(req, RUNTIME_NAME));
  } else if (SCENARIO_FILE.test(path) && !PRECACHE.includes(path)) {
    const [, id, file] = /** @type {RegExpExecArray} */ (SCENARIO_FILE.exec(path));
    event.respondWith(scenarioFile(event, req, id, file));
  } else {
    event.respondWith(precached(req));
  }
});

/**
 * The precached copy, else the network. `ignoreVary`: a module script's
 * request carries an `Origin` header the install's didn't, and a server that
 * answers `Vary: Origin` (Vite's does) would otherwise never match.
 */
async function precached(req) {
  const cache = await caches.open(PRECACHE_NAME);
  return (await cache.match(req, { ignoreVary: true })) ?? fetch(req);
}

/**
 * The cached copy, else the network — keeping what comes back. Offline with
 * no copy (a library preview never shown online), a 404: the startup card
 * drops a preview that doesn't load, and a 404 is what this is to the page.
 */
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  let resp;
  try {
    resp = await fetch(req);
  } catch {
    return new Response(null, { status: 404, statusText: 'Not saved for offline play' });
  }
  if (resp.ok) await cache.put(req, resp.clone());
  return resp;
}

/**
 * The network, refreshing the cached copy; offline, the cached copy. A page
 * whose own path was never cached (`/blades-of-exile-ts/?scenario=x` is
 * cached as `index.html`) falls back to the game's page.
 */
async function networkFirst(req, cacheName, matchOptions) {
  const cache = await caches.open(cacheName);
  try {
    const resp = await fetch(req);
    if (resp.ok && new URL(req.url).search === '') await cache.put(req, resp.clone());
    return resp;
  } catch (err) {
    const hit = (await cache.match(req, { ...matchOptions, ignoreVary: true }))
      ?? (req.mode === 'navigate' ? await cache.match(toUrl('index.html')) : undefined);
    if (hit) return hit;
    throw err;
  }
}

/**
 * A file of a bundled scenario. Played before (by this build's copy of it):
 * the cached copy. Otherwise the whole scenario is fetched into its cache —
 * this request among them, so nothing downloads twice — and the reply comes
 * from there. Offline with no copy of this build's, an older build's.
 */
async function scenarioFile(event, req, id, file) {
  const entry = SCENARIOS[id];
  if (!entry?.files.includes(file)) {
    // Not in this build (an optional file the loader probes for): offline,
    // the 404 the server would have given, not a network error.
    return fetch(req).catch(() => new Response(null, { status: 404, statusText: 'Not Found' }));
  }
  const cache = await caches.open(scenarioCacheName(id));
  const hit = await cache.match(toUrl(`scenarios/${id}/${file}`));
  if (hit) return hit;
  const downloads = fetchScenario(id);
  // The rest of the scenario keeps downloading after this reply has gone.
  event.waitUntil(Promise.allSettled(downloads.values()));
  try {
    await downloads.get(file);
    const fetched = await cache.match(toUrl(`scenarios/${id}/${file}`));
    if (fetched) return fetched;
  } catch { /* offline, or the file failed: an older copy, else the error */ }
  for (const name of await caches.keys()) {
    if (!name.startsWith(SCENARIO_CACHE) || scenarioOfCache(name) !== id) continue;
    const old = await (await caches.open(name)).match(toUrl(`scenarios/${id}/${file}`));
    if (old) return old;
  }
  // Offline and never played: a 503 the loader recognises by its header
  // (`ScenarioNotOfflineError`, src/fileio/source.ts), so it can say why.
  return fetch(req).catch(() => new Response(null, {
    status: 503, statusText: 'Not saved for offline play', headers: { 'X-BoE-Not-Offline': id },
  }));
}

/** Per scenario, its files' downloads in flight: one fetch each, shared. */
const inFlight = new Map();

/**
 * Starts fetching every file of scenario `id` not already in its cache, once
 * however many requests ask, and returns each file's download. When all of
 * them land, older builds' copies of the scenario are deleted; if any fails,
 * the next request tries the missing ones again.
 */
function fetchScenario(id) {
  const running = inFlight.get(id);
  if (running) return running;
  const name = scenarioCacheName(id);
  const cacheP = caches.open(name);
  /** @type {Map<string, Promise<void>>} */
  const downloads = new Map();
  for (const file of SCENARIOS[id].files) {
    const url = toUrl(`scenarios/${id}/${file}`);
    downloads.set(file, (async () => {
      const cache = await cacheP;
      if (await cache.match(url)) return;
      const resp = await fetch(new Request(url, { cache: 'reload' }));
      if (!resp.ok) throw new Error(`${resp.status} ${url}`);
      await cache.put(url, resp);
    })());
  }
  inFlight.set(id, downloads);
  void Promise.allSettled(downloads.values()).then(async (results) => {
    inFlight.delete(id);
    if (results.some((r) => r.status === 'rejected')) return;
    for (const other of await caches.keys()) {
      if (other !== name && other.startsWith(SCENARIO_CACHE) && scenarioOfCache(other) === id) {
        await caches.delete(other);
      }
    }
  });
  return downloads;
}
