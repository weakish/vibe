open Jest;

[@mel.scope "Date"]
external dateUtc: (int, int, int, int, int, int) => float = "UTC";

let fmtHm = (h, m) =>
  (h < 10 ? "0" : "")
  ++ string_of_int(h)
  ++ ":"
  ++ (m < 10 ? "0" : "")
  ++ string_of_int(m);

let seams =
    (
      ~now=() => 0.,
      ~forceProbeA=None,
      ~forceLatnDisplay=false,
      ~forceDegrade=false,
      ~throwOnWallFormat=false,
      (),
    )
    : Zone.seams => {
  now,
  forceProbeA,
  forceLatnDisplay,
  forceDegrade,
  throwOnWallFormat,
};

let () =
  describe("Zone", () => {
    open Expect;

    test("bangkokWallManual BMT fixture 17:17:55Z → 23:59", () => {
      let ms = dateUtc(1920, 2, 31, 17, 17, 55);
      let (h, m) = Zone.bangkokWallManual(ms);
      expect(fmtHm(h, m)) |> toBe("23:59");
    });

    test("bangkokWallManual ICT fixture 17:17:56Z → 00:17", () => {
      let ms = dateUtc(1920, 2, 31, 17, 17, 56);
      let (h, m) = Zone.bangkokWallManual(ms);
      expect(fmtHm(h, m)) |> toBe("00:17");
    });

    test("logic via Intl or manual at BMT boundary", () => {
      let s = seams(~forceLatnDisplay=true, ());
      let before = dateUtc(1920, 2, 31, 17, 17, 55);
      let after = dateUtc(1920, 2, 31, 17, 17, 56);
      switch (Zone.logicHhMm(~seams=s, before), Zone.logicHhMm(~seams=s, after)) {
      | (Ok((h1, m1)), Ok((h2, m2))) =>
        expect(fmtHm(h1, m1)) |> toBe("23:59") |> ignore;
        expect(fmtHm(h2, m2)) |> toBe("00:17");
      | _ => expect(false) |> toBe(true)
      };
    });

    test("forced probe A fail still yields manual fixtures + latn HHMM", () => {
      let s =
        seams(
          ~now=() => dateUtc(2026, 6, 20, 15, 0, 0),
          ~forceProbeA=Some(`Fail),
          ~forceLatnDisplay=true,
          (),
        );
      switch (Zone.resolve(s)) {
      | Error(_) => expect(false) |> toBe(true)
      | Ok(resolved) =>
        expect(resolved.probeA) |> toEqual(`Fail) |> ignore;
        let before = dateUtc(1920, 2, 31, 17, 17, 55);
        let after = dateUtc(1920, 2, 31, 17, 17, 56);
        switch (
          Zone.wallAt(~resolved, before),
          Zone.wallAt(~resolved, after),
          Zone.wallAt(~resolved, s.now()),
        ) {
        | (Ok(w1), Ok(w2), Ok(now)) =>
          expect(fmtHm(w1.hour, w1.minute)) |> toBe("23:59") |> ignore;
          expect(fmtHm(w2.hour, w2.minute)) |> toBe("00:17") |> ignore;
          expect(now.hhmm) |> toBe("2200");
        | _ => expect(false) |> toBe(true)
        };
      };
    });

    test("display thai HHMM at Bangkok 22:00 when thai works", () => {
      let s =
        seams(
          ~now=() => dateUtc(2026, 6, 20, 15, 0, 0),
          ~forceProbeA=Some(`Pass),
          (),
        );
      switch (Zone.nowWall(~seams=s, ())) {
      | Error(_) => expect(false) |> toBe(true)
      | Ok((_r, wall)) =>
        expect(wall.hour) |> toBe(22) |> ignore;
        expect(wall.minute) |> toBe(0) |> ignore;
        /* thai digits ๒๒๐๐ or latn 2200 if thai unavailable */
        let ok =
          wall.hhmm == {js|๒๒๐๐|js} || wall.hhmm == "2200";
        expect(ok) |> toBe(true);
      };
    });

    test("forced latn display yields 2200", () => {
      let s =
        seams(
          ~now=() => dateUtc(2026, 6, 20, 15, 0, 0),
          ~forceProbeA=Some(`Pass),
          ~forceLatnDisplay=true,
          (),
        );
      switch (Zone.nowWall(~seams=s, ())) {
      | Error(_) => expect(false) |> toBe(true)
      | Ok((_r, wall)) => expect(wall.hhmm) |> toBe("2200")
      };
    });

    test("intlUsable is true in Node", () => {
      expect(Zone.intlUsable()) |> toBe(true);
    });

    test("forceDegrade: intlUsable false and resolve Error", () => {
      let s = seams(~forceDegrade=true, ());
      expect(Zone.intlUsable(~seams=s, ())) |> toBe(false) |> ignore;
      switch (Zone.resolve(s)) {
      | Error("degrade") => expect(true) |> toBe(true)
      | _ => expect(false) |> toBe(true)
      };
    });

    test("throwOnWallFormat: resolve Ok then wallAt Error", () => {
      let s =
        seams(
          ~now=() => dateUtc(2026, 6, 20, 15, 0, 0),
          ~forceProbeA=Some(`Pass),
          ~forceLatnDisplay=true,
          ~throwOnWallFormat=true,
          (),
        );
      switch (Zone.resolve(s)) {
      | Error(_) => expect(false) |> toBe(true)
      | Ok(resolved) =>
        expect(resolved.throwOnWallFormat) |> toBe(true) |> ignore;
        switch (Zone.wallAt(~resolved, s.now())) {
        | Error("throw") => expect(true) |> toBe(true)
        | _ => expect(false) |> toBe(true)
        };
      };
    });

    test("Pass probe A without logicFmt: wallAt Error", () => {
      let s =
        seams(
          ~now=() => dateUtc(2026, 6, 20, 15, 0, 0),
          ~forceProbeA=Some(`Pass),
          ~forceLatnDisplay=true,
          (),
        );
      switch (Zone.resolve(s)) {
      | Error(_) => expect(false) |> toBe(true)
      | Ok(resolved) =>
        let broken = {...resolved, logicFmt: None};
        switch (Zone.wallAt(~resolved=broken, s.now())) {
        | Error("logicFmt") => expect(true) |> toBe(true)
        | _ => expect(false) |> toBe(true)
        };
      };
    });
  });
