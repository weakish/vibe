/** Bangkok wall time: BMT history probe A + display numbering probe B + manual fallback. */

type numbering = [ | `Thai | `Latn ];

type wall = {
  hour: int,
  minute: int,
  hhmm: string,
};

type probeAResult = [ | `Pass | `Fail ];

type seams = {
  now: unit => float,
  forceProbeA: option(probeAResult),
  forceLatnDisplay: bool,
  /** Skip Intl; resolve/nowWall fail so App can enter degrade. */
  forceDegrade: bool,
  /** After a successful resolve, wallAt/display format fails (tick / mid-announce). */
  throwOnWallFormat: bool,
};

let defaultSeams: seams = {
  now: () => Js.Date.now(),
  forceProbeA: None,
  forceLatnDisplay: false,
  forceDegrade: false,
  throwOnWallFormat: false,
};

type dateTimeFormatOptions;
type dateTimeFormat;
type formatPart;

[@mel.get] external partType: formatPart => string = "type";
[@mel.get] external partValueField: formatPart => string = "value";

[@mel.scope "Intl"] [@mel.new]
external makeDateTimeFormat:
  (string, dateTimeFormatOptions) => dateTimeFormat =
  "DateTimeFormat";

[@mel.send]
external formatToParts: (dateTimeFormat, Js.Date.t) => array(formatPart) =
  "formatToParts";

external asOptions: Js.t({..}) => dateTimeFormatOptions = "%identity";

[@mel.scope "Date"]
external dateUtc: (int, int, int, int, int, int) => float = "UTC";

let intlSmokeOk: unit => bool = [%mel.raw
  {|
  function () {
    try {
      if (typeof Intl === "undefined" || typeof Intl.DateTimeFormat !== "function") {
        return false;
      }
      var fmt = new Intl.DateTimeFormat("th-TH", {
        timeZone: "UTC",
        hourCycle: "h23",
        numberingSystem: "latn",
        hour: "2-digit",
        minute: "2-digit"
      });
      fmt.formatToParts(new Date(0));
      return true;
    } catch (e) {
      return false;
    }
  }
|}
];

let intlUsable = (~seams=defaultSeams, ()): bool =>
  !seams.forceDegrade && intlSmokeOk();

let baseOpts = (~timeZone: string, ~numberingSystem: string) =>
  asOptions({
    "timeZone": timeZone,
    "hourCycle": "h23",
    "numberingSystem": numberingSystem,
    "hour": "2-digit",
    "minute": "2-digit",
  });

let tryMake = (locale, opts): result(dateTimeFormat, string) =>
  try(Ok(makeDateTimeFormat(locale, opts))) {
  | _ => Error("construct")
  };

let tryParts = (fmt, date): result(array(formatPart), string) =>
  try(Ok(formatToParts(fmt, date))) {
  | _ => Error("format")
  };

let partValue = (parts: array(formatPart), kind: string): option(string) => {
  let rec loop = i =>
    if (i >= Array.length(parts)) {
      None;
    } else if (partType(parts[i]) == kind) {
      Some(partValueField(parts[i]));
    } else {
      loop(i + 1);
    };
  loop(0);
};

let parseIntSafe = (s: string): option(int) =>
  switch (int_of_string(s)) {
  | n => Some(n)
  | exception _ => None
  };

let isAllThaiDigits = (s: string): bool => {
  let len = Js.String.length(s);
  if (len == 0) {
    false;
  } else {
    let rec loop = i =>
      if (i >= len) {
        true;
      } else {
        let code = Js.String.charCodeAt(~index=i, s);
        code >= 0x0E50. && code <= 0x0E59. && loop(i + 1);
      };
    loop(0);
  };
};

let ictTransitionUtcMs: float = dateUtc(1920, 2, 31, 17, 17, 56);
let lastBmtUtcMs: float = ictTransitionUtcMs -. 1000.;
let bmtOffsetMs = 24124000.;
let ictOffsetMs = 25200000.;
/* 2026-07-20T15:00:00Z → Bangkok 22:00 ICT. Date.UTC month is 0-indexed (6 = July). */
let probeBIctUtcMs: float = dateUtc(2026, 6, 20, 15, 0, 0);

