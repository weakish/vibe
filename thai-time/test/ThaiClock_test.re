open Jest;

let expectedLabels = [|
  {js|เที่ยงคืน|js},
  {js|ตีหนึ่ง|js},
  {js|ตีสอง|js},
  {js|ตีสาม|js},
  {js|ตีสี่|js},
  {js|ตีห้า|js},
  {js|ย่ำรุ่ง|js},
  {js|หนึ่งโมงเช้า|js},
  {js|สองโมงเช้า|js},
  {js|สามโมงเช้า|js},
  {js|สี่โมงเช้า|js},
  {js|ห้าโมงเช้า|js},
  {js|เที่ยงวัน|js},
  {js|บ่ายโมง|js},
  {js|บ่ายสองโมง|js},
  {js|บ่ายสามโมง|js},
  {js|สี่โมงเย็น|js},
  {js|ห้าโมงเย็น|js},
  {js|หกโมงเย็น|js},
  {js|หนึ่งทุ่ม|js},
  {js|สองทุ่ม|js},
  {js|สามทุ่ม|js},
  {js|สี่ทุ่ม|js},
  {js|ห้าทุ่ม|js},
|];

let expectedChimes = [|6, 1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5|];

let hasDigit = (s: string): bool => {
  let len = Js.String.length(s);
  let rec loop = i =>
    if (i >= len) {
      false;
    } else {
      let code = Js.String.charCodeAt(~index=i, s);
      let latin = code >= 48. && code <= 57.;
      let thai = code >= 0x0E50. && code <= 0x0E59.;
      latin || thai || loop(i + 1);
    };
  loop(0);
};

let () =
  describe("ThaiClock", () => {
    open Expect;

    testAll(
      "displayLabel matches table",
      Belt.List.makeBy(24, i => i),
      hour =>
        expect(ThaiClock.displayLabel(hour))
        |> toBe(expectedLabels[hour]),
    );

    testAll(
      "chimeCount matches table",
      Belt.List.makeBy(24, i => i),
      hour => expect(ThaiClock.chimeCount(hour)) |> toBe(expectedChimes[hour]),
    );

    test("rejects forbidden alternatives", () => {
      expect(ThaiClock.displayLabel(6)) |> not_ |> toBe({js|ตีหก|js}) |> ignore;
      expect(ThaiClock.displayLabel(16))
      |> not_
      |> toBe({js|บ่ายสี่โมง|js})
      |> ignore;
      expect(ThaiClock.displayLabel(17))
      |> not_
      |> toBe({js|บ่ายห้าโมง|js})
      |> ignore;
      expect(ThaiClock.displayLabel(18))
      |> not_
      |> toBe({js|ย่ำค่ำ|js})
      |> ignore;
      expect(ThaiClock.displayLabel(0))
      |> not_
      |> toBe({js|หกทุ่ม|js});
    });

    testAll(
      "displayLabel has no digits",
      Belt.List.makeBy(24, i => i),
      hour => expect(hasDigit(ThaiClock.displayLabel(hour))) |> toBe(false),
    );

    test("22:00 is สี่ทุ่ม with 4 chimes", () => {
      expect(ThaiClock.displayLabel(22)) |> toBe({js|สี่ทุ่ม|js}) |> ignore;
      expect(ThaiClock.chimeCount(22)) |> toBe(4);
    });
  });
