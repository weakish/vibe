/** Pure announce / degrade FSM (testable without DOM). */

type mode =
  | Clock
  | Announce
  | Degrade;

type state = {
  mode,
  text: string,
  lastAnnouncedHour: int,
  audioArmed: bool,
  /** Generation id; supersede bumps it so stale completions are ignored. */
  announceGen: int,
  /** Hour of the in-flight announce sequence, if any. */
  inFlightHour: option(int),
};

type action =
  | EnterDegrade(string) /* unix seconds string */
  | TickClock(string) /* hhmm */
  | StartAnnounce(string, int) /* label, hour */
  | CompleteAnnounce(int, string, int) /* gen, hhmm, hour */
  | ToggleAudio;

let unixSecondsText: float => string = [%mel.raw
  {|function (nowMs) { return String(Math.floor(nowMs / 1000)); }|}
];

let initClock = (~hhmm: string, ~hour: int): state => {
  mode: Clock,
  text: hhmm,
  lastAnnouncedHour: hour,
  audioArmed: false,
  announceGen: 0,
  inFlightHour: None,
};

let initDegrade = (~nowMs: float): state => {
  mode: Degrade,
  text: unixSecondsText(nowMs),
  lastAnnouncedHour: (-1),
  audioArmed: false,
  announceGen: 0,
  inFlightHour: None,
};

/** Should foreground tick start an announce? Hidden tabs wait for visibility. */
let shouldAnnounceForeground =
    (
      ~tabHidden: bool,
      ~prevHour: int,
      ~hour: int,
      ~minute: int,
      ~lastAnnouncedHour: int,
    )
    : bool =>
  !tabHidden && minute == 0 && hour != prevHour && lastAnnouncedHour != hour;

/** Background → visible: on the hour if not yet announced and not already in flight. */
let shouldAnnounceOnVisible =
    (
      ~hour: int,
      ~minute: int,
      ~lastAnnouncedHour: int,
      ~inFlightHour: option(int),
    )
    : bool =>
  minute == 0
  && lastAnnouncedHour != hour
  && inFlightHour != Some(hour);

/** In-flight hour differs at :00 and is not already lastAnnouncedHour. */
let shouldSupersede =
    (
      ~tabHidden: bool,
      ~minute: int,
      ~hour: int,
      ~lastAnnouncedHour: int,
      ~inFlightHour: option(int),
    )
    : bool =>
  !tabHidden
  && (
    switch (inFlightHour) {
    | Some(inFlight) =>
      minute == 0 && hour != inFlight && lastAnnouncedHour != hour
    | None => false
    }
  );

let reduce = (state: state, action: action): state =>
  switch (state.mode, action) {
  | (_, EnterDegrade(text)) => {
      ...state,
      mode: Degrade,
      text,
      announceGen: state.announceGen + 1,
      inFlightHour: None,
    }
  | (Degrade, TickClock(_) | StartAnnounce(_) | CompleteAnnounce(_) | ToggleAudio) => state
  | (_, ToggleAudio) => {...state, audioArmed: !state.audioArmed}
  | (Clock, TickClock(hhmm)) => {
      ...state,
      text: hhmm,
      mode: Clock,
    }
  | (Announce, TickClock(_)) => state
  | (_, StartAnnounce(label, hour)) => {
      ...state,
      mode: Announce,
      text: label,
      announceGen: state.announceGen + 1,
      inFlightHour: Some(hour),
    }
  | (Announce, CompleteAnnounce(gen, hhmm, hour)) =>
    if (gen != state.announceGen) {
      state;
    } else {
      {
        ...state,
        mode: Clock,
        text: hhmm,
        lastAnnouncedHour: hour,
        inFlightHour: None,
      };
    }
  | (Clock, CompleteAnnounce(_)) => state
  };

let completeAnnounce =
    (state: state, ~gen: int, ~hhmm: string, ~hour: int): state =>
  reduce(state, CompleteAnnounce(gen, hhmm, hour));