let bangkokWallManual = (utcMs: float): (int, int) => {
  let offset = utcMs < ictTransitionUtcMs ? bmtOffsetMs : ictOffsetMs;
  let d = Js.Date.fromFloat(utcMs +. offset);
  (int_of_float(Js.Date.getUTCHours(d)), int_of_float(Js.Date.getUTCMinutes(d)));
};

let runProbeA = (): result(probeAResult, string) => {
  let opts = baseOpts(~timeZone="Asia/Bangkok", ~numberingSystem="latn");
  switch (tryMake("th-TH", opts)) {
  | Error(e) => Error(e)
  | Ok(fmt) =>
    switch (tryParts(fmt, Js.Date.fromFloat(lastBmtUtcMs))) {
    | Error(e) => Error(e)
    | Ok(parts) =>
      let hourOk =
        switch (partValue(parts, "hour")) {
        | Some(h) => parseIntSafe(h) == Some(23)
        | None => false
        };
      let minuteOk =
        switch (partValue(parts, "minute")) {
        | Some(m) => parseIntSafe(m) == Some(59)
        | None => false
        };
      Ok(hourOk && minuteOk ? `Pass : `Fail);
    }
  };
};

let thaiProbeOk = (~timeZone, ~date): bool => {
  let opts = baseOpts(~timeZone, ~numberingSystem="thai");
  switch (tryMake("th-TH", opts)) {
  | Error(_) => false
  | Ok(fmt) =>
    switch (tryParts(fmt, date)) {
    | Error(_) => false
    | Ok(parts) =>
      switch (partValue(parts, "hour"), partValue(parts, "minute")) {
      | (Some(h), Some(m)) => isAllThaiDigits(h) && isAllThaiDigits(m)
      | _ => false
      }
    }
  };
};

let probeBAnchor = (~useBangkokTz: bool): (string, Js.Date.t) =>
  if (useBangkokTz) {
    ("Asia/Bangkok", Js.Date.fromFloat(probeBIctUtcMs));
  } else {
    ("UTC", Js.Date.fromFloat(dateUtc(1970, 0, 1, 22, 0, 0)));
  };

let runProbeB = (~useBangkokTz: bool): result(numbering, string) => {
  let (tz, probeDate) = probeBAnchor(~useBangkokTz);
  let latnOpts = baseOpts(~timeZone=tz, ~numberingSystem="latn");
  switch (tryMake("th-TH", latnOpts)) {
  | Error(e) => Error(e)
  | Ok(fmt) =>
    switch (tryParts(fmt, probeDate)) {
    | Error(e) => Error(e)
    | Ok(_) =>
      Ok(thaiProbeOk(~timeZone=tz, ~date=probeDate) ? `Thai : `Latn)
    }
  };
};

type resolved = {
  probeA: probeAResult,
  numbering,
  logicFmt: option(dateTimeFormat),
  displayFmt: dateTimeFormat,
  throwOnWallFormat: bool,
};

