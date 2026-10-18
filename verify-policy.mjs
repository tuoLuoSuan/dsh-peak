// Verification for the dsh-peak policy.
//
//   node verify-policy.mjs            # run the cases
//   node verify-policy.mjs --dump     # also print the extracted code
//
// Why this reads client.js as text instead of importing it: the policy lives
// inside the `window.__ModuleLoader__.load({ factory })` closure, which only
// exists in a browser bundle. Everything between the `#region policy` and
// `#endregion` markers is pure JavaScript with no React, no DOM and no client
// services, so it can be extracted and executed here directly. That is the whole
// point — the arithmetic is the risky part and it is the part that is testable.
//
// Exit codes follow the house convention (see .learnings/LRN-20261003-001):
//   0  every case passed
//   1  an assertion failed — the code is wrong
//   2  the verification itself could not run — says nothing about the code

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

function fail(code, message) {
  console.error(message);
  process.exitCode = code;
}

let source;
try {
  source = readFileSync(join(HERE, 'client.js'), 'utf8');
} catch (error) {
  fail(2, `could not read client.js next to this script: ${error.message}`);
}

let policy;
if (source !== undefined) {
  const start = source.indexOf('// #region policy');
  const end = source.indexOf('// #endregion', start);
  if (start < 0 || end < 0) {
    fail(2, 'client.js no longer has a "#region policy" ... "#endregion" block, so the policy could not be extracted. This says nothing about whether it is correct.');
  } else {
    try {
      policy = new Function(`${source.slice(start, end)}\nreturn { peakState, offPeakReach, alertPlan, holidayLookup, HOLIDAY_TABLE, HOLIDAY_COVERAGE, LATEST_COVERED_YEAR, PEAK_WINDOWS, mdKey, hhmm };`)();
    } catch (error) {
      fail(1, `the extracted policy does not evaluate: ${error.message}`);
    }
  }
}

