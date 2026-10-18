// Client half of dsh-peak.
//
// Shows whether DeepSeek's API pricing is in its peak or off-peak window right
// now, as a compact chip at the left of the composer tool row. Clicking it
// expands the schedule behind the verdict.
//
// The whole policy is a pure function of the Beijing wall clock plus the
// statutory holiday table below, so this half is self-contained: no network, no
// host RPC. It must never load a clock or a timer from the ambient globals —
// browser timers are trapped in a client half, and the disposable interval comes
// from the `timer` service instead.
//
// Policy (api-docs.deepseek.com/zh-cn/quick_start/pricing):
//   "北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为高峰时段；
//    其余时段，包括周末及中国法定节假日全天均为空闲时段。"
//   "空闲时段价格为高峰时段价格的一半。"
// The English page says the same thing in UTC ("01:00 - 04:00 and 06:00 - 10:00
// UTC, Monday through Friday, excluding Chinese public holidays" = the two local
// windows above) and repeats that weekends and holidays are off-peak in full.
// So weekends really have no peak window at all: do not "fix" this file into a
// seven-day schedule.

// The factory scope is the only safe place for a binding: bundle files are
// concatenated into page-global `<script>`s, and every shipped bundle keeps its
// top level to the single `load(...)` call for exactly that reason. Hence the id
// appears twice — this call and the `PACKAGE_ID` inside the factory — and the two
// must be changed together.
window.__ModuleLoader__.load({
  id: 'dsh-peak',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const PACKAGE_ID = 'dsh-peak';

    // #region policy

    const CHINA_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
    const PEAK_WINDOWS = [[9 * 60, 12 * 60], [14 * 60, 18 * 60]];
    const TICK_MS = 30000;

    /**
     * One single source of truth per year.
     *
     * The table carries its own year so the coverage check in `peakState` cannot
     * drift from the data: `HOLIDAY_COVERAGE` is derived from these rows rather
     * than maintained beside them. Adding a year's rows *is* extending coverage,
     * which makes a half-finished year bump impossible.
     *
     * Sources:
     *   2026 — 国务院办公厅关于2026年部分节假日安排的通知, 国办发明电〔2025〕7号
     *          https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm
     *
     * Holiday ranges are inclusive and written `[month, day]`; each row stays one
     * line so a future year's notice can replace its block wholesale.
     */
    const HOLIDAY_TABLE = {
      '2026': {
        year: 2026,
        rows: [
          ['元旦', [[1, 1], [1, 3]]],
          ['春节', [[2, 15], [2, 23]]],
          ['清明节', [[4, 4], [4, 6]]],
          ['劳动节', [[5, 1], [5, 5]]],
          ['端午节', [[6, 19], [6, 21]]],
          ['中秋节', [[9, 25], [9, 27]]],
          ['国庆节', [[10, 1], [10, 7]]],
        ],
        // 调休上班日. DeepSeek's rule keys on 「周一至周五」 and names weekends
        // off-peak in full, so these make-up workdays that land on a weekend stay
        // OFF-PEAK. They are kept only so the expanded card can say so out loud
        // instead of leaving the reader to guess.
        makeUp: [[1, 4], [2, 14], [2, 28], [5, 9], [9, 20], [10, 10]],
      },
    };

    /** Years the table above covers, in declaration order. */
    const HOLIDAY_COVERAGE = Object.values(HOLIDAY_TABLE)
      .map((entry) => entry.year)
      .sort((a, b) => a - b);
    const LATEST_COVERED_YEAR = HOLIDAY_COVERAGE[HOLIDAY_COVERAGE.length - 1];

    /** Month-day key. Built as a string, so no leading-zero or octal trap exists. */
    function mdKey(month, day) {
      return `${month}/${day}`;
    }

    /** Flatten one year's rows into a key -> holiday name table. */
    function buildHolidayTable(entry) {
      const table = new Map();
      for (const [name, [from, to]] of entry.rows) {
        const cursor = new Date(Date.UTC(entry.year, from[0] - 1, from[1]));
        const last = new Date(Date.UTC(entry.year, to[0] - 1, to[1]));
        while (cursor.getTime() <= last.getTime()) {
          table.set(mdKey(cursor.getUTCMonth() + 1, cursor.getUTCDate()), name);
          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
      }
      return table;
    }

    /**
     * One year's flattened table and make-up set, built on first use and cached
     * on the entry, so the year object stays the only thing a maintainer edits.
     *
     * @returns undefined when the year is not in the table at all.
     */
    function holidayYear(year) {
      const entry = HOLIDAY_TABLE[String(year)];
      if (entry === undefined) return undefined;
      if (entry.table === undefined) {
        entry.table = buildHolidayTable(entry);
        entry.makeUpKeys = new Set(entry.makeUp.map(([m, d]) => mdKey(m, d)));
      }
      return entry;
    }

    /**
     * The holiday record for one Beijing civil date, or undefined.
     *
     * Two different "undefined"s matter here and they are not the same question:
     * `holidayYear` answers "does the table cover this year at all", while this
     * answers "is this particular day a statutory holiday". Use the year function
     * when the walk needs to stop on unknown territory; use this one to name a
     * day off.
     *
     * Only the name comes back. Whether the day is a 调休 make-up workday is a
     * separate question — by construction such a day is never in this table — so
     * it is asked with `isMakeUpDay` below rather than smuggled in as a field that
     * could only ever be false.
     */
    function holidayLookup(year, month, day) {
      const entry = holidayYear(year);
      if (entry === undefined) return undefined;
      const name = entry.table.get(mdKey(month, day));
      if (name === undefined) return undefined;
      return { name };
    }

    /** Whether one Beijing civil date is a 调休 make-up workday (a working weekend). */
    function isMakeUpDay(year, month, day) {
      const entry = holidayYear(year);
      return entry === undefined ? false : entry.makeUpKeys.has(mdKey(month, day));
    }

    /** `minutes` past midnight as `HH:MM`. */
    function hhmm(minutes) {
      const hour = Math.floor(minutes / 60);
      const minute = minutes % 60;
      return `${hour < 10 ? '0' : ''}${hour}:${minute < 10 ? '0' : ''}${minute}`;
    }

    /**
     * `2026-08-19` for a Beijing instant, backed by UTC formatting of a shifted
     * instant.
     *
     * Deliberately language-free: the weekday is returned as its number and the
     * view renders both, because the policy region must stay executable on its
     * own by `verify-policy.mjs`.
     */
    function formatCivilDate(instantMs) {
      try {
        return new Intl.DateTimeFormat('en-CA', {
          timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date(instantMs));
      } catch {
        const date = new Date(instantMs);
        const month = date.getUTCMonth() + 1;
        const dayOfMonth = date.getUTCDate();
        return `${date.getUTCFullYear()}-${month < 10 ? '0' : ''}${month}-${dayOfMonth < 10 ? '0' : ''}${dayOfMonth}`;
      }
    }

    /** The current 谷时 window, or undefined during peak. */
    function activePeakWindow(minuteOfDay) {
      for (const [open, close] of PEAK_WINDOWS) {
        if (minuteOfDay >= open && minuteOfDay < close) return [open, close];
      }
      return undefined;
    }

    /**
     * Where the off-peak stretch containing this moment ends.
     *
     * Walks whole Beijing days forward. `inDays` counts them from the current
     * civil date, so callers describe the target as 今天 / 明天 / N 天后 without
     * recovering the offset from timestamps.
     *
     * @param nowMs - an instant already known to be off-peak.
     * @returns the next peak-window open, or a verdict that the walk found none.
     */
    function offPeakReach(nowMs) {
      const shiftedNow = new Date(nowMs + CHINA_UTC_OFFSET_MS);
      const minuteNow = shiftedNow.getUTCHours() * 60 + shiftedNow.getUTCMinutes();
      for (let inDays = 0; inDays < 400; inDays += 1) {
        // Two clocks, and both are needed. Today (`inDays === 0`) has to be judged
        // against the moment itself, or a 12:30 noon break answers "09:00 is still
        // ahead"; every later day is judged at midnight, because there the whole
        // day is ahead and the first window is the next one.
        const cursor = new Date(nowMs + CHINA_UTC_OFFSET_MS - ((nowMs + CHINA_UTC_OFFSET_MS) % 86400000) + inDays * 86400000);
        const weekday = cursor.getUTCDay();
        const entry = holidayYear(cursor.getUTCFullYear());
        // A year the table does not cover makes every day in it a working day:
        // peakState already refuses to answer there, so this only stops the walk
        // from inventing a holiday-free answer it would never be asked to show.
        if (entry === undefined) return { kind: 'later' };
        if (entry.table.has(mdKey(cursor.getUTCMonth() + 1, cursor.getUTCDate()))) continue;
        if (weekday === 0 || weekday === 6) continue;
        const minuteOfDay = inDays === 0 ? minuteNow : 0;
        for (const window of PEAK_WINDOWS) {
          if (minuteOfDay < window[0]) return { kind: 'peak', inDays, open: window[0], close: window[1] };
          if (minuteOfDay < window[1]) return { kind: 'peak', inDays, open: window[0], close: window[1] };
        }
      }
      return { kind: 'later' };
    }

    /**
     * Resolve the full badge state for one instant.
     *
     * Weekday and clock are read on the moment itself, never on its date: a
     * Beijing Friday runs off-peak past 18:00 and straight into a Saturday, so
     * the weekend rule has to win for that Friday-evening instant even though
     * the same civil date held a peak window hours earlier.
     *
     * @param nowMs - the instant to judge.
     * @returns peak / off-peak / unknown, with the schedule behind the verdict.
     */
    function peakState(nowMs) {
      // Snap to the start of the current Beijing minute. The policy is stated in
      // whole minutes, so seconds are noise; without the snap a printed gap can
      // round up by up to a minute (09:00:30 showing "3 小时" for 179.5).
      nowMs -= nowMs % 60000;
      const shifted = new Date(nowMs + CHINA_UTC_OFFSET_MS);
      const year = shifted.getUTCFullYear();
      const month = shifted.getUTCMonth() + 1;
      const day = shifted.getUTCDate();
      const weekday = shifted.getUTCDay();
      const minuteOfDay = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
      const dateText = formatCivilDate(nowMs + CHINA_UTC_OFFSET_MS);
      const schedule = PEAK_WINDOWS.map(([open, close]) => `${hhmm(open)}–${hhmm(close)}`).join(' · ');

      const isWeekend = weekday === 0 || weekday === 6;

      /** One shape for every off-peak verdict; only the reasoning differs. */
      const offPeak = (reason, reasonParams, tail) => {
        const reach = offPeakReach(nowMs);
        let next;
        if (reach.kind === 'peak') {
          const targetMs = nowMs + reach.inDays * 86400000 + reach.open * 60000 - minuteOfDay * 60000;
          // Numbers, not sentences: `at` is a bare clock time, `inDays` a count
          // and `leftMinutes` a duration. The view formats all three, which is
          // what lets `verify-policy.mjs` execute this region on its own.
          next = {
            at: hhmm(reach.open),
            inDays: reach.inDays,
            leftMinutes: Math.max(1, Math.round((targetMs - nowMs) / 60000)),
          };
        }
        return {
          status: 'off',
          dateText,
          weekday,
          discount: 'rateOffPeak',
          reason,
          reasonParams,
          tail,
          schedule,
          next,
        };
      };

      // The table stopping early removes the answer only for days whose verdict
      // actually depends on it. A statutory holiday's does; a weekend's does not
      // — the official wording names weekends off-peak in full, with no reference
      // to any year's notice, and this plugin already lets the weekend rule win
      // over a 调休 make-up workday (see `makeup` below). So a Saturday beyond the
      // table is still a confident 谷时, and only weekdays fall back to the third,
      // honest posture. `offPeakReach` stops on the same boundary, so the card
      // says the rate without inventing a next switch it cannot know.
      if (!HOLIDAY_COVERAGE.includes(year)) {
        if (isWeekend) return offPeak('weekendUncovered', { weekday }, 'allDayOff');
        return {
          status: 'unknown', dateText, weekday, schedule,
          reason: 'tableExhausted',
          reasonParams: { latest: LATEST_COVERED_YEAR, year },
        };
      }

      const entry = holidayLookup(year, month, day);
      const holiday = entry === undefined ? undefined : entry.name;
      // Asked separately from `holidayLookup`: a 调休 workday is by definition not
      // a statutory holiday, so it never appears in that lookup — it is the one
      // case where "the official rule counts the weekday" needs saying out loud.
      const isMakeup = isMakeUpDay(year, month, day);

      // Every off-peak instant routes through the same day-walk. Doing it here
      // rather than with a special case per gap is what keeps the noon break
      // (12:00-14:00) and a Friday evening honest: both have a next peak that is
      // not "tomorrow 09:00", and both are exactly what offPeakReach computes.
      if (holiday !== undefined || isWeekend) {
        // The leading reason names the day and carries the whole explanation for
        // a make-up workday, where "it is Saturday" alone would not.
        if (isMakeup) return offPeak('makeup', { weekday }, 'allDayOff');
        if (holiday !== undefined) return offPeak('holiday', { name: holiday }, 'allDayOff');
        return offPeak('weekend', { weekday }, 'allDayOff');
      }

      const peakWindow = activePeakWindow(minuteOfDay);
      if (peakWindow !== undefined) {
        const closeAt = new Date(nowMs + CHINA_UTC_OFFSET_MS);
        closeAt.setUTCHours(Math.floor(peakWindow[1] / 60), peakWindow[1] % 60, 0, 0);
        return {
          status: 'peak',
          dateText,
          weekday,
          discount: 'rateStandard',
          reason: 'peakWorkday',
          schedule,
          next: {
            at: hhmm(peakWindow[1]),
            inDays: 0,
            leftMinutes: Math.max(1, Math.round((closeAt.getTime() - CHINA_UTC_OFFSET_MS - nowMs) / 60000)),
          },
        };
      }

      // Off-peak on a working day: either the noon break (next peak today) or the
      // evening run-out (next peak tomorrow or later). offPeakReach tells them
      // apart, so there is no need to guess which one this is. No `tail`: the one
      // sentence already says everything there is to say here.
      return offPeak('workingDayOff');
    }

    /**
     * What to warn about, or null when there is nothing worth saying.
     *
     * The rate is decided by the moment a request is *sent*, so a switch two
     * minutes away is a decision the user can still act on: sending now pays the
     * old rate, sending after pays the new one. That is the whole reason this
     * function exists — the chip already answers "what is the rate now", and the
     * card already answers "when does it change".
     *
     * Pure on purpose, like the rest of this region: `verify-policy.mjs` runs the
     * region on its own, so nothing here may reach for a clock, a document or a
     * language table. The caller supplies `leadMinutes`.
     *
     * `key` names the *boundary*, not the moment it was noticed. The clock ticks
     * every 30s, so a two-minute lead is observed four times; without a stable
     * key the toast would be re-issued on every tick and the remaining minutes
     * would visibly count down inside a notice the user cannot dismiss. The date
     * plus the day offset plus the clock time is exactly the identity of one
     * window edge, and it retires itself at the Beijing day rollover.
     *
     * @param state - a verdict from `peakState`.
     * @param leadMinutes - how long before the switch to speak up; 0 disables.
     */
    function alertPlan(state, leadMinutes) {
      if (!(leadMinutes > 0)) return null;
      if (state === undefined || state === null) return null;
      // An unknown verdict has no `next` by construction, but say so out loud:
      // a table-exhausted year must never be announced as an imminent switch.
      if (state.status !== 'peak' && state.status !== 'off') return null;
      const next = state.next;
      if (next === undefined || next === null) return null;
      if (next.leftMinutes > leadMinutes) return null;
      return {
        key: `${state.dateText}|${next.inDays}|${next.at}`,
        // A boundary always lands on the other side of it, so the destination is
        // the complement of where we are. Only one of the two saves money.
        entering: state.status === 'peak' ? 'off' : 'peak',
        at: next.at,
        inDays: next.inDays,
        leftMinutes: next.leftMinutes,
      };
    }

    // #endregion

    // #region styles

    const STYLE_TAG_ID = `${PACKAGE_ID}/styles`;
    // Stable and package-scoped, so it is unique even though the slot is
    // per-session (one card per open conversation at most).
    const CARD_ID = `${PACKAGE_ID}-card`;
    // `off` and `unknown` restate the base colour on purpose. The off-peak chip
    // used to read --dsw-alias-state-idle-primary, which resolves to
    // --dsw-static-neutral-300 (#d4d4d4 on the light theme) — a border-grade grey
    // at 1.2:1 against the composer, visibly washed out. Declaring the token per
    // status keeps that mistake from coming back silently, and the secondary label
    // is the same neutral family one step darker (5.0:1) that follows the theme in
    // both directions.
    //
    // The chip's status dot carries an explicit `corner-shape: round` for the same
    // kind of reason. The theme installs a global
    // `*, :before, :after { corner-shape: var(--dsw-corner-shape) }` rule whose
    // variable is `superellipse(1.5)` (dsh-client-ui-theme/lib/client.js:1145), and
    // at 6px a superellipse keeps visibly flat sides — the dot renders as a rounded
    // SQUARE, not a circle. Rendering both variants at 10x under Edge confirmed it;
    // engines without `corner-shape` ignore the declaration, so it costs nothing.
    //
    // The card is 304px wide rather than the 264px it started at, because the
    // `下次切换` value has to stay on one line. Its longest form is
    // `N 天后 09:00（M 天 N 小时）`: about 200px at 12px, plus the `下次切换` label
    // (48px) and the 10px flex gap. At 264px that row wrapped, leaving a lone `）`
    // on a second line, which reads as a broken layout rather than a long value.
    // `verify-policy.mjs` guards the format; `demo/shoot.mjs` measures the row and
    // refuses to write a screenshot when a row overflows, since a wrapped row is
    // invisible in the PNG itself.
    //
    // Both surfaces are OPAQUE, and that is a requirement rather than a taste.
    // The wallpaper plugin (dsh-wallpaper-engine) puts `data-we-glass-page` on
    // <body> and folds every alias token that can paint a solid surface into its
    // glass recipe (its own comment calls the batch "全表面玻璃", added to fix
    // "个别面仍是突兀实色块"). Both tokens this component used to read are in it:
    //   --dsw-specific-input-major  -> the composer a transparent chip sat in
    //   --dsw-alias-bg-overlay      -> the card, which is why the panel went
    //                                  see-through when it opened
    // Each becomes `color-mix(in srgb, base floor%, tint alpha%)`, so the variable
    // still EXISTS and a `var(token, #fallback)` never falls back. Reading the
    // static palette instead is what makes the fill opaque regardless of which
    // plugins rewrite the aliases.
    //   chip -> --dsw-static-neutral-bluish-00 / -850, i.e. exactly the two values
    //           `--dsw-specific-input-major` resolves to without the plugin, so the
    //           solid chip matches the composer surface in both themes.
    //   card -> --dsw-static-neutral-bluish-150 / -875, the opaque pair behind
    //           `--dsw-alias-bg-overlay`. The card floats over the wallpaper rather
    //           than sitting in the composer, so it takes the panel shade (the
    //           wallpaper plugin's own solid panel colour is bluish-875 on dark).
    //
    // Each fill then takes a LITTLE of the wallpaper's own colour, so a solid
    // surface still belongs to the picture instead of sitting on it like a sticker.
    // The tint is --we-surface-tint-light/-dark, the wallpaper plugin's own
    // wall-derived colour (it clamps it into a readable luminance band per theme
    // before publishing it). The weight is the complement of the plugin's
    // --we-wallpaper-opacity, so the tint appears with the wallpaper and vanishes
    // with it. Two rules keep the blend honest:
    //   - the mix stays 100% opaque. There is no `transparent` operand anywhere, so
    //     the result cannot become a window, and the verifier refuses one that does.
    //   - the tint weight follows the plugin's own wallpaper-opacity: at the default
    //     fully-faded wallpaper (`--we-wallpaper-opacity: 0`) the weight is 0 and the
    //     fill is exactly the static colour, so nothing changes until the user
    //     actually shows a wallpaper. Because that is the value the plugin REMOVES
    //     when no wallpaper is opaque (`s.removeProperty('--we-wallpaper-opacity')`),
    //     the `0` fallback also covers "plugin not installed" — the math works out
    //     to the plain static fill in every case.
    // The weights are 25% (chip) and 30% (card), measured rather than guessed: at
    // 12-14% the whole move was 4 units of RGB (a #b98f5e wall colour on bluish-150
    // landed on #e9ecf1, i.e. invisible), because the plugin clamps its tint into a
    // readable luminance band and a light wall colour is already close to a light
    // base. The verifier proves the ceiling instead: the theme's own saturated amber
    // (--dsw-alias-state-warn-primary) at 25% still leaves 5.0:1 for the 12px chip
    // label, and at 50% it would not. The card takes more than the chip because it
    // is the larger surface, and the chip is the one carrying coloured text.
    // `color-mix()` percentage arguments are `<percentage> | <calc-sum>`, so a
    // weight that follows the wallpaper's opacity is expressible — but only in some
    // spellings. Measured in the engine this ships to (Edge/Chromium, via
    // `.tmp-probe3.mjs`), `calc((100% - var(--we-wallpaper-opacity, 0)) * 25%)` is
    // ACCEPTED BY CSS.supports() AND THEN SILENTLY DROPPED at computed-value time,
    // which leaves the plain declaration above as the fill and therefore no tint at
    // all — a failure that looks exactly like a working tint in a screenshot.
    // `calc(25% * (1 - var(--we-wallpaper-opacity, 0)))` resolves correctly
    // (verified in the same probe), so that is the form used here and the form the
    // verifier requires. Without the plugin the whole `var()` resolves through its
    // fallback and the declaration still parses; a `var()` that resolved to NOTHING
    // would make the declaration invalid at computed-value time and drop the fill to
    // `transparent`, which is the exact failure this component is written to avoid.
    //
    // Nothing in the literal below may contain a backtick. Inside it the contents are
    // CSS, not source: prose written there is compiled as CSS, and a backtick ends
    // the literal early, which is a SyntaxError reported at the prose. Version 0.1.4
    // broke exactly that way, so the card's comment about the settings rows keeping
    // the dialog role lives up here instead, and the verifier now refuses the file.
    const CSS = `
.peak-badge-root { position: relative; display: inline-flex; }
.peak-badge-chip {
  display: inline-flex; align-items: center; gap: 4px;
  height: 24px; padding: 0 8px; box-sizing: border-box;
  font: inherit; font-size: 12px; line-height: 1;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-static-neutral-bluish-00);
  background: color-mix(in srgb, var(--dsw-static-neutral-bluish-00), var(--we-surface-tint-light, #ffffff) calc(25% * (1 - var(--we-wallpaper-opacity, 0))));
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px; cursor: pointer; white-space: nowrap;
}
body[data-ds-dark-theme] .peak-badge-chip {
  background: var(--dsw-static-neutral-bluish-850);
  background: color-mix(in srgb, var(--dsw-static-neutral-bluish-850), var(--we-surface-tint-dark, #2c2c2e) calc(25% * (1 - var(--we-wallpaper-opacity, 0))));
}
/* Hover darkens every theme, wallpaper or not: it mixes MORE of the same tint,
   which moves away from the light fill and toward the dark one. The old hover
   read --dsw-alias-bg-layer-2, an alias the wallpaper plugin rewrites. */
.peak-badge-chip:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-static-neutral-bluish-150);
  background: color-mix(in srgb, var(--dsw-static-neutral-bluish-150), var(--we-surface-tint-light, #e9ecf2) calc(25% * (1 - var(--we-wallpaper-opacity, 0))));
}
body[data-ds-dark-theme] .peak-badge-chip:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-static-neutral-bluish-750);
  background: color-mix(in srgb, var(--dsw-static-neutral-bluish-750), var(--we-surface-tint-dark, #43454a) calc(25% * (1 - var(--we-wallpaper-opacity, 0))));
}
.peak-badge-chip[data-status="peak"] { color: var(--dsw-alias-state-warn-primary); }
.peak-badge-chip[data-status="off"] { color: var(--dsw-alias-label-secondary); }
.peak-badge-chip[data-status="unknown"] { color: var(--dsw-alias-label-secondary); }
.peak-badge-dot { width: 6px; height: 6px; border-radius: 50%; corner-shape: round; background: currentColor; flex: none; }
.peak-badge-card {
  position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 40;
  width: 304px; box-sizing: border-box; padding: 10px 12px;
  display: flex; flex-direction: column; gap: 6px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-static-neutral-bluish-150);
  background: color-mix(in srgb, var(--dsw-static-neutral-bluish-150), var(--we-surface-tint-light, #e9ecf2) calc(30% * (1 - var(--we-wallpaper-opacity, 0))));
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, .16);
}
body[data-ds-dark-theme] .peak-badge-card {
  background: var(--dsw-static-neutral-bluish-875);
  background: color-mix(in srgb, var(--dsw-static-neutral-bluish-875), var(--we-surface-tint-dark, #232324) calc(30% * (1 - var(--we-wallpaper-opacity, 0))));
}
.peak-badge-row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 12px; }
.peak-badge-row + .peak-badge-row { border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 6px; }
.peak-badge-key { color: var(--dsw-alias-label-secondary); flex: none; }
/* A row is one line by contract: every value here is a short fact (a date, a
   rate, a window), and the card is sized for the longest of them. Letting one
   wrap puts an orphaned word on a second line and the row reads as a mistake. */
.peak-badge-value { text-align: right; white-space: nowrap; }
.peak-badge-value[data-tone="peak"] { color: var(--dsw-alias-state-warn-primary); }
.peak-badge-value[data-tone="off"] { color: var(--dsw-alias-label-secondary); }
.peak-badge-foot { font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.peak-badge-controls {
  display: flex; flex-direction: column; gap: 6px;
  border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 6px;
}
.peak-badge-control { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 12px; }
.peak-badge-select {
  font: inherit; font-size: 12px; height: 22px; padding: 0 4px; box-sizing: border-box; cursor: pointer;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-static-neutral-bluish-00);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px;
}
body[data-ds-dark-theme] .peak-badge-select { background: var(--dsw-static-neutral-bluish-850); }
.peak-badge-check {
  display: inline-flex; align-items: center; gap: 6px;
  font: inherit; font-size: 12px; color: var(--dsw-alias-label-primary); cursor: pointer;
}
.peak-badge-check[data-unavailable="yes"] { color: var(--dsw-alias-label-secondary); cursor: default; }
/* The status words beside the box. Wraps rather than pushing the box out of the
   card, and never shrinks below legibility: this is the line that explains a
   refusal, so it must not be the thing that gets clipped. */
.peak-badge-note { font-size: 11px; color: var(--dsw-alias-label-secondary); min-width: 0; }
.peak-badge-check input { width: 14px; height: 14px; margin: 0; accent-color: var(--dsw-alias-brand-primary, #4176e6); }
/* The pre-switch notice.
   Fixed to the viewport, not to the chip: the clock that raises it runs whether
   or not a conversation is open, so the notice has to be able to appear when the
   chip is not on screen at all. Same corner and stacking order as the skill
   centre's toasts, because two plugins of one family should not disagree about
   where a transient message goes.
   The surface is --dsw-alias-toast-bg, DSH's own toast token, and it is dark in
   BOTH themes — so the ink is a static light palette entry, never a flipping
   label alias. (That mistake is what shipped black-on-black in the sibling
   plugin.) */
.peak-badge-toast {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483002;
  width: 304px; box-sizing: border-box; padding: 10px 12px;
  display: flex; align-items: flex-start; gap: 8px;
  font-size: 12px; line-height: 1.5;
  color: var(--dsw-static-neutral-bluish-00, #fff);
  background: var(--dsw-alias-toast-bg, #353638);
  border: 1px solid rgba(255, 255, 255, .1);
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, .24);
}
/* The dot reuses the chip's shape rule. A notice about money should be
   recognisable as the same object as the chip it belongs to. */
.peak-badge-toast > .peak-badge-dot { margin-top: 5px; flex: none; color: var(--dsw-static-neutral-bluish-300, #cfd3d6); }
.peak-badge-toast[data-entering="peak"] > .peak-badge-dot { color: var(--dsw-static-amber-400, #f7ad31); }
.peak-badge-toast[data-entering="off"] > .peak-badge-dot { color: var(--dsw-static-green-400, #4ed17e); }
.peak-badge-toasttext { flex: 1; min-width: 0; }
.peak-badge-toasttitle { font-weight: 600; }
.peak-badge-toastclose {
  flex: none; width: 18px; height: 18px; padding: 0; margin: -1px -2px 0 0; box-sizing: border-box;
  font: inherit; font-size: 14px; line-height: 1; cursor: pointer;
  color: inherit; background: transparent; border: 0; border-radius: 5px; opacity: .7;
}
.peak-badge-toastclose:hover { opacity: 1; background: rgba(255, 255, 255, .16); }
`;

    /**
     * Announce the stylesheet once per page.
     *
     * This is a static bundle: the factory receives only `require`, so the
     * `styles.insert` helper of the dynamic-package evaluator is not on offer and
     * the tag is injected by hand.
     *
     * The `data-plugin` stamp is not decoration. `removeOwnedStyles` in
     * dsh-client-modules (lib/client.js:194-197) tears down every
     * `style[data-plugin]` whose attribute equals the package id, on factory
     * failure and on revision change; a tag without it survives unload and the
     * next revision renders against stale rules.
     */
    function ensureStyles() {
      if (typeof document === 'undefined') return;
      if (document.querySelector(`style[data-plugin="${PACKAGE_ID}"]`) !== null) return;
      const tag = document.createElement('style');
      tag.dataset.plugin = PACKAGE_ID;
      tag.dataset.dshPeakBadge = STYLE_TAG_ID;
      tag.textContent = CSS;
      document.head.append(tag);
    }

    // #endregion

    // #region text

    // One source for the Chinese labels, so `localize` can restore them wholesale
    // instead of re-listing every key. A hand-copied second literal drifts: the
    // first version of this file already lacked `beyondHorizon` in the restore
    // path, which would have left the English string on screen after switching
    // back to Chinese.
    const TEXT_ZH = {
      peak: '峰时',
      off: '谷时',
      unknown: '未知',
      title: 'DeepSeek 峰谷时段',
      state: '当前',
      discount: '计费',
      next: '下次切换',
      schedule: '高峰时段',
      pending: '待定',
      beyondHorizon: '一年内没有可判断的高峰时段',
      nextBeyondTable: '表外的年份，无法判断下一个高峰',
      clockError: '无法读取本机时钟。',
      hour: '小时',
      minute: '分钟',
      day: '天',
      today: '今天',
      tomorrow: '明天',
      dayAfter: '后天',
      daysAfter: '天后',
      weekday: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
      rateStandard: '标准价',
      rateOffPeak: '5 折 · 半价',
      alertLead: '切换提醒',
      alertOff: '关闭',
      alertMinutes: '提前 {n} 分钟',
      notify: '系统通知',
      notifyUnsupported: '本机不支持系统通知',
      notifyNoteDenied: '未开启 · 权限被拒绝，点一下再试',
      notifyNoteUnsupported: '未开启 · 本机没有通知接口',
      notifyNotePrompt: '未开启 · 点一下会问一次权限',
      notifyNoteIdle: '未开启 · 点一下开启',
      alertToPeak: '{at} 进入高峰时段',
      alertToOff: '{at} 进入空闲时段',
      alertToPeakBody: '还有 {left}。价格翻倍，要发就趁现在。',
      alertToOffBody: '还有 {left}。价格减半，不急就等一下。',
      dismiss: '关闭提醒',
    };
    const TEXT_EN = {
      peak: 'Peak',
      off: 'Off-peak',
      unknown: 'Unknown',
      title: 'DeepSeek peak / off-peak',
      state: 'Now',
      discount: 'Rate',
      next: 'Next switch',
      schedule: 'Peak hours',
      pending: 'Unknown',
      beyondHorizon: 'No assessable peak window within a year',
      nextBeyondTable: 'a year beyond the table — the next peak cannot be determined',
      clockError: 'The local clock could not be read.',
      hour: 'h',
      minute: 'min',
      day: 'd',
      today: 'today',
      tomorrow: 'tomorrow',
      dayAfter: 'in 2 days',
      daysAfter: 'days from now',
      weekday: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      rateStandard: 'standard rate',
      rateOffPeak: '50% · half price',
      alertLead: 'Warn before',
      alertOff: 'Off',
      alertMinutes: '{n} min before',
      notify: 'System notification',
      notifyUnsupported: 'not available in this browser',
      notifyNoteDenied: 'Off · permission was refused, press to try again',
      notifyNoteUnsupported: 'Off · this machine has no notification API',
      notifyNotePrompt: 'Off · pressing this asks for permission once',
      notifyNoteIdle: 'Off · press to turn on',
      alertToPeak: 'Peak starts at {at}',
      alertToOff: 'Off-peak starts at {at}',
      alertToPeakBody: 'In {left}. The rate doubles — send now if you are going to send.',
      alertToOffBody: 'In {left}. The rate halves — wait a moment if you can.',
      dismiss: 'Dismiss',
    };

    // The policy region returns a reason *key* plus its parameters; the sentence
    // lives here because the sentence is language. Anything unknown falls back to
    // Chinese rather than printing `undefined` in the card.
    const REASON_ZH = {
      holiday: '法定节假日：{name}',
      weekend: '{weekday}',
      makeup: '调休上班日，但官方规则按周几算，周末一律空闲（{weekday}）',
      allDayOff: '全天按空闲时段计价。',
      workingDayOff: '工作日非高峰时段，当前按空闲时段计价。',
      peakWorkday: '工作日高峰时段，当前按标准价计价。',
      tableExhausted: '节日表只到 {latest} 年，{year} 年的法定节假日无从判断。',
      weekendUncovered: '{weekday}；官方规则里周末不查节假日表',
    };
    const REASON_EN = {
      holiday: 'statutory holiday: {name}',
      weekend: '{weekday}',
      makeup: 'a 调休 make-up workday, but the official rule counts the weekday, and weekends stay off-peak ({weekday})',
      allDayOff: 'billed off-peak all day.',
      workingDayOff: 'off-peak window on a working day, currently billed at the off-peak rate.',
      peakWorkday: 'peak window on a working day, currently billed at the standard rate.',
      tableExhausted: 'the holiday table only reaches {latest}, so the statutory holidays of {year} cannot be determined.',
      weekendUncovered: '{weekday}; the official rule names weekends off-peak without consulting the holiday table',
    };
    const REASON = { zh: REASON_ZH, en: REASON_EN };
    // The active language lives in a mutable holder rather than in a closing-over
    // `let`. Not because a bare `let` is illegal here — it is legal, and
    // `verify-policy.mjs` extracts this region into a plain function body that has
    // no trouble with one either. It is a holder because there is nothing in this
    // region that wants to rebind a binding: `localize` mutates the tables'
    // contents and this one field, so `Object.freeze` would be the only thing a
    // bare `let` bought, and the two readers below stay pure lookups.
    const i18n = { lang: 'zh' };

    /** Fill `{name}`-style slots; a missing key is left visible on purpose. */
    function fill(template, params) {
      if (params === undefined) return template;
      return template.replace(/\{(\w+)\}/g, (whole, key) => (
        Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : whole
      ));
    }

    /** The sentence for one reason key, tolerating a plain string. */
    function reasonText(state) {
      if (typeof state.reason !== 'string') return '';
      const template = REASON[i18n.lang][state.reason];
      if (template === undefined) return state.reason;
      const params = state.reasonParams;
      return fill(template, params === undefined ? undefined : Object.assign({}, params, {
        // A weekday arrives as a number so the policy region stays language-free.
        weekday: typeof params.weekday === 'number' ? text.weekday[params.weekday] : params.weekday,
      }));
    }

    /** The card's opening sentence: the reason, plus its closing note. */
    function reasonSentence(state) {
      const head = reasonText(state);
      const tail = state.tail === undefined ? '' : reasonText({ reason: state.tail });
      // English reason templates are written lowercase so they can be embedded
      // mid-sentence; here they always open one, so the first letter is lifted.
      const cap = (sentence) => `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`;
      if (tail === '') return i18n.lang === 'en' ? cap(head) : head;
      if (head === '') return i18n.lang === 'en' ? cap(tail) : tail;
      return i18n.lang === 'en' ? `${cap(head)}. ${cap(tail)}` : `${head}，${tail}`;
    }

    const text = Object.assign({}, TEXT_ZH);

    /**
     * A minute count as `X 天 Y 小时` / `X 小时 Y 分钟` / `Y 分钟`.
     *
     * This is a size decision as much as a wording one. The `下次切换` row has to
     * stay on one line: `94 小时 19 分钟` is both wide and harder to read than
     * `3 天 22 小时`, and once the gap is a day or more the exact minute is noise
     * on a card that already prints the absolute switch time.
     */
    function formatGap(minutes) {
      const total = Math.max(0, Math.ceil(minutes));
      const days = Math.floor(total / 1440);
      const hours = Math.floor((total % 1440) / 60);
      const rest = total % 60;
      const unit = (count, label) => `${count} ${label}`;
      const parts = [];
      if (days > 0) parts.push(unit(days, text.day));
      if (hours > 0 || days > 0) parts.push(unit(hours, text.hour));
      if (days === 0) parts.push(unit(rest, text.minute));
      return parts.join(' ');
    }

    /** How many Beijing days ahead a peak window is, in words. */
    function dayOffsetLabel(dayOffset) {
      if (dayOffset <= 0) return text.today;
      if (dayOffset === 1) return text.tomorrow;
      if (dayOffset === 2) return text.dayAfter;
      return `${dayOffset} ${text.daysAfter}`;
    }

    /** Point the labels at the active language, if one is on offer. */
    function localize(ctx) {
      const locale = ctx.get('locale');
      if (locale === undefined || typeof locale.getLocale !== 'function') return { active: 'zh' };
      try {
        const active = locale.getLocale().active;
        const english = typeof active === 'string' && active.toLowerCase().startsWith('en');
        i18n.lang = english ? 'en' : 'zh';
        Object.assign(text, english ? TEXT_EN : TEXT_ZH);
        return { active };
      } catch {
        i18n.lang = 'zh';
        Object.assign(text, TEXT_ZH);
        return { active: 'zh' };
      }
    }

    // #endregion

    // #region alert

    const ALERT_STORE_KEY = `${PACKAGE_ID}/alert`;
    const ALERT_SELECT_ID = `${PACKAGE_ID}-alert-lead`;
    // Fixed rungs rather than a number field: the useful range is two orders of
    // magnitude wide (a minute to half an hour) and every value in between is a
    // decision nobody wants to make. 0 is the off switch, and it is first because
    // that is where a `<select>`'s eye starts.
    const ALERT_CHOICES = [0, 1, 2, 5, 10, 15, 30];
    const ALERT_DEFAULT_MINUTES = 2;
    const TOAST_MS = 20000;

    /**
     * The two preferences, plus the three things that have to outlive a mount.
     *
     * Module scope on purpose. The clock is started by `apply` while the chip may
     * mount, unmount and remount many times across one session — and a switch that
     * has already been announced must not be announced again merely because the
     * user changed conversations.
     */
    const alert = { leadMinutes: ALERT_DEFAULT_MINUTES, notify: false };
    /**
     * The last answer the permission machinery gave, for the row to report.
     *
     * `null` means "nothing has been tried in this session", which is not the
     * same as a refusal: the row says a different thing in each case. Without
     * this the box could only ever be on or off, and a press that ended in
     * `denied` — or in `default`, which is what a dismissed prompt leaves behind
     * — looked exactly like a press that did nothing at all.
     */
    let notifyHint = null;
    let announcedKey = null;
    let toastNode = null;
    let toastDispose = null;
    let alertTimer = null;

    /** Read the stored preference, tolerating every way storage can refuse. */
    function readAlertSettings() {
      // `localStorage` throws outright in a partitioned or storage-blocked frame
      // and returns null for a key that was never written. Neither is worth
      // reporting: the defaults are what a first run would have chosen anyway.
      try {
        const raw = window.localStorage.getItem(ALERT_STORE_KEY);
        if (raw === null) return;
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object') return;
        // Validated rather than trusted: a stored 3 would make the select render
        // no matching option and silently show the first one instead.
        if (ALERT_CHOICES.includes(parsed.leadMinutes)) alert.leadMinutes = parsed.leadMinutes;
        if (parsed.notify === true) alert.notify = true;
      } catch {
        /* private mode, disabled storage, or a half-written value */
      }
      // The stored preference is a wish, not a fact: permission can be revoked
      // between sessions from the browser's own settings, and a box that stays
      // ticked while every notification is refused would be a lie. Dropping the
      // wish is also what makes the row honest — the hint below then reports the
      // real state, which is the one thing the previous code never did.
      if (alert.notify && notifySupport() !== 'granted') alert.notify = false;
    }

    function writeAlertSettings() {
      try {
        window.localStorage.setItem(ALERT_STORE_KEY, JSON.stringify({
          leadMinutes: alert.leadMinutes,
          notify: alert.notify,
        }));
      } catch {
        /* the preference still applies for this session */
      }
    }

    /**
     * What the system-notification row can actually do.
     *
     * Three outcomes, not two. The API is absent in a headless shell, and it can
     * be present-but-refused in a frame that was never granted `notifications`, so
     * every reach is guarded — and the card names which case it is rather than
     * offering a checkbox that quietly does nothing.
     */
    function notifySupport() {
      if (typeof window === 'undefined' || typeof window.Notification !== 'function') return 'unsupported';
      try {
        if (window.Notification.permission === 'denied') return 'denied';
        if (window.Notification.permission === 'granted') return 'granted';
        return 'prompt';
      } catch {
        return 'unsupported';
      }
    }

    function closeToast() {
      if (typeof toastDispose === 'function') {
        toastDispose();
        toastDispose = null;
      }
      if (toastNode !== null) {
        if (toastNode.parentNode !== null) toastNode.parentNode.removeChild(toastNode);
        toastNode = null;
      }
    }

    /**
     * Raise the pre-switch notice.
     *
     * Plain DOM rather than React, because this is raised by the plugin's own
     * clock and not from inside any React tree: the chip mounts only on a
     * conversation page, and a notice that appeared only there would be missing
     * exactly when the user is reading something else and about to start a job.
     * Building it here also keeps the component a pure function of the verdict.
     */
    function showToast(plan) {
      closeToast();
      if (typeof document === 'undefined' || document.body === null || document.body === undefined) return;
      ensureStyles();
      const toPeak = plan.entering === 'peak';
      const node = document.createElement('div');
      node.className = 'peak-badge-toast';
      node.dataset.dshPeakBadge = 'toast';
      node.dataset.entering = plan.entering;
      // `status`, not `alert`: worth a glance, not worth interrupting typing.
      node.setAttribute('role', 'status');

      const dot = document.createElement('span');
      dot.className = 'peak-badge-dot';
      dot.setAttribute('aria-hidden', 'true');

      const body = document.createElement('div');
      body.className = 'peak-badge-toasttext';
      const heading = document.createElement('div');
      heading.className = 'peak-badge-toasttitle';
      heading.textContent = fill(toPeak ? text.alertToPeak : text.alertToOff, { at: plan.at });
      const detail = document.createElement('div');
      detail.textContent = fill(toPeak ? text.alertToPeakBody : text.alertToOffBody, {
        left: formatGap(plan.leftMinutes),
      });
      body.append(heading, detail);

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'peak-badge-toastclose';
      close.setAttribute('aria-label', text.dismiss);
      close.textContent = '×';
      close.addEventListener('click', closeToast);

      node.append(dot, body, close);
      document.body.append(node);
      toastNode = node;
      // Auto-dismiss runs on the timer service, never on a bare `setTimeout`:
      // bundle code executes in a client half, where the ambient timer globals are
      // trapped. Keeping the dispose is what lets a second notice replace this one
      // instead of stacking beneath it.
      if (alertTimer !== null) toastDispose = alertTimer.timeout(closeToast, TOAST_MS);
    }

    function fireSystemNotification(plan) {
      if (!alert.notify) return;
      if (notifySupport() !== 'granted') return;
      try {
        const toPeak = plan.entering === 'peak';
        // eslint-disable-next-line no-new -- the notice is the side effect
        new window.Notification(fill(toPeak ? text.alertToPeak : text.alertToOff, { at: plan.at }), {
          body: fill(toPeak ? text.alertToPeakBody : text.alertToOffBody, {
            left: formatGap(plan.leftMinutes),
          }),
          // Same tag for the same boundary, so a re-fire replaces the notice
          // rather than leaving the user with two of them.
          tag: `${PACKAGE_ID}:${plan.key}`,
        });
      } catch (error) {
        console.error('[peak-badge] the system notification could not be raised', error);
      }
    }

    /**
     * Start the pre-switch clock and return its unsubscriber.
     *
     * Owned by `apply`, not by the chip, because the chip only exists while a
     * conversation page is mounted. The decision itself stays pure — `peakState`
     * then `alertPlan` — so this function supplies nothing but the time and the
     * memory of what it has already said.
     */
    function startAlertClock(ctx, timer) {
      // Claimed here rather than by the caller, so the notice can never be raised
      // before something owns its auto-dismiss. `startAlertClock` announces once
      // synchronously, so a caller that assigned this *after* the call would get a
      // notice with no timer behind it — a toast that never leaves.
      alertTimer = timer;
      const announce = () => {
        // A client half can in principle run before the document has a body. If it
        // has, say nothing and leave the edge un-announced, so the next tick tries
        // again instead of burning the one chance to speak.
        if (typeof document === 'undefined' || document.body === null || document.body === undefined) return;
        let state;
        try {
          state = peakState(Date.now());
        } catch (error) {
          console.error('[peak-badge] the alert clock could not read the time', error);
          return;
        }
        const plan = alertPlan(state, alert.leadMinutes);
        if (plan === null || plan.key === announcedKey) return;
        announcedKey = plan.key;
        // Re-localize on the way out. The chip's own locale subscription only runs
        // while the chip is mounted and this clock is not, so a language switched
        // on another page would otherwise be spoken here in the old one.
        localize(ctx);
        showToast(plan);
        fireSystemNotification(plan);
      };
      // One pass immediately: a plugin enabled two minutes before a switch should
      // say so at once rather than at the first tick thirty seconds later.
      announce();
      return timer.interval(announce, TICK_MS);
    }

    // #endregion

    // #region view

    function Row(props) {
      return h('div', { className: 'peak-badge-row' },
        h('span', { className: 'peak-badge-key' }, props.label),
        h('span', { className: 'peak-badge-value', 'data-tone': props.tone }, props.value));
    }

    /** One label/value pair inside the expanded card; nulls render nothing. */
    function Detail(props) {
      if (props.value === null || props.value === undefined) return null;
      return h(Row, { label: props.label, value: props.value, tone: props.tone });
    }

    /**
     * The card's two settings rows: how long before a switch to speak up, and
     * whether to also raise a system notification.
     *
     * A plain function rather than a component — it holds no state of its own and
     * the card already re-renders on the tick, so a component would only add a
     * boundary React has to reconcile for nothing.
     */
    function renderAlertControls(setTick) {
      const support = notifySupport();
      const usable = support === 'prompt' || support === 'granted';
      const rerender = () => setTick((value) => value + 1);

      const chooseLead = (event) => {
        alert.leadMinutes = Number(event.target.value);
        writeAlertSettings();
        // Not a new switch, but a longer lead can make an already-announced edge
        // newly due and a shorter one can push it back out. Clearing the key lets
        // the next tick decide again under the new rule rather than staying silent
        // about a boundary it had already spoken for.
        announcedKey = null;
        rerender();
      };

      const chooseNotify = (event) => {
        if (event.target.checked !== true) {
          alert.notify = false;
          notifyHint = null;
          writeAlertSettings();
          rerender();
          return;
        }
        // Permission has to be asked for from a user gesture and this is one, and
        // the ANSWER is what gets stored: a refusal must turn the box back off
        // rather than leave a setting behind that can never fire. Older engines
        // return undefined from `requestPermission()` and expect a callback, so
        // both shapes are accepted and neither is assumed.
        // The answer arrives in two shapes and BOTH are real. Modern engines
        // resolve `requestPermission()` with the permission string — `'granted'`,
        // `'denied'`, `'default'` — while the legacy callback form passes a
        // boolean. Comparing against `true` alone therefore threw away every
        // modern grant: the box sprang back and the row said "nothing tried yet",
        // which is exactly the report that started this. Accept either shape.
        const allowed = (answer) => answer === true || answer === 'granted';
        const settle = (granted) => {
          alert.notify = allowed(granted);
          // `'default'` is its own answer, not a failure: it is what a prompt the
          // user dismissed leaves behind, and it is undone by pressing again. The
          // row reports which of the two happened instead of silently reverting
          // the box, which is what made the previous version look broken.
          notifyHint = allowed(granted) ? null : notifySupport() === 'denied' ? 'denied' : 'default';
          writeAlertSettings();
          rerender();
        };
        try {
          // The two shapes, told apart by what comes back rather than by a version
          // check. A thenable carries the permission string; engines that take a
          // callback call it with the boolean, synchronously in every one I could
          // find. `once` guards the case where an engine does both, so a single
          // press can never settle twice.
          let settled = false;
          const once = (answer) => { if (!settled) { settled = true; settle(answer); } };
          const asked = window.Notification.requestPermission(once);
          if (asked !== null && asked !== undefined && typeof asked.then === 'function') {
            asked.then(once, () => once(false));
          } else if (!settled) {
            // The callback form that only looks at `permission` afterwards.
            once(window.Notification.permission === 'granted');
          }
        } catch {
          settle(false);
        }
      };

      return h('div', { className: 'peak-badge-controls' },
        h('div', { className: 'peak-badge-control' },
          h('label', { className: 'peak-badge-key', htmlFor: ALERT_SELECT_ID }, text.alertLead),
          h('select', {
            id: ALERT_SELECT_ID,
            className: 'peak-badge-select',
            'data-dsh-peak-badge': 'alert-lead',
            value: String(alert.leadMinutes),
            onChange: chooseLead,
          }, ALERT_CHOICES.map((minutes) => h('option', { key: minutes, value: String(minutes) },
            minutes === 0 ? text.alertOff : fill(text.alertMinutes, { n: minutes }))))),
        h('div', { className: 'peak-badge-control' },
          h('label', {
            className: 'peak-badge-check',
            'data-unavailable': usable ? 'no' : 'yes',
          },
            h('input', {
              type: 'checkbox',
              'data-dsh-peak-badge': 'alert-notify',
              checked: alert.notify,
              // Disabled only when the API is absent — that is the one case a
              // press cannot change. A refusal is NOT one: the browser may grant
              // on a later press once the user has changed its settings, and a
              // dead control offers no way to find that out. `denied` already
              // reports itself through the status text below.
              disabled: support === 'unsupported',
              onChange: chooseNotify,
            }),
            h('span', null, text.notify),
            // The status sits inside the label, beside the words it is about, so
            // it can never be the line that scrolls out of the card — and a
            // refused or dismissed request leaves a visible trace instead of a
            // box that quietly springs back.
            alert.notify
              ? null
              : h('span', {
                  className: 'peak-badge-note',
                  'data-dsh-peak-badge': 'alert-note',
                }, support === 'unsupported'
                  ? text.notifyNoteUnsupported
                  : support === 'denied' || notifyHint === 'denied'
                    ? text.notifyNoteDenied
                    : notifyHint === 'default'
                      ? text.notifyNoteIdle
                      : text.notifyNotePrompt))));
    }

    const Main = React.memo(function PeakBadge() {
      // The tick exists to re-render on schedule; the verdict is computed during
      // render so the first paint is already correct.
      const [tick, setTick] = React.useState(0);
      const [open, setOpen] = React.useState(false);
      const rootRef = React.useRef(null);

      React.useEffect(() => {
        ensureStyles();
      }, []);

      React.useEffect(() => {
        // `localize` is a one-shot at apply time, so a language switch at runtime
        // would otherwise leave the chip in whichever language was active when the
        // plugin loaded. The locale service is observable and `subscribe` returns
        // its own unsubscriber, which is exactly the cleanup contract of an effect.
        // No eager call here: `apply` already localized before this entry mounted,
        // so the first paint is correct.
        let unsubscribe = null;
        try {
          const locale = pluginCtx === null ? undefined : pluginCtx.get('locale');
          if (locale === undefined || typeof locale.subscribe !== 'function') return undefined;
          unsubscribe = locale.subscribe(() => {
            localize(pluginCtx);
            setTick((value) => value + 1);
          });
        } catch (error) {
          console.error('[peak-badge] locale subscription unavailable', error);
          return undefined;
        }
        return () => {
          if (typeof unsubscribe === 'function') unsubscribe();
        };
      }, []);

      React.useEffect(() => {
        // Both the service lookup and the interval must sit inside the guard: a
        // disposed context throws INACTIVE_EFFECT (assertActive, called by
        // ctx.effect, which backs every timer method) rather than returning
        // nothing. Unmount normally races that disposal.
        let dispose = null;
        try {
          const timer = pluginCtx === null ? undefined : pluginCtx.get('timer');
          if (timer === undefined || typeof timer.interval !== 'function') return undefined;
          dispose = timer.interval(() => {
            setTick((value) => value + 1);
          }, TICK_MS);
        } catch (error) {
          // A badge that never refreshes still beats a crashed composer row:
          // the verdict stays right until the next unrelated re-render.
          console.error('[peak-badge] interval unavailable', error);
          return undefined;
        }
        return () => {
          if (typeof dispose === 'function') dispose();
        };
      }, []);

      let state;
      try {
        state = peakState(Date.now());
      } catch (error) {
        console.error('[peak-badge] failed to resolve the current window', error);
        state = { status: 'unknown', dateText: '', schedule: '', reason: text.clockError };
      }
      void tick;

      const status = state.status;
      const label = status === 'peak' ? text.peak : status === 'off' ? text.off : text.unknown;
      const rate = status === 'unknown' ? null : text[state.discount] || state.discount;
      // `next` is absent only when the day-walk found no peak window it is
      // willing to name. Two different reasons hide behind that one absence and
      // they are not interchangeable: a year outside the holiday table means the
      // question cannot be answered at all, while the walk hitting its own
      // horizon means the answer is "not within the next year". Both are never
      // "the next workday" — on weekends and holidays the whole day is off-peak,
      // so the next peak is by definition a later day.
      const nextText = state.next !== undefined
        ? (i18n.lang === 'en'
          ? `${dayOffsetLabel(state.next.inDays)} ${state.next.at} (${formatGap(state.next.leftMinutes)})`
          : `${dayOffsetLabel(state.next.inDays)} ${state.next.at}（${formatGap(state.next.leftMinutes)}）`)
        : status !== 'off'
          ? text.pending
          : state.reason === 'weekendUncovered' ? text.nextBeyondTable : text.beyondHorizon;

      /**
       * Close the card when the pointer goes down anywhere outside it.
       *
       * On `document`, in the capture phase, rather than React's `onBlur` on the
       * root: an outside click on a NON-focusable area — the transcript, the
       * composer background — does not move focus, so it fires no blur at all and
       * the card stayed open until the chip was pressed a second time. The event
       * is retargeted, so `contains` reads the truth even when a click inside the
       * card lands on a child; capture means a handler inside the card that stops
       * propagation cannot make this one stale.
       *
       * The containment test is what keeps this compatible with a card that now
       * holds controls: the lead `<select>` and the notification checkbox live
       * inside the root, so pressing either one leaves the card open — while a
       * press on the body behind it closes, because `pointerdown` on a `<select>`
       * opens the native menu and unmounting the card out from under it would be
       * indistinguishable from the control being broken.
       */
      React.useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
          const root = rootRef.current;
          if (root !== null && !root.contains(event.target)) setOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => document.removeEventListener('pointerdown', onPointerDown, true);
      }, [open]);

      return h('div', {
        ref: rootRef,
        className: 'peak-badge-root',
        tabIndex: -1,
        // Keyboard dismissal. `relatedTarget === null` means focus left the
        // document, i.e. an outside click — and that case is already handled by
        // the pointer listener above, which fires first and closes the card. So
        // this only has to cover focus moving to a real sibling.
        onBlur: (event) => {
          const next = event.relatedTarget;
          if (next === null || event.currentTarget.contains(next)) return;
          setOpen(false);
        },
        onKeyDown: (event) => {
          if (event.key === 'Escape') setOpen(false);
        },
      },
        h('button', {
          type: 'button',
          className: 'peak-badge-chip',
          'data-status': status,
          'data-dsh-peak-badge': 'chip',
          title: `${text.title}${i18n.lang === 'en' ? ': ' : '：'}${label}`,
          'aria-expanded': open,
          'aria-haspopup': 'dialog',
          'aria-controls': open ? CARD_ID : undefined,
          onClick: () => setOpen((value) => !value),
        },
          h('span', { className: 'peak-badge-dot', 'aria-hidden': true }),
          h('span', null, label)),
        open
          ? h('div', {
              id: CARD_ID,
              className: 'peak-badge-card',
              'data-dsh-peak-badge': 'card',
              role: 'dialog',
              'aria-label': text.title,
            },
              // `state.dateText` is a bare ISO date on purpose; the weekday is
              // rendered here so it follows the language.
              h(Row, { label: text.state, value: `${label} · ${state.dateText}${state.weekday === undefined ? '' : ` ${text.weekday[state.weekday]}`}`, tone: status }),
              h(Detail, { label: text.discount, value: rate, tone: status }),
              h(Detail, { label: text.next, value: nextText }),
              h(Detail, { label: text.schedule, value: status === 'unknown' ? null : state.schedule }),
              renderAlertControls(setTick),
              h('div', { className: 'peak-badge-foot' }, reasonSentence(state)))
          : null);
    });

    // #endregion

    // Set by `apply`, read by the mounted entry. The component mounts only while
    // this plugin's fiber is alive, so a closure read is safer than threading the
    // context through the slot's inject surface.
    let pluginCtx = null;

    return {
      inject: ['slots'],
      apply(ctx) {
        pluginCtx = ctx;
        localize(ctx);
        readAlertSettings();
        // The pre-switch clock is started here rather than from the chip's effect,
        // because the chip exists only while a conversation page is mounted and the
        // warning has to be able to arrive while the user is looking at something
        // else. `ctx.effect` ties its lifetime to the plugin's own.
        try {
          ctx.effect(() => {
            const timer = ctx.get('timer');
            // Both the lookup and the interval live inside the effect: a disposed
            // context throws INACTIVE_EFFECT from every timer method rather than
            // returning nothing.
            if (timer === undefined || typeof timer.interval !== 'function') return () => {};
            // `startAlertClock` claims the timer for itself before announcing, so
            // there is nothing to assign out here.
            const stop = startAlertClock(ctx, timer);
            return () => {
              if (typeof stop === 'function') stop();
              alertTimer = null;
              closeToast();
            };
          }, `${PACKAGE_ID}: alert clock`);
        } catch (error) {
          // A badge with no warning still beats a plugin that fails to apply: the
          // chip and the card are unaffected by this clock being unavailable.
          console.error('[peak-badge] the alert clock could not be started', error);
        }
        // The `try` matters even though this is the plugin's own mount path: an
        // `apply` that throws takes the whole entry down, and a slot can be
        // *declared by another package* whose entry is not active (the settings
        // shell and the conversation columns are both disableable), in which case
        // `inject` never fires. A chip that fails to appear is a bad outcome; a
        // plugin that fails to apply because of it is a worse one, and it is the
        // kind of failure that shows up as "this plugin broke that plugin".
        try {
          ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
            name: 'conversation.input.left',
            id: 'peak-badge',
            order: 20,
          }, Main));
        } catch (error) {
          console.error('[peak-badge] the composer seat could not be registered', error);
        }
      },
    };
  },
});
