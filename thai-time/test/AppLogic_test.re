open Jest;

let () =
  describe("AppLogic FSM", () => {
    open Expect;

    test("init at :00 does not announce — lastAnnouncedHour set", () => {
      let s = AppLogic.initClock(~hhmm="2200", ~hour=22);
      expect(s.mode) |> toEqual(AppLogic.Clock) |> ignore;
      expect(s.text) |> toBe("2200") |> ignore;
      expect(s.lastAnnouncedHour) |> toBe(22);
    });

    test("foreground :00 transition triggers shouldAnnounce", () => {
      expect(
        AppLogic.shouldAnnounceForeground(
          ~tabHidden=false,
          ~prevHour=21,
          ~hour=22,
          ~minute=0,
          ~lastAnnouncedHour=21,
        ),
      )
      |> toBe(true)
      |> ignore;
      expect(
        AppLogic.shouldAnnounceForeground(
          ~tabHidden=false,
          ~prevHour=22,
          ~hour=22,
          ~minute=0,
          ~lastAnnouncedHour=22,
        ),
      )
      |> toBe(false)
      |> ignore;
      expect(
        AppLogic.shouldAnnounceForeground(
          ~tabHidden=false,
          ~prevHour=21,
          ~hour=22,
          ~minute=1,
          ~lastAnnouncedHour=21,
        ),
      )
      |> toBe(false);
    });

    test("visibility at :30 does not announce; at :00 does", () => {
      expect(
        AppLogic.shouldAnnounceOnVisible(
          ~hour=22,
          ~minute=30,
          ~lastAnnouncedHour=21,
          ~inFlightHour=None,
        ),
      )
      |> toBe(false)
      |> ignore;
      expect(
        AppLogic.shouldAnnounceOnVisible(
          ~hour=22,
          ~minute=0,
          ~lastAnnouncedHour=21,
          ~inFlightHour=None,
        ),
      )
      |> toBe(true);
    });

    test("supersede at :00 when a different hour is in flight", () => {
      expect(
        AppLogic.shouldSupersede(
          ~tabHidden=false,
          ~minute=0,
          ~hour=23,
          ~lastAnnouncedHour=21,
          ~inFlightHour=Some(22),
        ),
      )
      |> toBe(true)
      |> ignore;
      expect(
        AppLogic.shouldSupersede(
          ~tabHidden=false,
          ~minute=0,
          ~hour=22,
          ~lastAnnouncedHour=21,
          ~inFlightHour=Some(22),
        ),
      )
      |> toBe(false)
      |> ignore;
      expect(
        AppLogic.shouldSupersede(
          ~tabHidden=false,
          ~minute=30,
          ~hour=23,
          ~lastAnnouncedHour=21,
          ~inFlightHour=Some(22),
        ),
      )
      |> toBe(false)
      |> ignore;
      expect(
        AppLogic.shouldSupersede(
          ~tabHidden=false,
          ~minute=0,
          ~hour=23,
          ~lastAnnouncedHour=21,
          ~inFlightHour=None,
        ),
      )
      |> toBe(false);
    });

    test("hidden tab does not foreground-announce or supersede", () => {
      expect(
        AppLogic.shouldAnnounceForeground(
          ~tabHidden=true,
          ~prevHour=21,
          ~hour=22,
          ~minute=0,
          ~lastAnnouncedHour=21,
        ),
      )
      |> toBe(false)
      |> ignore;
      expect(
        AppLogic.shouldSupersede(
          ~tabHidden=true,
          ~minute=0,
          ~hour=23,
          ~lastAnnouncedHour=21,
          ~inFlightHour=Some(22),
        ),
      )
      |> toBe(false);
    });

    test("visibility at :00 does not restart an in-flight same hour", () => {
      expect(
        AppLogic.shouldAnnounceOnVisible(
          ~hour=22,
          ~minute=0,
          ~lastAnnouncedHour=21,
          ~inFlightHour=Some(22),
        ),
      )
      |> toBe(false)
      |> ignore;
      expect(
        AppLogic.shouldAnnounceOnVisible(
          ~hour=23,
          ~minute=0,
          ~lastAnnouncedHour=21,
          ~inFlightHour=Some(22),
        ),
      )
      |> toBe(true);
    });

    test("start announce then complete via reduce sets lastAnnouncedHour", () => {
      let s0 = AppLogic.initClock(~hhmm="2159", ~hour=21);
      let s1 =
        AppLogic.reduce(s0, AppLogic.StartAnnounce({js|สี่ทุ่ม|js}, 22));
      expect(s1.mode) |> toEqual(AppLogic.Announce) |> ignore;
      expect(s1.text) |> toBe({js|สี่ทุ่ม|js}) |> ignore;
      expect(s1.lastAnnouncedHour) |> toBe(21) |> ignore;
      expect(s1.inFlightHour) |> toEqual(Some(22)) |> ignore;
      let gen = s1.announceGen;
      let s2 =
        AppLogic.reduce(
          s1,
          AppLogic.CompleteAnnounce(gen, "2200", 22),
        );
      expect(s2.mode) |> toEqual(AppLogic.Clock) |> ignore;
      expect(s2.text) |> toBe("2200") |> ignore;
      expect(s2.lastAnnouncedHour) |> toBe(22) |> ignore;
      expect(s2.inFlightHour) |> toEqual(None);
    });

    test("completeAnnounce is the same reduce path", () => {
      let s0 = AppLogic.initClock(~hhmm="2159", ~hour=21);
      let s1 =
        AppLogic.reduce(s0, AppLogic.StartAnnounce({js|สี่ทุ่ม|js}, 22));
      let gen = s1.announceGen;
      let viaHelper =
        AppLogic.completeAnnounce(s1, ~gen, ~hhmm="2200", ~hour=22);
      let viaReduce =
        AppLogic.reduce(
          s1,
          AppLogic.CompleteAnnounce(gen, "2200", 22),
        );
      expect(viaHelper.lastAnnouncedHour) |> toBe(22) |> ignore;
      expect(viaReduce.lastAnnouncedHour) |> toBe(22);
    });

    test("supersede: stale complete ignored; new complete wins", () => {
      let s0 = AppLogic.initClock(~hhmm="2159", ~hour=21);
      let s1 =
        AppLogic.reduce(s0, AppLogic.StartAnnounce({js|สี่ทุ่ม|js}, 22));
      let gen1 = s1.announceGen;
      let s2 =
        AppLogic.reduce(s1, AppLogic.StartAnnounce({js|ห้าทุ่ม|js}, 23));
      let gen2 = s2.announceGen;
      expect(gen2) |> toBeGreaterThan(gen1) |> ignore;
      let stale =
        AppLogic.completeAnnounce(s2, ~gen=gen1, ~hhmm="2200", ~hour=22);
      expect(stale.mode) |> toEqual(AppLogic.Announce) |> ignore;
      expect(stale.lastAnnouncedHour) |> toBe(21) |> ignore;
      let done_ =
        AppLogic.completeAnnounce(s2, ~gen=gen2, ~hhmm="2300", ~hour=23);
      expect(done_.mode) |> toEqual(AppLogic.Clock) |> ignore;
      expect(done_.lastAnnouncedHour) |> toBe(23);
    });

    test("ToggleAudio flips audioArmed; mid-announce keeps inFlightHour", () => {
      let s0 = AppLogic.initClock(~hhmm="2159", ~hour=21);
      expect(s0.audioArmed) |> toBe(false) |> ignore;
      let s1 =
        AppLogic.reduce(s0, AppLogic.StartAnnounce({js|สี่ทุ่ม|js}, 22));
      expect(s1.mode) |> toEqual(AppLogic.Announce) |> ignore;
      expect(s1.inFlightHour) |> toEqual(Some(22)) |> ignore;
      let s2 = AppLogic.reduce(s1, AppLogic.ToggleAudio);
      expect(s2.audioArmed) |> toBe(true) |> ignore;
      expect(s2.mode) |> toEqual(AppLogic.Announce) |> ignore;
      expect(s2.inFlightHour) |> toEqual(Some(22)) |> ignore;
      expect(s2.text) |> toBe({js|สี่ทุ่ม|js}) |> ignore;
      let s3 = AppLogic.reduce(s2, AppLogic.ToggleAudio);
      expect(s3.audioArmed) |> toBe(false) |> ignore;
      expect(s3.mode) |> toEqual(AppLogic.Announce) |> ignore;
      expect(s3.inFlightHour) |> toEqual(Some(22));
    });

    test("armed announce starts with audioArmed still true", () => {
      let s0 = {
        ...AppLogic.initClock(~hhmm="2159", ~hour=21),
        audioArmed: true,
      };
      let s1 =
        AppLogic.reduce(s0, AppLogic.StartAnnounce({js|สี่ทุ่ม|js}, 22));
      expect(s1.audioArmed) |> toBe(true) |> ignore;
      expect(s1.inFlightHour) |> toEqual(Some(22));
    });

    test("degrade mode ignores announce and ToggleAudio", () => {
      let s0 = AppLogic.initDegrade(~nowMs=1_000_000.);
      expect(s0.mode) |> toEqual(AppLogic.Degrade) |> ignore;
      expect(s0.text) |> toBe("1000") |> ignore;
      let s1 =
        AppLogic.reduce(s0, AppLogic.StartAnnounce({js|สี่ทุ่ม|js}, 22));
      expect(s1.mode) |> toEqual(AppLogic.Degrade) |> ignore;
      expect(s1.text) |> toBe("1000") |> ignore;
      let s2 = AppLogic.reduce(s0, AppLogic.ToggleAudio);
      expect(s2.audioArmed) |> toBe(false);
    });

    test("enter degrade from clock", () => {
      let s0 = AppLogic.initClock(~hhmm="2200", ~hour=22);
      let s1 = AppLogic.reduce(s0, AppLogic.EnterDegrade("1700000000"));
      expect(s1.mode) |> toEqual(AppLogic.Degrade) |> ignore;
      expect(s1.text) |> toBe("1700000000");
    });

    test("mid-announce degrade bumps gen so stale complete is ignored", () => {
      let s0 = {
        ...AppLogic.initClock(~hhmm="2159", ~hour=21),
        audioArmed: true,
      };
      let s1 =
        AppLogic.reduce(s0, AppLogic.StartAnnounce({js|สี่ทุ่ม|js}, 22));
      let gen = s1.announceGen;
      let s2 = AppLogic.reduce(s1, AppLogic.EnterDegrade("1700000000"));
      expect(s2.mode) |> toEqual(AppLogic.Degrade) |> ignore;
      expect(s2.announceGen) |> toBeGreaterThan(gen) |> ignore;
      expect(s2.audioArmed) |> toBe(true) |> ignore;
      expect(s2.lastAnnouncedHour) |> toBe(21) |> ignore;
      expect(s2.inFlightHour) |> toEqual(None) |> ignore;
      let stale =
        AppLogic.completeAnnounce(s2, ~gen, ~hhmm="2200", ~hour=22);
      expect(stale.mode) |> toEqual(AppLogic.Degrade) |> ignore;
      expect(stale.text) |> toBe("1700000000") |> ignore;
      expect(stale.lastAnnouncedHour) |> toBe(21);
    });

    test("TickClock updates clock HHMM; ignored during announce", () => {
      let s0 = AppLogic.initClock(~hhmm="2159", ~hour=21);
      let s1 = AppLogic.reduce(s0, AppLogic.TickClock("2200"));
      expect(s1.mode) |> toEqual(AppLogic.Clock) |> ignore;
      expect(s1.text) |> toBe("2200") |> ignore;
      let s2 =
        AppLogic.reduce(s0, AppLogic.StartAnnounce({js|สี่ทุ่ม|js}, 22));
      let s3 = AppLogic.reduce(s2, AppLogic.TickClock("2200"));
      expect(s3.mode) |> toEqual(AppLogic.Announce) |> ignore;
      expect(s3.text) |> toBe({js|สี่ทุ่ม|js});
    });

    test("unixSecondsText uses Math.floor, not 32-bit int", () => {
      expect(AppLogic.unixSecondsText(1_000_000.)) |> toBe("1000") |> ignore;
      expect(AppLogic.unixSecondsText(3_000_000_000_000.))
      |> toBe("3000000000");
    });

    test("silent announce duration formula", () => {
      expect(Bell.silentAnnounceDurationMs(4))
      |> toBe(4 * Bell.chimeGapMs + Bell.postChimeTailMs);
    });

    test("armed announce duration uses sample + tail after last start", () => {
      expect(Bell.armedAnnounceDurationMs(4))
      |> toBe(
           3 * Bell.chimeGapMs + Bell.sampleDurationMs + Bell.postChimeTailMs,
         )
      |> ignore;
      expect(Bell.armedAnnounceDurationMs(1))
      |> toBe(Bell.sampleDurationMs + Bell.postChimeTailMs)
      |> ignore;
      expect(Bell.armedAnnounceDurationMs(0))
      |> toBe(Bell.postChimeTailMs)
      |> ignore;
      expect(Bell.silentAnnounceDurationMs(0))
      |> toBe(Bell.postChimeTailMs);
    });
  });
