module BellIcon = {
  [@react.component]
  let make = (~on: bool) =>
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="28"
      height="28"
      ariaHidden=true>
      <path
        d="M6.5 8.5a5.5 5.5 0 0 1 11 0c0 6.5 2.5 8.5 2.5 8.5H4s2.5-2 2.5-8.5"
      />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
      {on ? React.null : <path d="M4 4 L20 20" />}
    </svg>;
};

module App = {
  [@react.component]
  let make = () => {
    let seams = Zone.defaultSeams;

    let resolvedRef = React.useRef(None: option(Zone.resolved));
    let prevHourRef = React.useRef((-1));
    let bellRef = React.useRef(None: option(Bell.handle));

    let (state, setState) =
      React.useState(() =>
        if (!Zone.intlUsable(~seams, ())) {
          AppLogic.initDegrade(~nowMs=seams.now());
        } else {
          switch (Zone.nowWall(~seams, ())) {
          | Error(_) => AppLogic.initDegrade(~nowMs=seams.now())
          | Ok((resolved, wall)) =>
            /* Seed refs from the same wall as lastAnnouncedHour so a
               :00 rollover between init and useEffect cannot skip announce. */
            resolvedRef.current = Some(resolved);
            prevHourRef.current = wall.hour;
            AppLogic.initClock(~hhmm=wall.hhmm, ~hour=wall.hour)
          };
        }
      );

    let stateRef = React.useRef(state);

    let commit = (next: AppLogic.state) => {
      stateRef.current = next;
      setState(_ => next);
    };

    let cancelBell = () => {
      switch (bellRef.current) {
      | Some(h) => Bell.cancel(h)
      | None => ()
      };
      bellRef.current = None;
    };

    let toggleAudio = () => {
      let s = stateRef.current;
      if (s.mode == AppLogic.Degrade) {
        ();
      } else {
        let next = AppLogic.reduce(s, AppLogic.ToggleAudio);
        commit(next);
        if (!next.audioArmed) {
          switch (bellRef.current) {
          | Some(h) => Bell.setPlayEnabled(h, false)
          | None => ()
          };
        };
      };
    };

    let enterDegrade = () => {
      cancelBell();
      resolvedRef.current = None;
      commit(
        AppLogic.reduce(
          stateRef.current,
          AppLogic.EnterDegrade(AppLogic.unixSecondsText(seams.now())),
        ),
      );
    };

    let startAnnounce = (~label, ~hour, ~chimes) => {
      let s = stateRef.current;
      if (s.mode == AppLogic.Degrade) {
        ();
      } else if (s.mode == AppLogic.Announce && s.inFlightHour == Some(hour)) {
        ();
      } else {
        cancelBell();
        let next = AppLogic.reduce(s, AppLogic.StartAnnounce(label, hour));
        let gen = next.announceGen;
        commit(next);
        let handle =
          Bell.schedule(
            ~armed=s.audioArmed,
            ~n=chimes,
            ~src="bell.mp3",
            ~onComplete=
              () => {
                switch (resolvedRef.current) {
                | None => enterDegrade()
                | Some(resolved) =>
                  switch (Zone.wallAt(~resolved, seams.now())) {
                  | Error(_) => enterDegrade()
                  | Ok(wall) =>
                    commit(
                      AppLogic.completeAnnounce(
                        stateRef.current,
                        ~gen,
                        ~hhmm=wall.hhmm,
                        ~hour,
                      ),
                    )
                  };
                };
              },
            (),
          );
        bellRef.current = Some(handle);
      };
    };

    let handleWall = (~wall: Zone.wall, ~fromVisibility: bool) => {
      let s = stateRef.current;
      if (s.mode == AppLogic.Degrade) {
        ();
      } else {
        let prevHour =
          if (prevHourRef.current < 0) {
            wall.hour;
          } else {
            prevHourRef.current;
          };
        prevHourRef.current = wall.hour;

        let tabHidden =
          !fromVisibility && DomEvents.visibilityState == "hidden";

        let wantAnnounce =
          if (fromVisibility) {
            AppLogic.shouldAnnounceOnVisible(
              ~hour=wall.hour,
              ~minute=wall.minute,
              ~lastAnnouncedHour=s.lastAnnouncedHour,
              ~inFlightHour=s.inFlightHour,
            );
          } else {
            AppLogic.shouldAnnounceForeground(
              ~tabHidden,
              ~prevHour,
              ~hour=wall.hour,
              ~minute=wall.minute,
              ~lastAnnouncedHour=s.lastAnnouncedHour,
            );
          };

        /* Hour skipped while a sequence is in flight: cancel bell + bump
           announceGen via StartAnnounce so a stale onComplete cannot revert
           HHMM or set lastAnnouncedHour for the aborted hour. */
        let supersede =
          AppLogic.shouldSupersede(
            ~tabHidden,
            ~minute=wall.minute,
            ~hour=wall.hour,
            ~lastAnnouncedHour=s.lastAnnouncedHour,
            ~inFlightHour=s.inFlightHour,
          );

        if (wantAnnounce || supersede) {
          let label = ThaiClock.displayLabel(wall.hour);
          let chimes = ThaiClock.chimeCount(wall.hour);
          startAnnounce(~label, ~hour=wall.hour, ~chimes);
        } else if (s.mode == AppLogic.Clock && s.text != wall.hhmm) {
          commit(AppLogic.reduce(s, AppLogic.TickClock(wall.hhmm)));
        };
      };
    };

    let tick = (~fromVisibility) => {
      let s = stateRef.current;
      if (s.mode == AppLogic.Degrade) {
        let text = AppLogic.unixSecondsText(seams.now());
        if (s.text != text) {
          commit({...s, text});
        };
      } else {
        let resolved =
          switch (resolvedRef.current) {
          | Some(r) => Some(r)
          | None =>
            switch (Zone.resolve(seams)) {
            | Error(_) =>
              enterDegrade();
              None;
            | Ok(r) =>
              resolvedRef.current = Some(r);
              Some(r);
            }
          };
        switch (resolved) {
        | None => ()
        | Some(resolved) =>
          switch (Zone.wallAt(~resolved, seams.now())) {
          | Error(_) => enterDegrade()
          | Ok(wall) => handleWall(~wall, ~fromVisibility)
          }
        };
      };
    };

    React.useEffect0(() => {
      switch (stateRef.current.mode, resolvedRef.current) {
      | (AppLogic.Degrade, _)
      | (_, Some(_)) => ()
      | (_, None) =>
        switch (Zone.resolve(seams)) {
        | Error(_) => enterDegrade()
        | Ok(r) =>
          resolvedRef.current = Some(r);
          switch (Zone.wallAt(~resolved=r, seams.now())) {
          | Ok(wall) =>
            if (prevHourRef.current < 0) {
              prevHourRef.current = wall.hour;
            }
          | Error(_) => enterDegrade()
          };
        }
      };

      let id =
        Js.Global.setInterval(~f=() => tick(~fromVisibility=false), 1000);

      let onVis = () =>
        if (DomEvents.visibilityState != "hidden") {
          tick(~fromVisibility=true);
        };

      let onKey = (e: DomEvents.keyboardEvent) =>
        if (DomEvents.keyboardKey(e) == " "
            && !DomEvents.keyboardRepeat(e)
            && !DomEvents.keyTargetIsEditable(DomEvents.keyboardTarget(e))) {
          if (DomEvents.keyTargetIsBellButton(e)) {
            ();
          } else {
            DomEvents.preventDefault(e);
            toggleAudio();
          };
        };

      DomEvents.addDocumentListener("visibilitychange", onVis);
      DomEvents.addWindowKeyListener("keydown", onKey);

      Some(
        () => {
          Js.Global.clearInterval(id);
          DomEvents.removeDocumentListener("visibilitychange", onVis);
          DomEvents.removeWindowKeyListener("keydown", onKey);
          cancelBell();
        },
      );
    });

    let className =
      switch (state.mode) {
      | AppLogic.Clock => "clock"
      | AppLogic.Announce => "announce"
      | AppLogic.Degrade => "degrade"
      };

    let bellControl =
      if (state.mode == AppLogic.Degrade) {
        React.null;
      } else {
        let label =
          if (state.audioArmed) {
            {js|ปิดเสียงกระดิ่ง|js};
          } else {
            {js|เปิดเสียงกระดิ่ง|js};
          };
        <button
          type_="button"
          className="bell"
          ariaLabel=label
          ariaPressed={state.audioArmed ? "true" : "false"}
          onClick={_ => toggleAudio()}>
          <BellIcon on=state.audioArmed />
          <kbd className="bell-shortcut" ariaHidden=true>
            {React.string("Space")}
          </kbd>
        </button>;
      };

    <div className="app">
      <div className> {React.string(state.text)} </div>
      bellControl
    </div>;
  };
};

switch (ReactDOM.querySelector("#root")) {
| Some(element) =>
  let root = ReactDOM.Client.createRoot(element);
  ReactDOM.Client.render(root, <App />);
| None =>
  Js.Console.error("Failed to start React: couldn't find the #root element")
};
