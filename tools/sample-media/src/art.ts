import type { SampleArt } from '@r10c/utils-ts-fleet';

/**
 * One drawing per kind of product, inside a 400 × 400 box, in two inks: the
 * category's tone and a dark outline. Deliberately plain — a recognisable
 * silhouette, not a photograph pretending to be the product — so nobody
 * mistakes a sample store's picture for a real listing.
 */
type Drawing = (tone: string, ink: string) => string;

const stroke = (ink: string, width = 10) =>
  `stroke="${ink}" stroke-width="${String(width)}" stroke-linecap="round" stroke-linejoin="round"`;

const coil: Drawing = (tone, ink) =>
  `<circle cx="200" cy="200" r="150" fill="${tone}" ${stroke(ink)}/>` +
  `<circle cx="200" cy="200" r="105" fill="none" ${stroke(ink, 6)} opacity=".45"/>` +
  `<circle cx="200" cy="200" r="60" fill="#fff" ${stroke(ink)}/>` +
  `<path d="M350 200 C 390 260 380 330 330 370" fill="none" ${stroke(ink, 14)}/>`;

const screw: Drawing = (tone, ink) =>
  `<rect x="140" y="40" width="120" height="44" rx="12" fill="${tone}" ${stroke(ink)}/>` +
  `<path d="M175 84 L225 84 L215 330 L200 370 L185 330 Z" fill="${tone}" ${stroke(ink)}/>` +
  [120, 160, 200, 240, 280]
    .map(
      y =>
        `<path d="M170 ${String(y)} L230 ${String(y + 18)}" ${stroke(ink, 8)}/>`,
    )
    .join('') +
  `<path d="M180 62 L220 62" ${stroke(ink, 8)}/>`;

const nail: Drawing = (tone, ink) =>
  `<rect x="120" y="50" width="160" height="30" rx="10" fill="${tone}" ${stroke(ink)}/>` +
  `<path d="M188 80 L212 80 L206 330 L200 370 L194 330 Z" fill="${tone}" ${stroke(ink)}/>`;

const anchor: Drawing = (tone, ink) =>
  `<path d="M160 60 L240 60 L250 320 L200 360 L150 320 Z" fill="${tone}" ${stroke(ink)}/>` +
  `<path d="M200 60 L200 330" ${stroke(ink, 6)}/>` +
  [120, 180, 240]
    .map(
      y => `<path d="M156 ${String(y)} L244 ${String(y)}" ${stroke(ink, 6)}/>`,
    )
    .join('');

const plate: (inner: string) => Drawing = inner => (tone, ink) =>
  `<rect x="80" y="40" width="240" height="320" rx="24" fill="#fff" ${stroke(ink)}/>` +
  `<rect x="130" y="100" width="140" height="200" rx="16" fill="${tone}" ${stroke(ink)}/>` +
  inner;

const switchPlate = plate(
  '<rect x="182" y="150" width="36" height="100" rx="10" fill="#fff"/>',
);
const socket = plate(
  '<rect x="165" y="135" width="16" height="40" rx="4" fill="#fff"/><rect x="219" y="135" width="16" height="40" rx="4" fill="#fff"/>' +
    '<rect x="165" y="225" width="16" height="40" rx="4" fill="#fff"/><rect x="219" y="225" width="16" height="40" rx="4" fill="#fff"/>',
);

const box: Drawing = (tone, ink) =>
  `<path d="M90 120 L200 60 L310 120 L310 300 L200 360 L90 300 Z" fill="${tone}" ${stroke(ink)}/>` +
  `<path d="M90 120 L200 180 L310 120 M200 180 L200 360" fill="none" ${stroke(ink)}/>`;

const hammer: Drawing = (tone, ink) =>
  `<rect x="185" y="140" width="34" height="230" rx="14" fill="${tone}" ${stroke(ink)}/>` +
  `<path d="M90 70 L280 70 Q330 70 330 110 L330 120 L90 140 Z" fill="#9aa3ab" ${stroke(ink)}/>`;

const screwdriver: Drawing = (tone, ink) =>
  `<rect x="160" y="40" width="80" height="150" rx="30" fill="${tone}" ${stroke(ink)}/>` +
  `<rect x="190" y="190" width="20" height="150" fill="#9aa3ab" ${stroke(ink, 8)}/>` +
  `<path d="M190 340 L210 340 L205 372 L195 372 Z" fill="#9aa3ab" ${stroke(ink, 8)}/>`;

