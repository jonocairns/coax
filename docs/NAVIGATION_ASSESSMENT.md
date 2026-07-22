# Navigation Assessment

|                 |                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| Status          | Current-state assessment                                                                                       |
| Date            | 2026-07-22                                                                                                     |
| Scope           | Navigation structure, fullscreen behavior, guide access, keyboard/controller consistency, focus, and dead ends |
| Product context | [PRD — Coax](../PRD.md)                                                                                        |

## Outcome

The overall navigation direction is sound, but it is not yet coherent enough for a production live-TV app, especially for controller use. The mouse path is reasonably aligned with Plex- and Channels-style apps; the keyboard and controller paths currently diverge.

This is a source-level assessment against the current UI screenshots and code, not a recorded native-Windows usability session. The absence of a production EPG, favourites, recents, and production navigation is expected during M0b; the purpose of this review is to identify navigation foundations that should be corrected before those features make the state model more expensive to change.

## What already aligns

| Area                                           | Assessment                                                                                                                                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Channel selector with live preview             | Good. Plex similarly keeps playback in a mini-player while the guide is open. See [Plex big-screen navigation](https://support.plex.tv/articles/navigating-the-big-screen-apps/).                                                                      |
| Video-only fullscreen                          | Good. Keeping the selector windowed and dedicating fullscreen to video establishes a clear distinction between browsing and watching.                                                                                                                  |
| Minimal fullscreen overlay                     | Good. Auto-hidden controls restored by pointer or input are conventional player behavior. See [VLC fullscreen behavior](https://docs.videolan.me/vlc-user/desktop/3.0/en/basic/video.html).                                                            |
| Escape exits fullscreen first                  | Correct for a Windows desktop player. VLC and Kodi both use Escape to leave fullscreen. See [VLC hotkeys](https://docs.videolan.me/vlc-user/desktop/3.0/en/basic/hotkeys.html) and [Kodi keyboard controls](https://kodi.wiki/view/Keyboard_controls). |
| Search, categories, and active-channel styling | Appropriate foundations for the future guide and favourites model.                                                                                                                                                                                     |
| Stop omitted from fullscreen                   | Sensible for a lean-back player. Back/Exit should manage navigation while destructive playback actions remain elsewhere.                                                                                                                               |

## Current navigation model

The intended top-level flow is now:

```text
Channel selector  --Fullscreen-->  Fullscreen video
       ^                                  |
       |                                  | Escape / Exit fullscreen
       +---------  Windowed video  <------+
```

That is a reasonable model, but the actual input behavior varies according to overlay visibility and which renderer owns focus.

## Important gaps

### 1. Back and Escape are not deterministic

The desired hierarchy should be:

- Fullscreen + Escape/Back → windowed video.
- Windowed video + Escape/Back → channel selector.
- Channel selector + Escape/Back → current windowed video, if one exists.
- Open menu or dialog + Escape/Back → close that transient surface first.

Currently:

- Keyboard Escape in fullscreen exits fullscreen correctly.
- Gamepad Back in fullscreen hides the controls instead of exiting fullscreen.
- Gamepad Back in the channel selector does nothing.
- In windowed playback, Escape opens the selector only if the overlay is completely hidden.
- If the passive overlay is visible, Escape can appear to do nothing or require additional presses.

The relevant keyboard paths are in [`src/main/index.ts`](../src/main/index.ts), while controller Back is handled separately in [`OverlayApp.tsx`](../src/renderer/src/OverlayApp.tsx). These paths should consume the same logical navigation action.

This differs from the predictable “Back unwinds one layer” model used by TV apps. Channels documents Back/Exit as returning to the menu, while Kodi and VLC consistently use Escape to leave fullscreen. See [Channels remote navigation](https://getchannels.com/docs/apps/remote-control/general/).

### 2. Controller navigation does not work in the selector

The product requirement says the whole app should be D-pad driven, but the current selector does not implement spatial navigation. [`OverlayApp.tsx`](../src/renderer/src/OverlayApp.tsx) ignores controller input unless the playback-control view is open. Consequently, in the selector:

- D-pad does not move between search, categories, channels, and actions.
- Accept cannot tune the focused channel.
- Back does nothing.
- The active channel is styled but is not automatically focused or scrolled into view.

This is the largest divergence from Channels-, Kodi-, and TiviMate-style apps, where D-pad and Select are the primary model. Channels explicitly uses Up, Down, Left, Right, and Select throughout its interface. See [Channels remote controls](https://getchannels.com/docs/apps/remote-control/general/).

It also conflicts with the [PRD spatial-navigation requirement](../PRD.md), which calls focus state a primary navigation model rather than a later keyboard adaptation.

### 3. Controller input potentially has two owners

Both the shell and overlay independently poll the same gamepad through [`use-controller-navigation.ts`](../src/renderer/src/use-controller-navigation.ts). This creates the possibility that one physical press is interpreted by both renderer windows during a focus transition.

Navigation input should have one owner—preferably Electron main or a dedicated input coordinator—which dispatches one logical action to the currently active navigation state.

### 4. Playback has no clear guide-entry command

Removing the guide icon from the fullscreen overlay is defensible; a minimal overlay is desirable. Its replacement still needs to be discoverable and consistent.

Comparable apps provide at least one rapid route:

- Channels uses Down to open its Quick Guide.
- Plex exposes other currently airing content from the player.
- Kodi has dedicated Guide and Channels commands.
- YouTube TV supports channel up/down, recently watched content, and returning to the last channel.

See [Plex live playback](https://support.plex.tv/articles/115007689648-watching-live-tv/), [Channels Live TV](https://getchannels.com/docs/apps/usage/live-tv/), and [YouTube TV controls](https://support.google.com/youtubetv/answer/7452153).

For Coax, a minimal model would be:

- `G` opens the channel selector or future EPG.
- Controller D-pad Down opens the channel selector or future quick guide.
- Escape/Back from windowed video opens the selector.
- No permanent guide icon is required in fullscreen.

### 5. The selector can still be fullscreened through other routes

The main shell still exposes a Fullscreen button in [`App.tsx`](../src/renderer/src/App.tsx), and F11 toggles fullscreen regardless of whether the app is displaying video or the selector.

That contradicts the current product rule that fullscreen is for video only. The visible shell button should be removed. F11 should either expand active video and enter fullscreen, or do nothing while no video is active.

### 6. There are two independent channel browsers

The shell renders one [`ProviderBrowser`](../src/renderer/src/ProviderBrowser.tsx), while the overlay renders another for the preview experience. Provider readiness automatically opens the overlay browser.

Each component instance owns separate category, search, pending-selection, and local active-channel state. A user can therefore return to what appears to be the same selector but encounter different navigation context. Production navigation should have one canonical selector state and one focus history.

### 7. Returning to the selector should restore context

When reopening the selector, the expected behavior is:

- Current channel selected and scrolled into view.
- Previous category retained.
- A predictable focus target, normally the current channel rather than the search field.
- Search cleared or retained according to an explicit rule.

Kodi exposes “preselect playing channel” as a live-TV navigation setting, illustrating how important this behavior is in long channel lists. See [Kodi live-TV playback settings](https://kodi.wiki/view/Settings/Live_TV/Playback).

### 8. Channel activation is mouse-first

Selecting a channel currently tunes it into the preview, after which the user moves to a separate Fullscreen action. This is a reasonable desktop preview model, but it adds friction for lean-back use.

Plex's big-screen guide restores fullscreen playback when another channel is selected, while Channels Select changes to the selected channel from its Quick Guide. Coax can preserve preview-first behavior, but controller Accept needs an explicit contract. Reasonable options are:

- First Accept tunes the preview; a second Accept on the active channel enters fullscreen.
- Accept tunes the preview while a dedicated controller Play action enters fullscreen.
- A preference controls whether channel selection previews or immediately watches.

The first option is the smallest extension of the current UI.

### 9. Common rapid-navigation features are not present yet

Favourites, recents, last-channel switching, and production channel surfing are explicitly deferred beyond the current M0b slice, so their absence is not a current implementation failure. They should nevertheless influence the navigation model now.

Channels supports a Quick Guide and last-channel action; Plex provides favourites and guide customization; YouTube TV exposes recent programs and channel up/down behavior. See [Channels Live TV](https://getchannels.com/docs/apps/usage/live-tv/), [Plex Program Guide](https://support.plex.tv/articles/225877387-program-guide/), and [YouTube TV viewing controls](https://support.google.com/youtubetv/answer/7452153).

## Recommended priority

1. Define one Back/Escape state machine shared by keyboard and controller.
2. Implement real spatial navigation in `ProviderBrowser`.
3. Centralize controller input so only one surface handles each press.
4. Remove or gate the remaining selector-fullscreen routes.
5. Consolidate the two browser instances or lift their navigation state into a shared owner.
6. Restore focus to the active channel when reopening the selector.
7. Establish guide-entry commands such as `G`, controller Down, and windowed Back.
8. Add channel up/down, last channel, favourites, and recents as the guide work arrives.

## Suggested acceptance scenarios

Run each scenario independently with mouse, keyboard, and the recorded M0 controller where applicable:

1. Launch, choose a category, tune a channel, and enter fullscreen without pointer input.
2. Exit fullscreen, return to the selector, and confirm the current channel is focused and visible.
3. Repeat the fullscreen → windowed video → selector path using only Back/Escape; each press must unwind exactly one layer.
4. Open and dismiss player controls in fullscreen and windowed playback without creating a dead key press.
5. Tune three channels from the selector and verify focus follows the newest accepted channel.
6. Hold or rapidly tap directional input and confirm one renderer handles every edge exactly once.
7. Open stream statistics from the selector and playback states, then return without losing the active-channel context.
8. Verify F11 or any visible fullscreen action cannot fullscreen the selector without active video.

## Conclusion

The visual hierarchy and video-only fullscreen direction align well with comparable live-TV apps. The primary risk is that Coax currently looks like a controller-friendly television interface but still behaves like a mouse-first web interface in its selector and focus model.

The shared navigation state machine and spatial-focus system should be corrected before the EPG is built. Doing so will let the future channel list, time grid, quick guide, favourites, and player overlay share one predictable input model rather than adding more special cases to the existing renderer-specific paths.