if (policy !== undefined) {
  const { peakState, holidayLookup, alertPlan, HOLIDAY_COVERAGE, LATEST_COVERED_YEAR } = policy;
  if (process.argv.includes('--dump')) {
    const start = source.indexOf('// #region policy');
    const end = source.indexOf('// #endregion', start);
    console.log(source.slice(start, end));
  }

  const beijing = (y, m, d, hh, mm) => Date.UTC(y, m - 1, d, hh - 8, mm);
  let failed = 0;
  let passed = 0;

  function check(label, actual, expected) {
    const ok = actual === expected;
    if (ok) passed += 1;
    else failed += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) console.log(`       expected: ${expected}\n       actual:   ${actual}`);
  }

  /**
   * `off | 0 今天 180 | rateOffPeak | weekend(6) + allDayOff` — one line, so a
   * diff is readable.
   *
   * The shape prints what the policy actually owns: the reason *keys*, the day
   * offset, the clock time and the gap in **minutes**. Sentences and 今天/明天
   * are the view's job (they change with the language), so asserting them here
   * would only be asserting the test's own copy.
   */
  const shape = (state) => {
    const when = state.next === undefined
      ? '—'
      : `${state.next.inDays} ${state.next.at} ${state.next.leftMinutes}min`;
    const why = state.reasonParams === undefined
      ? state.reason
      : `${state.reason}(${Object.values(state.reasonParams).join('/')})`;
    return `${state.status} | ${when} | ${state.discount ?? '—'} | ${why}${state.tail === undefined ? '' : ` + ${state.tail}`}`;
  };
  const at = (y, m, d, hh, mm) => shape(peakState(beijing(y, m, d, hh, mm)));

  console.log('--- the statutory holiday table ---');
  // 3 + 9 + 3 + 5 + 3 + 3 + 7 days. Ask through `holidayLookup`, the same door
  // the policy uses, so this cannot pass against a table the policy never reads.
  let holidayDays = 0;
  {
    const cursor = new Date(Date.UTC(2026, 0, 1));
    while (cursor.getUTCFullYear() === 2026) {
      if (holidayLookup(2026, cursor.getUTCMonth() + 1, cursor.getUTCDate()) !== undefined) holidayDays += 1;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  check('2026 holiday days total 33', String(holidayDays), '33');
  const nameOn = (month, day) => {
    const found = holidayLookup(2026, month, day);
    return found === undefined ? undefined : found.name;
  };
  for (const [month, day, name] of [
    [1, 1, '元旦'], [1, 3, '元旦'], [2, 15, '春节'], [2, 23, '春节'],
    [4, 4, '清明节'], [5, 5, '劳动节'], [6, 21, '端午节'], [9, 27, '中秋节'],
    [10, 1, '国庆节'], [10, 7, '国庆节'],
  ]) {
    check(`${month}/${day} is ${name}`, nameOn(month, day), name);
  }
  for (const [month, day] of [[1, 4], [2, 14], [2, 28], [5, 9], [9, 20], [10, 10], [1, 31], [3, 1]]) {
    check(`${month}/${day} is not a holiday`, String(nameOn(month, day)), 'undefined');
  }
  check('coverage is derived from the table', HOLIDAY_COVERAGE.join(','), '2026');
  check('latest covered year', String(LATEST_COVERED_YEAR), '2026');

  console.log('\n--- peak / off-peak verdicts (Beijing wall clock) ---');
  const OFF = 'rateOffPeak';

  // ---------------------------------------------------------------------------
  // Timezone independence.
  //
  // DSH runs in whatever timezone the user's machine is set to, but every answer
  // here is about Beijing wall time. That holds because `peakState` shifts the
  // instant and then reads it through the **UTC** getters
  // (`new Date(nowMs + CHINA_UTC_OFFSET_MS).getUTCHours()`), never the local ones.
  // The values below are the ones a local-time refactor would break first, and each
  // is wrong in a different way.
  //
  // To check the whole file under another timezone, run it with `TZ` set — Node on
  // this platform reads `TZ`, so no code change is needed:
  //
  //   TZ=UTC                  node verify-policy.mjs
  //   TZ=America/New_York     node verify-policy.mjs
  //   TZ=Asia/Shanghai        node verify-policy.mjs
  //   TZ=Pacific/Kiritimati   node verify-policy.mjs
  //
  // All four pass as of this writing. Pinning `TZ` inside this file would be the
  // stronger check, but it has to happen before Node reads the zone and is not
  // portable to Windows, so the guard is this battery plus the note above.
  // ---------------------------------------------------------------------------
  console.log(`\n--- timezone independence (process TZ: ${Intl.DateTimeFormat().resolvedOptions().timeZone}) ---`);
  check('10:00 Beijing is peak regardless of the process timezone', at(2026, 8, 19, 10, 0), 'peak | 0 12:00 120min | rateStandard | peakWorkday');
  check('20:00 Beijing is off-peak regardless of the process timezone', at(2026, 8, 19, 20, 0), `off | 1 09:00 780min | ${OFF} | workingDayOff`);
  check('the Beijing date is not the local date', peakState(beijing(2026, 8, 19, 1, 0)).dateText, '2026-08-19');
  check('01:00 Beijing is still 08-19 in Beijing', String(peakState(beijing(2026, 8, 19, 1, 0)).weekday), '3');
  check('23:00 Beijing keeps its own weekday, not the next one locally', String(peakState(beijing(2026, 8, 19, 23, 0)).weekday), '3');
  check('Wed 09:00 exactly — peak starts, inclusive', at(2026, 8, 19, 9, 0), 'peak | 0 12:00 180min | rateStandard | peakWorkday');
  check('Wed 10:00', at(2026, 8, 19, 10, 0), 'peak | 0 12:00 120min | rateStandard | peakWorkday');
  check('Wed 11:59', at(2026, 8, 19, 11, 59), 'peak | 0 12:00 1min | rateStandard | peakWorkday');
  check('Wed 12:00 exactly — peak ends, exclusive', at(2026, 8, 19, 12, 0), `off | 0 14:00 120min | ${OFF} | workingDayOff`);
  check('Wed 12:30 — noon break, next is TODAY 14:00', at(2026, 8, 19, 12, 30), `off | 0 14:00 90min | ${OFF} | workingDayOff`);
  check('Wed 13:59 — still the noon break', at(2026, 8, 19, 13, 59), `off | 0 14:00 1min | ${OFF} | workingDayOff`);
  check('Wed 14:00 exactly — peak resumes', at(2026, 8, 19, 14, 0), 'peak | 0 18:00 240min | rateStandard | peakWorkday');
  check('Wed 17:59', at(2026, 8, 19, 17, 59), 'peak | 0 18:00 1min | rateStandard | peakWorkday');
  check('Wed 18:00 exactly — peak ends, exclusive', at(2026, 8, 19, 18, 0), `off | 1 09:00 900min | ${OFF} | workingDayOff`);
  check('Wed 18:01', at(2026, 8, 19, 18, 1), `off | 1 09:00 899min | ${OFF} | workingDayOff`);

  // REGRESSION 2: the after-18:00 branch used to hardcode 明天 09:00 without
  // asking whether tomorrow is a working day.
  check('Fri 20:00 — next peak is MONDAY, not Saturday', at(2026, 8, 21, 20, 0), `off | 3 09:00 3660min | ${OFF} | workingDayOff`);
  check('Fri 18:30 — the whole weekend is ahead', at(2026, 8, 21, 18, 30), `off | 3 09:00 3750min | ${OFF} | workingDayOff`);
  check('Wed 2026-09-30 20:00 — 国庆 eve, next peak is after the holiday', at(2026, 9, 30, 20, 0), `off | 8 09:00 10860min | ${OFF} | workingDayOff`);

  console.log('\n--- weekends and holidays are off-peak all day ---');
  check('Sat 10:00', at(2026, 8, 22, 10, 0), `off | 2 09:00 2820min | ${OFF} | weekend(6) + allDayOff`);
  check('Sat 01:00 — midnight weekend edge', at(2026, 8, 22, 1, 0), `off | 2 09:00 3360min | ${OFF} | weekend(6) + allDayOff`);
  // Sunday 23:00 has no peak window of its own left, so the next one is Monday's
  // morning window — 10 hours away, not Monday's afternoon one.
  check('Sun 23:00 — the next peak is Monday MORNING, not Monday 14:00', at(2026, 8, 23, 23, 0), `off | 1 09:00 600min | ${OFF} | weekend(0) + allDayOff`);
  check('Thu 2026-10-01 10:00 — inside 国庆, a weekday', at(2026, 10, 1, 10, 0), `off | 7 09:00 10020min | ${OFF} | holiday(国庆节) + allDayOff`);
  // 春节 2026 runs 2/15-2/23, so the next peak after Friday 2/20 10:00 is Tuesday
  // 2/24 09:00 — four days, not "after the weekend". (2/28 is a make-up workday,
  // but no walk asserted here ever reaches it.)
  check('Fri 2026-02-20 10:00 — inside 春节, next peak clears the whole holiday', at(2026, 2, 20, 10, 0), `off | 4 09:00 5700min | ${OFF} | holiday(春节) + allDayOff`);

  console.log('\n--- the 调休 decision, stated out loud ---');
  // 2026-05-09 is a Saturday the notice marks as a make-up workday. The policy
  // follows the official literal rule, so it stays off-peak — but it must say so,
  // and it must say it *once*: asserting the key and the tail separately keeps a
  // failure attributable to the rule rather than to the wording.
  const makeup = peakState(beijing(2026, 5, 9, 10, 0));
  check('Sat 2026-05-09 (调休上班日) is OFF-PEAK', makeup.status, 'off');
  check('and explains itself with the 调休 reason', makeup.reason, 'makeup');
  check('carrying the weekday as a number', String(makeup.reasonParams.weekday), '6');
  check('and does not double up the closing note', String(makeup.tail), 'allDayOff');
  check('a normal Saturday uses the plain weekend reason', peakState(beijing(2026, 5, 16, 10, 0)).reason, 'weekend');

  console.log('\n--- seconds are snapped to the minute ---');
  // 09:00:30 used to print "3 小时" for a real 179.5 minutes.
  check('Wed 09:00:30', shape(peakState(beijing(2026, 8, 19, 9, 0) + 30000)), 'peak | 0 12:00 180min | rateStandard | peakWorkday');
  check('Wed 08:59:45 — off-peak, 15 s before the window', shape(peakState(beijing(2026, 8, 19, 9, 0) - 15000)), `off | 0 09:00 1min | ${OFF} | workingDayOff`);

  console.log('\n--- a year the table does not cover ---');
  const unknown = peakState(beijing(2027, 1, 6, 10, 0));
  check('Wed 2027-01-06 refuses to guess', unknown.status, 'unknown');
  check('it has no next-switch to offer', String(unknown.next), 'undefined');
  check('and names the limit as keys, not words', unknown.reason, 'tableExhausted');
  check('with both years as parameters', `${unknown.reasonParams.latest}/${unknown.reasonParams.year}`, '2026/2027');
  check('and an uncovered year cannot be walked into a peak', shape(peakState(beijing(2027, 1, 6, 10, 0))), 'unknown | — | — | tableExhausted(2026/2027)');

  // The table stopping early only removes the days whose verdict *depends* on it.
  // 2027-01-02 is a Saturday, and the official wording names weekends off-peak in
  // full — with no reference to any year's notice — so this one is still a
  // confident verdict. Getting this wrong in the safe direction (saying 未知 for a
  // day the plugin can actually answer) is still wrong: it is the difference
  // between "I don't know" and "I do know and it is 谷时", and the card prints it.
  const uncoveredSaturday = peakState(beijing(2027, 1, 2, 10, 0));
  check('Sat 2027-01-02 is still a confident off-peak', uncoveredSaturday.status, 'off');
  check('through the weekend rule, not the holiday table', uncoveredSaturday.reason, 'weekendUncovered');
  check('billed at the off-peak rate', uncoveredSaturday.discount, 'rateOffPeak');
  check('with the whole day named off-peak', uncoveredSaturday.tail, 'allDayOff');
  check('and the weekday still carried for the sentence', String(uncoveredSaturday.reasonParams.weekday), '6');
  check('Sun 2027-01-03 too', shape(peakState(beijing(2027, 1, 3, 10, 0))), `off | — | ${OFF} | weekendUncovered(0) + allDayOff`);
  // No next switch is invented: 2027-01-04 could be a holiday nobody has announced
  // yet, so the walk stops on the same boundary the weekday verdict does.
  check('and no next switch is invented for it', String(uncoveredSaturday.next), 'undefined');
  check('Mon 2027-01-04 still refuses to guess', peakState(beijing(2027, 1, 4, 10, 0)).status, 'unknown');
  check('Tue 2027-01-05 too', peakState(beijing(2027, 1, 5, 10, 0)).status, 'unknown');
  check('a covered-year weekend is unaffected', shape(peakState(beijing(2026, 8, 22, 10, 0))), `off | 2 09:00 2820min | ${OFF} | weekend(6) + allDayOff`);

  // ---------------------------------------------------------------------------
  // The text region: the formatters and the language switch.
  //
  // The policy returns numbers and keys; every sentence a user reads is built
  // here. That makes this half just as worth testing as the arithmetic — and it
  // is testable for the same reason, because `#region text` touches no React and
  // no DOM. `localize` is handed a stub context so both languages can be driven.
  // ---------------------------------------------------------------------------
  console.log('\n--- the formatters and the language switch ---');
  {
    const textStart = source.indexOf('// #region text');
    const textEnd = source.indexOf('// #endregion', textStart);
    if (textStart < 0 || textEnd < 0) {
      fail(2, 'client.js no longer has a "#region text" ... "#endregion" block, so the formatters could not be extracted. This says nothing about whether they are correct.');
    } else {
      let view;
      try {
        view = new Function('stub', `${source.slice(textStart, textEnd)}\nreturn { text, i18n, localize, formatGap, dayOffsetLabel, reasonText, reasonSentence };`);
      } catch (error) {
        fail(1, `the extracted text region does not evaluate: ${error.message}`);
      }
      if (view !== undefined) {
        const stub = (active) => ({ get: () => ({ getLocale: () => ({ active }) }) });
        const load = (active) => {
          const api = view(stub(active));
          api.localize(stub(active));
          return api;
        };

        const zh = load('zh-CN');
        check('gap: 90 minutes', zh.formatGap(90), '1 小时 30 分钟');
        // Zero minutes are kept on purpose: the card prints a fixed set of rows,
        // and `3 小时` vs `3 小时 0 分钟` alternating between renders makes the row
        // jump. One shape per magnitude is easier to read than a shorter one.
        check('gap: 3 hours exactly keeps the minutes field', zh.formatGap(180), '3 小时 0 分钟');
        check('gap: under an hour', zh.formatGap(1), '1 分钟');
        // 94 h 19 min is the 国庆节 case the card used to wrap onto two lines:
        // days take over at 24 h, and the minutes drop once days are in play.
        check('gap: past a day switches to days', zh.formatGap(5659), '3 天 22 小时');
        check('gap: whole days keep the hours', zh.formatGap(5760), '4 天 0 小时');
        check('gap: 47 hours', zh.formatGap(2820), '1 天 23 小时');
        check('day offset: today', zh.dayOffsetLabel(0), '今天');
        check('day offset: tomorrow', zh.dayOffsetLabel(1), '明天');
        check('day offset: the day after', zh.dayOffsetLabel(2), '后天');
        check('day offset: three days out', zh.dayOffsetLabel(3), '3 天后');

        const en = load('en-US');
        check('gap in English', en.formatGap(90), '1 h 30 min');
        check('gap in English, exact hours', en.formatGap(180), '3 h 0 min');
        check('gap in English, past a day', en.formatGap(5659), '3 d 22 h');
        check('day offset in English', en.dayOffsetLabel(3), '3 days from now');

        // The sentences a user actually reads, in both languages.
        check('zh weekend sentence', zh.reasonSentence({ reason: 'weekend', reasonParams: { weekday: 6 }, tail: 'allDayOff' }), '周六，全天按空闲时段计价。');
        check('en weekend sentence', en.reasonSentence({ reason: 'weekend', reasonParams: { weekday: 6 }, tail: 'allDayOff' }), 'Saturday. Billed off-peak all day.');
        check('zh holiday sentence', zh.reasonSentence({ reason: 'holiday', reasonParams: { name: '春节' }, tail: 'allDayOff' }), '法定节假日：春节，全天按空闲时段计价。');
        check('en holiday sentence', en.reasonSentence({ reason: 'holiday', reasonParams: { name: '春节' }, tail: 'allDayOff' }), 'Statutory holiday: 春节. Billed off-peak all day.');
        check('zh 调休 sentence says the rule out loud', zh.reasonSentence({ reason: 'makeup', reasonParams: { weekday: 6 }, tail: 'allDayOff' }), '调休上班日，但官方规则按周几算，周末一律空闲（周六），全天按空闲时段计价。');
        check('en 调休 sentence', en.reasonSentence({ reason: 'makeup', reasonParams: { weekday: 6 }, tail: 'allDayOff' }), 'A 调休 make-up workday, but the official rule counts the weekday, and weekends stay off-peak (Saturday). Billed off-peak all day.');
        check('working-day off-peak is one clause, not two', zh.reasonSentence({ reason: 'workingDayOff' }), '工作日非高峰时段，当前按空闲时段计价。');
        check('the exhausted-table sentence fills both years', zh.reasonSentence({ reason: 'tableExhausted', reasonParams: { latest: 2026, year: 2027 } }), '节日表只到 2026 年，2027 年的法定节假日无从判断。');
        check('no English string is missing a sentence', en.reasonSentence({ reason: 'peakWorkday' }), 'Peak window on a working day, currently billed at the standard rate.');

        // The trap that started all of this: the restore path used to be a
        // hand-copied literal that had drifted, leaving English on screen after
        // switching back to Chinese.
        check('switching en -> zh restores Chinese', (() => {
          const api = load('en-US');
          const english = api.reasonText({ reason: 'weekend', reasonParams: { weekday: 0 }, tail: 'allDayOff' });
          api.localize(stub('zh-CN'));
          const chinese = api.reasonSentence({ reason: 'weekend', reasonParams: { weekday: 0 }, tail: 'allDayOff' });
          return `${english} -> ${chinese}`;
        })(), 'Sunday -> 周日，全天按空闲时段计价。');

        // An unknown reason must not print `undefined` into the card.
        check('an unknown reason key falls back rather than printing undefined', zh.reasonText({ reason: 'notAReason' }), 'notAReason');

        // ---------------------------------------------------------------------
        // The seam between the two regions.
        //
        // Everything above tests the regions the way they are shipped: two
        // independent slices of client.js. That is also their blind spot. The
        // policy hands the text region `{ name: ... }`; if the policy renames
        // that key, or a template typos `{name}`, `fill` deliberately leaves the
        // placeholder visible — and every assertion above still passes, because
        // each side is fed by hand.
        //
        // So evaluate both slices in ONE function body and drive the card end to
        // end: peakState(...) -> reasonSentence(...). These are the only
        // assertions here that can fail on a mismatch *between* the regions.
        // ---------------------------------------------------------------------
        console.log('\n--- the policy and the text region, wired together ---');
        const policyStart = source.indexOf('// #region policy');
        const policyEnd = source.indexOf('// #endregion', policyStart);
        let whole;
        try {
          whole = new Function('stub', `${source.slice(policyStart, policyEnd)}\n${source.slice(textStart, textEnd)}\nreturn { peakState, reasonSentence, reasonText, localize };`);
        } catch (error) {
          fail(1, `the two regions do not evaluate together: ${error.message}`);
        }
        if (whole !== undefined) {
          const loadWhole = (active) => {
            const api = whole(stub(active));
            api.localize(stub(active));
            return api;
          };
          // The card builds its sentence from THIS pairing, not from hand-written
          // params, so a renamed reasonParams key can no longer hide.
          const say = (active) => (y, m, d, hh, mm) => {
            const api = loadWhole(active);
            return api.reasonSentence(api.peakState(beijing(y, m, d, hh, mm)));
          };
          const sayZh = say('zh-CN');
          const sayEn = say('en-US');

          check('end to end: a plain weekend', sayZh(2026, 8, 22, 10, 0), '周六，全天按空闲时段计价。');
          check('end to end: the same instant in English', sayEn(2026, 8, 22, 10, 0), 'Saturday. Billed off-peak all day.');
          check('end to end: a holiday carries its own name into the sentence', sayZh(2026, 2, 17, 10, 0), '法定节假日：春节，全天按空闲时段计价。');
          check('end to end: 调休 says the rule out loud', sayZh(2026, 5, 9, 10, 0), '调休上班日，但官方规则按周几算，周末一律空闲（周六），全天按空闲时段计价。');
          check('end to end: a peak window', sayZh(2026, 8, 19, 9, 30), '工作日高峰时段，当前按标准价计价。');
          check('end to end: an uncovered year fills both years', sayZh(2027, 1, 6, 10, 0), '节日表只到 2026 年，2027 年的法定节假日无从判断。');
          check('end to end: an uncovered weekend still answers', sayZh(2027, 1, 2, 10, 0), '周六；官方规则里周末不查节假日表，全天按空闲时段计价。');
          check('end to end: no placeholder is ever left unfilled', (() => {
            // A sweep over every reason the policy can produce: if a template and
            // its reasonParams ever disagree, `{...}` shows up here.
            const api = loadWhole('zh-CN');
            const leaked = [
              [2026, 8, 19, 9, 30], [2026, 8, 19, 12, 30], [2026, 8, 19, 20, 0],
              [2026, 8, 22, 10, 0], [2026, 5, 9, 10, 0], [2026, 2, 17, 10, 0],
              [2026, 10, 1, 10, 0], [2027, 1, 6, 10, 0], [2027, 1, 2, 10, 0],
            ]
              .map(([y, m, d, hh, mm]) => api.reasonSentence(api.peakState(beijing(y, m, d, hh, mm))))
              .filter((sentence) => /\{\w+\}/.test(sentence));
            return leaked.length === 0 ? 'no placeholders' : leaked.join(' | ');
          })(), 'no placeholders');

          // `dateText`, the weekday number and the schedule line are printed by
          // no other assertion in this file, so a broken date formatter or a
          // drifted window list would sail through everything above.
          const sample = loadWhole('zh-CN').peakState(beijing(2026, 8, 22, 10, 0));
          check('dateText is a bare ISO date for the Beijing day', sample.dateText, '2026-08-22');
          check('the weekday travels as a number', String(sample.weekday), '6');
          check('the schedule line lists both peak windows', sample.schedule, '09:00–12:00 · 14:00–18:00');
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // The 调休 decision, but out where it costs something.
  //
  // The case above asks one make-up Saturday what it is. This one asks whether
  // the *walk* agrees: it starts on Friday evening and must step over the make-up
  // Saturday 5/9 (and the Sunday) to reach Monday 09:00. A walk that counted 调休
  // as a working day would answer "1 09:00 780min" — Saturday's own morning
  // window — and that is exactly the bug this case exists to catch.
  // ---------------------------------------------------------------------------
  console.log('\n--- a walk that has to cross a make-up workday ---');
  check('Fri 2026-05-08 20:00 walks to Monday, not to 调休 Saturday', at(2026, 5, 8, 20, 0), `off | 3 09:00 3660min | ${OFF} | workingDayOff`);

  // ---------------------------------------------------------------------------
  // The dismissal wiring, read as text out of client.js.
  //
  // Nothing above can catch this: an outside click that does not close the card
  // is a browser behaviour, and this file has no DOM. What it CAN catch is the
  // regression that actually happened — the card was closed by blur alone, and an
  // outside click on a non-focusable area (the transcript, the composer
  // background) moves no focus, so it fired no blur and the card stayed open
  // until the user pressed the chip a second time.
  //
  // Each assertion names one thing that has to be true for that to work. They are
  // deliberately narrow: this is a tripwire for deleting the listener, not a
  // parser.
  // ---------------------------------------------------------------------------
  console.log('\n--- the card closes when you click outside it ---');
  {
    const wiring = source === undefined ? '' : source;
    check('a document-level pointerdown listener is registered', String(/document\.addEventListener\('pointerdown'/.test(wiring)), 'true');
    check('it runs in the capture phase, ahead of anything that may stop propagation', String(/document\.addEventListener\('pointerdown', [^)]*?, true\)/.test(wiring)), 'true');
    check('it is removed again with the same phase', String(/document\.removeEventListener\('pointerdown', [^)]*?, true\)/.test(wiring)), 'true');
    check('it is registered while the card is open and dropped when it is not', String(/if \(!open\) return undefined;/.test(wiring)), 'true');
    check('the root element it measures "outside" against is the one the listener reads', String(/ref: rootRef,\s*\n\s*className: 'peak-badge-root',/.test(wiring)), 'true');
  }

  console.log('\n--- the chip and the card are opaque, so a wallpaper cannot show through them ---');
  {
    const css = source === undefined ? '' : source;
    // Split the stylesheet into `selector { body }` chunks instead of one loose
    // regex: `\s*` happily walks from a selector past the end of its own block, so
    // a pattern like `\.chip\s*\{\s*background:` can report the NEXT rule's
    // background. The `[^}]*` body cannot cross a closing brace.
    const blocks = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .map((match) => ({ selector: match[1].trim().replace(/\s+/g, ' '), body: match[2] }));
    // Reads every `background` declaration of one rule, by exact selector, in
    // source order. A list rather than one value because the fills are written as
    // a plain static colour first and then the tinted `color-mix()` that layers the
    // wallpaper's own colour over it: the plain one is the fallback, the last one
    // is what a browser that supports `color-mix()` paints. Named `fill` rather
    // than `chip` because the card goes through it too — the first version of this
    // section only checked the chip, and the card was the surface the user actually
    // saw go transparent.
    //
    // The declarations are split on the semicolons that are NOT inside parentheses:
    // a value like `color-mix(…, … calc((100% - var(--x, 0)) * 12%))` contains
    // `[^;]+`, which stops at the first `;` it meets — including the one inside
    // `var(--we-wallpaper-opacity, 0)` if the value were ever written without a
    // nested call, and more importantly stops one declaration early on a multi-line
    // value. Depth counting is what makes this read the whole declaration.
    const declarations = (body) => {
      const out = [];
      let depth = 0;
      let current = '';
      for (const ch of body) {
        if (ch === '(') depth += 1;
        else if (ch === ')') depth -= 1;
        if (ch === ';' && depth === 0) {
          out.push(current);
          current = '';
        } else {
          current += ch;
        }
      }
      out.push(current);
      return out.map((part) => part.trim()).filter((part) => part !== '');
    };
    const fills = (selector) => {
      const block = blocks.find((entry) => entry.selector === selector);
      if (block === undefined) return [];
      return declarations(block.body)
        .filter((part) => /^background\s*:/.test(part))
        .map((part) => part.replace(/^background\s*:\s*/, '').trim());
    };
    // 0.2126R + 0.7152G + 0.0722B, the luminance term of WCAG's contrast ratio.
    const luminance = (hex) => {
      const value = Number.parseInt(hex.slice(1), 16);
      const channel = (part) => {
        const c = part / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel((value >> 16) & 0xff) + 0.7152 * channel((value >> 8) & 0xff) + 0.0722 * channel(value & 0xff);
    };
    const contrast = (a, b) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    // The static colours a fill may use, read from the shipped theme
    // (dsh-client-ui-theme/lib/client.js). Kept as a table so the contrast
    // assertions can check the real pair instead of a copy that may drift.
    const PALETTE = {
      '--dsw-static-neutral-bluish-00': '#ffffff',
      '--dsw-static-neutral-bluish-150': '#e9ecf2',
      '--dsw-static-neutral-bluish-700': '#61666b',
      '--dsw-static-neutral-bluish-750': '#43454a',
      '--dsw-static-neutral-bluish-850': '#2c2c2e',
      '--dsw-static-neutral-bluish-875': '#232324',
    };
    const resolve = (value) => {
      const token = value.match(/^var\((--dsw-static-[a-z0-9-]+)\)$/);
      return token === null ? value : (PALETTE[token[1]] ?? '');
    };
    // A fill is opaque when it is a literal colour, or a `var()` whose token comes
    // from the STATIC palette. The shell's moving aliases are what a translucent
    // theme rewrites, so a fill may not be one of those.
    const opaque = (value) => /^#[0-9a-f]{6}$/i.test(value) || /^var\(--dsw-static-[a-z0-9-]+\)$/.test(value);
    // The tinted fill: a static base plus the wallpaper plugin's own wall-derived
    // colour, mixed to 100% opacity — `in srgb` with two colour arguments, no
    // `transparent` operand, so the RESULT cannot be see-through. The weight is
    // bounded (see the assertion below) and falls to zero when the wallpaper is
    // fully faded, so the static base is what the default look is.
    // Matched against the value with all whitespace removed, so the pattern can be
    // written the way the CSS reads instead of escaping every space.
    //
    // The weight spelling is load-bearing, not cosmetic. Measured in the shipping
    // engine (`.tmp-probe3.mjs`), `calc((100% - var(--we-wallpaper-opacity, 0)) *
    // 12%)` passes `CSS.supports()` and is then SILENTLY DROPPED at computed-value
    // time: the plain declaration above it wins, the fill is the untinted static
    // colour, and the only visible symptom is the absence of a subtle tint — which
    // no screenshot can distinguish. `calc(12% * (1 - var(--we-wallpaper-opacity,
    // 0)))` resolves. Requiring the working form here is what keeps a future edit
    // from quietly re-introducing the broken one.
    const TINTED = /^color-mix\(insrgb,var\(--dsw-static-[a-z0-9-]+\),var\(--we-surface-tint-(?:light|dark),#[0-9a-f]{6}\)calc\((\d+(?:\.\d+)?)%\*\(1-var\(--we-wallpaper-opacity,0\)\)\)\)$/i;
    const tintWeight = (value) => {
      const found = value.replace(/\s+/g, '').match(TINTED);
      return found === null ? null : Number(found[1]);
    };
    const chipLight = fills('.peak-badge-chip');
    const chipDark = fills('body[data-ds-dark-theme] .peak-badge-chip');
    const cardLight = fills('.peak-badge-card');
    const cardDark = fills('body[data-ds-dark-theme] .peak-badge-card');
    const surfaces = [['the light chip', chipLight], ['the dark chip', chipDark], ['the light card', cardLight], ['the dark card', cardDark]];
    check('all four surfaces have a fill', String(surfaces.every(([, list]) => list.length > 0)), 'true');
    check('every fill is either a static colour or the tinted opaque blend',
      String(surfaces.every(([, list]) => list.every((value) => opaque(value) || TINTED.test(value.replace(/\s+/g, ''))))), 'true');
    check('at least one fill carries a tint, or the knob this section exists for is gone',
      String(surfaces.some(([, list]) => list.some((value) => tintWeight(value) !== null))), 'true');
    // A tint strong enough to walk the fill out of its readable band is the failure
    // mode: the point of the tint is that a solid surface still belongs to the
    // picture, not that it repaints itself in the wallpaper's colour. Measured on a
    // fully saturated tint, the 12px chip label holds 5.0:1 at 25% and 4.9:1 at 30%,
    // then falls through 4.5:1 at 50%, so the ceiling sits above the weights in use
    // and below the point where the label stops being legible.
    const weights = surfaces.flatMap(([, list]) => list.map(tintWeight).filter((w) => w !== null));
    check(`every tint stays under 35% (max ${Math.max(...weights)}%)`, String(weights.every((w) => w <= 35)), 'true');
    check('the light and dark chip fills are actually different colours',
      String(chipDark[chipDark.length - 1].toLowerCase() !== chipLight[chipLight.length - 1].toLowerCase()), 'true');
    check('the light and dark card fills are actually different colours',
      String(cardDark[cardDark.length - 1].toLowerCase() !== cardLight[cardLight.length - 1].toLowerCase()), 'true');
    check('no fill is a translucent surface token',
      String(surfaces.some(([, list]) => list.some((value) => /\btransparent\b/.test(value)))), 'false');
    // The specific regression: the card used to read --dsw-alias-bg-overlay, which
    // the wallpaper plugin rewrites into a color-mix() of its glass tint, so the
    // opened panel was see-through. The alias must not come back.
    check('no fill goes back to a glass-rewritten alias',
      String(surfaces.some(([, list]) => list.some((value) => /--dsw-alias-/.test(value)))), 'false');
    // 4.5:1 is WCAG AA for 12px text, and these are the pairs that have to hold
    // once the fills are solid instead of holes in the composer. The label colours
    // are what --dsw-alias-label-primary / -secondary resolve to per theme, and the
    // fills resolve through PALETTE, so a fill pointing at a token the table does
    // not know would print here as a pair that cannot be computed.
    // Worst case, not the default case: the tint is what can move the fill, so the
    // contrast is computed against a fill blended at the FULL weight (which only
    // happens with a fully opaque wallpaper), starting from the static base. If the
    // bounded tint cannot break 4.5:1 at full strength, no lighter weight can.
    //
    // The interpolation is done in LINEAR light, because that is what `color-mix()`
    // does — mixing sRGB-encoded bytes averages them arithmetically and reports a
    // slightly darker, more saturated result than any browser paints. Verified
    // against a real render: the card's `#e9ecf2` + `#b98f5e` at 15% measured
    // `#e2dedc` in the PNG, which is the plain sRGB average, while the linear
    // computation says `#e3e1e3`. Reading the PNG is what settled it.
    const blend = (base, tint, weight) => {
      const parse = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
      const toLinear = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      const toEncoded = (v) => Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255);
      const from = parse(resolve(base));
      const to = parse(tint);
      const mixed = from.map((v, i) => toEncoded((1 - weight / 100) * toLinear(v) + (weight / 100) * toLinear(to[i])));
      return `#${mixed.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    };
    const pairs = [
      ['chip, light theme', chipLight, '#ffffff', '#61666b'],
      ['chip, dark theme', chipDark, '#2c2c2e', '#cfd3d6'],
      ['card, light theme', cardLight, '#e9ecf2', '#0f1115'],
      ['card, dark theme', cardDark, '#232324', '#f9fafb'],
    ];
    for (const [label, list, tint, ink] of pairs) {
      const base = list[0];
      const weight = list.map(tintWeight).filter((w) => w !== null).pop() ?? 0;
      if (!/^#[0-9a-f]{6}$/i.test(resolve(base))) {
        check(`${label}: the fill resolves to a known colour`, resolve(base), resolve(base));
        continue;
      }
      const worst = blend(base, tint, weight);
      const ratio = Math.round(contrast(ink, worst) * 10) / 10;
      check(`${label}: text clears 4.5:1 even at full tint (${ratio}:1)`, String(ratio >= 4.5), 'true');
    }
    // Proof that the assertions above are not idle. The wallpaper plugin clamps its
    // published tint into a readable band, but the fills are tested here against a
    // neutral `#ffffff` / `#2c2c2e`, so the interesting case is a saturated wall.
    // `#f59e0b` is the theme's own amber (--dsw-alias-state-warn-primary), picked
    // because it is the most saturated colour this component already trusts.
    // Measured: 25% keeps 5.0:1 while 50% drops to 4.3:1, so the ceiling above is
    // the thing standing between a tinted chip and an unreadable one.
    const atWeight = (weight) => contrast('#61666b', blend('#ffffff', '#f59e0b', weight));
    check('a saturated tint at the real weight still clears 4.5:1', String(atWeight(25) >= 4.5), 'true');
    check('a saturated tint at half strength would not clear it, so the bound is load-bearing',
      String(atWeight(50) < 4.5), 'true');
  }

  console.log('\n--- the pre-switch warning ---');
  // The rate is fixed at the moment a request is SENT, so the only useful thing a
  // warning can say is "the edge is N minutes away". Everything asserted here is
  // the decision; the sentence and the 今天/明天 wording belong to the view.
  {
    const planAt = (y, m, d, hh, mm, lead) => alertPlan(peakState(beijing(y, m, d, hh, mm)), lead);
    const summary = (plan) => (plan === null
      ? 'null'
      : `${plan.entering} @ ${plan.at} +${plan.inDays}d in ${plan.leftMinutes}min`);

    // 2026-08-19 is a Wednesday, the anchor the verdict section already uses.
    check('two minutes before the morning peak, a 2-minute lead fires',
      summary(planAt(2026, 8, 19, 11, 58, 2)), 'off @ 12:00 +0d in 2min');
    check('the same moment with a 1-minute lead stays quiet',
      summary(planAt(2026, 8, 19, 11, 58, 1)), 'null');
    check('three minutes out with a 2-minute lead stays quiet',
      summary(planAt(2026, 8, 19, 11, 57, 2)), 'null');
    check('the lead is inclusive, not exclusive',
      String(planAt(2026, 8, 19, 11, 58, 2) === null), 'false');
    check('the noon break is announced as the peak coming back',
      summary(planAt(2026, 8, 19, 13, 58, 2)), 'peak @ 14:00 +0d in 2min');
    check('the end of the afternoon peak is announced as money saved',
      summary(planAt(2026, 8, 19, 17, 59, 2)), 'off @ 18:00 +0d in 1min');
    check('a Friday evening edge is still announced',
      summary(planAt(2026, 8, 21, 17, 59, 2)), 'off @ 18:00 +0d in 1min');
    check('a working evening points at tomorrow morning',
      summary(planAt(2026, 8, 19, 20, 0, 1000)), 'peak @ 09:00 +1d in 780min');
    check('thirty minutes does not reach tomorrow morning',
      summary(planAt(2026, 8, 19, 20, 0, 30)), 'null');
    check('a weekend points at Monday, two days out',
      summary(planAt(2026, 8, 22, 10, 0, 3000)), 'peak @ 09:00 +2d in 2820min');

    // The dedupe key. This is the property the whole notice rests on: the clock
    // ticks every 30 s, so a stable key is what stops one edge being announced
    // four times with a visibly shrinking number.
    const keyAt = (y, m, d, hh, mm, lead) => {
      const plan = planAt(y, m, d, hh, mm, lead);
      return plan === null ? 'null' : plan.key;
    };
    check('two observations of one edge share a key',
      String(keyAt(2026, 8, 19, 11, 58, 5) === keyAt(2026, 8, 19, 11, 59, 5)), 'true');
    check('one clock time on different days does not share one',
      String(keyAt(2026, 8, 19, 11, 58, 5) === keyAt(2026, 8, 20, 11, 58, 5)), 'false');
    // Two edges inside one Beijing day. Asked for explicitly rather than through
    // `keyAt`, because comparing two *absences* would pass this for the wrong
    // reason: "no plan" is shared by every moment that has nothing to say.
    const noonEdge = planAt(2026, 8, 19, 12, 30, 120);
    const eveningEdge = planAt(2026, 8, 19, 18, 30, 1200);
    check('both of the day\'s edges do produce a plan',
      `${noonEdge === null ? 'none' : noonEdge.at}/${eveningEdge === null ? 'none' : eveningEdge.at}`,
      '14:00/09:00');
    check('the two edges do not share a key', String(noonEdge.key !== eveningEdge.key), 'true');

    // Every way of having nothing to say.
    check('a lead of zero disables the warning', String(alertPlan(peakState(beijing(2026, 8, 19, 11, 58)), 0)), 'null');
    check('a negative lead disables it too', String(alertPlan(peakState(beijing(2026, 8, 19, 11, 58)), -5)), 'null');
    check('a missing state says nothing', String(alertPlan(undefined, 30)), 'null');
    check('a null state says nothing', String(alertPlan(null, 30)), 'null');
    // The table-exhausted verdict has no `next` at all, and it must never be
    // dressed up as an imminent switch.
    const exhausted = peakState(beijing(2027, 3, 10, 10, 0));
    check('an uncovered year still reports unknown', exhausted.status, 'unknown');
    check('an unknown verdict is never announced', String(alertPlan(exhausted, 30)), 'null');
  }

  console.log('\n--- the alert clock ---');
  // The verdict above is pure; the clock around it is not. What is asserted here
  // is the part a screenshot cannot show and a reader cannot see: that one edge is
  // announced once, that the announcement survives the clock ticking, and that
  // the toast and the system notice are wired to the preferences at all.
  //
  // The clock is driven through the real `#region alert` code, extracted the same
  // way the policy is, over a DOM small enough to read.
  {
    const ALERT_REGIONS = ['policy', 'text', 'alert', 'view'];
    const region = (name) => {
      const at = source.indexOf(`// #region ${name}`);
      const end = source.indexOf('// #endregion', at);
      if (at < 0 || end < 0) return null;
      return source.slice(at, end);
    };
    const pieces = ALERT_REGIONS.map(region);
    const alertSource = pieces.every((piece) => piece !== null)
      ? `${pieces.join('\n')}\nreturn { alert, alertPlan, peakState, startAlertClock, readAlertSettings, writeAlertSettings, notifySupport, closeToast, showToast, renderAlertControls, text, ALERT_CHOICES, ALERT_DEFAULT_MINUTES, TOAST_MS, get notifyHint() { return notifyHint; }, get announcedKey() { return announcedKey; }, set announcedKey(value) { announcedKey = value; } };`
      : null;
    if (alertSource === null) {
      fail(2, 'client.js no longer has extractable policy/text/alert regions, so the clock could not be driven. This says nothing about whether it is correct.');
    }

    const clock = { now: 0 };
    // Passed in as a parameter so it shadows the real `Date` inside the extracted
    // code: the clock has to be the test's, not the machine's.
    class FakeDate extends Date {
      constructor(...args) { if (args.length === 0) super(clock.now); else super(...args); }
      static now() { return clock.now; }
    }

    const makeElement = (tag) => ({
      tagName: String(tag).toUpperCase(), className: '', textContent: '', dataset: {},
      attributes: {}, children: [], parentNode: null, listeners: {},
      setAttribute(name, value) { this.attributes[name] = String(value); },
      getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; },
      addEventListener(type, handler) { (this.listeners[type] = this.listeners[type] || []).push(handler); },
      append(...kids) { for (const kid of kids) { kid.parentNode = this; this.children.push(kid); } },
      removeChild(kid) {
        const at = this.children.indexOf(kid);
        if (at >= 0) { this.children.splice(at, 1); kid.parentNode = null; }
      },
    });
    const textOf = (node) => `${node.textContent}${node.children.map(textOf).join('')}`;

    const boot = () => {
      const body = makeElement('body');
      const document = { body, createElement: makeElement };
      const store = new Map();
      const sent = [];
      function FakeNotification(title, options) { sent.push({ title, options }); }
      FakeNotification.permission = 'default';
      const window = {
        localStorage: {
          getItem: (key) => (store.has(key) ? store.get(key) : null),
          setItem: (key, value) => { store.set(key, String(value)); },
        },
        Notification: FakeNotification,
      };
      const intervals = [];
      const timeouts = [];
      const timer = {
        interval(fn, ms) { const entry = { fn, ms }; intervals.push(entry); return () => { const at = intervals.indexOf(entry); if (at >= 0) intervals.splice(at, 1); }; },
        timeout(fn, ms) { const entry = { fn, ms }; timeouts.push(entry); return () => { const at = timeouts.indexOf(entry); if (at >= 0) timeouts.splice(at, 1); }; },
      };
      // The `view` region builds its nodes through a tiny `h` and wraps the two
      // components in `React.memo`. Neither is the subject here: the row under test
      // is produced by plain function calls, so a memo that just returns its
      // argument and an `h` that records props are enough to read the result.
      const React = { memo: (component) => component };
      const h = (type, props, ...kids) => {
        if (typeof type === 'function') return type(Object.assign({}, props, { children: kids }));
        const node = makeElement(type);
        for (const [key, value] of Object.entries(props || {})) {
          if (key === 'children') continue;
          if (key === 'className') node.className = String(value);
          else if (key === 'style') node.style = value;
          else node[key] = value;
        }
        for (const kid of kids.flat()) {
          if (kid === null || kid === undefined || kid === false) continue;
          if (typeof kid === 'string' || typeof kid === 'number') node.textContent += String(kid);
          else node.append(kid);
        }
        return node;
      };
      const api = new Function('window', 'document', 'ensureStyles', 'PACKAGE_ID', 'Date', 'React', 'h', alertSource)(
        window, document, () => {}, 'dsh-peak', FakeDate, React, h,
      );
      const ctx = { get: () => undefined };
      return {
        api, document, body, window, FakeNotification, sent, store, timer, intervals, timeouts, ctx,
        toasts: () => (document.body === null ? [] : document.body.children.filter((node) => node.className === 'peak-badge-toast')),
        tick: () => { for (const { fn } of [...intervals]) fn(); },
        at: (y, m, d, hh, mm) => { clock.now = beijing(y, m, d, hh, mm); },
      };
    };

    if (alertSource !== null) {
      let live = null;

      // One edge, told once. The clock fires every 30 s and the lead is two
      // minutes, so a naive implementation announces the same boundary four times
      // with a visibly shrinking number.
      live = boot();
      live.at(2026, 8, 19, 11, 58);
      live.api.startAlertClock(live.ctx, live.timer);
      check('the clock registers exactly one interval', String(live.intervals.length), '1');
      check('the tick is TICK_MS apart', String(live.intervals[0].ms), '30000');
      check('an edge two minutes out is announced at once', String(live.toasts().length), '1');
      check('the notice names the boundary', String(live.toasts()[0].children.some((node) => textOf(node).includes('12:00'))), 'true');
      check('the notice prints the remaining time, not just the boundary',
        String(textOf(live.toasts()[0]).includes('2 分钟')), 'true');
      for (let beat = 0; beat < 4; beat += 1) { clock.now += 30000; live.tick(); }
      check('four more ticks do not repeat it', String(live.toasts().length), '1');
      check('and it is still the same notice', String(live.toasts()[0].children.some((node) => textOf(node).includes('12:00'))), 'true');

      // The next edge is a different edge.
      clock.now = beijing(2026, 8, 19, 17, 59);
      live.tick();
      check('the evening edge is announced too', String(live.toasts().length), '1');
      check('and it replaces the morning notice', String(textOf(live.toasts()[0]).includes('18:00')), 'true');
      check('the morning notice is gone', String(textOf(live.toasts()[0]).includes('12:00')), 'false');

      // The key carries the date, so yesterday's edge cannot silence today's.
      live.api.announcedKey = '2026-08-19|0|12:00';
      clock.now = beijing(2026, 8, 20, 11, 58);
      live.tick();
      check('yesterday\'s key does not silence today\'s edge', String(textOf(live.toasts()[0]).includes('12:00')), 'true');

      // Off means off.
      live = boot();
      live.api.alert.leadMinutes = 0;
      live.at(2026, 8, 19, 11, 58);
      live.api.startAlertClock(live.ctx, live.timer);
      for (let beat = 0; beat < 5; beat += 1) { clock.now += 30000; live.tick(); }
      check('a lead of zero keeps the clock silent', String(live.toasts().length), '0');

      // A missing body must leave the edge un-announced, not burn it: the client
      // half can run before the document has one.
      live = boot();
      live.at(2026, 8, 19, 11, 58);
      live.document.body = null;
      live.api.startAlertClock(live.ctx, live.timer);
      check('no body means nothing is said', String(live.toasts().length), '0');
      // The assertion that matters: the edge is still un-announced, so the next
      // tick gets to speak. Reading `toasts()` alone would pass here no matter what
      // the clock did, because there is no body for a notice to land in.
      check('and the edge is still un-announced', String(live.api.announcedKey), 'null');
      live.document.body = live.body;
      live.tick();
      check('so the next tick gets to speak', String(live.toasts().length), '1');

      // Auto-dismiss has to go through the timer service: a bare `setTimeout` is
      // trapped in a client half, and the failure is a notice that never leaves.
      check('auto-dismiss is booked on the timer service', String(live.timeouts.length), '1');
      check('auto-dismiss waits TOAST_MS', String(live.timeouts[0].ms), String(live.api.TOAST_MS));
      live.api.closeToast();
      check('closing removes the notice', String(live.toasts().length), '0');
      live.api.closeToast();
      check('closing twice is harmless', String(live.toasts().length), '0');
      check('closing clears the pending auto-dismiss', String(live.timeouts.length), '0');

      // The preferences survive a restart, and a value the select cannot render is
      // refused rather than trusted.
      live = boot();
      live.api.alert.leadMinutes = 15;
      live.api.alert.notify = true;
      live.api.writeAlertSettings();
      live.api.alert.leadMinutes = live.api.ALERT_DEFAULT_MINUTES;
      live.api.alert.notify = false;
      // A stored `true` is only honoured while the browser agrees. Set that up
      // first, because a wish the browser contradicts is dropped on read.
      live.FakeNotification.permission = 'granted';
      live.api.readAlertSettings();
      check('the lead survives a restart', String(live.api.alert.leadMinutes), '15');
      check('the notification choice survives too', String(live.api.alert.notify), 'true');

      // And the other half of that rule: a stored `true` the browser will not
      // honour is dropped, so the box can never show a tick that cannot fire.
      // Note the order — the wish is stored while it IS granted (otherwise it
      // would never reach the store at all) and then contradicted.
      live = boot();
      live.FakeNotification.permission = 'granted';
      live.api.alert.notify = true;
      live.api.writeAlertSettings();
      live.api.alert.notify = false;
      live.FakeNotification.permission = 'denied';
      live.api.readAlertSettings();
      check('a wish the browser refuses is dropped on read', String(live.api.alert.notify), 'false');
      live = boot();
      live.FakeNotification.permission = 'granted';
      live.api.alert.notify = true;
      live.api.writeAlertSettings();
      live.api.alert.notify = false;
      live.FakeNotification.permission = 'default';
      live.api.readAlertSettings();
      check('and so is a wish that was never granted', String(live.api.alert.notify), 'false');
      // The control, so the two above cannot pass by the box simply never turning
      // itself on: with the browser still agreeing, the same stored `true` sticks.
      live = boot();
      live.FakeNotification.permission = 'granted';
      live.api.alert.notify = true;
      live.api.writeAlertSettings();
      live.api.alert.notify = false;
      live.api.readAlertSettings();
      check('a wish the browser still honours comes back', String(live.api.alert.notify), 'true');
      live.store.set('dsh-peak/alert', '{"leadMinutes":3}');
      live.api.alert.leadMinutes = 15;
      live.api.readAlertSettings();
      check('a lead outside the choices is ignored', String(live.api.alert.leadMinutes), '15');
      live.store.set('dsh-peak/alert', 'not json');
      live.api.readAlertSettings();
      check('an unparseable preference is ignored', String(live.api.alert.leadMinutes), '15');

      // The states of the notification row, each one the card has wording for.
      live = boot();
      live.window.Notification = undefined;
      check('no Notification API reads as unsupported', live.api.notifySupport(), 'unsupported');
      live = boot();
      live.FakeNotification.permission = 'denied';
      check('a refused permission reads as denied', live.api.notifySupport(), 'denied');
      live.FakeNotification.permission = 'granted';
      check('a granted permission reads as granted', live.api.notifySupport(), 'granted');
      live.FakeNotification.permission = 'default';
      check('an unasked permission reads as prompt', live.api.notifySupport(), 'prompt');

      // The system notice only goes out when the user asked for it *and* the
      // browser agreed. Either one alone is silence, and the in-page toast is not
      // the system notice: it must survive both.
      live = boot();
      live.at(2026, 8, 19, 11, 58);
      live.FakeNotification.permission = 'granted';
      live.api.alert.notify = false;
      live.api.startAlertClock(live.ctx, live.timer);
      check('a granted permission alone raises no system notice', String(live.sent.length), '0');
      check('but the in-page notice still goes out', String(live.toasts().length), '1');
      live = boot();
      live.at(2026, 8, 19, 11, 58);
      live.FakeNotification.permission = 'default';
      live.api.alert.notify = true;
      live.api.startAlertClock(live.ctx, live.timer);
      check('the preference alone raises no system notice', String(live.sent.length), '0');
      check('the in-page notice goes out anyway', String(live.toasts().length), '1');
      live = boot();
      live.at(2026, 8, 19, 11, 58);
      live.FakeNotification.permission = 'granted';
      live.api.alert.notify = true;
      live.api.startAlertClock(live.ctx, live.timer);
      check('both together raise one system notice', String(live.sent.length), '1');
      check('the system notice is tagged with the boundary',
        String(live.sent[0].options.tag.includes('2026-08-19')), 'true');

      // The notification row, rendered. A press that ends in `denied` — or in
      // `default`, which is what a dismissed prompt leaves behind — used to leave
      // no trace at all: the box sprang back and the card said nothing, which is
      // indistinguishable from a control that does not work. The row now always
      // carries its own status, so these assertions are about words being present,
      // not about a behaviour that only shows up in a screenshot.
      const find = (node, match) => {
        if (match(node)) return node;
        for (const kid of node.children) {
          const hit = find(kid, match);
          if (hit !== undefined) return hit;
        }
        return undefined;
      };
      const rowOf = (setup) => {
        const box = boot();
        if (typeof setup === 'function') setup(box);
        const node = box.api.renderAlertControls(() => {});
        const label = find(node, (child) => child.className === 'peak-badge-check');
        const note = label === undefined ? undefined : find(label, (child) => child.className === 'peak-badge-note');
        const input = label === undefined ? undefined : find(label, (child) => child.tagName === 'INPUT');
        return {
          note: note === undefined ? null : textOf(note),
          disabled: input === undefined ? null : input.disabled,
          input,
          box,
        };
      };

      live = boot();
      live.FakeNotification.permission = 'default';
      let row = rowOf();
      check('an untouched box explains how to turn it on',
        String(row.note === live.api.text.notifyNotePrompt), 'true');
      check('and it is pressable', String(row.disabled), 'false');

      live = boot();
      live.FakeNotification.permission = 'denied';
      row = rowOf((box) => { box.FakeNotification.permission = 'denied'; });
      check('a refused box says it was refused, not nothing',
        String(row.note === live.api.text.notifyNoteDenied), 'true');
      check('a refusal is not a dead control', String(row.disabled), 'false');

      live = boot();
      row = rowOf((box) => { box.window.Notification = undefined; });
      check('a missing API says so',
        String(row.note === live.api.text.notifyNoteUnsupported), 'true');
      check('and that is the one case that is disabled', String(row.disabled), 'true');

      // The press itself, through the handler the row installs: a granted answer
      // ticks the box and clears the note, a refused one leaves a refusal behind.
      // The stub moves `permission` before it resolves, the way a real browser
      // does, because the row reads the state back rather than trusting the answer.
      row = rowOf((box) => {
        box.FakeNotification.requestPermission = () => {
          box.FakeNotification.permission = 'denied';
          return Promise.resolve('denied');
        };
      });
      let input = row.input;
      input.checked = true;
      input.onChange({ target: input });
      await Promise.resolve();
      await Promise.resolve();
      check('a refused press turns the box back off', String(row.box.api.alert.notify), 'false');
      check('and leaves a refusal to read', String(row.box.api.notifyHint), 'denied');
      // The same box, drawn again after the refusal: the note has to change with
      // it, because a row that reverts in silence is the bug this section exists
      // for.
      {
        const again = row.box.api.renderAlertControls(() => {});
        const label = find(again, (child) => child.className === 'peak-badge-check');
        const note = find(label, (child) => child.className === 'peak-badge-note');
        check('and the redrawn row says it was refused',
          String(note !== undefined && textOf(note) === row.box.api.text.notifyNoteDenied), 'true');
      }

      row = rowOf((box) => {
        box.FakeNotification.requestPermission = () => {
          box.FakeNotification.permission = 'granted';
          return Promise.resolve('granted');
        };
      });
      input = row.input;
      input.checked = true;
      input.onChange({ target: input });
      await Promise.resolve();
      await Promise.resolve();
      check('a granted press turns it on', String(row.box.api.alert.notify), 'true');
      check('and the note is gone', String(row.box.api.notifyHint), 'null');
      // The same grant in the other shape. Modern engines answer with the
      // permission STRING, legacy ones pass a boolean to a callback; reading only
      // the boolean silently discarded every modern grant.
      row = rowOf((box) => {
        box.FakeNotification.requestPermission = (callback) => {
          box.FakeNotification.permission = 'granted';
          callback(true);
        };
      });
      input = row.input;
      input.checked = true;
      input.onChange({ target: input });
      check('a granted press in the callback shape works too', String(row.box.api.alert.notify), 'true');
      // And a promise that resolves with the string `'denied'`: the box must go
      // back off and say so.
      row = rowOf((box) => {
        box.FakeNotification.requestPermission = () => {
          box.FakeNotification.permission = 'denied';
          return Promise.resolve('denied');
        };
      });
      input = row.input;
      input.checked = true;
      input.onChange({ target: input });
      await Promise.resolve();
      await Promise.resolve();
      check('a denied string turns it back off', String(row.box.api.alert.notify), 'false');
      check('and is reported as a refusal', String(row.box.api.notifyHint), 'denied');
    }
  }

  console.log('\n--- the file is a module the loader can actually load ---');
  {
    // Everything above reads client.js as TEXT: the policy is sliced out of the
    // file and compiled on its own, and the stylesheet is matched with regular
    // expressions. So a client.js that cannot be loaded at all passed all of it.
    // That is not a hypothetical: version 0.1.4 shipped with a backtick inside the
    // CSS template literal, which closed the literal early and made the whole
    // bundle a SyntaxError, while this script printed "176 passed, 0 failed" and
    // the harness rendered seven perfectly good screenshots. The failure was
    // reported by the application instead, as a load error with an empty card.
    //
    // The file is therefore EXECUTED here, against the smallest honest stand-in
    // for the browser: the loader call at the top level and a `window` to hang it
    // on. Nothing else runs at import time — the factory only registers, which is
    // the behaviour the real loader depends on.
    let registered;
    let loaded = 'yes';
    try {
      const evaluate = new Function('window', `${source}\n`);
      evaluate({
        __ModuleLoader__: {
          load(module) {
            registered = module;
          },
        },
      });
    } catch (error) {
      // The file cannot be compiled at all, so every check below would report on a
      // string that does not exist. Report the real message — it is the one the
      // application shows — and stop asking.
      loaded = 'no';
      check('client.js is a file the browser can compile', error.message, 'it compiles');
    }
    if (loaded === 'yes') {
      check('the loader call at the top level registers a module', registered === undefined ? 'no' : 'yes', 'yes');
      check('the registered id is the package id the profile installs',
        registered === undefined ? 'none' : String(registered.id), 'dsh-peak');
      check('the registered module exposes a factory',
        registered === undefined ? 'none' : typeof registered.factory, 'function');

      // The stylesheet has to survive as one piece. A backtick is the failure mode
      // above. The second one is subtler: the literal's contents are CSS, not
      // source, so a block comment written in there is closed only if it is opened
      // in there too — an unpaired closer ends a comment the surrounding JavaScript
      // opened, and everything after it is compiled as code. The comments must
      // therefore be balanced, not absent: this stylesheet legitimately explains
      // four of its rules.
      const literalStart = source.indexOf('const CSS = `');
      const literalEnd = source.indexOf('`;', literalStart);
      check('the stylesheet is written as one template literal',
        literalStart < 0 || literalEnd < 0 ? 'not found' : 'found', 'found');
      const literal = literalStart < 0 || literalEnd < 0
        ? ''
        : source.slice(literalStart + 'const CSS = `'.length, literalEnd);
      check('nothing inside it closes the literal', String(literal.includes('`')), 'false');
      const balanced = (() => {
        let index = 0;
        let open = false;
        for (;;) {
          const next = literal.indexOf(open ? '*/' : '/*', index);
          if (next < 0) return open ? 'unterminated' : 'balanced';
          open = !open;
          index = next + 2;
        }
      })();
      check('every block comment inside it is opened and closed in there too', balanced, 'balanced');
      // A count, because a rule that got swallowed by a stray delimiter would leave
      // the rest of the literal intact: every other check here would still pass.
      // 34 rules as of 0.1.6. Raise it when rules are added, never lower it to make
      // a run go green.
      check('every one of its 34 rules is still there',
        String([...literal.matchAll(/([^{}]+)\{/g)].length), '34');
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  // A floor, not just `failed > 0`: a section that stops running entirely would
  // otherwise print "0 passed, 0 failed" and exit 0 — the loudest possible
  // silence. Raise it when cases are added; lowering it is the one edit that can
  // quietly disarm this tripwire, so do that only on purpose.
  const FLOOR = 200;
  if (passed < FLOOR && failed === 0) {
    console.error(`only ${passed} cases ran, below the expected floor of ${FLOOR} — a section has stopped running.`);
    process.exitCode = 1;
  }
  if (failed > 0) process.exitCode = 1;
}