const tape: Drawing = (tone, ink) =>
  `<rect x="70" y="80" width="250" height="250" rx="50" fill="${tone}" ${stroke(ink)}/>` +
  `<circle cx="195" cy="205" r="60" fill="#fff" ${stroke(ink)}/>` +
  `<rect x="300" y="290" width="60" height="30" fill="#f2c94c" ${stroke(ink, 8)}/>`;

const pliers: Drawing = (tone, ink) =>
  `<path d="M150 380 L190 200 M250 380 L210 200" fill="none" stroke="${tone}" stroke-width="40" stroke-linecap="round"/>` +
  `<path d="M190 200 L170 50 L200 30 L215 190 M210 200 L230 50 L200 30" fill="#9aa3ab" ${stroke(ink)}/>` +
  `<circle cx="200" cy="200" r="16" fill="#fff" ${stroke(ink)}/>`;

const valve: Drawing = (tone, ink) =>
  `<rect x="40" y="220" width="320" height="70" rx="10" fill="#fff" ${stroke(ink)}/>` +
  `<rect x="150" y="180" width="100" height="150" rx="20" fill="${tone}" ${stroke(ink)}/>` +
  `<rect x="190" y="90" width="20" height="90" fill="#9aa3ab" ${stroke(ink, 8)}/>` +
  `<rect x="110" y="60" width="180" height="40" rx="18" fill="${tone}" ${stroke(ink)}/>`;

const pipe: Drawing = (tone, ink) =>
  `<rect x="40" y="160" width="320" height="80" rx="8" fill="#fff" ${stroke(ink)}/>` +
  `<ellipse cx="360" cy="200" rx="20" ry="40" fill="${tone}" ${stroke(ink)}/>` +
  `<path d="M60 200 L330 200" ${stroke(ink, 4)} opacity=".35"/>`;

const saw: Drawing = (tone, ink) =>
  `<path d="M60 120 L60 300 L340 300 L340 120" fill="none" stroke="${tone}" stroke-width="30" stroke-linejoin="round"/>` +
  `<path d="M60 280 ${Array.from({ length: 14 }, (_, i) => `L${String(70 + i * 20)} ${i % 2 === 0 ? '300' : '280'}`).join(' ')} L340 280" fill="#9aa3ab" ${stroke(ink, 6)}/>`;

const level: Drawing = (tone, ink) =>
  `<rect x="30" y="150" width="340" height="100" rx="12" fill="${tone}" ${stroke(ink)}/>` +
  `<rect x="160" y="175" width="80" height="50" rx="25" fill="#b6e3a8" ${stroke(ink, 8)}/>` +
  `<circle cx="200" cy="200" r="12" fill="#fff"/>`;

const drill: Drawing = (tone, ink) =>
  [100, 160, 220, 280]
    .map(
      (x, i) =>
        `<path d="M${String(x)} ${String(60 + i * 10)} L${String(x)} 350" stroke="${i % 2 === 0 ? tone : '#9aa3ab'}" stroke-width="${String(26 - i * 4)}" stroke-linecap="round"/>` +
        `<path d="M${String(x - 10)} 120 L${String(x + 10)} 150 M${String(x - 10)} 180 L${String(x + 10)} 210 M${String(x - 10)} 240 L${String(x + 10)} 270" ${stroke(ink, 5)}/>`,
    )
    .join('');

const bottle: Drawing = (tone, ink) =>
  `<rect x="170" y="40" width="60" height="50" rx="8" fill="#40403f" ${stroke(ink)}/>` +
  `<path d="M150 90 L250 90 L280 140 L280 360 L120 360 L120 140 Z" fill="${tone}" ${stroke(ink)}/>` +
  `<rect x="140" y="190" width="120" height="110" rx="10" fill="#fff" ${stroke(ink, 6)}/>`;

const phone = (tone: string, ink: string) =>
  `<rect x="120" y="30" width="160" height="340" rx="34" fill="${tone}" ${stroke(ink)}/>`;