let resolve = (seams: seams): result(resolved, string) =>
  if (seams.forceDegrade) {
    Error("degrade");
  } else {
    let aRes =
      switch (seams.forceProbeA) {
      | Some(r) => Ok(r)
      | None => runProbeA()
      };
    switch (aRes) {
    | Error(e) => Error(e)
    | Ok(a) =>
      let useBangkok = a == `Pass;
      let nRes =
        switch (runProbeB(~useBangkokTz=useBangkok)) {
        | Error(e) => Error(e)
        | Ok(n) => Ok(seams.forceLatnDisplay ? `Latn : n)
        };
      switch (nRes) {
      | Error(e) => Error(e)
      | Ok(numbering) =>
        let displayTz = useBangkok ? "Asia/Bangkok" : "UTC";
        let ns = numbering == `Thai ? "thai" : "latn";
        let displayOpts = baseOpts(~timeZone=displayTz, ~numberingSystem=ns);
        switch (tryMake("th-TH", displayOpts)) {
        | Error(e) => Error(e)
        | Ok(displayFmt) =>
          let logicFmtRes =
            if (useBangkok) {
              let logicOpts =
                baseOpts(~timeZone="Asia/Bangkok", ~numberingSystem="latn");
              switch (tryMake("th-TH", logicOpts)) {
              | Ok(f) => Ok(Some(f))
              | Error(e) => Error(e)
              };
            } else {
              Ok(None);
            };
          switch (logicFmtRes) {
          | Error(e) => Error(e)
          | Ok(logicFmt) =>
            Ok({
              probeA: a,
              numbering,
              logicFmt,
              displayFmt,
              throwOnWallFormat: seams.throwOnWallFormat,
            })
          };
        };
      };
    };
  };

let hhmmFromParts = (parts: array(formatPart)): result(string, string) =>
  switch (partValue(parts, "hour"), partValue(parts, "minute")) {
  | (Some(h), Some(m)) when h != "" && m != "" => Ok(h ++ m)
  | _ => Error("parts")
  };

let wallFromIntlLogic =
    (fmt: dateTimeFormat, utcMs: float): result((int, int), string) =>
  switch (tryParts(fmt, Js.Date.fromFloat(utcMs))) {
  | Error(e) => Error(e)
  | Ok(parts) =>
    switch (partValue(parts, "hour"), partValue(parts, "minute")) {
    | (Some(hs), Some(ms)) =>
      switch (parseIntSafe(hs), parseIntSafe(ms)) {
      | (Some(h), Some(m)) => Ok((h, m))
      | _ => Error("parse")
      }
    | _ => Error("parts")
    }
  };

let displayHhmm =
    (~resolved: resolved, ~hour: int, ~minute: int, ~utcMs: float)
    : result(string, string) =>
  if (resolved.probeA == `Pass) {
    switch (tryParts(resolved.displayFmt, Js.Date.fromFloat(utcMs))) {
    | Error(e) => Error(e)
    | Ok(parts) => hhmmFromParts(parts)
    };
  } else {
    let anchor =
      Js.Date.fromFloat(
        dateUtc(1970, 0, 1, hour, minute, 0),
      );
    switch (tryParts(resolved.displayFmt, anchor)) {
    | Error(e) => Error(e)
    | Ok(parts) => hhmmFromParts(parts)
    };
  };

let wallAt = (~resolved: resolved, utcMs: float): result(wall, string) =>
  if (resolved.throwOnWallFormat) {
    Error("throw");
  } else {
    let hm =
      switch (resolved.probeA, resolved.logicFmt) {
      | (`Pass, Some(fmt)) => wallFromIntlLogic(fmt, utcMs)
      | (`Pass, None) => Error("logicFmt")
      | (`Fail, _) => Ok(bangkokWallManual(utcMs))
      };
    switch (hm) {
    | Error(e) => Error(e)
    | Ok((hour, minute)) =>
      switch (displayHhmm(~resolved, ~hour, ~minute, ~utcMs)) {
      | Error(e) => Error(e)
      | Ok(hhmm) => Ok({hour, minute, hhmm})
      }
    };
  };

let nowWall = (~seams=defaultSeams, ()): result((resolved, wall), string) =>
  switch (resolve(seams)) {
  | Error(e) => Error(e)
  | Ok(resolved) =>
    switch (wallAt(~resolved, seams.now())) {
    | Error(e) => Error(e)
    | Ok(w) => Ok((resolved, w))
    }
  };

let logicHhMm = (~seams=defaultSeams, utcMs: float): result((int, int), string) =>
  switch (resolve(seams)) {
  | Error(e) => Error(e)
  | Ok(resolved) =>
    switch (wallAt(~resolved, utcMs)) {
    | Error(e) => Error(e)
    | Ok(w) => Ok((w.hour, w.minute))
    }
  };
