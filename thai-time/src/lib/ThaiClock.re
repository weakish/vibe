/** Thai six-hour labels and independent chime counts. */

let displayLabel = (hour: int): string =>
  switch (hour) {
  | 0 => {js|เที่ยงคืน|js}
  | 1 => {js|ตีหนึ่ง|js}
  | 2 => {js|ตีสอง|js}
  | 3 => {js|ตีสาม|js}
  | 4 => {js|ตีสี่|js}
  | 5 => {js|ตีห้า|js}
  | 6 => {js|ย่ำรุ่ง|js}
  | 7 => {js|หนึ่งโมงเช้า|js}
  | 8 => {js|สองโมงเช้า|js}
  | 9 => {js|สามโมงเช้า|js}
  | 10 => {js|สี่โมงเช้า|js}
  | 11 => {js|ห้าโมงเช้า|js}
  | 12 => {js|เที่ยงวัน|js}
  | 13 => {js|บ่ายโมง|js}
  | 14 => {js|บ่ายสองโมง|js}
  | 15 => {js|บ่ายสามโมง|js}
  | 16 => {js|สี่โมงเย็น|js}
  | 17 => {js|ห้าโมงเย็น|js}
  | 18 => {js|หกโมงเย็น|js}
  | 19 => {js|หนึ่งทุ่ม|js}
  | 20 => {js|สองทุ่ม|js}
  | 21 => {js|สามทุ่ม|js}
  | 22 => {js|สี่ทุ่ม|js}
  | 23 => {js|ห้าทุ่ม|js}
  | _ => ""
  };

/** Six-hour index 1–6 within each block (not 24h / 12h). */
let chimeCount = (hour: int): int =>
  switch (hour) {
  | 0
  | 6
  | 12 => 6
  | h when h >= 1 && h <= 5 => h
  | h when h >= 7 && h <= 11 => h - 6
  | h when h >= 13 && h <= 18 => h - 12
  | h when h >= 19 && h <= 23 => h - 18
  | _ => 0
  };