const phoneCase: Drawing = (tone, ink) =>
  phone(tone, ink) +
  `<rect x="145" y="55" width="60" height="80" rx="18" fill="#fff" ${stroke(ink, 6)}/>` +
  `<circle cx="175" cy="80" r="12" fill="${ink}"/><circle cx="175" cy="112" r="12" fill="${ink}"/>`;

const glass: Drawing = (tone, ink) =>
  `<rect x="110" y="30" width="180" height="340" rx="34" fill="#e8f2f8" ${stroke(ink)}/>` +
  `<rect x="130" y="50" width="140" height="300" rx="24" fill="${tone}" opacity=".35"/>` +
  `<path d="M150 120 L230 60 M150 190 L260 100" stroke="#fff" stroke-width="12" stroke-linecap="round"/>`;

const charger: Drawing = (tone, ink) =>
  `<rect x="110" y="110" width="180" height="200" rx="30" fill="#fff" ${stroke(ink)}/>` +
  `<rect x="160" y="40" width="20" height="70" fill="#9aa3ab" ${stroke(ink, 6)}/>` +
  `<rect x="220" y="40" width="20" height="70" fill="#9aa3ab" ${stroke(ink, 6)}/>` +
  `<rect x="170" y="240" width="60" height="24" rx="12" fill="${tone}" ${stroke(ink, 6)}/>`;

const usb: Drawing = (tone, ink) =>
  `<path d="M200 70 C 60 120 60 280 200 330" fill="none" stroke="${tone}" stroke-width="22" stroke-linecap="round"/>` +
  `<rect x="180" y="30" width="60" height="70" rx="12" fill="#fff" ${stroke(ink)}/>` +
  `<rect x="180" y="300" width="60" height="70" rx="12" fill="#fff" ${stroke(ink)}/>`;

const earbuds: Drawing = (tone, ink) =>
  `<rect x="90" y="190" width="220" height="150" rx="70" fill="#fff" ${stroke(ink)}/>` +
  `<path d="M90 255 L310 255" ${stroke(ink, 6)}/>` +
  `<circle cx="150" cy="120" r="50" fill="${tone}" ${stroke(ink)}/>` +
  `<circle cx="250" cy="120" r="50" fill="${tone}" ${stroke(ink)}/>`;

const holder: Drawing = (tone, ink) =>
  `<circle cx="200" cy="150" r="110" fill="${tone}" ${stroke(ink)}/>` +
  `<circle cx="200" cy="150" r="50" fill="#fff" ${stroke(ink, 6)}/>` +
  `<rect x="180" y="260" width="40" height="100" rx="12" fill="#40403f" ${stroke(ink)}/>`;

const battery: Drawing = (tone, ink) =>
  `<rect x="110" y="50" width="180" height="300" rx="30" fill="${tone}" ${stroke(ink)}/>` +
  [100, 160, 220]
    .map(
      y =>
        `<rect x="150" y="${String(y)}" width="100" height="40" rx="8" fill="#fff"/>`,
    )
    .join('');

const roll: Drawing = (tone, ink) =>
  `<path d="M90 120 L320 120 L320 300 L90 300" fill="${tone}" ${stroke(ink)}/>` +
  `<ellipse cx="90" cy="210" rx="50" ry="90" fill="${tone}" ${stroke(ink)}/>` +
  `<ellipse cx="90" cy="210" rx="16" ry="30" fill="#fff" ${stroke(ink, 6)}/>` +
  `<path d="M320 300 L360 360 L130 360 L90 300" fill="${tone}" opacity=".7" ${stroke(ink)}/>`;

const sole: Drawing = (tone, ink) =>
  `<path d="M200 30 C 290 30 300 130 280 190 C 265 240 290 300 260 350 C 230 390 160 390 140 350 C 115 300 140 240 120 190 C 100 130 110 30 200 30 Z" fill="${tone}" ${stroke(ink)}/>` +
  [90, 150, 290]
    .map(
      y =>
        `<path d="M150 ${String(y)} L250 ${String(y)}" ${stroke(ink, 6)} opacity=".45"/>`,
    )
    .join('');

