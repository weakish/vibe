/** Bell chimes: N plays spaced by CHIME_GAP_MS; POST_CHIME_TAIL_MS after last. */

let chimeGapMs = 800;
let postChimeTailMs = 1000;
/** Must stay < chimeGapMs; keep in sync with assets/NOTICE trim. */
let sampleDurationMs = 550;

type timerId = Js.Global.timeoutId;
type audioEl;

type handle = {
  mutable timers: list(timerId),
  mutable audio: option(audioEl),
  mutable cancelled: bool,
  mutable playEnabled: bool,
  mutable playbackCancelled: bool,
  mutable startedAtMs: float,
  mutable completionTimer: option(timerId),
  mutable completed: bool,
};

let makeHandle = (): handle => {
  timers: [],
  audio: None,
  cancelled: false,
  playEnabled: false,
  playbackCancelled: false,
  startedAtMs: 0.,
  completionTimer: None,
  completed: false,
};

let clearTimers = (h: handle): unit => {
  h.timers |> List.iter(id => Js.Global.clearTimeout(id));
  h.timers = [];
  h.completionTimer = None;
};

[@mel.send] external audioPause: audioEl => unit = "pause";
[@mel.set] external setAudioCurrentTime: (audioEl, float) => unit = "currentTime";

let stopAudio = (h: handle): unit => {
  switch (h.audio) {
  | Some(el) =>
    audioPause(el);
    setAudioCurrentTime(el, 0.);
    h.audio = None
  | None => ()
  };
};

let cancel = (h: handle): unit => {
  h.cancelled = true;
  clearTimers(h);
  stopAudio(h);
};

/** Stop samples without aborting the announce complete timer. */
let setPlayEnabled = (h: handle, enabled: bool): unit => {
  h.playEnabled = enabled;
  if (!enabled) {
    h.playbackCancelled = true;
    stopAudio(h);
  };
};

[@mel.new] external createAudio: string => audioEl = "Audio";
[@mel.send] external audioPlay: audioEl => Js.Promise.t(unit) = "play";

let playOne =
    (h: handle, src: string, ~onPlaybackFailure: unit => unit): unit =>
  if (!h.cancelled && h.playEnabled && !h.playbackCancelled) {
    stopAudio(h);
    let el = createAudio(src);
    h.audio = Some(el);
    audioPlay(el)
    |> Js.Promise.then_(_ => Js.Promise.resolve())
    |> Js.Promise.catch(_err => {
      onPlaybackFailure();
      Js.Console.warn("bell play failed (armed)");
      Js.Promise.resolve();
    })
    |> ignore;
  };

/** Unarmed label window: N * CHIME_GAP_MS + POST_CHIME_TAIL_MS. */
let silentAnnounceDurationMs = (n: int): int =>
  n * chimeGapMs + postChimeTailMs;

/** Armed label window: last chime start + sample + POST_CHIME_TAIL_MS. */
let armedAnnounceDurationMs = (n: int): int =>
  if (n <= 0) {
    postChimeTailMs;
  } else {
    (n - 1) * chimeGapMs + sampleDurationMs + postChimeTailMs;
  };

/**
 * Schedule N chimes. If [armed], play audio; otherwise silent gaps only.
 * [onComplete] fires after last chime end + POST_CHIME_TAIL_MS
 * (or after N * CHIME_GAP_MS + POST_CHIME_TAIL_MS when unarmed).
 */
let schedule =
    (
      ~armed: bool,
      ~n: int,
      ~src: string,
      ~onComplete: unit => unit,
      (),
    )
    : handle => {
  let h = makeHandle();
  h.playEnabled = armed;
  h.startedAtMs = Js.Date.now();
  let scheduleAt = (delayMs, fn) => {
    let id =
      Js.Global.setTimeout(
        ~f=
          () =>
            if (!h.cancelled) {
              fn();
            },
        delayMs,
      );
    h.timers = [id, ...h.timers];
    id;
  };

  let complete = () => {
    h.completionTimer = None;
    h.completed = true;
    onComplete();
  };

  let scheduleCompletion = delayMs => {
    let id = scheduleAt(delayMs, complete);
    h.completionTimer = Some(id);
  };

  let fallbackToSilent = () => {
    if (
      !h.cancelled
      && h.playEnabled
      && !h.playbackCancelled
      && !h.completed
    ) {
      h.playbackCancelled = true;
      stopAudio(h);
      switch (h.completionTimer) {
      | Some(id) => Js.Global.clearTimeout(id)
      | None => ()
      };
      h.completionTimer = None;
      let elapsedMs = int_of_float(Js.Date.now() -. h.startedAtMs);
      let remainingMs = silentAnnounceDurationMs(n) - elapsedMs;
      scheduleCompletion(remainingMs > 0 ? remainingMs : 0);
    };
  };

  if (armed && n > 0) {
    for (i in 0 to n - 1) {
      let startMs = i * chimeGapMs;
      scheduleAt(
        startMs,
        () => playOne(h, src, ~onPlaybackFailure=fallbackToSilent),
      )
      |> ignore;
    };
  };

  let completeAt =
    armed ? armedAnnounceDurationMs(n) : silentAnnounceDurationMs(n);
  scheduleCompletion(completeAt);
  h;
};