const heel: Drawing = (tone, ink) =>
  `<path d="M120 60 L300 60 L280 120 L240 340 L190 340 L180 140 Q130 120 120 60 Z" fill="${tone}" ${stroke(ink)}/>` +
  `<rect x="185" y="330" width="60" height="30" rx="6" fill="#40403f" ${stroke(ink, 6)}/>`;

const insole: Drawing = (tone, ink) =>
  `<path d="M150 30 C 220 30 225 130 210 190 C 200 240 220 300 200 350 C 180 390 120 390 105 350 C 85 300 105 240 90 190 C 75 130 80 30 150 30 Z" fill="${tone}" ${stroke(ink)}/>` +
  `<path d="M270 30 C 340 30 345 130 330 190 C 320 240 340 300 320 350 C 300 390 240 390 225 350" fill="none" ${stroke(ink)}/>`;

const thread: Drawing = (tone, ink) =>
  `<rect x="120" y="40" width="160" height="40" rx="8" fill="#c9a36b" ${stroke(ink)}/>` +
  `<rect x="120" y="320" width="160" height="40" rx="8" fill="#c9a36b" ${stroke(ink)}/>` +
  `<rect x="140" y="80" width="120" height="240" fill="${tone}" ${stroke(ink)}/>` +
  [120, 160, 200, 240, 280]
    .map(
      y =>
        `<path d="M140 ${String(y)} L260 ${String(y + 10)}" ${stroke(ink, 4)} opacity=".5"/>`,
    )
    .join('');

const buckle: Drawing = (tone, ink) =>
  `<rect x="80" y="90" width="240" height="220" rx="40" fill="none" stroke="${tone}" stroke-width="36"/>` +
  `<rect x="80" y="90" width="240" height="220" rx="40" fill="none" ${stroke(ink, 6)}/>` +
  `<path d="M200 90 L200 300" ${stroke(ink, 18)}/>`;

const eyelet: Drawing = (tone, ink) =>
  [
    [130, 130],
    [270, 130],
    [130, 270],
    [270, 270],
  ]
    .map(
      ([x, y]) =>
        `<circle cx="${String(x)}" cy="${String(y)}" r="60" fill="${tone}" ${stroke(ink)}/>` +
        `<circle cx="${String(x)}" cy="${String(y)}" r="26" fill="#fff" ${stroke(ink, 6)}/>`,
    )
    .join('');

const zipper: Drawing = (tone, ink) =>
  `<rect x="140" y="30" width="120" height="340" rx="10" fill="${tone}" ${stroke(ink)}/>` +
  Array.from(
    { length: 14 },
    (_, i) =>
      `<rect x="${i % 2 === 0 ? '185' : '200'}" y="${String(50 + i * 20)}" width="15" height="12" fill="#9aa3ab"/>`,
  ).join('') +
  `<rect x="170" y="120" width="60" height="70" rx="10" fill="#9aa3ab" ${stroke(ink, 6)}/>`;

const laces: Drawing = (tone, ink) =>
  `<path d="M80 80 C 320 80 80 200 320 200 C 80 200 320 320 80 320" fill="none" stroke="${tone}" stroke-width="20" stroke-linecap="round"/>` +
  `<rect x="60" y="60" width="40" height="18" rx="6" fill="${ink}"/><rect x="60" y="312" width="40" height="18" rx="6" fill="${ink}"/>`;

const wire: Drawing = (tone, ink) =>
  `<ellipse cx="200" cy="200" rx="150" ry="110" fill="none" stroke="${tone}" stroke-width="24"/>` +
  `<ellipse cx="200" cy="200" rx="120" ry="85" fill="none" stroke="${tone}" stroke-width="16" opacity=".7"/>` +
  `<ellipse cx="200" cy="200" rx="150" ry="110" fill="none" ${stroke(ink, 4)}/>`;

export const DRAWINGS: Readonly<Record<SampleArt, Drawing>> = {
  cable: coil,
  wire,
  screw,
  nail,
  anchor,
  switch: switchPlate,
  socket,
  box,
  hammer,
  screwdriver,
  tape,
  pliers,
  valve,
  pipe,
  saw,
  level,
  drill,
  bottle,
  case: phoneCase,
  glass,
  charger,
  usb,
  earbuds,
  holder,
  battery,
  roll,
  sole,
  heel,
  insole,
  thread,
  buckle,
  eyelet,
  zipper,
  laces,
};
